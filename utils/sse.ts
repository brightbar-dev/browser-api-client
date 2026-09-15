/**
 * Server-Sent Events (text/event-stream) parsing, following the WHATWG HTML
 * standard's "Parsing an event stream" and "Interpreting an event stream".
 */

export interface SseEvent {
  /** The last event ID in effect when this event was dispatched (persists across events). */
  id: string;
  /** Event type; "message" when the stream gave none. */
  event: string;
  data: string;
  /** The most recent valid `retry` value (ms) received since the previous dispatched event. */
  retry?: number;
  receivedAt: number;
}

export interface SseParser {
  /** Feed decoded text. Chunks may split lines, and CRLF pairs, anywhere. */
  push(chunk: string): void;
  /**
   * End of stream: an incomplete event (no terminating blank line) is discarded.
   * The parser can then be reused for a reconnected stream; the last event ID
   * and reconnection time carry over.
   */
  end(): void;
  lastEventId(): string;
  /** The reconnection time (ms) most recently set by a `retry` field, if any. */
  retry(): number | undefined;
}

const LF = 10;
const CR = 13;
const COLON = 0x3a;
const SPACE = 0x20;
const BOM = 0xfeff;

export function createSseParser(onEvent: (e: SseEvent) => void, now: () => number = Date.now): SseParser {
  let lineBuffer = '';
  let atStreamStart = true;
  let skipLeadingLF = false;

  let data = '';
  let eventType = '';
  let idBuffer = '';
  let lastId = '';
  let pendingRetry: number | undefined;
  let reconnectionTime: number | undefined;

  let hasError = false;
  let firstError: unknown;

  const dispatch = () => {
    lastId = idBuffer;
    if (data === '') {
      eventType = '';
      return;
    }
    const event: SseEvent = {
      id: lastId,
      event: eventType || 'message',
      data: data.charCodeAt(data.length - 1) === LF ? data.slice(0, -1) : data,
      receivedAt: now(),
    };
    if (pendingRetry !== undefined) event.retry = pendingRetry;
    data = '';
    eventType = '';
    pendingRetry = undefined;
    try {
      onEvent(event);
    } catch (e) {
      // Finish the chunk so no stream data is lost, then rethrow from push().
      if (!hasError) {
        hasError = true;
        firstError = e;
      }
    }
  };

  const processLine = (line: string) => {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.charCodeAt(0) === COLON) return; // comment
    const colon = line.indexOf(':');
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.charCodeAt(0) === SPACE) value = value.slice(1);
    }
    switch (field) {
      case 'event':
        eventType = value;
        break;
      case 'data':
        data += value + '\n';
        break;
      case 'id':
        if (!value.includes('\0')) idBuffer = value;
        break;
      case 'retry':
        if (/^[0-9]+$/.test(value)) {
          const ms = Number(value);
          if (Number.isSafeInteger(ms)) {
            pendingRetry = ms;
            reconnectionTime = ms;
          }
        }
        break;
      default:
        break; // unknown fields are ignored
    }
  };

  return {
    push(chunk: string) {
      if (chunk.length === 0) return;
      let text = chunk;
      if (atStreamStart) {
        atStreamStart = false;
        if (text.charCodeAt(0) === BOM) text = text.slice(1);
      }
      let start = 0;
      if (skipLeadingLF && text.length > 0) {
        skipLeadingLF = false;
        if (text.charCodeAt(0) === LF) start = 1;
      }
      for (let i = start; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c !== LF && c !== CR) continue;
        const line = lineBuffer + text.slice(start, i);
        lineBuffer = '';
        if (c === CR) {
          if (i + 1 < text.length) {
            if (text.charCodeAt(i + 1) === LF) i++;
          } else {
            skipLeadingLF = true; // a CRLF may be split across chunks
          }
        }
        start = i + 1;
        processLine(line);
      }
      lineBuffer += text.slice(start);
      if (hasError) {
        const e = firstError;
        hasError = false;
        firstError = undefined;
        throw e;
      }
    },
    end() {
      lineBuffer = '';
      data = '';
      eventType = '';
      idBuffer = lastId;
      pendingRetry = undefined;
      skipLeadingLF = false;
      atStreamStart = true;
    },
    lastEventId: () => lastId,
    retry: () => reconnectionTime,
  };
}

/** True for a `text/event-stream` media type, ignoring case and parameters. */
export function isEventStream(contentType: string): boolean {
  if (!contentType) return false;
  const essence = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  return essence === 'text/event-stream';
}

/**
 * Read a byte stream as UTF-8 (multibyte characters may span chunks) and feed each
 * event to `onEvent`. Resolves at the end of the stream, or quietly when `signal`
 * aborts (the stream is cancelled). Rejects if the stream errors or `onEvent` throws.
 */
export async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (e: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    await stream.cancel().catch(() => {});
    return;
  }
  const reader = stream.getReader();
  // Keep the BOM in the text; the parser strips exactly one, as the standard says.
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  const parser = createSseParser(onEvent);
  let finished = false;
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (e) {
        if (signal?.aborted) break;
        throw e;
      }
      if (signal?.aborted || result.done) break;
      if (result.value && result.value.byteLength > 0) {
        parser.push(decoder.decode(result.value, { stream: true }));
      }
    }
    if (!signal?.aborted) {
      const tail = decoder.decode();
      if (tail) parser.push(tail);
    }
    parser.end();
    finished = true;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!finished) reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
