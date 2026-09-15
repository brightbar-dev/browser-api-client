import { describe, it, expect } from 'vitest';
import {
  newOAuth2Config, generateCodeVerifier, codeChallengeS256, generateState,
  buildAuthorizationUrl, buildTokenRequest, parseTokenResponse, parseAuthorizationRedirect,
  isTokenExpired, tokenExpiresIn, base64Encode, base64EncodeUtf8, base64UrlEncode,
  type OAuth2Config, type OAuth2Token,
} from '../utils/oauth2';

/** Reference encoder built on btoa, independent of the module under test. */
const b64Bytes = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const b64 = (s: string) => b64Bytes(new TextEncoder().encode(s));

function config(partial: Partial<OAuth2Config> = {}): OAuth2Config {
  return {
    ...newOAuth2Config(),
    authUrl: 'https://auth.example.com/authorize',
    tokenUrl: 'https://auth.example.com/token',
    clientId: 'client-1',
    ...partial,
  };
}

function header(headers: Array<[string, string]>, name: string): string | undefined {
  return headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
}

describe('newOAuth2Config', () => {
  it('defaults to authorization code with PKCE', () => {
    expect(newOAuth2Config()).toMatchObject({
      grant: 'authorization_code', usePkce: true, clientAuth: 'header', clientId: '', clientSecret: '', scope: '',
    });
  });
});

describe('base64', () => {
  it('matches btoa for every padding length and for non-ASCII text', () => {
    for (const s of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', 'héllo ☃ 😀']) {
      expect(base64EncodeUtf8(s)).toBe(b64(s));
    }
    expect(base64EncodeUtf8('foobar')).toBe('Zm9vYmFy');
  });

  it('encodes all byte values', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const reference = b64Bytes(bytes);
    expect(base64Encode(bytes)).toBe(reference);
    expect(base64UrlEncode(bytes)).toBe(reference.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    expect(base64UrlEncode(bytes)).not.toMatch(/[+/=]/);
  });
});

describe('PKCE and state', () => {
  it('generates a 43-character verifier from the unreserved set by default', () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-._~]{43}$/);
    expect(generateCodeVerifier()).not.toBe(v);
  });

  it('allows up to 128 characters and rejects out-of-range lengths', () => {
    expect(generateCodeVerifier(96)).toHaveLength(128);
    expect(() => generateCodeVerifier(31)).toThrow(RangeError);
    expect(() => generateCodeVerifier(97)).toThrow(RangeError);
  });

  it('computes the RFC 7636 Appendix B S256 challenge', async () => {
    expect(await codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generates distinct url-safe state values', () => {
    const s = generateState();
    expect(s).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(generateState()).not.toBe(s);
  });
});

describe('buildAuthorizationUrl', () => {
  const opts = { redirectUri: 'https://abc.chromiumapp.org/cb', state: 'st4te', codeChallenge: 'chal' };

  it('builds a code request that keeps the existing query', () => {
    const url = buildAuthorizationUrl(config({
      authUrl: 'https://auth.example.com/authorize?tenant=acme',
      clientId: 'my app',
      scope: 'openid profile',
      audience: 'https://api.example.com',
    }), opts);
    expect(url.startsWith('https://auth.example.com/authorize?tenant=acme&response_type=code&')).toBe(true);
    expect(url).toContain('scope=openid%20profile');
    const q = new URL(url).searchParams;
    expect(Object.fromEntries(q)).toEqual({
      tenant: 'acme',
      response_type: 'code',
      client_id: 'my app',
      redirect_uri: 'https://abc.chromiumapp.org/cb',
      scope: 'openid profile',
      audience: 'https://api.example.com',
      state: 'st4te',
      code_challenge: 'chal',
      code_challenge_method: 'S256',
    });
  });

  it('omits empty scope, audience and challenge', () => {
    const q = new URL(buildAuthorizationUrl(config(), { redirectUri: 'https://x/cb', state: 's' })).searchParams;
    expect([...q.keys()]).toEqual(['response_type', 'client_id', 'redirect_uri', 'state']);
  });

  it('appends extra parameters, which override defaults', () => {
    const url = buildAuthorizationUrl(config({
      extraAuthParams: '?prompt=consent&resource=a&resource=b&response_type=code id_token',
    }), opts);
    const q = new URL(url).searchParams;
    expect(q.get('prompt')).toBe('consent');
    expect(q.getAll('resource')).toEqual(['a', 'b']);
    expect(q.getAll('response_type')).toEqual(['code id_token']);
  });

  it('replaces a same-named parameter already in the URL', () => {
    const url = buildAuthorizationUrl(config({ authUrl: 'https://a.example/auth?client_id=old&x=1' }), opts);
    const q = new URL(url).searchParams;
    expect(q.getAll('client_id')).toEqual(['client-1']);
    expect(q.get('x')).toBe('1');
  });

  it('rejects a missing or invalid URL', () => {
    expect(() => buildAuthorizationUrl(config({ authUrl: '' }), opts)).toThrow('Enter an authorization URL');
    expect(() => buildAuthorizationUrl(config({ authUrl: 'not a url' }), opts)).toThrow(/is not a valid URL/);
  });
});

