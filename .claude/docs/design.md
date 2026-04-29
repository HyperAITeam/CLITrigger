# CLITrigger Design System

CLITrigger is a **developer-focused task automation dashboard** built on an Apple HIG-inspired foundation. The interface is calm, precise, and data-dense — prioritizing information clarity over decoration. Two accent colors carry all interactive and expressive weight: a quiet blue for actions, a vivid pink for emphasis. Everything else recedes.

**Key Characteristics:**
- Minimal chrome; content and data take center stage.
- Two-accent system: blue for interactive elements, pink for point text and special callouts.
- Surface-color change (light ↔ dark tile) creates hierarchy — not shadows or borders.
- Consistent `rounded-xl` (12px) for cards and inputs; `rounded-full` pill for primary CTAs and badges.
- Inter for UI text; JetBrains Mono for code, terminal output, and the brand mark.
- Micro-interactions on every interactive element: 300ms ease, 2px lift on hover, scale(0.97) on press.

---

## Colors

### Brand & Accent
- **Action Blue** (`{colors.primary}` — light `#0071E3` / dark `#4B8DFF`): The single interactive color. All buttons, links, focus rings, active states, and progress indicators. On hover/focus the dark variant brightens slightly via opacity.
- **Point Pink** (`{colors.pink}` — light `#FF2D55` / dark `#FF375F`): The expressive accent. Used for tag emphasis, special badges, keyword highlights, and "new" callouts. Never used for interactive elements — pink signals meaning, not action.
- **Accent Amber** (`{colors.amber}` — light `#FF9500` / dark `#FF9F0A`): Warning states and cost/token callouts.

### Surface
- **Canvas** (`{colors.canvas}` — `#FFFFFF`): Card backgrounds, modal surfaces, input fields.
- **Parchment** (`{colors.canvas-parchment}` — `#F5F5F7`): The default page background. Apple's signature off-white.
- **Surface Secondary** (`{colors.surface-2}` — light `#EDEDF0` / dark `#1A1A1A`): Sidebar background, secondary panels.
- **Surface Tertiary** (`{colors.surface-3}` — light `#E2E2E8` / dark `#2C2C2C`): Hover states, input backgrounds, chips.
- **Card** (`{colors.card}` — light `#FFFFFF` / dark `#222222`): Todo cards, project cards, list items.
- **Hover** (`{colors.hover}` — light `#E5E5EB` / dark `#363636`): Hover backgrounds on list rows and nav items.
- **Active** (`{colors.active}` — light `#D1D1D6` / dark `#444444`): Press/selected state backgrounds.
- **Near-Black** (`{colors.page-dark}` — `#141414`): Dark theme page background.

### Text
- **Ink** (`{colors.ink}` — light `#1D1D1F` / dark `#F0F0F0`): All primary headings and body text.
- **Secondary** (`{colors.ink-2}` — light `#6E6E73` / dark `#A8A8A8`): Labels, captions, supporting copy.
- **Tertiary** (`{colors.ink-3}` — light `#7C7C82` / dark `#858585`): Placeholders, timestamps, metadata.
- **Muted** (`{colors.ink-muted}` — light `#AEAEB2` / dark `#5A5A5A`): Disabled text, fine print.
- **Faint** (`{colors.ink-faint}` — light `#C7C7CC` / dark `#3C3C3C`): Dividers styled as text, ghost placeholders.

### Status
- **Success** (`{colors.success}` — `#34C759`): Completed tasks, passing states.
- **Running** (`{colors.running}` — `#007AFF`): Active/in-progress; animates with `pulse-soft`.
- **Error** (`{colors.error}` — `#FF3B30`): Failed tasks, destructive actions.
- **Warning** (`{colors.warning}` — `#FF9500`): Caution states, quota warnings.
- **Merged** (`{colors.merged}` — `#AF52DE`): Git-merged branch indicator.
- **Info** (`{colors.info}` — `#8E8E93`): Neutral informational badges.

### Borders
- **Border** (`{colors.border}` — light `#D8D8DD` / dark implied): Standard card and input border.
- **Border Strong** (`{colors.border-strong}` — light `#C7C7CC`): Input focus ring base.
- **Border Muted** (`{colors.border-muted}` — `rgba(0,0,0,0.10)`): Subtle dividers.

