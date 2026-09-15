import { describe, it, expect } from 'vitest';
import { resolveRequest } from '../utils/resolve';
import { newRequest } from '../utils/request';
import { newOAuth2Config } from '../utils/oauth2';

const oauthRequest = () => ({
  ...newRequest(),
  url: 'https://api.example.com/me',
  auth: { type: 'oauth2' as const, oauth2: newOAuth2Config() },
});

describe('resolveRequest with OAuth 2.0', () => {
  it('adds the access token as a Bearer Authorization header', () => {
    const { request } = resolveRequest(oauthRequest(), [], { oauthToken: { accessToken: 'at_123', tokenType: 'bearer' } });
    expect(request.headers).toContainEqual(['Authorization', 'Bearer at_123']);
  });

  it('keeps a non-bearer token type as given', () => {
    const { request } = resolveRequest(oauthRequest(), [], { oauthToken: { accessToken: 'at_123', tokenType: 'MAC' } });
    expect(request.headers).toContainEqual(['Authorization', 'MAC at_123']);
  });

  it('sends no Authorization header without a token', () => {
    const { request } = resolveRequest(oauthRequest(), []);
    expect(request.headers.find(([k]) => k.toLowerCase() === 'authorization')).toBeUndefined();
  });

  it('replaces a hand-set Authorization header and warns', () => {
    const req = { ...oauthRequest(), headers: [{ key: 'Authorization', value: 'Bearer old', enabled: true }] };
    const { request, warnings } = resolveRequest(req, [], { oauthToken: { accessToken: 'new' } });
    expect(request.headers.filter(([k]) => k.toLowerCase() === 'authorization')).toEqual([['Authorization', 'Bearer new']]);
    expect(warnings.some((w) => w.includes('Authorization'))).toBe(true);
  });
});
