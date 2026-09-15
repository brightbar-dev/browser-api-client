/**
 * OAuth 2.0 helpers: client credentials, and authorization code with PKCE
 * (RFC 6749, RFC 7636). Pure functions; the caller performs the HTTP requests and
 * the browser redirect.
 */

export type OAuth2Grant = 'client_credentials' | 'authorization_code';

export interface OAuth2Config {
  grant: OAuth2Grant;
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  /** Optional for public clients using PKCE. */
  clientSecret: string;
  scope: string;
  audience?: string;
  usePkce: boolean;
  /**
   * `header`: HTTP Basic (RFC 6749 §2.3.1). With an empty secret the client is
   * public, so `client_id` goes in the body instead (§3.2.1).
   * `body`: `client_id` / `client_secret` form fields.
   */
  clientAuth: 'header' | 'body';
  /** Extra authorization request parameters as "k=v&k2=v2"; they override same-named defaults. */
  extraAuthParams?: string;
}

export interface OAuth2Token {
  accessToken: string;
  tokenType: string;
  /** Epoch ms, or null when the server gave no `expires_in`. */
  expiresAt: number | null;
  refreshToken?: string;
  scope?: string;
  obtainedAt: number;
}

export type TokenGrant =
  | { type: 'client_credentials' }
  | { type: 'authorization_code'; code: string; redirectUri: string; codeVerifier?: string }
  | { type: 'refresh_token'; refreshToken: string };

export function newOAuth2Config(): OAuth2Config {
  return {
    grant: 'authorization_code',
    authUrl: '',
    tokenUrl: '',
    clientId: '',
    clientSecret: '',
    scope: '',
    audience: '',
    usePkce: true,
    clientAuth: 'header',
    extraAuthParams: '',
  };
}

// ---------------------------------------------------------------------------
// Encoding

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 with padding. */
export function base64Encode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + B64.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + '=';
  }
  return out;
}

/** base64url without padding (RFC 4648 §5). */
export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Standard base64 of a string's UTF-8 bytes. */
export function base64EncodeUtf8(text: string): string {
  return base64Encode(new TextEncoder().encode(text));
}

/** application/x-www-form-urlencoded encoding of one value (spaces become +). */
function formEncode(value: string): string {
  return new URLSearchParams([['', value]]).toString().slice(1);
}

function decodeComponent(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

// ---------------------------------------------------------------------------
// PKCE and state

/**
 * RFC 7636 code verifier: base64url of `byteLength` random bytes. The default 32
 * bytes gives 43 characters; 96 bytes gives the maximum of 128.
 */
export function generateCodeVerifier(byteLength = 32): string {
  if (!Number.isInteger(byteLength) || byteLength < 32 || byteLength > 96) {
    throw new RangeError('Code verifier byte length must be an integer from 32 to 96 (43 to 128 characters)');
  }
  return base64UrlEncode(randomBytes(byteLength));
}

/** S256 code challenge: base64url(SHA-256(ASCII(verifier))), no padding. */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** An unguessable `state` value (128 random bits, base64url). */
export function generateState(): string {
  return base64UrlEncode(randomBytes(16));
}

// ---------------------------------------------------------------------------
// Requests

function parseParamString(text: string | undefined): Array<[string, string]> {
  const trimmed = (text ?? '').trim().replace(/^[?&]+/, '');
  if (!trimmed) return [];
  const pairs: Array<[string, string]> = [];
  for (const part of trimmed.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = decodeComponent((eq === -1 ? part : part.slice(0, eq)).trim());
    const value = eq === -1 ? '' : decodeComponent(part.slice(eq + 1).trim());
    if (key) pairs.push([key, value]);
  }
  return pairs;
}

/**
 * The authorization request URL (`response_type=code`). Keeps any query already in
 * `authUrl` (same-named parameters are replaced) and appends `extraAuthParams`.
 */
export function buildAuthorizationUrl(
  cfg: OAuth2Config,
  opts: { redirectUri: string; state: string; codeChallenge?: string },
): string {
  const base = cfg.authUrl.trim();
  if (!base) throw new Error('Enter an authorization URL');
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`Authorization URL "${base}" is not a valid URL`);
  }

  const params: Array<[string, string]> = [
    ['response_type', 'code'],
    ['client_id', cfg.clientId.trim()],
    ['redirect_uri', opts.redirectUri],
  ];
  if (cfg.scope.trim()) params.push(['scope', cfg.scope.trim()]);
  if (cfg.audience?.trim()) params.push(['audience', cfg.audience.trim()]);
  params.push(['state', opts.state]);
  if (opts.codeChallenge) {
    params.push(['code_challenge', opts.codeChallenge], ['code_challenge_method', 'S256']);
  }

  const extras = parseParamString(cfg.extraAuthParams);
  const extraKeys = new Set(extras.map(([k]) => k));
  const added = [...params.filter(([k]) => !extraKeys.has(k)), ...extras];
  const addedKeys = new Set(added.map(([k]) => k));

  const kept = url.search
    .replace(/^\?/, '')
    .split('&')
    .filter(part => part !== '' && !addedKeys.has(decodeComponent(part.split('=')[0] ?? '')));
  const appended = added.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  url.search = [...kept, ...appended].join('&');
  return url.toString();
}

