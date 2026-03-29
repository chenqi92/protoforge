# ProtoForge UI Style Guide

All UI development must follow this guide. Open the built-in Design System page via Command Palette (`Ctrl+K` > "Design System") to see live examples.

## Font Sizes

Always use CSS token references. **Never** use Tailwind `text-xs`, `text-sm`, etc. in application components (only allowed in `src/components/ui/` shadcn internals).

| Token | Size | Usage |
|-------|------|-------|
| `--fs-3xs` | 9px | Micro labels, badge text |
| `--fs-xxs` | 10px | Section labels (uppercase), captions |
| `--fs-xs` | 11px | Form field text, button text, secondary content |
| `--fs-sm` | 12px | Small body, tab text |
| `--fs-base` | 13px | Default body text |
| `--fs-md` | 14px | Emphasized body |
| `--fs-lg` | 15px | Section titles |
| `--fs-xl` | 16px | Page headings |
| `--fs-mono` | 12px | Code, URLs, monospace content |

**Syntax**: `text-[var(--fs-xs)]`

## Colors

Use semantic color tokens. **Never** hardcode hex values in components.

| Token | Usage |
|-------|-------|
| `bg-accent` / `text-accent` | Primary interactive elements |
| `bg-error` / `text-error` | Destructive actions, errors |
| `bg-warning` | Caution states (connecting, pending) |
| `bg-success` | Success indicators |
| `text-text-primary` | Main content text |
| `text-text-secondary` | Secondary descriptions |
| `text-text-tertiary` | Muted helper text |
| `text-text-disabled` | Labels, inactive content |
| `bg-bg-primary` | Main surfaces |
| `bg-bg-secondary` | Recessed areas, inputs |
| `border-border-default` | Standard borders |

## Buttons

### Action Buttons (`.btn-action`)
Primary call-to-action. Accent solid color, 32px height.

```html
<button className="btn-action">Primary</button>
<button className="btn-action btn-danger">Delete</button>
<button className="btn-action btn-warning">Caution</button>
<button className="btn-action btn-success">Confirm</button>
<button className="btn-action btn-action-sm">Small (28px)</button>
<button className="btn-action btn-action-xs">XS (24px)</button>
```

### Workbench Buttons (`.wb-*`)
For toolbar and workspace UI.

```html
<button className="wb-primary-btn bg-accent">Send</button>
<button className="wb-ghost-btn">Cancel</button>
<button className="wb-icon-btn"><Icon /></button>
```

**Never** use `bg-gradient-to-r`. All primary buttons use `bg-accent` solid color.

## Border Radius

Always use token references. **Never** use `rounded-[8px]` or other hardcoded pixel values.

| Token | Size | Usage |
|-------|------|-------|
| `--radius-xs` | 5px | Tiny elements: status dots, badge corners |
| `--radius-sm` | 7px | Buttons, inputs, small cards, chips |
| `--radius-md` | 10px | Cards, dropdowns, medium containers |
| `--radius-lg` | 14px | Panels, major containers |
| `--radius-xl` | 18px | Modals, dialogs, large overlays |

**Syntax**: `rounded-[var(--radius-sm)]`

**Semantic aliases** (prefer these when the intent is clear):
- `--radius-btn` = sm (7px) - button corners
- `--radius-field` = sm (7px) - input field corners
- `--radius-panel` = lg (14px) - panel/surface corners
- `--radius-card` = md (10px) - card corners
- `--radius-chip` = xs (5px) - tag/chip corners

## Input Fields

Use `.wb-field` variants:

```html
<input className="wb-field w-full" />       <!-- 32px height -->
<input className="wb-field-sm w-full" />     <!-- 28px height -->
<input className="wb-field-xs w-full" />     <!-- 26px height -->
```

## Labels

### Settings/Section Labels (primary pattern)
```html
<label className="text-[var(--fs-xxs)] font-semibold uppercase tracking-[0.06em] text-text-disabled">
```

### Form Content Labels (secondary pattern)
```html
<label className="text-[var(--fs-xs)] font-medium text-text-secondary">
```

## Panels

```html
<div className="wb-panel">                    <!-- Primary panel -->
  <div className="wb-panel-header">Header</div>
  <div className="p-3">Content</div>
</div>

<div className="wb-subpanel">                 <!-- Nested panel -->
  <div className="p-3">Content</div>
</div>
```

## Spacing

Prefer these standard values:

| Pattern | Value | Usage |
|---------|-------|-------|
| `gap-2` | 8px | Primary gap between items |
| `gap-1.5` | 6px | Compact gap |
| `gap-3` | 12px | Spacious gap |
| `px-3` | 12px | Primary horizontal padding |
| `py-2` | 8px | Primary vertical padding |
| `p-3` | 12px | Panel content padding |
| `space-y-1.5` | 6px | Form field vertical spacing |
| `space-y-4` | 16px | Section vertical spacing |

## Icons

Use `lucide-react`. Standard sizes:

| Size | Usage |
|------|-------|
| `w-3 h-3` | Inline small icons, chevrons |
| `w-3.5 h-3.5` | Button icons |
| `w-4 h-4` | Standard toolbar icons |
| `w-5 h-5` | Medium action icons |
| `w-8 h-8` | Large panel icons |

## Forbidden Patterns

- `bg-gradient-to-r from-X to-Y` - Use `bg-accent` or `.btn-action`
- `text-xs`, `text-sm`, `text-lg` (Tailwind defaults) - Use `text-[var(--fs-*)]`
- `rounded-[8px]` (hardcoded pixels) - Use `rounded-[var(--radius-*)]`
- Hardcoded hex colors - Use semantic tokens
- `border-radius: 11px` in inline styles - Use CSS tokens
