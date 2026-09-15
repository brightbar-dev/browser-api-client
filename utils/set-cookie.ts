/** Parse Set-Cookie response headers for display. */

export interface ParsedSetCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  maxAge?: string;
  sameSite?: string;
  secure: boolean;
  httpOnly: boolean;
  partitioned: boolean;
  raw: string;
}

/** Firefox joins several Set-Cookie headers with newlines; Chrome reports each separately. */
export function splitSetCookieValues(values: string[]): string[] {
  return values.flatMap((v) => v.split('\n')).map((v) => v.trim()).filter(Boolean);
}

export function parseSetCookie(header: string): ParsedSetCookie {
  const [pair = '', ...attrs] = header.split(';');
  const eq = pair.indexOf('=');
  const cookie: ParsedSetCookie = {
    name: (eq === -1 ? '' : pair.slice(0, eq)).trim(),
    value: (eq === -1 ? pair : pair.slice(eq + 1)).trim(),
    secure: false,
    httpOnly: false,
    partitioned: false,
    raw: header,
  };
  for (const attr of attrs) {
    const i = attr.indexOf('=');
    const key = (i === -1 ? attr : attr.slice(0, i)).trim().toLowerCase();
    const val = i === -1 ? '' : attr.slice(i + 1).trim();
    switch (key) {
      case 'domain':
        cookie.domain = val;
        break;
      case 'path':
        cookie.path = val;
        break;
      case 'expires':
        cookie.expires = val;
        break;
      case 'max-age':
        cookie.maxAge = val;
        break;
      case 'samesite':
        cookie.sameSite = val;
        break;
      case 'secure':
        cookie.secure = true;
        break;
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'partitioned':
        cookie.partitioned = true;
        break;
    }
  }
  return cookie;
}
