import { useState, useEffect, useCallback, useRef } from "react";
import { Eye, EyeOff, RefreshCw, Trash2, ShieldCheck, Info } from "lucide-react";
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

/* ── Token status helpers ── */
type TokenStatus = "valid" | "expiring" | "expired" | "none";

function getTokenStatus(config: OAuth2Config): TokenStatus {
  if (!config.accessToken) return "none";
  if (!config.tokenExpiresAt) return "valid"; // no expiry info — assume valid
  const remaining = config.tokenExpiresAt - Date.now();
  if (remaining <= 0) return "expired";
  if (remaining <= 5 * 60 * 1000) return "expiring"; // < 5 min
  return "valid";
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const rm = min % 60;
  return rm > 0 ? `${hr}h ${rm}m` : `${hr}h`;
}

const statusStyles: Record<TokenStatus, string> = {
  valid: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20",
  expiring: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
  expired: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20",
  none: "bg-bg-tertiary text-text-disabled border-border-default",
};

const statusDotColor: Record<TokenStatus, string> = {
  valid: "bg-emerald-500",
  expiring: "bg-amber-500 animate-pulse",
  expired: "bg-red-500",
  none: "bg-gray-400",
};

/* ── OAuth 2.0 Panel ── */
function OAuth2Panel({ config, onChange }: { config: OAuth2Config; onChange: (updates: Partial<OAuth2Config>) => void }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenMeta, setTokenMeta] = useState<{ tokenType?: string; scope?: string } | null>(null);
  // PKCE: store code_verifier during auth flow (only needed temporarily)
  const codeVerifierRef = useRef<string | null>(null);

  // Live token status with countdown
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>(() => getTokenStatus(config));
  const [timeRemaining, setTimeRemaining] = useState<string>("");

  useEffect(() => {
    const update = () => {
      const status = getTokenStatus(config);
      setTokenStatus(status);
      if (config.tokenExpiresAt && config.accessToken) {
        const remaining = config.tokenExpiresAt - Date.now();
        setTimeRemaining(remaining > 0 ? formatTimeRemaining(remaining) : "");
      } else {
        setTimeRemaining("");
      }
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [config.accessToken, config.tokenExpiresAt]);

  const canFetchToken = config.accessTokenUrl && config.clientId && (
    config.grantType === "client_credentials" ||
    (config.grantType === "password" && config.username) ||
    (config.grantType === "authorization_code" && config.authUrl && config.redirectUri)
  );

  const applyTokenResult = useCallback((result: {
    accessToken: string;
    tokenType?: string;
    expiresIn?: number;
    refreshToken?: string;
    scope?: string;
  }) => {
    const updates: Partial<OAuth2Config> = { accessToken: result.accessToken };
    if (result.expiresIn) {
      updates.tokenExpiresAt = Date.now() + result.expiresIn * 1000;
    } else {
      updates.tokenExpiresAt = 0;
    }
    if (result.refreshToken) {
      updates.refreshToken = result.refreshToken;
    }
    onChange(updates);
    setTokenMeta({
      tokenType: result.tokenType,
      scope: result.scope,
    });
  }, [onChange]);

  const handleFetchToken = async () => {
    setLoading(true);
    setError(null);
    try {
      if (config.grantType === "authorization_code") {
        setAuthorizing(true);

        // PKCE: generate verifier and challenge if enabled
        let codeChallenge: string | undefined;
        if (config.usePkce) {
          const { generateCodeVerifier, generateCodeChallenge } = await import("@/lib/pkce");
          const verifier = generateCodeVerifier();
          codeVerifierRef.current = verifier;
          codeChallenge = await generateCodeChallenge(verifier);
        }

        const { openOAuthWindow } = await import("@/lib/oauthWindow");
        let oauthResult;
        try {
          oauthResult = await openOAuthWindow({
            authUrl: config.authUrl,
            clientId: config.clientId,
            redirectUri: config.redirectUri,
            scope: config.scope,
            codeChallenge,
          });
        } finally {
          setAuthorizing(false);
        }

        // Validate state to prevent CSRF attacks
        if (oauthResult.state !== oauthResult._sentState) {
          throw new Error("OAuth state mismatch — possible CSRF attack. Please try again.");
        }

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
            username: null,
            password: null,
            code: oauthResult.code,
            redirectUri: config.redirectUri || null,
            codeVerifier: codeVerifierRef.current || null,
            refreshToken: null,
          },
        });
        codeVerifierRef.current = null;
        applyTokenResult(result);
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
            codeVerifier: null,
            refreshToken: null,
          },
        });
        applyTokenResult(result);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setAuthorizing(false);
    }
  };

  const handleRefreshToken = async () => {
    if (!config.refreshToken || !config.accessTokenUrl) return;
    setRefreshing(true);
    setError(null);
    try {
      const result = await invoke<{
        accessToken: string;
        tokenType?: string;
        expiresIn?: number;
        refreshToken?: string;
        scope?: string;
      }>("fetch_oauth2_token", {
        req: {
          grantType: "refresh_token",
          accessTokenUrl: config.accessTokenUrl,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          scope: config.scope || null,
          username: null,
          password: null,
          code: null,
          redirectUri: null,
          codeVerifier: null,
          refreshToken: config.refreshToken,
        },
      });
      applyTokenResult(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const handleClearToken = () => {
    onChange({ accessToken: "", refreshToken: "", tokenExpiresAt: 0 });
    setTokenMeta(null);
    setError(null);
  };

  const buttonLabel = authorizing
    ? t('http.oauth2.authorizing')
    : loading
      ? t('http.oauth2.fetchingToken')
      : config.grantType === "authorization_code"
        ? t('http.oauth2.authorize')
        : t('http.oauth2.fetchToken');

  const statusLabel = tokenStatus === "valid"
    ? t('http.oauth2.tokenValid')
    : tokenStatus === "expiring"
      ? t('http.oauth2.tokenExpiring')
      : tokenStatus === "expired"
        ? t('http.oauth2.tokenExpired')
        : t('http.oauth2.noToken');

  return (
    <div className="space-y-3">
      {/* Grant Type */}
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

      {/* Common fields */}
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

      {/* Authorization Code specific */}
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
          {/* PKCE Toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange({ usePkce: !config.usePkce })}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                config.usePkce ? "bg-accent" : "bg-bg-tertiary border border-border-default"
              )}
            >
              <span className={cn(
                "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                config.usePkce ? "translate-x-[18px]" : "translate-x-[3px]"
              )} />
            </button>
            <span className="pf-text-xs font-medium text-text-secondary flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              {t('http.oauth2.pkce')}
            </span>
            <span className="pf-text-xxs text-text-disabled" title={t('http.oauth2.pkceHint')}>
              <Info className="w-3 h-3" />
            </span>
          </div>
        </>
      )}

      {/* Password specific */}
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

      {/* ── Token Section ── */}
      <div className="pt-2 border-t border-border-default space-y-3">

        {/* Token status badge */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-md border pf-text-xxs font-medium", statusStyles[tokenStatus])}>
            <span className={cn("w-1.5 h-1.5 rounded-full", statusDotColor[tokenStatus])} />
            {statusLabel}
          </span>
          {timeRemaining && tokenStatus !== "none" && (
            <span className="pf-text-xxs text-text-tertiary">
              {t('http.oauth2.expiresIn', { time: timeRemaining })}
            </span>
          )}
          {tokenMeta?.tokenType && (
            <span className="px-1.5 py-0.5 bg-sky-500/10 text-sky-600 dark:text-sky-400 rounded pf-text-xxs font-medium">
              {tokenMeta.tokenType}
            </span>
          )}
          {tokenMeta?.scope && (
            <span className="pf-text-xxs text-text-tertiary">scope: {tokenMeta.scope}</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Get Token */}
          <button
            onClick={handleFetchToken}
            disabled={loading || !canFetchToken}
            className={cn(
              "px-3.5 py-1.5 pf-text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5",
              loading
                ? "bg-warning cursor-wait opacity-70 text-white"
                : canFetchToken
                  ? "bg-accent hover:bg-accent-hover text-white shadow-sm"
                  : "bg-bg-tertiary text-text-disabled cursor-not-allowed"
            )}
          >
            {(loading || authorizing) && (
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="31.4 31.4" />
              </svg>
            )}
            {buttonLabel}
          </button>

          {/* Refresh Token button */}
          {config.refreshToken && (
            <button
              onClick={handleRefreshToken}
              disabled={refreshing}
              className={cn(
                "px-3 py-1.5 pf-text-xs font-medium rounded-lg border transition-all flex items-center gap-1.5",
                refreshing
                  ? "border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 cursor-wait"
                  : "border-border-default bg-bg-secondary hover:bg-bg-hover text-text-secondary hover:text-text-primary"
              )}
            >
              <RefreshCw className={cn("w-3 h-3", refreshing && "animate-spin")} />
              {refreshing ? t('http.oauth2.refreshing') : t('http.oauth2.refreshToken')}
            </button>
          )}

          {/* Clear Token button */}
          {config.accessToken && (
            <button
              onClick={handleClearToken}
              className="px-3 py-1.5 pf-text-xs font-medium rounded-lg border border-border-default bg-bg-secondary hover:bg-red-50 dark:hover:bg-red-500/10 text-text-secondary hover:text-red-600 dark:text-red-300 transition-all flex items-center gap-1.5"
            >
              <Trash2 className="w-3 h-3" />
              {t('http.oauth2.clearToken')}
            </button>
          )}
        </div>

        {/* Authorizing hint */}
        {authorizing && (
          <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 pf-text-xs text-blue-600 dark:text-blue-400 flex items-center gap-2">
            <svg className="w-4 h-4 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {t('http.oauth2.authorizingHint')}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 pf-text-xs text-red-600 dark:text-red-400 break-all">
            {error}
          </div>
        )}

        {/* Access Token field */}
        <div className="space-y-1.5">
          <label className="pf-text-xs font-medium text-text-secondary">Access Token</label>
          <input value={config.accessToken} onChange={(e) => onChange({ accessToken: e.target.value })} placeholder={t('http.oauth2.accessTokenPlaceholder')} className="wb-field w-full font-mono pf-text-xs" />
        </div>
      </div>
    </div>
  );
}
