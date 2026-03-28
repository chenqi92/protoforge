// Design System Showcase — ProtoForge
// Dev-only page for previewing all design tokens, components, and patterns
// Access via tab in development mode

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Search, Trash2, Settings, Send, Check, X, AlertTriangle } from "lucide-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

// ── Color Swatch ──
function Swatch({ label, cssVar, className }: { label: string; cssVar: string; className?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn("h-8 w-8 rounded-[var(--radius-sm)] border border-border-default/60 shadow-xs", className)}
        style={{ background: `var(${cssVar})` }} />
      <div>
        <div className="text-[var(--fs-xs)] font-medium text-text-primary">{label}</div>
        <div className="text-[var(--fs-xxs)] font-mono text-text-tertiary">{cssVar}</div>
      </div>
    </div>
  );
}

// ── Section ──
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-[var(--fs-lg)] font-bold text-text-primary border-b border-border-default/60 pb-2">{title}</h2>
      {children}
    </div>
  );
}

export function DesignSystemPage() {
  const [inputVal, setInputVal] = useState("Sample text");

  return (
    <div className="h-full overflow-y-auto p-6 space-y-8 bg-bg-app">
      <div>
        <h1 className="text-[var(--fs-4xl)] font-bold text-text-primary">ProtoForge Design System</h1>
        <p className="text-[var(--fs-sm)] text-text-secondary mt-1">Token reference, component showcase, and usage guide</p>
      </div>

      {/* ── Colors ── */}
      <Section title="Colors">
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="text-[var(--fs-sm)] font-semibold text-text-secondary uppercase tracking-wide">Backgrounds</h3>
            <div className="space-y-2">
              <Swatch label="App" cssVar="--color-bg-app" />
              <Swatch label="Primary" cssVar="--color-bg-primary" />
              <Swatch label="Secondary" cssVar="--color-bg-secondary" />
              <Swatch label="Tertiary" cssVar="--color-bg-tertiary" />
              <Swatch label="Hover" cssVar="--color-bg-hover" />
              <Swatch label="Input" cssVar="--color-bg-input" />
            </div>
          </div>
          <div className="space-y-3">
            <h3 className="text-[var(--fs-sm)] font-semibold text-text-secondary uppercase tracking-wide">Text</h3>
            <div className="space-y-2">
              <Swatch label="Primary" cssVar="--color-text-primary" />
              <Swatch label="Secondary" cssVar="--color-text-secondary" />
              <Swatch label="Tertiary" cssVar="--color-text-tertiary" />
              <Swatch label="Disabled" cssVar="--color-text-disabled" />
            </div>
            <h3 className="text-[var(--fs-sm)] font-semibold text-text-secondary uppercase tracking-wide mt-4">Accent</h3>
            <div className="space-y-2">
              <Swatch label="Accent" cssVar="--color-accent" />
              <Swatch label="Accent Hover" cssVar="--color-accent-hover" />
              <Swatch label="Accent Soft" cssVar="--color-accent-soft" />
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <h3 className="text-[var(--fs-sm)] font-semibold text-text-secondary uppercase tracking-wide">Semantic</h3>
          <div className="flex gap-4">
            <Swatch label="Success" cssVar="--color-success" />
            <Swatch label="Warning" cssVar="--color-warning" />
            <Swatch label="Error" cssVar="--color-error" />
            <Swatch label="Info" cssVar="--color-info" />
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <h3 className="text-[var(--fs-sm)] font-semibold text-text-secondary uppercase tracking-wide">Borders</h3>
          <div className="flex gap-4">
            <Swatch label="Default" cssVar="--color-border-default" />
            <Swatch label="Subtle" cssVar="--color-border-subtle" />
            <Swatch label="Strong" cssVar="--color-border-strong" />
          </div>
        </div>
      </Section>

      {/* ── Typography ── */}
      <Section title="Typography Scale">
        <div className="space-y-1 rounded-[var(--radius-md)] border border-border-default/60 bg-bg-primary p-4">
          {[
            { token: "--fs-3xs", label: "3xs", desc: "Micro (9px)" },
            { token: "--fs-xxs", label: "xxs", desc: "Caption (10px)" },
            { token: "--fs-xs", label: "xs", desc: "Label (11px)" },
            { token: "--fs-sm", label: "sm", desc: "Small (12px)" },
            { token: "--fs-base", label: "base", desc: "Body (13px)" },
            { token: "--fs-md", label: "md", desc: "Medium (14px)" },
            { token: "--fs-lg", label: "lg", desc: "Title (15px)" },
            { token: "--fs-xl", label: "xl", desc: "Heading (16px)" },
            { token: "--fs-2xl", label: "2xl", desc: "H4 (17px)" },
            { token: "--fs-3xl", label: "3xl", desc: "H3 (18px)" },
            { token: "--fs-4xl", label: "4xl", desc: "H2 (20px)" },
          ].map(({ token, label, desc }) => (
            <div key={token} className="flex items-baseline gap-4 py-1">
              <span className="w-12 text-[var(--fs-xxs)] font-mono text-text-disabled shrink-0">{label}</span>
              <span style={{ fontSize: `var(${token})` }} className="text-text-primary font-medium">The quick brown fox — {desc}</span>
              <span className="text-[var(--fs-3xs)] font-mono text-text-disabled ml-auto">{token}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Border Radius ── */}
      <Section title="Border Radius">
        <div className="flex gap-4 items-end">
          {[
            { token: "--radius-xs", label: "xs (5px)" },
            { token: "--radius-sm", label: "sm (7px)" },
            { token: "--radius-md", label: "md (10px)" },
            { token: "--radius-lg", label: "lg (14px)" },
            { token: "--radius-xl", label: "xl (18px)" },
          ].map(({ token, label }) => (
            <div key={token} className="text-center space-y-1">
              <div className="h-16 w-16 border-2 border-accent bg-accent-soft"
                style={{ borderRadius: `var(${token})` }} />
              <div className="text-[var(--fs-xxs)] font-mono text-text-tertiary">{label}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Buttons ── */}
      <Section title="Buttons">
        <div className="space-y-4">
          <div>
            <h3 className="text-[var(--fs-xs)] font-semibold text-text-disabled uppercase tracking-wide mb-2">Action Buttons (.btn-action)</h3>
            <div className="flex items-center gap-3 flex-wrap">
              <button className="btn-action"><Send className="w-3.5 h-3.5" /> Primary</button>
              <button className="btn-action btn-danger"><Trash2 className="w-3.5 h-3.5" /> Danger</button>
              <button className="btn-action btn-warning"><AlertTriangle className="w-3.5 h-3.5" /> Warning</button>
              <button className="btn-action btn-success"><Check className="w-3.5 h-3.5" /> Success</button>
              <button className="btn-action" disabled><X className="w-3.5 h-3.5" /> Disabled</button>
            </div>
          </div>

          <div>
            <h3 className="text-[var(--fs-xs)] font-semibold text-text-disabled uppercase tracking-wide mb-2">Sizes</h3>
            <div className="flex items-center gap-3">
              <button className="btn-action btn-action-xs">XS (24px)</button>
              <button className="btn-action btn-action-sm">SM (28px)</button>
              <button className="btn-action">MD (32px)</button>
            </div>
          </div>

          <div>
            <h3 className="text-[var(--fs-xs)] font-semibold text-text-disabled uppercase tracking-wide mb-2">Workbench Buttons (.wb-*)</h3>
            <div className="flex items-center gap-3">
              <button className="wb-primary-btn bg-accent">wb-primary-btn</button>
              <button className="wb-ghost-btn">wb-ghost-btn</button>
              <button className="wb-icon-btn"><Settings className="w-4 h-4" /></button>
              <button className="wb-icon-btn"><Search className="w-4 h-4" /></button>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Segmented Controls ── */}
      <Section title="Segmented Controls">
        <div className="space-y-4 max-w-lg">
          <div>
            <h3 className="text-[var(--fs-xs)] font-semibold text-text-disabled uppercase tracking-wide mb-2">Standard (md)</h3>
            <SegmentedControl
              options={[
                { value: "tcp", label: "TCP" },
                { value: "udp", label: "UDP" },
              ]}
              value="tcp"
              onChange={() => {}}
            />
          </div>
          <div>
            <h3 className="text-[var(--fs-xs)] font-semibold text-text-disabled uppercase tracking-wide mb-2">Multi-option</h3>
            <SegmentedControl
              options={[
                { value: "caller", label: "Caller" },
                { value: "listener", label: "Listener" },
                { value: "rendezvous", label: "Rendezvous" },
              ]}
              value="caller"
              onChange={() => {}}
            />
          </div>
          <div>
            <h3 className="text-[var(--fs-xs)] font-semibold text-text-disabled uppercase tracking-wide mb-2">Small (sm)</h3>
            <SegmentedControl
              options={[
                { value: "all", label: "All" },
                { value: "video", label: "Video" },
                { value: "audio", label: "Audio" },
              ]}
              value="all"
              onChange={() => {}}
              size="sm"
            />
          </div>
          <div>
            <h3 className="text-[var(--fs-xs)] font-semibold text-text-disabled uppercase tracking-wide mb-2">Disabled</h3>
            <SegmentedControl
              options={[
                { value: "on", label: "Enabled" },
                { value: "off", label: "Disabled" },
              ]}
              value="on"
              onChange={() => {}}
              disabled
            />
          </div>
        </div>
      </Section>

      {/* ── Inputs ── */}
      <Section title="Input Fields">
        <div className="space-y-3 max-w-md">
          <div>
            <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled mb-1 block">Standard (.wb-field)</label>
            <input className="wb-field w-full" value={inputVal} onChange={(e) => setInputVal(e.target.value)} />
          </div>
          <div>
            <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled mb-1 block">Small (.wb-field-sm)</label>
            <input className="wb-field-sm w-full" placeholder="Placeholder text..." />
          </div>
          <div>
            <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled mb-1 block">Extra Small (.wb-field-xs)</label>
            <input className="wb-field-xs w-full" placeholder="Compact input" />
          </div>
          <div>
            <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled mb-1 block">Disabled</label>
            <input className="wb-field w-full" value="Disabled field" disabled />
          </div>
        </div>
      </Section>

      {/* ── Panels ── */}
      <Section title="Panels">
        <div className="grid grid-cols-2 gap-4">
          <div className="wb-panel">
            <div className="wb-panel-header flex items-center">
              <span className="text-[var(--fs-sm)] font-semibold text-text-primary">.wb-panel</span>
            </div>
            <div className="p-3 text-[var(--fs-xs)] text-text-secondary">
              Primary panel with header. Used for main content areas.
            </div>
          </div>
          <div className="wb-subpanel">
            <div className="p-3 space-y-2">
              <span className="text-[var(--fs-sm)] font-semibold text-text-primary">.wb-subpanel</span>
              <p className="text-[var(--fs-xs)] text-text-secondary">
                Sub-panel for nested content. Smaller radius.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Icons ── */}
      <Section title="Icon Sizes">
        <div className="flex items-end gap-6">
          {[
            { size: "w-3 h-3", label: "12px" },
            { size: "w-3.5 h-3.5", label: "14px" },
            { size: "w-4 h-4", label: "16px" },
            { size: "w-5 h-5", label: "20px" },
            { size: "w-6 h-6", label: "24px" },
            { size: "w-8 h-8", label: "32px" },
          ].map(({ size, label }) => (
            <div key={size} className="text-center space-y-1">
              <Settings className={cn(size, "text-text-secondary")} />
              <div className="text-[var(--fs-3xs)] font-mono text-text-disabled">{label}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Shadows ── */}
      <Section title="Shadows">
        <div className="flex gap-6 flex-wrap">
          {["shadow-xs", "shadow-sm", "shadow-md", "shadow-lg", "shadow-soft"].map((s) => (
            <div key={s} className="text-center space-y-2">
              <div className={cn("h-16 w-24 rounded-[var(--radius-md)] bg-bg-primary border border-border-default/30")}
                style={{ boxShadow: `var(--${s})` }} />
              <div className="text-[var(--fs-xxs)] font-mono text-text-tertiary">{s}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Spacing Reference ── */}
      <Section title="Spacing Reference">
        <div className="space-y-1 text-[var(--fs-xs)] text-text-secondary">
          <p><code className="font-mono text-accent">gap-1</code> = 4px | <code className="font-mono text-accent">gap-1.5</code> = 6px | <code className="font-mono text-accent">gap-2</code> = 8px (primary) | <code className="font-mono text-accent">gap-3</code> = 12px</p>
          <p><code className="font-mono text-accent">px-2</code> = 8px | <code className="font-mono text-accent">px-3</code> = 12px (primary) | <code className="font-mono text-accent">px-4</code> = 16px</p>
          <p><code className="font-mono text-accent">py-1</code> = 4px | <code className="font-mono text-accent">py-1.5</code> = 6px | <code className="font-mono text-accent">py-2</code> = 8px (primary) | <code className="font-mono text-accent">py-3</code> = 12px</p>
          <p><code className="font-mono text-accent">p-3</code> = 12px (panel padding) | <code className="font-mono text-accent">p-4</code> = 16px (large panel)</p>
        </div>
      </Section>

      {/* ── Label Pattern ── */}
      <Section title="Label Patterns">
        <div className="space-y-4 max-w-md">
          <div>
            <label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">Settings Label (primary pattern)</label>
            <p className="text-[var(--fs-3xs)] text-text-disabled mt-0.5">font-size: --fs-xxs | weight: 600 | uppercase | tracking: 0.06em | color: text-disabled</p>
          </div>
          <div>
            <label className="text-[var(--fs-xs)] font-medium text-text-secondary">Form Label (secondary pattern)</label>
            <p className="text-[var(--fs-3xs)] text-text-disabled mt-0.5">font-size: --fs-xs | weight: 500 | color: text-secondary</p>
          </div>
        </div>
      </Section>

      {/* ── Forbidden ── */}
      <Section title="Forbidden Patterns">
        <div className="rounded-[var(--radius-md)] border border-error/30 bg-error/5 p-4 space-y-2 text-[var(--fs-xs)]">
          <div className="flex items-center gap-2 text-error font-semibold">
            <X className="w-4 h-4" /> Do NOT use these patterns
          </div>
          <ul className="space-y-1 text-text-secondary pl-6 list-disc">
            <li><code className="font-mono">bg-gradient-to-r from-X to-Y</code> — Use <code className="font-mono text-accent">.btn-action</code> or <code className="font-mono text-accent">bg-accent</code></li>
            <li><code className="font-mono">text-xs / text-sm / text-lg</code> — Use <code className="font-mono text-accent">text-[var(--fs-xs)]</code> etc.</li>
            <li><code className="font-mono">rounded-[8px]</code> — Use <code className="font-mono text-accent">rounded-[var(--radius-sm)]</code></li>
            <li>Hardcoded hex colors — Use semantic tokens (<code className="font-mono text-accent">text-text-primary</code>, <code className="font-mono text-accent">bg-accent</code>)</li>
          </ul>
        </div>
      </Section>
    </div>
  );
}
