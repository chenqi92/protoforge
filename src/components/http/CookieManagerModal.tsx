import { useState, useMemo, useCallback } from "react";
import {
  Cookie,
  Search,
  Plus,
  Trash2,
  X,
  ChevronRight,
  ChevronDown,
  Pencil,
  Shield,
  Globe,
  AlertTriangle,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useCookieJarStore, type StoredCookie } from "@/stores/cookieJarStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

interface CookieManagerModalProps {
  open: boolean;
  onClose: () => void;
}

// Group cookies by effective domain
function groupByDomain(cookies: StoredCookie[]): Record<string, StoredCookie[]> {
  const groups: Record<string, StoredCookie[]> = {};
  for (const c of cookies) {
    const d = c.domain || c.originDomain || "unknown";
    (groups[d] ??= []).push(c);
  }
  // Sort domains alphabetically
  const sorted: Record<string, StoredCookie[]> = {};
  for (const key of Object.keys(groups).sort()) {
    sorted[key] = groups[key];
  }
  return sorted;
}

function isExpired(cookie: StoredCookie): boolean {
  if (!cookie.expires) return false;
  try {
    return new Date(cookie.expires).getTime() < Date.now();
  } catch {
    return false;
  }
}

function formatDate(ts: number | string | null | undefined): string {
  if (!ts) return "—";
  try {
    const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

// ── Edit / Add cookie form ──
interface CookieFormData {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

function emptyForm(domain?: string): CookieFormData {
  return {
    name: "",
    value: "",
    domain: domain || "",
    path: "/",
    expires: "",
    httpOnly: false,
    secure: false,
    sameSite: "",
  };
}

function cookieToForm(c: StoredCookie): CookieFormData {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain || c.originDomain || "",
    path: c.path || "/",
    expires: c.expires || "",
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite || "",
  };
}

export function CookieManagerModal({ open, onClose }: CookieManagerModalProps) {
  const { t } = useTranslation();
  const cookies = useCookieJarStore((s) => s.cookies);
  const clearAll = useCookieJarStore((s) => s.clear);
  const clearDomain = useCookieJarStore((s) => s.clearDomain);
  const removeCookie = useCookieJarStore((s) => s.removeCookie);
  const addCookie = useCookieJarStore((s) => s.addCookie);
  const updateCookie = useCookieJarStore((s) => s.updateCookie);
  const autoSave = useSettingsStore((s) => s.settings.autoSaveCookies);

  const [search, setSearch] = useState("");
  const [collapsedDomains, setCollapsedDomains] = useState<Set<string>>(new Set());

  // Editing state: null = not editing, { mode, ... } = editing/adding
  const [editing, setEditing] = useState<{
    mode: "add" | "edit";
    original?: { name: string; domain: string; path: string };
    form: CookieFormData;
    errors: Record<string, string>;
  } | null>(null);

  // Filter cookies by search
  const filtered = useMemo(() => {
    if (!search.trim()) return cookies;
    const q = search.toLowerCase();
    return cookies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.value.toLowerCase().includes(q) ||
        (c.domain || "").toLowerCase().includes(q) ||
        (c.path || "").toLowerCase().includes(q),
    );
  }, [cookies, search]);

  const grouped = useMemo(() => groupByDomain(filtered), [filtered]);
  const domainKeys = Object.keys(grouped);
  const totalCount = cookies.length;

  const toggleDomain = useCallback((domain: string) => {
    setCollapsedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }, []);

  const handleClearAll = useCallback(async () => {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const yes = await confirm(t("cookieManager.clearAllConfirm"));
    if (yes) clearAll();
  }, [clearAll, t]);

  const handleClearDomain = useCallback(
    async (domain: string) => {
      const { confirm } = await import("@tauri-apps/plugin-dialog");
      const yes = await confirm(t("cookieManager.clearDomainConfirm", { domain }));
      if (yes) clearDomain(domain);
    },
    [clearDomain, t],
  );

  const handleRemoveCookie = useCallback(
    (c: StoredCookie) => {
      removeCookie(c.name, c.domain || c.originDomain || "", c.path || "/");
    },
    [removeCookie],
  );

  // ── Form handlers ──
  const startAdd = useCallback((domain?: string) => {
    setEditing({ mode: "add", form: emptyForm(domain), errors: {} });
  }, []);

  const startEdit = useCallback((c: StoredCookie) => {
    setEditing({
      mode: "edit",
      original: {
        name: c.name,
        domain: c.domain || c.originDomain || "",
        path: c.path || "/",
      },
      form: cookieToForm(c),
      errors: {},
    });
  }, []);

  const cancelEdit = useCallback(() => setEditing(null), []);

  const updateForm = useCallback(
    <K extends keyof CookieFormData>(key: K, value: CookieFormData[K]) => {
      setEditing((prev) => {
        if (!prev) return prev;
        const { [key]: _, ...restErrors } = prev.errors;
        return { ...prev, form: { ...prev.form, [key]: value }, errors: restErrors };
      });
    },
    [],
  );

  const handleSave = useCallback(() => {
    if (!editing) return;
    const { form, mode, original } = editing;
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = t("cookieManager.nameRequired");
    if (!form.domain.trim()) errors.domain = t("cookieManager.domainRequired");
    if (Object.keys(errors).length) {
      setEditing({ ...editing, errors });
      return;
    }

    const stored: StoredCookie = {
      name: form.name.trim(),
      value: form.value,
      domain: form.domain.trim().toLowerCase().replace(/^\./, ""),
      path: form.path || "/",
      expires: form.expires || null,
      httpOnly: form.httpOnly,
      secure: form.secure,
      sameSite: form.sameSite || null,
      originDomain: form.domain.trim().toLowerCase().replace(/^\./, ""),
      storedAt: Date.now(),
    };

    if (mode === "add") {
      addCookie(stored);
    } else if (original) {
      updateCookie(original, stored);
    }
    setEditing(null);
  }, [editing, addCookie, updateCookie, t]);

  const openSettings = useCallback(() => {
    onClose();
    window.dispatchEvent(new CustomEvent("open-settings-modal"));
  }, [onClose]);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setEditing(null);
          onClose();
        }
      }}
    >
      <DialogContent
        className="flex h-[min(86vh,720px)] w-[920px] max-w-[94vw] min-h-[560px] max-h-[86vh] flex-col gap-0 overflow-hidden pf-rounded-xl border border-border-default bg-bg-primary p-0 shadow-[0_12px_32px_-4px_rgba(0,0,0,0.12),0_4px_12px_-4px_rgba(0,0,0,0.08)] dark:border-white/[0.08] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_16px_48px_rgba(0,0,0,0.6)] sm:max-w-[920px]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t("cookieManager.title")}</DialogTitle>

        <div className="flex h-full min-h-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-border-default/80 px-6 py-4">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center pf-rounded-xl bg-accent">
                <Cookie className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="pf-text-xl font-semibold tracking-tight text-text-primary">
                  {t("cookieManager.title")}
                </p>
                <p className="mt-1 pf-text-sm leading-5 text-text-secondary">
                  {t("cookieManager.subtitle")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {totalCount > 0 && (
                <button
                  onClick={handleClearAll}
                  className="flex h-8 items-center gap-1.5 pf-rounded-lg border border-border-default/80 bg-bg-primary/72 px-3 pf-text-xs font-medium text-red-500 dark:text-red-300 transition-colors hover:bg-red-500/8"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("cookieManager.clearAll")}
                </button>
              )}
              <button
                onClick={() => startAdd()}
                className="flex h-8 items-center gap-1.5 pf-rounded-lg bg-accent px-3 pf-text-xs font-semibold text-white shadow-sm transition-colors hover:bg-accent/90"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("cookieManager.addCookie")}
              </button>
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center pf-rounded-lg text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Auto-save notice */}
          {!autoSave && (
            <div className="mx-6 mt-4 flex items-center gap-3 pf-rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-300" />
              <div className="min-w-0 flex-1">
                <p className="pf-text-xs font-medium text-amber-700 dark:text-amber-400">
                  {t("cookieManager.autoSaveOff")}
                </p>
                <p className="mt-0.5 pf-text-xs text-amber-600/80 dark:text-amber-400/60">
                  {t("cookieManager.autoSaveOffHint")}
                </p>
              </div>
              <button
                onClick={openSettings}
                className="flex h-7 shrink-0 items-center gap-1 pf-rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 pf-text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
              >
                <Settings className="h-3 w-3" />
                {t("cookieManager.goToSettings")}
              </button>
            </div>
          )}

          {/* Search + stats bar */}
          <div className="flex shrink-0 items-center gap-3 border-b border-border-default/60 px-6 py-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-disabled" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("cookieManager.search")}
                className="h-8 w-full pf-rounded-lg border border-border-default/60 bg-bg-secondary/40 pl-9 pr-3 pf-text-xs text-text-primary outline-none placeholder:text-text-disabled focus:border-accent/40 focus:ring-1 focus:ring-accent/20"
              />
            </div>
            <div className="flex items-center gap-3 pf-text-xs text-text-tertiary">
              <span>{t("cookieManager.cookieCount", { count: filtered.length })}</span>
              <span className="text-border-default">|</span>
              <span>{t("cookieManager.domainCount", { count: domainKeys.length })}</span>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {editing ? (
              <CookieForm
                editing={editing}
                updateForm={updateForm}
                onSave={handleSave}
                onCancel={cancelEdit}
              />
            ) : totalCount === 0 ? (
              <EmptyState onAdd={() => startAdd()} />
            ) : filtered.length === 0 ? (
              <div className="flex h-full items-center justify-center p-8 text-text-disabled pf-text-sm">
                {t("cookieManager.empty")}
              </div>
            ) : (
              <div className="divide-y divide-border-default/40">
                {domainKeys.map((domain) => (
                  <DomainGroup
                    key={domain}
                    domain={domain}
                    cookies={grouped[domain]}
                    collapsed={collapsedDomains.has(domain)}
                    onToggle={() => toggleDomain(domain)}
                    onClearDomain={() => handleClearDomain(domain)}
                    onAddCookie={() => startAdd(domain)}
                    onEditCookie={startEdit}
                    onRemoveCookie={handleRemoveCookie}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Empty state ──
function EmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10">
        <Cookie className="h-8 w-8 text-amber-500 dark:text-amber-300/60" />
      </div>
      <div className="text-center">
        <p className="pf-text-base font-semibold text-text-secondary">{t("cookieManager.empty")}</p>
        <p className="mt-1.5 max-w-[360px] pf-text-xs leading-5 text-text-tertiary">
          {t("cookieManager.emptyHint")}
        </p>
      </div>
      <button
        onClick={onAdd}
        className="flex h-8 items-center gap-1.5 pf-rounded-lg bg-accent px-4 pf-text-xs font-semibold text-white shadow-sm transition-colors hover:bg-accent/90"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("cookieManager.addCookie")}
      </button>
    </div>
  );
}

// ── Domain group ──
function DomainGroup({
  domain,
  cookies,
  collapsed,
  onToggle,
  onClearDomain,
  onAddCookie,
  onEditCookie,
  onRemoveCookie,
}: {
  domain: string;
  cookies: StoredCookie[];
  collapsed: boolean;
  onToggle: () => void;
  onClearDomain: () => void;
  onAddCookie: () => void;
  onEditCookie: (c: StoredCookie) => void;
  onRemoveCookie: (c: StoredCookie) => void;
}) {
  const { t } = useTranslation();
  const secureCnt = cookies.filter((c) => c.secure).length;
  const httpOnlyCnt = cookies.filter((c) => c.httpOnly).length;

  return (
    <div>
      {/* Domain header */}
      <div
        className="group flex cursor-pointer items-center gap-2 px-6 py-3 transition-colors hover:bg-bg-hover/40"
        onClick={onToggle}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-disabled transition-transform" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-disabled transition-transform" />
        )}

        <Globe className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        <span className="pf-text-sm font-semibold text-text-primary">{domain}</span>

        <span className="pf-text-xs text-text-disabled">
          {t("cookieManager.cookieCount", { count: cookies.length })}
        </span>

        {secureCnt > 0 && (
          <span className="flex items-center gap-0.5 pf-text-xs text-emerald-600 dark:text-emerald-300">
            <Shield className="h-3 w-3" /> {secureCnt}
          </span>
        )}
        {httpOnlyCnt > 0 && (
          <span className="pf-text-xs text-blue-600 dark:text-blue-300">HttpOnly {httpOnlyCnt}</span>
        )}

        <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddCookie();
            }}
            className="flex h-6 w-6 items-center justify-center pf-rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
            title={t("cookieManager.addCookie")}
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClearDomain();
            }}
            className="flex h-6 w-6 items-center justify-center pf-rounded-md text-text-tertiary hover:bg-red-500/10 hover:text-red-500 dark:text-red-300"
            title={t("cookieManager.clearDomain")}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Cookies table */}
      {!collapsed && (
        <div className="px-6 pb-3">
          <div className="overflow-hidden pf-rounded-lg border border-border-default/60">
            <table className="w-full pf-text-xs">
              <thead>
                <tr className="border-b border-border-default/40 bg-bg-secondary/40">
                  <th className="px-3 py-2 text-left font-semibold text-text-tertiary">
                    {t("cookieManager.name")}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-text-tertiary">
                    {t("cookieManager.value")}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-text-tertiary">
                    {t("cookieManager.path")}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-text-tertiary">
                    {t("cookieManager.expires")}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-text-tertiary">
                    {t("cookieManager.flags")}
                  </th>
                  <th className="w-[72px] px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default/30">
                {cookies.map((cookie, i) => {
                  const expired = isExpired(cookie);
                  return (
                    <tr
                      key={`${cookie.name}-${cookie.path}-${i}`}
                      className={cn(
                        "group/row transition-colors hover:bg-bg-hover/30",
                        expired && "opacity-50",
                      )}
                    >
                      <td className="px-3 py-2 font-medium text-text-primary">
                        {cookie.name}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2 font-mono text-text-secondary" title={cookie.value}>
                        {cookie.value}
                      </td>
                      <td className="px-3 py-2 text-text-tertiary">{cookie.path || "/"}</td>
                      <td className="px-3 py-2 text-text-tertiary">
                        {expired ? (
                          <span className="text-red-500 dark:text-red-300">{t("cookieManager.expired")}</span>
                        ) : cookie.expires ? (
                          formatDate(cookie.expires)
                        ) : (
                          <span className="text-text-disabled">{t("cookieManager.neverExpires")}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {cookie.httpOnly && (
                            <span className="inline-flex pf-rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-300">
                              HttpOnly
                            </span>
                          )}
                          {cookie.secure && (
                            <span className="inline-flex pf-rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-300">
                              Secure
                            </span>
                          )}
                          {cookie.sameSite && (
                            <span className="inline-flex pf-rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-300">
                              {cookie.sameSite}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
                          <button
                            onClick={() => onEditCookie(cookie)}
                            className="flex h-6 w-6 items-center justify-center pf-rounded-md text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
                            title={t("cookieManager.editCookie")}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => onRemoveCookie(cookie)}
                            className="flex h-6 w-6 items-center justify-center pf-rounded-md text-text-tertiary hover:bg-red-500/10 hover:text-red-500 dark:text-red-300"
                            title={t("cookieManager.deleteCookie")}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cookie add/edit form ──
function CookieForm({
  editing,
  updateForm,
  onSave,
  onCancel,
}: {
  editing: {
    mode: "add" | "edit";
    form: CookieFormData;
    errors: Record<string, string>;
  };
  updateForm: <K extends keyof CookieFormData>(key: K, value: CookieFormData[K]) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { form, errors, mode } = editing;

  const fieldCls =
    "h-8 w-full pf-rounded-lg border border-border-default/60 bg-bg-secondary/40 px-3 pf-text-xs text-text-primary outline-none placeholder:text-text-disabled focus:border-accent/40 focus:ring-1 focus:ring-accent/20";
  const errorCls = "mt-1 pf-text-xs text-red-500 dark:text-red-300";

  return (
    <div className="mx-auto w-full max-w-[560px] p-6">
      <h3 className="pf-text-base font-semibold text-text-primary">
        {mode === "add" ? t("cookieManager.addCookie") : t("cookieManager.editCookie")}
      </h3>

      <div className="mt-5 grid gap-4">
        {/* Name */}
        <div>
          <label className="pf-text-xs font-semibold text-text-secondary">
            {t("cookieManager.name")} <span className="text-red-500 dark:text-red-300">*</span>
          </label>
          <input
            value={form.name}
            onChange={(e) => updateForm("name", e.target.value)}
            className={cn(fieldCls, "mt-1.5", errors.name && "border-red-500/60")}
            placeholder="session_id"
          />
          {errors.name && <p className={errorCls}>{errors.name}</p>}
        </div>

        {/* Value */}
        <div>
          <label className="pf-text-xs font-semibold text-text-secondary">
            {t("cookieManager.value")}
          </label>
          <input
            value={form.value}
            onChange={(e) => updateForm("value", e.target.value)}
            className={cn(fieldCls, "mt-1.5 font-mono")}
            placeholder="abc123..."
          />
        </div>

        {/* Domain + Path */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="pf-text-xs font-semibold text-text-secondary">
              {t("cookieManager.domain")} <span className="text-red-500 dark:text-red-300">*</span>
            </label>
            <input
              value={form.domain}
              onChange={(e) => updateForm("domain", e.target.value)}
              className={cn(fieldCls, "mt-1.5", errors.domain && "border-red-500/60")}
              placeholder="example.com"
            />
            {errors.domain && <p className={errorCls}>{errors.domain}</p>}
          </div>
          <div>
            <label className="pf-text-xs font-semibold text-text-secondary">
              {t("cookieManager.path")}
            </label>
            <input
              value={form.path}
              onChange={(e) => updateForm("path", e.target.value)}
              className={cn(fieldCls, "mt-1.5")}
              placeholder="/"
            />
          </div>
        </div>

        {/* Expires */}
        <div>
          <label className="pf-text-xs font-semibold text-text-secondary">
            {t("cookieManager.expires")}
          </label>
          <input
            type="datetime-local"
            value={form.expires ? toDatetimeLocal(form.expires) : ""}
            onChange={(e) => {
              updateForm("expires", e.target.value ? new Date(e.target.value).toUTCString() : "");
            }}
            className={cn(fieldCls, "mt-1.5")}
          />
        </div>

        {/* Flags */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex items-center justify-between pf-rounded-lg border border-border-default/40 bg-bg-secondary/30 px-3 py-2.5">
            <span className="pf-text-xs font-semibold text-text-secondary">HttpOnly</span>
            <Switch
              size="sm"
              checked={form.httpOnly}
              onCheckedChange={(checked) => updateForm("httpOnly", checked)}
            />
          </div>
          <div className="flex items-center justify-between pf-rounded-lg border border-border-default/40 bg-bg-secondary/30 px-3 py-2.5">
            <span className="pf-text-xs font-semibold text-text-secondary">Secure</span>
            <Switch
              size="sm"
              checked={form.secure}
              onCheckedChange={(checked) => updateForm("secure", checked)}
            />
          </div>
          <div>
            <label className="pf-text-xs font-semibold text-text-secondary">SameSite</label>
            <select
              value={form.sameSite}
              onChange={(e) => updateForm("sameSite", e.target.value)}
              className={cn(fieldCls, "mt-1.5")}
            >
              <option value="">None</option>
              <option value="Strict">Strict</option>
              <option value="Lax">Lax</option>
              <option value="None">None (explicit)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          onClick={onCancel}
          className="h-8 pf-rounded-lg border border-border-default/80 bg-bg-primary/72 px-4 pf-text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover"
        >
          {t("cookieManager.cancel")}
        </button>
        <button
          onClick={onSave}
          className="h-8 pf-rounded-lg bg-accent px-4 pf-text-xs font-semibold text-white shadow-sm transition-colors hover:bg-accent/90"
        >
          {t("cookieManager.save")}
        </button>
      </div>
    </div>
  );
}

/** Convert a date string to datetime-local input value */
function toDatetimeLocal(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    // Format as YYYY-MM-DDThh:mm
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}
