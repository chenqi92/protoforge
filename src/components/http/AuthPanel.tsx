import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { useTranslation } from 'react-i18next';
import type { OAuth2Config } from "@/types/http";

export function AuthPanel({
  config,
  tabId,
  updateHttpConfig,
}: {
  config: {
    authType: string;
    bearerToken: string;
    basicUsername: string;
    basicPassword: string;
    apiKeyAddTo: string;
    apiKeyName: string;
    apiKeyValue: string;
    oauth2Config: OAuth2Config;
  };
  tabId: string;
  updateHttpConfig: (tabId: string, updates: Record<string, any>) => void;
}) {
  const { t } = useTranslation();
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const toggleSecret = (field: string) => setShowSecrets(prev => ({ ...prev, [field]: !prev[field] }));

  return (
    <div className="flex h-full flex-1 min-h-0">
      <div className="w-[140px] shrink-0 border-r border-border-default/60 bg-bg-secondary/20 p-3 overflow-y-auto">
        <div className="flex flex-col gap-0.5">
          {(["none", "bearer", "basic", "apiKey", "oauth2"] as const).map((at) => (
            <button
              key={at}
              onClick={() => updateHttpConfig(tabId, { authType: at })}
              className={cn(
                "flex items-center w-full px-3 py-2 rounded-md text-left pf-text-xs transition-colors",
                config.authType === at
                  ? "bg-accent/10 text-text-primary font-medium"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              )}
            >
              {at === "none" ? "No Auth" : at === "bearer" ? "Bearer Token" : at === "basic" ? "Basic Auth" : at === "apiKey" ? "API Key" : "OAuth 2.0"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 p-5 overflow-y-auto">
        <div className="max-w-2xl">
          {config.authType === "none" && <p className="pf-text-xs text-text-disabled mt-2">{t('http.noAuth')}</p>}
          {config.authType === "bearer" && (
            <div className="space-y-2">
              <label className="pf-text-xs font-medium text-text-secondary">{t('http.bearerTokenLabel')}</label>
              <div className="relative">
                <input
                  value={config.bearerToken}
                  onChange={(e) => updateHttpConfig(tabId, { bearerToken: e.target.value })}
                  type={showSecrets['bearer'] ? 'text' : 'password'}
                  placeholder="ey..."
                  className="wb-field w-full font-mono pf-text-xs pr-9"
                />
                <button type="button" onClick={() => toggleSecret('bearer')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-disabled hover:text-text-secondary transition-colors" tabIndex={-1}>
                  {showSecrets['bearer'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          )}
          {config.authType === "basic" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="pf-text-xs font-medium text-text-secondary">Username</label>
                <input value={config.basicUsername} onChange={(e) => updateHttpConfig(tabId, { basicUsername: e.target.value })} className="wb-field w-full pf-text-xs" />
              </div>
              <div className="space-y-1.5">
                <label className="pf-text-xs font-medium text-text-secondary">Password</label>
                <div className="relative">
                  <input value={config.basicPassword} onChange={(e) => updateHttpConfig(tabId, { basicPassword: e.target.value })} type={showSecrets['basicPwd'] ? 'text' : 'password'} className="wb-field w-full pf-text-xs pr-9" />
                  <button type="button" onClick={() => toggleSecret('basicPwd')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-disabled hover:text-text-secondary transition-colors" tabIndex={-1}>
                    {showSecrets['basicPwd'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          )}
          {config.authType === "apiKey" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="pf-text-xs font-medium text-text-secondary">{t('http.addTo')}</label>
                <div className="wb-segmented w-fit">
                  {(["header", "query"] as const).map((a) => (
                    <button key={a} onClick={() => updateHttpConfig(tabId, { apiKeyAddTo: a })} className={cn("wb-segment", config.apiKeyAddTo === a && "wb-segment-active")}>
                      {a === "header" ? "Header" : "Query Param"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="pf-text-xs font-medium text-text-secondary">Key</label>
                <input value={config.apiKeyName} onChange={(e) => updateHttpConfig(tabId, { apiKeyName: e.target.value })} placeholder="X-API-Key" className="wb-field w-full font-mono pf-text-xs" />
              </div>
              <div className="space-y-1.5">
                <label className="pf-text-xs font-medium text-text-secondary">Value</label>
                <div className="relative">
                  <input value={config.apiKeyValue} onChange={(e) => updateHttpConfig(tabId, { apiKeyValue: e.target.value })} type={showSecrets['apiKey'] ? 'text' : 'password'} className="wb-field w-full font-mono pf-text-xs pr-9" />
                  <button type="button" onClick={() => toggleSecret('apiKey')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-disabled hover:text-text-secondary transition-colors" tabIndex={-1}>
                    {showSecrets['apiKey'] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          )}
          {config.authType === "oauth2" && (
            <OAuth2Panel config={config.oauth2Config} onChange={(updates) => updateHttpConfig(tabId, { oauth2Config: { ...config.oauth2Config, ...updates } })} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── OAuth 2.0 Panel ── */
function OAuth2Panel({ config, onChange }: { config: OAuth2Config; onChange: (updates: Partial<OAuth2Config>) => void }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenMeta, setTokenMeta] = useState<{ tokenType?: string; expiresIn?: number; scope?: string } | null>(null);

  const canFetchToken = config.accessTokenUrl && config.clientId && (
    config.grantType === "client_credentials" ||
    (config.grantType === "password" && config.username) ||
    (config.grantType === "authorization_code" && config.authUrl && config.redirectUri)
  );

  const exchangeCodeForToken = async (code: string) => {
    return invoke<{
      accessToken: string;
      tokenType?: string;
      expiresIn?: number;
      refreshToken?: string;
      scope?: string;
    }>("fetch_oauth2_token", {
      req: {
        grantType: config.grantType,
        accessTokenUrl: config.accessTokenUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        scope: config.scope || null,
        username: config.username || null,
        password: config.password || null,
        code,
        redirectUri: config.redirectUri || null,
      },
    });
  };

  const handleFetchToken = async () => {
    setLoading(true);
    setError(null);
    try {
      if (config.grantType === "authorization_code") {
        setAuthorizing(true);
        const { openOAuthWindow } = await import("@/lib/oauthWindow");
        let oauthResult;
        try {
          oauthResult = await openOAuthWindow({
            authUrl: config.authUrl,
            clientId: config.clientId,
            redirectUri: config.redirectUri,
            scope: config.scope,
          });
        } finally {
          setAuthorizing(false);
        }

        const result = await exchangeCodeForToken(oauthResult.code);
        onChange({ accessToken: result.accessToken });
        setTokenMeta({
          tokenType: result.tokenType,
          expiresIn: result.expiresIn,
          scope: result.scope,
        });
      } else {
        const result = await invoke<{
          accessToken: string;
          tokenType?: string;
          expiresIn?: number;
          refreshToken?: string;
          scope?: string;
        }>("fetch_oauth2_token", {
          req: {
            grantType: config.grantType,
            accessTokenUrl: config.accessTokenUrl,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            scope: config.scope || null,
            username: config.username || null,
            password: config.password || null,
            code: null,
            redirectUri: null,
          },
        });
        onChange({ accessToken: result.accessToken });
        setTokenMeta({
          tokenType: result.tokenType,
          expiresIn: result.expiresIn,
          scope: result.scope,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setAuthorizing(false);
    }
  };

  const buttonLabel = authorizing
    ? t('http.oauth2.authorizing')
    : loading
      ? t('http.oauth2.fetchingToken')
      : config.grantType === "authorization_code"
        ? t('http.oauth2.authorize')
        : t('http.oauth2.fetchToken');

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="pf-text-xs font-medium text-text-secondary">{t('http.authType')}</label>
        <div className="wb-segmented w-fit">
          {(["client_credentials", "authorization_code", "password"] as const).map((gt) => (
            <button
              key={gt}
              onClick={() => { onChange({ grantType: gt }); setError(null); setTokenMeta(null); }}
              className={cn("wb-segment", config.grantType === gt && "wb-segment-active")}
            >
              {gt === "client_credentials" ? "Client Credentials" : gt === "authorization_code" ? "Authorization Code" : "Password"}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="pf-text-xs font-medium text-text-secondary">Access Token URL</label>
        <input value={config.accessTokenUrl} onChange={(e) => onChange({ accessTokenUrl: e.target.value })} placeholder="https://auth.example.com/oauth/token" className="wb-field w-full font-mono pf-text-xs" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="pf-text-xs font-medium text-text-secondary">Client ID</label>
          <input value={config.clientId} onChange={(e) => onChange({ clientId: e.target.value })} className="wb-field w-full font-mono pf-text-xs" />
        </div>
        <div className="space-y-1.5">
          <label className="pf-text-xs font-medium text-text-secondary">Client Secret</label>
          <input value={config.clientSecret} onChange={(e) => onChange({ clientSecret: e.target.value })} type="password" className="wb-field w-full font-mono pf-text-xs" />
        </div>
      </div>
      {config.grantType === "authorization_code" && (
        <>
          <div className="space-y-1.5">
            <label className="pf-text-xs font-medium text-text-secondary">Auth URL</label>
            <input value={config.authUrl} onChange={(e) => onChange({ authUrl: e.target.value })} placeholder="https://auth.example.com/authorize" className="wb-field w-full font-mono pf-text-xs" />
          </div>
          <div className="space-y-1.5">
            <label className="pf-text-xs font-medium text-text-secondary">Redirect URI</label>
            <input value={config.redirectUri} onChange={(e) => onChange({ redirectUri: e.target.value })} className="wb-field w-full font-mono pf-text-xs" />
          </div>
        </>
      )}
      {config.grantType === "password" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="pf-text-xs font-medium text-text-secondary">Username</label>
            <input value={config.username} onChange={(e) => onChange({ username: e.target.value })} className="wb-field w-full pf-text-xs" />
          </div>
          <div className="space-y-1.5">
            <label className="pf-text-xs font-medium text-text-secondary">Password</label>
            <input value={config.password} onChange={(e) => onChange({ password: e.target.value })} type="password" className="wb-field w-full pf-text-xs" />
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <label className="pf-text-xs font-medium text-text-secondary">Scope</label>
        <input value={config.scope} onChange={(e) => onChange({ scope: e.target.value })} placeholder="read write" className="wb-field w-full font-mono pf-text-xs" />
      </div>

      {/* Get Token + Access Token */}
      <div className="pt-2 border-t border-border-default">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={handleFetchToken}
            disabled={loading || !canFetchToken}
            className={cn(
              "px-4 py-2 pf-text-sm font-semibold rounded-lg transition-all flex items-center gap-2",
              loading
                ? "bg-warning cursor-wait opacity-70 text-white"
                : canFetchToken
                  ? "bg-accent hover:bg-accent-hover text-white shadow-sm"
                  : "bg-bg-tertiary text-text-disabled cursor-not-allowed"
            )}
          >
            {(loading || authorizing) && (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="31.4 31.4" />
              </svg>
            )}
            {buttonLabel}
          </button>
          {tokenMeta && (
            <div className="flex items-center gap-2 pf-text-xs text-text-tertiary">
              {tokenMeta.tokenType && <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 rounded pf-text-xxs font-medium">{tokenMeta.tokenType}</span>}
              {tokenMeta.expiresIn && <span>{t('http.tokenExpiry', { time: tokenMeta.expiresIn })}</span>}
              {tokenMeta.scope && <span>scope: {tokenMeta.scope}</span>}
            </div>
          )}
        </div>
        {authorizing && (
          <div className="mb-3 p-2.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 pf-text-xs text-blue-600 dark:text-blue-400 flex items-center gap-2">
            <svg className="w-4 h-4 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {t('http.oauth2.authorizingHint')}
          </div>
        )}
        {error && (
          <div className="mb-3 p-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 pf-text-xs text-red-600 dark:text-red-400 break-all">
            {error}
          </div>
        )}
        <div className="space-y-1.5">
          <label className="pf-text-xs font-medium text-text-secondary">Access Token</label>
          <input value={config.accessToken} onChange={(e) => onChange({ accessToken: e.target.value })} placeholder={t('http.oauth2.accessTokenPlaceholder')} className="wb-field w-full font-mono pf-text-xs" />
        </div>
      </div>
    </div>
  );
}