---

## Typography

### Font Families
- **UI / Body**: `Inter, system-ui, -apple-system, sans-serif` — weights 300, 400, 500, 600, 700, 800.
- **Code / Terminal / Brand**: `JetBrains Mono, Fira Code, monospace` — weights 400, 500, 700. Used for log output, diffs, inline code, and the `>_ CLI Trigger` wordmark.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.hero}` | 28px | 700 | 1.25 | -0.02em | Page-level headings |
| `{typography.display}` | 22px | 600 | 1.25 | -0.01em | Section headings, modal titles |
| `{typography.title}` | 18px | 600 | 1.3 | 0 | Card titles, panel headers |
| `{typography.subtitle}` | 15px | 600 | 1.4 | 0 | Sub-section labels, tab names |
| `{typography.body}` | 15px | 400 | 1.6 | 0 | Default paragraph, list copy |
| `{typography.body-strong}` | 15px | 500 | 1.6 | 0 | Emphasized inline copy |
| `{typography.caption}` | 13px | 400 | 1.4 | 0 | Metadata, timestamps, helper text |
| `{typography.caption-strong}` | 13px | 600 | 1.4 | 0 | Badge labels, section chips |
| `{typography.label}` | 11px | 600 | 1.4 | 0.06em | Section labels (uppercase), column headers |
| `{typography.micro}` | 10px | 700 | 1.4 | 0.08em | Badge text (uppercase), status chips |
| `{typography.code}` | 13px | 400 | 1.6 | 0 | Inline code, log lines (JetBrains Mono) |
| `{typography.terminal}` | 13px | 400 | 1.5 | 0 | Full terminal/log viewer blocks (JetBrains Mono) |

### Principles
- **Section labels** (`{typography.label}`, `{typography.micro}`) are always `uppercase` + `tracking-wider`. They orient the reader without competing with content.
- **Weight 500** is used sparingly for inline emphasis. Body text is 400; strong inline is 500; headings are 600/700.
- **Monospace is purposeful** — reserved for code, diffs, log output, and the brand mark. Never use it for UI labels or body copy.

---

## Layout

### Spacing System
Base unit: 4px. All structural spacing snaps to multiples of 4.

| Token | Value | Use |
|---|---|---|
| `{spacing.xxs}` | 4px | Icon padding, tight chip gaps |
| `{spacing.xs}` | 8px | List item internal padding, badge padding |
| `{spacing.sm}` | 12px | Nav item padding, compact card padding |
| `{spacing.md}` | 16px | Default card padding, form field gaps |
| `{spacing.lg}` | 20px | Section padding, panel gaps |
| `{spacing.xl}` | 24px | Card outer padding |
| `{spacing.2xl}` | 32px | Panel section breaks |
| `{spacing.3xl}` | 48px | Page-level section margins |

### Grid & Structure
- **Sidebar**: Fixed 240px wide; collapses on mobile. Background `{colors.surface-2}`.
- **Main content**: Fills remaining width; max-width unconstrained for dashboard views.
- **Resizable splits**: Drag handles between sidebar/main, file-list/diff, history/detail — all persist per `localStorage` key.
- **Card gutters**: `gap-3` (12px) between sibling cards in list views.

---

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow, no border | Page backgrounds, sidebar, tab bars |
| Soft border | `border border-[{colors.border-muted}]` | Panel wrappers, dividers |
| Card | `shadow-soft` + `inset 0 1px 0 0 rgba(255,255,255,0.06)` | Todo cards, project cards, stat tiles |
| Elevated | `shadow-card` | Modals, dropdowns, hover-lifted cards |
| Floating | `shadow-elevated` + backdrop-blur | Tooltips, popovers, command palette |
| Accent glow | `shadow-accent` (blue-tinted) | Focused inputs, primary CTA hover |

**Shadow tokens:**
- `shadow-soft`: `0 1px 2px -1px rgba(0,0,0,0.04), 0 2px 8px -2px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.02)`
- `shadow-card`: `0 4px 6px -2px rgba(0,0,0,0.05), 0 12px 24px -4px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.03)`
- `shadow-elevated`: `0 8px 16px -4px rgba(0,0,0,0.08), 0 24px 48px -8px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)`
- `shadow-accent`: `0 8px 20px -4px rgba(0,113,227,0.2), 0 4px 12px -2px rgba(0,113,227,0.1)`

**Philosophy**: Cards have shadow; buttons do not. Hierarchy comes from surface-color and shadow tier, never from decorative borders or gradients. The hover accent top-line (`2px gradient from {colors.primary}`) is the one exception — it's an interaction cue, not decoration.

---

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Full-bleed log output panels |
| `{rounded.xs}` | 4px | Inline code chips, tiny badges |
| `{rounded.sm}` | 6px | Compact icon buttons, metric chips |
| `{rounded.md}` | 8px | Secondary buttons, small cards, dropdowns |
| `{rounded.lg}` | 10px | Status dots with rings |
| `{rounded.xl}` | 12px | **Default for cards, inputs, primary buttons, panels** |
| `{rounded.2xl}` | 16px | Modals, large panels |
| `{rounded.pill}` | 9999px | Badges (`.badge`), primary CTA pills, search input |

**Grammar rule**: `rounded-xl` (12px) is the default shape for all interactive and container elements. `rounded-full` (pill) is reserved for badges and pill-style CTAs — it signals "category label" or "primary action," not generic content.

---

## Components

### Sidebar (`{component.sidebar}`)
Background `{colors.surface-2}`. Width 240px fixed. Sections separated by 1px muted dividers. Nav items: `rounded-xl`, `py-1.5 px-3`, hover background `{colors.hover}`. Active item: 3px left accent bar in `{colors.primary}` + background `{colors.active}`. Project list rows have hover-revealed `X` delete button. Inline `+` create button at section header. Review Queue link shows 24h pending-count badge in `{colors.pink}`.

### Project Card (`{component.project-card}`)
Background `{colors.card}`, `rounded-xl`, `shadow-soft`, `border border-[{colors.border-muted}]`. On hover: accent top-line appears (2px gradient from `{colors.primary}`), shadow upgrades to `shadow-card`, lifts `translateY(-2px)`. Invalid-path projects show a `{colors.error}` "경로 없음" badge with dimmed opacity.

### Todo Item (`{component.todo-item}`)
Background `{colors.card}`, `rounded-xl`, `shadow-soft`. Status dot left-aligned. Title in `{typography.body}`. Metadata row (cost, tokens, time) in `{typography.caption}` + `{colors.ink-3}`. Drag handle visible on hover. Stack mode: absolute positioning, 6px peek, front card on top.

### Buttons

**`{component.button-primary}`** — Background `{colors.surface-3}`, text `{colors.primary}`, border `{colors.border}`, `rounded-xl`, `px-6 py-2.5`, weight 600. Hover: border and background become `{colors.primary}`, text becomes white. Active: `scale(0.97)`. Focus: 2px `{colors.primary}` outline.

**`{component.button-secondary}`** — Background `{colors.surface-3}`, text `{colors.ink-2}`, `shadow-soft`, `rounded-xl`. Hover: background `{colors.active}`, text `{colors.ink}`, lifts 2px.

**`{component.button-danger}`** — Background `{colors.error}` at 10% opacity, text `{colors.error}`, `rounded-xl`. Hover: solid `{colors.error}` background, white text, `shadow-accent` tinted red.

**`{component.button-ghost}`** — Background transparent, text `{colors.ink-3}`, `rounded-xl`, `px-3 py-2`. Hover: background `{colors.surface-3}`, text `{colors.ink}`.

**`{component.button-icon}`** — 32×32px, `rounded-lg`, `flex items-center justify-center`. Hover: background `{colors.hover}`, text `{colors.ink}`.

All buttons: `transform: scale(0.97)` on active press.

### Badge (`{component.badge}`)
`inline-flex`, `rounded-full` (pill), `px-2.5 py-1`, `text-[10px]` bold uppercase `tracking-wider`. Border ring: `1px currentColor` at 15% opacity via pseudo-element. Scales to 105% on hover (non-clickable; for clickable chips use button variants). Color variants map to status tokens:
- Blue: `{colors.primary}` background tint
- Pink: `{colors.pink}` background tint — for "new", "featured", special callouts
- Green: `{colors.success}` tint
- Red: `{colors.error}` tint
- Purple: `{colors.merged}` tint

### Input Field (`{component.input-field}`)
Background `{colors.surface-3}`, border `{colors.border-strong}`, `rounded-xl`, `px-4 py-3`, `text-sm`. Focus: border becomes `{colors.primary}`, `shadow-accent` glow appears, lifts 1px.

### Status Dot (`{component.status-dot}`)
8×8px circle. Colors: running=`{colors.running}` with `animate-pulse`, completed=`{colors.success}`, failed=`{colors.error}`, pending=`{colors.ink-muted}`. Running state pulses via `pulse-soft` animation.

### Tab Bar (`{component.tab-bar}`)
Horizontal strip, `border-b border-[{colors.border-muted}]`. Tab items: `px-4 py-2.5`, `{typography.caption-strong}`. Active tab: `border-b-2 border-[{colors.primary}]`, text `{colors.primary}`. Inactive: text `{colors.ink-3}`, hover text `{colors.ink}`.

### Log Viewer (`{component.log-viewer}`)
**Chat mode**: Assistant blocks in `{colors.card}`, `rounded-xl`, `shadow-soft`. Tool-use rows collapsible with `▶ / ▼` toggle. Monospace content uses `{typography.terminal}`.
**Raw mode**: Flat terminal view, full-width, `{colors.near-black}` background (dark always), `{colors.success}` for stdout, `{colors.error}` for stderr.

### Panel (`{component.panel}`)
`p-4 rounded-xl border border-[{colors.border}]`. No shadow by default. Used for sub-sections within a larger card.

### Modal (`{component.modal}`)
Background `{colors.card}`, `rounded-2xl`, `shadow-elevated`, backdrop `rgba(0,0,0,0.4)`. Close button: `{component.button-icon}` top-right. Renders via `createPortal` into `document.body`. `z-modal` (100).

### Toast (`{component.toast}`)
`rounded-xl`, `shadow-elevated`, 4 variants (success/error/warning/info) using status token tints. Progress bar at bottom. `z-toast` (150). Renders via portal.

### Point Text (`{component.point-text}`)
Inline text or label in `{colors.pink}` (`#FF2D55` light / `#FF375F` dark). Used for tag emphasis, "NEW" callouts, featured labels, keyword highlights. Weight 600 or paired with a pink `{component.badge}`. **Never use pink for interactive elements** — pink signals meaning only.

