/**
 * OAuth 2.0 in the app: tokens are fetched from the page (no CORS for permitted hosts),
 * the authorization-code flow runs through browser.identity.launchWebAuthFlow, and
 * tokens live in storage.local keyed by grant, token URL, client and scope — never in
 * requests, collections, exports or backups.
 */

import { browser } from 'wxt/browser';
import type { EnvVariable } from '@/utils/environment';
import { interpolate } from '@/utils/environment';
import type { OAuth2Config, OAuth2Token, TokenGrant } from '@/utils/oauth2';
import {
  buildAuthorizationUrl,
  buildTokenRequest,
  codeChallengeS256,
  generateCodeVerifier,
  generateState,
  isTokenExpired,
  parseAuthorizationRedirect,
  parseTokenResponse,
} from '@/utils/oauth2';
import { t } from '@/utils/i18n';

type IdentityApi = {
  launchWebAuthFlow: (details: { url: string; interactive: boolean }) => Promise<string | undefined>;
  getRedirectURL: (path?: string) => string;
};

function identity(): IdentityApi | undefined {
  const api = (browser as unknown as { identity?: IdentityApi }).identity;
  return api && typeof api.launchWebAuthFlow === 'function' ? api : undefined;
}

export function identityAvailable(): boolean {
  return identity() !== undefined;
}

/** The redirect URL to register with the provider (for example https://<id>.chromiumapp.org/). */
export function redirectUri(): string {
  return identity()?.getRedirectURL() ?? '';
}

export function interpolateOAuth(cfg: OAuth2Config, variables: EnvVariable[]): OAuth2Config {
  const v = (s: string | undefined) => interpolate(s ?? '', variables);
  return {
    ...cfg,
    authUrl: v(cfg.authUrl).trim(),
    tokenUrl: v(cfg.tokenUrl).trim(),
    clientId: v(cfg.clientId).trim(),
    clientSecret: v(cfg.clientSecret),
    scope: v(cfg.scope).trim(),
    audience: v(cfg.audience).trim(),
    extraAuthParams: v(cfg.extraAuthParams),
  };
}

export function tokenKey(cfg: OAuth2Config): string {
  return [cfg.grant, cfg.tokenUrl, cfg.clientId, cfg.scope, cfg.audience ?? ''].join('|');
}

async function readStore(): Promise<Record<string, OAuth2Token>> {
  const { oauthTokens } = await browser.storage.local.get('oauthTokens');
  return oauthTokens && typeof oauthTokens === 'object' ? (oauthTokens as Record<string, OAuth2Token>) : {};
}

export async function loadToken(cfg: OAuth2Config): Promise<OAuth2Token | null> {
  const token = (await readStore())[tokenKey(cfg)];
  return token && typeof token.accessToken === 'string' ? token : null;
}

export async function saveToken(cfg: OAuth2Config, token: OAuth2Token): Promise<void> {
  const store = await readStore();
  store[tokenKey(cfg)] = token;
  await browser.storage.local.set({ oauthTokens: store });
}

export async function clearToken(cfg: OAuth2Config): Promise<void> {
  const store = await readStore();
  delete store[tokenKey(cfg)];
  await browser.storage.local.set({ oauthTokens: store });
}

async function postToken(cfg: OAuth2Config, grant: TokenGrant): Promise<OAuth2Token> {
  if (!cfg.tokenUrl) throw new Error(t('oauthErrorNoTokenUrl'));
  const req = buildTokenRequest(cfg, grant);
  let res: Response;
  try {
    res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body, credentials: 'omit', cache: 'no-store' });
  } catch {
    throw new Error(t('oauthErrorUnreachable', req.url));
  }
  const text = await res.text();
  try {
    return parseTokenResponse(text, Date.now());
  } catch (e) {
    throw new Error(res.ok ? (e as Error).message : t('oauthErrorEndpointStatus', res.status, (e as Error).message));
  }
}

/** Get a fresh token from the provider. The authorization-code grant opens the provider's sign-in window. */
export async function requestToken(cfg: OAuth2Config): Promise<OAuth2Token> {
  if (cfg.grant === 'client_credentials') return postToken(cfg, { type: 'client_credentials' });

  const api = identity();
  if (!api) throw new Error(t('oauthErrorNoIdentity'));
  const redirect = api.getRedirectURL();
  const verifier = cfg.usePkce ? generateCodeVerifier() : undefined;
  const challenge = verifier ? await codeChallengeS256(verifier) : undefined;
  const state = generateState();
  const authUrl = buildAuthorizationUrl(cfg, { redirectUri: redirect, state, codeChallenge: challenge });
  let redirected: string | undefined;
  try {
    redirected = await api.launchWebAuthFlow({ url: authUrl, interactive: true });
  } catch (e) {
    throw new Error(t('oauthErrorSignInUnfinished', (e as Error).message));
  }
  if (!redirected) throw new Error(t('oauthErrorSignInClosed'));
  const { code } = parseAuthorizationRedirect(redirected, state);
  return postToken(cfg, { type: 'authorization_code', code, redirectUri: redirect, codeVerifier: verifier });
}

/**
 * The token to send with: a stored valid one, else a refreshed one, else (client
 * credentials only) a new one. Authorization-code tokens are never fetched silently.
 */
export async function tokenForSend(cfg: OAuth2Config): Promise<OAuth2Token> {
  const now = Date.now();
  const stored = await loadToken(cfg);
  if (stored && !isTokenExpired(stored, now)) return stored;
  if (stored?.refreshToken) {
    try {
      const refreshed = await postToken(cfg, { type: 'refresh_token', refreshToken: stored.refreshToken });
      if (!refreshed.refreshToken) refreshed.refreshToken = stored.refreshToken;
      await saveToken(cfg, refreshed);
      return refreshed;
    } catch {
      // fall through
    }
  }
  if (cfg.grant === 'client_credentials') {
    const token = await requestToken(cfg);
    await saveToken(cfg, token);
    return token;
  }
  throw new Error(stored ? t('oauthErrorTokenExpired') : t('oauthErrorNoToken', t('oauthGetToken')));
}
