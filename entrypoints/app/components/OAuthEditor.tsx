import { useEffect, useMemo, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { EnvVariable } from '@/utils/environment';
import type { OAuth2Config, OAuth2Token } from '@/utils/oauth2';
import { isTokenExpired, tokenExpiresIn } from '@/utils/oauth2';
import { showToast, useApp } from '../store';
import { clearToken, identityAvailable, interpolateOAuth, loadToken, redirectUri, requestToken, saveToken, tokenKey } from '../oauth';
import { VarField } from './VarField';
import { IconCopy } from './icons';
import { t } from '@/utils/i18n';

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
      showToast(t('oauthTokenReceived'));
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
        <legend class="bac-field-label">{t('oauthGrant')}</legend>
        <div class="bac-segmented">
          {(
            [
              ['authorization_code', t('oauthGrantAuthCode')],
              ['client_credentials', t('oauthGrantClientCredentials')],
            ] as const
          ).map(([id, label]) => (
            <label key={id} class={`bac-seg${config.grant === id ? ' is-on' : ''}`}>
              <input type="radio" name="bac-oauth-grant" checked={config.grant === id} onChange={() => set({ grant: id })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {authCode && field(t('oauthAuthUrl'), 'authUrl', 'https://auth.example.com/authorize')}
      {field(t('oauthTokenUrl'), 'tokenUrl', 'https://auth.example.com/oauth/token')}
      {field(t('oauthClientId'), 'clientId', '{{clientId}}')}
      {field(t('oauthClientSecret'), 'clientSecret', authCode && config.usePkce ? t('oauthOptionalWithPkce') : '{{clientSecret}}')}
      {field(t('oauthScope'), 'scope', 'read write')}
      {field(t('oauthAudience'), 'audience', t('oauthOptional'))}
      <label class="bac-field">
        <span class="bac-field-label">{t('oauthClientAuth')}</span>
        <select class="bac-select" value={config.clientAuth} onChange={(e) => set({ clientAuth: e.currentTarget.value === 'body' ? 'body' : 'header' })}>
          <option value="header">{t('oauthClientAuthHeader')}</option>
          <option value="body">{t('oauthClientAuthBody')}</option>
        </select>
      </label>
      {authCode && (
        <>
          <label class="bac-field">
            <span class="bac-field-label">PKCE</span>
            <span class="bac-inline-check">
              <input type="checkbox" checked={config.usePkce} onChange={(e) => set({ usePkce: e.currentTarget.checked })} /> {t('oauthUsePkce')}
            </span>
          </label>
          <div class="bac-field">
            <span class="bac-field-label">{t('oauthRedirectUrl')}</span>
            <span class="bac-copyline">
              <code class="bac-mono">{redirect || t('oauthRedirectUnavailable')}</code>
              {redirect && (
                <button
                  type="button"
                  class="bac-icon-btn"
                  aria-label={t('oauthCopyRedirect')}
                  onClick={() => {
                    void navigator.clipboard.writeText(redirect);
                    showToast(t('oauthRedirectCopied'));
                  }}
                >
                  <IconCopy />
                </button>
              )}
            </span>
          </div>
          <p class="bac-muted bac-small bac-field-note">{t('oauthRedirectNote')}</p>
          {!identityAvailable() && <p class="bac-notice bac-notice-warn">{t('oauthNoIdentity')}</p>}
        </>
      )}

      <div class="bac-token-box" role="group" aria-label={t('oauthAccessToken')}>
        <div>
          <p class="bac-strong">
            {token ? (expired ? t('oauthTokenExpired') : t('oauthTokenReady')) : t('oauthTokenNone')}
          </p>
          <p class="bac-muted bac-small">
            {token
              ? `${token.accessToken.slice(0, 10)}… · ${tokenExpiresIn(token, now)}${token.refreshToken ? ` · ${t('oauthCanRefresh')}` : ''}`
              : authCode
                ? t('oauthTokenHintAuthCode')
                : t('oauthTokenHintClient')}
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
            {t('commonClear')}
          </button>
        )}
        <button type="button" class="bac-btn bac-btn-small bac-btn-primary" disabled={busy || (authCode && !identityAvailable())} onClick={() => void getToken()}>
          {busy ? t('oauthWaiting') : t('oauthGetToken')}
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
