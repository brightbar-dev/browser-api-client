import { useEffect, useMemo, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { EnvVariable } from '@/utils/environment';
import type { OAuth2Config, OAuth2Token } from '@/utils/oauth2';
import { isTokenExpired, tokenExpiresIn } from '@/utils/oauth2';
import { showToast, useApp } from '../store';
import { clearToken, identityAvailable, interpolateOAuth, loadToken, redirectUri, requestToken, saveToken, tokenKey } from '../oauth';
import { VarField } from './VarField';
import { IconCopy } from './icons';

const NO_VARS: EnvVariable[] = [];

export function OAuth2Editor({ config, onChange }: { config: OAuth2Config; onChange: (c: OAuth2Config) => void }) {
  const variables = useApp((s) => s.environments.find((e) => e.id === s.activeEnvId)?.variables ?? NO_VARS);
  const resolved = useMemo(() => interpolateOAuth(config, variables), [config, variables]);
  const key = tokenKey(resolved);
  const [token, setToken] = useState<OAuth2Token | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const set = (patch: Partial<OAuth2Config>) => onChange({ ...config, ...patch });
  const authCode = config.grant === 'authorization_code';
  const redirect = redirectUri();

  useEffect(() => {
    let alive = true;
    const refresh = () => loadToken(resolved).then((t) => alive && setToken(t));
    void refresh();
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && 'oauthTokens' in changes) void refresh();
    };
    browser.storage.onChanged.addListener(onChanged);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(onChanged);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const getToken = async () => {
    setBusy(true);
    setError('');
    try {
      const fresh = await requestToken(resolved);
      await saveToken(resolved, fresh);
      setToken(fresh);
      showToast('Access token received');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, name: keyof OAuth2Config, placeholder = '') => (
    <label class="bac-field">
      <span class="bac-field-label">{label}</span>
      <VarField class="bac-input bac-mono" aria-label={label} placeholder={placeholder} spellcheck={false} autocomplete="off" value={String(config[name] ?? '')} onValue={(v) => set({ [name]: v } as Partial<OAuth2Config>)} />
    </label>
  );

  const expired = token ? isTokenExpired(token, now) : false;

  return (
    <div class="bac-oauth">
      <fieldset class="bac-field bac-fieldset">
        <legend class="bac-field-label">Grant</legend>
        <div class="bac-segmented">
          {(
            [
              ['authorization_code', 'Authorization code'],
              ['client_credentials', 'Client credentials'],
            ] as const
          ).map(([id, label]) => (
            <label key={id} class={`bac-seg${config.grant === id ? ' is-on' : ''}`}>
              <input type="radio" name="bac-oauth-grant" checked={config.grant === id} onChange={() => set({ grant: id })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {authCode && field('Authorization URL', 'authUrl', 'https://auth.example.com/authorize')}
      {field('Token URL', 'tokenUrl', 'https://auth.example.com/oauth/token')}
      {field('Client ID', 'clientId', '{{clientId}}')}
      {field('Client secret', 'clientSecret', authCode && config.usePkce ? 'Optional with PKCE' : '{{clientSecret}}')}
      {field('Scope', 'scope', 'read write')}
      {field('Audience', 'audience', 'Optional')}
      <label class="bac-field">
        <span class="bac-field-label">Client authentication</span>
        <select class="bac-select" value={config.clientAuth} onChange={(e) => set({ clientAuth: e.currentTarget.value === 'body' ? 'body' : 'header' })}>
          <option value="header">Basic auth header</option>
          <option value="body">Client ID and secret in the body</option>
        </select>
      </label>
      {authCode && (
        <>
          <label class="bac-field">
            <span class="bac-field-label">PKCE</span>
            <span class="bac-inline-check">
              <input type="checkbox" checked={config.usePkce} onChange={(e) => set({ usePkce: e.currentTarget.checked })} /> Use PKCE (S256) — recommended
            </span>
          </label>
          <div class="bac-field">
            <span class="bac-field-label">Redirect URL</span>
            <span class="bac-copyline">
              <code class="bac-mono">{redirect || 'Unavailable in this browser'}</code>
              {redirect && (
                <button
                  type="button"
                  class="bac-icon-btn"
                  aria-label="Copy redirect URL"
                  onClick={() => {
                    void navigator.clipboard.writeText(redirect);
                    showToast('Redirect URL copied');
                  }}
                >
                  <IconCopy />
                </button>
              )}
            </span>
          </div>
          <p class="bac-muted bac-small bac-field-note">Register this redirect URL with your provider. Sign-in opens in a browser window and never shares your cookies with this extension.</p>
          {!identityAvailable() && <p class="bac-notice bac-notice-warn">This browser doesn’t offer the identity API, so only the client-credentials grant works here.</p>}
        </>
      )}

      <div class="bac-token-box" role="group" aria-label="Access token">
        <div>
          <p class="bac-strong">
            {token ? (expired ? 'Access token expired' : 'Access token ready') : 'No access token yet'}
          </p>
          <p class="bac-muted bac-small">
            {token
              ? `${token.accessToken.slice(0, 10)}… · ${tokenExpiresIn(token, now)}${token.refreshToken ? ' · can refresh' : ''}`
              : authCode
                ? 'Get one before sending; it is added as Authorization: Bearer.'
                : 'Fetched automatically on send, or get one now.'}
          </p>
        </div>
        <div class="bac-spacer" />
        {token && (
          <button
            type="button"
            class="bac-btn bac-btn-small"
            onClick={async () => {
              await clearToken(resolved);
              setToken(null);
            }}
          >
            Clear
          </button>
        )}
        <button type="button" class="bac-btn bac-btn-small bac-btn-primary" disabled={busy} onClick={() => void getToken()}>
          {busy ? 'Waiting…' : 'Get new access token'}
        </button>
      </div>
      {error && (
        <p class="bac-notice bac-notice-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
