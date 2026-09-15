/**
 * Explain network failures. fetch() only ever says "Failed to fetch"; the browser's
 * webRequest API reports the real cause (Chrome `net::ERR_*`, Firefox `NS_ERROR_*`).
 */

import { t } from './i18n';

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

function texts(kind: NetErrorKind, where: string): [string, string] {
  switch (kind) {
    case 'dns':
      return [t('errorHostNotFoundTitle'), t('errorHostNotFoundDetail', where)];
    case 'refused':
      return [t('errorConnectionRefusedTitle'), t('errorConnectionRefusedDetail', where)];
    case 'timeout':
      return [t('errorConnectionTimedOutTitle'), t('errorConnectionTimedOutDetail', where)];
    case 'tls':
      return [t('errorTlsTitle'), t('errorTlsDetail', where)];
    case 'offline':
      return [t('errorOfflineTitle'), t('errorOfflineDetail')];
    case 'blocked':
      return [t('errorBlockedTitle'), t('errorBlockedDetail', where)];
    case 'reset':
      return [t('errorConnectionDroppedTitle'), t('errorConnectionDroppedDetail', where)];
    case 'protocol':
      return [t('errorInvalidResponseTitle'), t('errorInvalidResponseDetail', where)];
    case 'redirects':
      return [t('errorTooManyRedirectsTitle'), t('errorTooManyRedirectsDetail', where)];
    case 'unsafe-port':
      return [t('errorUnsafePortTitle'), t('errorUnsafePortDetail', where)];
    case 'unknown':
      return [t('errorCouldNotConnectTitle'), t('errorNoResponseFrom', where)];
  }
}

/** A title and next step for a browser network error code, naming the host. */
export function describeNetError(code: string, host: string): NetErrorInfo {
  const kind = classifyNetError(code);
  const [title, detail] = texts(kind, host || t('errorTheServer'));
  return { kind, title, detail: kind === 'unknown' ? t('errorBrowserReported', detail, code) : detail, code };
}
