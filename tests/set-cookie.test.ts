import { describe, it, expect } from 'vitest';
import { parseSetCookie, splitSetCookieValues } from '../utils/set-cookie';

describe('parseSetCookie', () => {
  it('parses name, value and every attribute', () => {
    const c = parseSetCookie('sid=abc123; Path=/; Domain=.example.com; Max-Age=3600; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Secure; HttpOnly; SameSite=Lax; Partitioned');
    expect(c).toMatchObject({ name: 'sid', value: 'abc123', path: '/', domain: '.example.com', maxAge: '3600', expires: 'Wed, 21 Oct 2026 07:28:00 GMT', secure: true, httpOnly: true, sameSite: 'Lax', partitioned: true });
  });

  it('keeps = inside the value and is case-insensitive about attributes', () => {
    const c = parseSetCookie('token=a=b==; path=/api; httponly');
    expect(c.name).toBe('token');
    expect(c.value).toBe('a=b==');
    expect(c.path).toBe('/api');
    expect(c.httpOnly).toBe(true);
    expect(c.secure).toBe(false);
  });

  it('treats a bare value as a nameless cookie', () => {
    expect(parseSetCookie('justavalue')).toMatchObject({ name: '', value: 'justavalue' });
  });
});

describe('splitSetCookieValues', () => {
  it('splits Firefox newline-joined values and drops blanks', () => {
    expect(splitSetCookieValues(['a=1; Path=/\nb=2', '', 'c=3'])).toEqual(['a=1; Path=/', 'b=2', 'c=3']);
  });
});