describe('buildTokenRequest', () => {
  it('sends client credentials with HTTP Basic of the form-encoded id and secret', () => {
    const req = buildTokenRequest(config({
      grant: 'client_credentials', clientSecret: 's:e cret', scope: 'read write', audience: 'https://api',
    }), { type: 'client_credentials' });
    expect(req.url).toBe('https://auth.example.com/token');
    expect(header(req.headers, 'Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(header(req.headers, 'Accept')).toBe('application/json');
    expect(header(req.headers, 'Authorization')).toBe(`Basic ${b64('client-1:s%3Ae+cret')}`);
    expect(Object.fromEntries(new URLSearchParams(req.body))).toEqual({
      grant_type: 'client_credentials', scope: 'read write', audience: 'https://api',
    });
  });

  it('encodes non-ASCII credentials safely', () => {
    const req = buildTokenRequest(config({ clientId: 'ïd', clientSecret: 'päss' }), { type: 'client_credentials' });
    expect(header(req.headers, 'Authorization')).toBe(`Basic ${b64('%C3%AFd:p%C3%A4ss')}`);
  });

  it('puts client credentials in the body when asked', () => {
    const req = buildTokenRequest(config({ clientAuth: 'body', clientSecret: 'shh' }), { type: 'client_credentials' });
    expect(header(req.headers, 'Authorization')).toBeUndefined();
    expect(Object.fromEntries(new URLSearchParams(req.body))).toEqual({
      grant_type: 'client_credentials', client_id: 'client-1', client_secret: 'shh',
    });
  });

  it('sends only client_id for a public client, even with header auth', () => {
    const req = buildTokenRequest(config(), {
      type: 'authorization_code', code: 'c0de', redirectUri: 'https://abc.chromiumapp.org/cb', codeVerifier: 'verif',
    });
    expect(header(req.headers, 'Authorization')).toBeUndefined();
    expect(Object.fromEntries(new URLSearchParams(req.body))).toEqual({
      grant_type: 'authorization_code',
      code: 'c0de',
      redirect_uri: 'https://abc.chromiumapp.org/cb',
      code_verifier: 'verif',
      client_id: 'client-1',
    });
  });

  it('does not send scope with an authorization code', () => {
    const req = buildTokenRequest(config({ scope: 'openid', clientSecret: 'x' }), {
      type: 'authorization_code', code: 'c', redirectUri: 'https://x/cb',
    });
    const body = new URLSearchParams(req.body);
    expect(body.has('scope')).toBe(false);
    expect(body.has('code_verifier')).toBe(false);
  });

  it('refreshes a token', () => {
    const req = buildTokenRequest(config({ clientAuth: 'body' }), { type: 'refresh_token', refreshToken: 'r1' });
    expect(req.body).toBe('grant_type=refresh_token&refresh_token=r1&client_id=client-1');
  });
});

describe('parseTokenResponse', () => {
  const now = 1_700_000_000_000;

  it('parses a JSON token response', () => {
    const token = parseTokenResponse(JSON.stringify({
      access_token: 'at', token_type: 'bearer', expires_in: 3600, refresh_token: 'rt', scope: 'read',
    }), now);
    expect(token).toEqual({
      accessToken: 'at', tokenType: 'bearer', expiresAt: now + 3_600_000, refreshToken: 'rt', scope: 'read', obtainedAt: now,
    });
  });

  it('accepts expires_in as a numeric string and defaults the type', () => {
    expect(parseTokenResponse('{"access_token":"at","expires_in":"60"}', now)).toEqual({
      accessToken: 'at', tokenType: 'Bearer', expiresAt: now + 60_000, obtainedAt: now,
    });
  });

  it('has no expiry without a usable expires_in', () => {
    expect(parseTokenResponse('{"access_token":"at"}', now).expiresAt).toBeNull();
    expect(parseTokenResponse('{"access_token":"at","expires_in":"soon"}', now).expiresAt).toBeNull();
  });

  it('joins an array scope', () => {
    expect(parseTokenResponse('{"access_token":"at","scope":["a","b"]}', now).scope).toBe('a b');
  });

  it('parses a urlencoded (GitHub-style) response', () => {
    expect(parseTokenResponse('access_token=gho_abc&scope=repo%2Cgist&token_type=bearer', now)).toEqual({
      accessToken: 'gho_abc', tokenType: 'bearer', expiresAt: null, scope: 'repo,gist', obtainedAt: now,
    });
  });

  it("throws the server's error and description", () => {
    expect(() => parseTokenResponse('{"error":"invalid_grant","error_description":"Code expired"}', now))
      .toThrow('Token request failed: invalid_grant (Code expired)');
    expect(() => parseTokenResponse('error=bad_verification_code&error_description=The+code+is+incorrect.', now))
      .toThrow('Token request failed: bad_verification_code (The code is incorrect.)');
    expect(() => parseTokenResponse('{"error":"unauthorized_client"}', now))
      .toThrow('Token request failed: unauthorized_client');
  });

  it('rejects responses without a token', () => {
    expect(() => parseTokenResponse('{"token_type":"bearer"}', now)).toThrow(/did not include an access_token/);
    expect(() => parseTokenResponse('<html>Server Error</html>', now)).toThrow(/not JSON or form data: <html>Server Error<\/html>/);
    expect(() => parseTokenResponse('{broken', now)).toThrow(/not JSON or form data/);
    expect(() => parseTokenResponse('  ', now)).toThrow(/empty/);
  });
});

describe('parseAuthorizationRedirect', () => {
  const base = 'https://abc.chromiumapp.org/cb';

  it('returns the code when the state matches', () => {
    expect(parseAuthorizationRedirect(`${base}?code=abc&state=s1`, 's1')).toEqual({ code: 'abc' });
  });

  it('reads parameters from the fragment too', () => {
    expect(parseAuthorizationRedirect(`${base}#code=xyz&state=s1`, 's1')).toEqual({ code: 'xyz' });
  });

  it('rejects a state mismatch or missing state', () => {
    expect(() => parseAuthorizationRedirect(`${base}?code=abc&state=evil`, 's1')).toThrow(/does not match/);
    expect(() => parseAuthorizationRedirect(`${base}?code=abc`, 's1')).toThrow(/missing its state/);
  });

  it('reports errors from the authorization server', () => {
    expect(() => parseAuthorizationRedirect(`${base}?error=access_denied&error_description=User+said+no&state=s1`, 's1'))
      .toThrow('Authorization was denied: User said no');
    expect(() => parseAuthorizationRedirect(`${base}?error=invalid_scope&error_description=bad&state=s1`, 's1'))
      .toThrow('Authorization failed: invalid_scope (bad)');
  });

  it('rejects a missing code or unreadable URL', () => {
    expect(() => parseAuthorizationRedirect(`${base}?state=s1`, 's1')).toThrow(/did not include a code/);
    expect(() => parseAuthorizationRedirect('::nope', 's1')).toThrow(/could not be read/);
  });
});

describe('token expiry', () => {
  const now = 1_700_000_000_000;
  const token = (expiresAt: number | null): OAuth2Token => ({ accessToken: 'a', tokenType: 'Bearer', expiresAt, obtainedAt: now });

  it('treats a missing token as expired and a token without expiry as valid', () => {
    expect(isTokenExpired(null, now)).toBe(true);
    expect(isTokenExpired(undefined, now)).toBe(true);
    expect(isTokenExpired(token(null), now)).toBe(false);
  });

  it('applies a clock skew', () => {
    expect(isTokenExpired(token(now + 60_000), now)).toBe(false);
    expect(isTokenExpired(token(now + 20_000), now)).toBe(true);
    expect(isTokenExpired(token(now + 20_000), now, 0)).toBe(false);
    expect(isTokenExpired(token(now), now, 0)).toBe(true);
  });

  it('describes the time left', () => {
    expect(tokenExpiresIn(token(null), now)).toBe('no expiry');
    expect(tokenExpiresIn(token(now + 3_599_000), now)).toBe('expires in 59 min');
    expect(tokenExpiresIn(token(now + 45_000), now)).toBe('expires in 45 s');
    expect(tokenExpiresIn(token(now + 2 * 3_600_000), now)).toBe('expires in 2 h');
    expect(tokenExpiresIn(token(now + 3 * 86_400_000), now)).toBe('expires in 3 d');
    expect(tokenExpiresIn(token(now - 180_000), now)).toBe('expired 3 min ago');
    expect(tokenExpiresIn(token(now), now)).toBe('expired just now');
  });
});