/** The token endpoint request: form-encoded body, `Accept: application/json`. */
export function buildTokenRequest(
  cfg: OAuth2Config,
  grant: TokenGrant,
): { url: string; headers: Array<[string, string]>; body: string } {
  const body = new URLSearchParams();
  const headers: Array<[string, string]> = [
    ['Content-Type', 'application/x-www-form-urlencoded'],
    ['Accept', 'application/json'],
  ];

  switch (grant.type) {
    case 'client_credentials':
      body.append('grant_type', 'client_credentials');
      if (cfg.scope.trim()) body.append('scope', cfg.scope.trim());
      if (cfg.audience?.trim()) body.append('audience', cfg.audience.trim());
      break;
    case 'authorization_code':
      body.append('grant_type', 'authorization_code');
      body.append('code', grant.code);
      body.append('redirect_uri', grant.redirectUri);
      if (grant.codeVerifier) body.append('code_verifier', grant.codeVerifier);
      break;
    case 'refresh_token':
      body.append('grant_type', 'refresh_token');
      body.append('refresh_token', grant.refreshToken);
      break;
  }

  const clientId = cfg.clientId.trim();
  const secret = cfg.clientSecret;
  if (cfg.clientAuth === 'header' && secret) {
    const credentials = `${formEncode(clientId)}:${formEncode(secret)}`;
    headers.push(['Authorization', `Basic ${base64EncodeUtf8(credentials)}`]);
  } else {
    if (clientId) body.append('client_id', clientId);
    if (secret) body.append('client_secret', secret);
  }

  return { url: cfg.tokenUrl.trim(), headers, body: body.toString() };
}

// ---------------------------------------------------------------------------
// Responses

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function describeError(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { message?: unknown }).message === 'string') {
    return (v as { message: string }).message;
  }
  return JSON.stringify(v);
}

function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ');
  return oneLine.length > 120 ? `${oneLine.slice(0, 119)}…` : oneLine;
}

/**
 * Parse a token endpoint response body (JSON, or urlencoded as GitHub may send).
 * `now` is epoch ms. Throws with the server's `error` / `error_description`.
 */
export function parseTokenResponse(bodyText: string, now: number): OAuth2Token {
  const text = bodyText.trim();
  if (!text) throw new Error('The token response was empty');

  let data: Record<string, unknown> | null = null;
  if (text.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch {
      // reported below
    }
  } else if (!text.startsWith('<') && !text.startsWith('[') && /^[^\s=&]+=/.test(text)) {
    data = Object.fromEntries(new URLSearchParams(text));
  }
  if (!data) throw new Error(`The token response is not JSON or form data: ${snippet(text)}`);

  if (data.error !== undefined && data.error !== null && data.error !== '') {
    const description = asString(data.error_description);
    throw new Error(`Token request failed: ${describeError(data.error)}${description ? ` (${description})` : ''}`);
  }

  const accessToken = asString(data.access_token);
  if (!accessToken) throw new Error('The token response did not include an access_token');

  let expiresAt: number | null = null;
  const rawExpires = data.expires_in;
  const seconds = typeof rawExpires === 'number'
    ? rawExpires
    : typeof rawExpires === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(rawExpires) ? Number(rawExpires) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) expiresAt = now + seconds * 1000;

  const token: OAuth2Token = {
    accessToken,
    tokenType: asString(data.token_type) ?? 'Bearer',
    expiresAt,
    obtainedAt: now,
  };
  const refreshToken = asString(data.refresh_token);
  if (refreshToken) token.refreshToken = refreshToken;
  const scope = Array.isArray(data.scope) ? data.scope.filter(s => typeof s === 'string').join(' ') : asString(data.scope);
  if (scope) token.scope = scope;
  return token;
}

/**
 * Read the authorization code from the URL the browser was redirected to. Looks in
 * the query, then the fragment. Throws on an `error` parameter, a state mismatch or
 * a missing code.
 */
export function parseAuthorizationRedirect(redirectedUrl: string, expectedState: string): { code: string } {
  let url: URL;
  try {
    url = new URL(redirectedUrl);
  } catch {
    throw new Error('The authorization redirect URL could not be read');
  }
  const query = url.searchParams;
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const get = (key: string): string | null => query.get(key) ?? fragment.get(key);

  const error = get('error');
  if (error) {
    const description = get('error_description');
    if (error === 'access_denied') {
      throw new Error(`Authorization was denied${description ? `: ${description}` : ''}`);
    }
    throw new Error(`Authorization failed: ${error}${description ? ` (${description})` : ''}`);
  }

  const state = get('state');
  if ((state ?? '') !== expectedState) {
    throw new Error(state === null
      ? 'The authorization response is missing its state parameter, so it was rejected. Start the sign-in again.'
      : 'The authorization response state does not match this sign-in, so it was rejected. Start the sign-in again.');
  }

  const code = get('code');
  if (!code) throw new Error('The authorization response did not include a code');
  return { code };
}

/** True when there is no token, or it expires within `skewSeconds` (default 30). Tokens without expiry never expire. */
export function isTokenExpired(token: OAuth2Token | null | undefined, now: number, skewSeconds = 30): boolean {
  if (!token) return true;
  if (token.expiresAt === null) return false;
  return now >= token.expiresAt - skewSeconds * 1000;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** "expires in 59 min", "expired 3 min ago", "no expiry". */
export function tokenExpiresIn(token: OAuth2Token, now: number): string {
  if (token.expiresAt === null) return 'no expiry';
  const diff = token.expiresAt - now;
  if (diff > 0) return diff < 1000 ? 'expires in under 1 s' : `expires in ${formatDuration(diff)}`;
  return -diff < 1000 ? 'expired just now' : `expired ${formatDuration(-diff)} ago`;
}