---

## Do's and Don'ts

### Do
- Use `{colors.primary}` (blue) for every interactive element — buttons, links, focus signals. One action color, always.
- Use `{colors.pink}` for point text, special badges, "new" labels, and expressive keyword highlights only.
- Apply `rounded-xl` (12px) as the default shape for cards, inputs, and buttons.
- Use `rounded-full` (pill) for badges and primary CTA pills — it signals "label" or "main action."
- Run body copy at 15px (`{typography.body}`), labels at 11–13px (`{typography.label}`, `{typography.caption}`).
- Render ALL floating elements (tooltips, dropdowns, popovers, context menus) via `createPortal` into `document.body` with `position: fixed` + viewport clamping. See CLAUDE.md UI Guidelines for the full checklist.
- Use `transform: scale(0.97)` as the press/active state on all buttons.
- Lift cards 2px (`translateY(-2px)`) on hover and upgrade shadow tier.

### Don't
- Don't add a third brand color. The system is blue (action) + pink (point/expressive). Amber and status colors are functional-only.
- Don't use pink on buttons, links, or any clickable element — pink is meaning, not interaction.
- Don't add decorative gradients as backgrounds. The hover accent top-line on cards is the only gradient in the system.
- Don't add shadows to buttons — elevation is for containers (cards, modals, panels), not controls.
- Don't use `position: absolute` for floating elements inside the component tree — overflow/transform ancestors will clip them.
- Don't use monospace (JetBrains Mono) for UI labels, navigation, or body copy.
- Don't round full-bleed log output panels — they use `rounded-none` for terminal authenticity.
- Don't mix `rounded-md` (8px) and `rounded-xl` (12px) within the same visual group — pick one tier and stay consistent.
