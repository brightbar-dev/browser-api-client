/**
 * Explain network failures. fetch() only ever says "Failed to fetch"; the browser's
 * webRequest API reports the real cause (Chrome `net::ERR_*`, Firefox `NS_ERROR_*`).
 */

export type NetErrorKind = 'dns' | 'refused' | 'timeout' | 'tls' | 'offline' | 'blocked' | 'reset' | 'protocol' | 'redirects' | 'unsafe-port' | 'unknown';

export interface NetErrorInfo {
  kind: NetErrorKind;
  title: string;
  detail: string;
  code: string;
}

const RULES: Array<{ test: RegExp; kind: NetErrorKind }> = [
  { test: /NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|UNKNOWN_HOST|DNS_/i, kind: 'dns' },
  { test: /CONNECTION_REFUSED/i, kind: 'refused' },
  { test: /TIMED_OUT|NET_TIMEOUT|TIMEOUT/i, kind: 'timeout' },
  { test: /CERT_|SSL_|SEC_ERROR|TLS|BAD_SSL|MOZILLA_PKIX/i, kind: 'tls' },
  { test: /INTERNET_DISCONNECTED|NETWORK_CHANGED|OFFLINE|ADDRESS_UNREACHABLE/i, kind: 'offline' },
  { test: /BLOCKED_BY_CLIENT|BLOCKED_BY_ADMINISTRATOR|BLOCKED_BY_RESPONSE|BLOCKED/i, kind: 'blocked' },
  { test: /CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_ABORTED|EMPTY_RESPONSE|NET_RESET|NET_INTERRUPT/i, kind: 'reset' },
  { test: /TOO_MANY_REDIRECTS|REDIRECT_LOOP/i, kind: 'redirects' },
  { test: /UNSAFE_PORT|PORT_ACCESS_NOT_ALLOWED/i, kind: 'unsafe-port' },
  { test: /HTTP2_|QUIC_|INVALID_RESPONSE|INVALID_HTTP_RESPONSE|RESPONSE_HEADERS|CONTENT_LENGTH_MISMATCH|INCOMPLETE_CHUNKED|NET_PARTIAL/i, kind: 'protocol' },
];

export function classifyNetError(code: string): NetErrorKind {
  if (/ABORTED$/i.test(code) && !/CONNECTION_ABORTED/i.test(code)) return 'unknown';
  return RULES.find((r) => r.test.test(code))?.kind ?? 'unknown';
}

/** A title and next step for a browser network error code, naming the host. */
export function describeNetError(code: string, host: string): NetErrorInfo {
  const kind = classifyNetError(code);
  const where = host || 'the server';
  const texts: Record<NetErrorKind, [string, string]> = {
    dns: ['Host not found', `The name ${where} could not be resolved (DNS). Check the spelling, or whether the host only exists on a VPN or local network.`],
    refused: ['Connection refused', `Nothing accepted the connection at ${where}. Is the server running, and on that port?`],
    timeout: ['Connection timed out', `${where} did not answer in time. The host may be down, firewalled, or unreachable from this network.`],
    tls: ['Secure connection failed', `The TLS connection to ${where} failed. The certificate may be self-signed, expired or issued for another name, or the server may not speak https on this port. Open the URL in a normal tab to see the details, or use http:// for a local server.`],
    offline: ['No network', 'This computer appears to be offline or changed networks during the request.'],
    blocked: ['Blocked in the browser', `Another extension, a browser policy or an administrator blocked this request to ${where}.`],
    reset: ['Connection dropped', `${where} closed the connection before sending a complete response.`],
    protocol: ['Invalid response', `${where} sent a response the browser could not read (a protocol or framing error).`],
    redirects: ['Too many redirects', `${where} kept redirecting. Check for a redirect loop between http and https or between hosts.`],
    'unsafe-port': ['Port blocked by the browser', `Browsers refuse to connect to this port because it belongs to another protocol (for example SMTP or IRC). Use a different port for ${where}.`],
    unknown: ['Could not connect', `No response from ${where}.`],
  };
  const [title, detail] = texts[kind];
  return { kind, title, detail: kind === 'unknown' ? `${detail} The browser reported ${code}.` : detail, code };
}
