# Design System — OrderRestro

Aesthetic Direction: **Hot Sunset Tangerine on Deep Carbon & Warm Frost Canvas**.
Punchy, hyper-saturated, fast, and aggressive with crisp border structures and deep, rich surfaces (no washed-out/ashy greys).

## 1. Color Palette

### Dark Mode (Deep Carbon & Hot Sunset Tangerine)
Pure carbon with zero muddy grey or ashy wash. High-contrast neon orange and amber accents.
```css
--background:          #0A0A0C;   /* true deep carbon canvas */
--card:                #121216;   /* crisp elevated card surface */
--card-foreground:     #FBFBFC;   /* high-contrast white */
--foreground:          #FBFBFC;
--muted-foreground:    #9E9EA8;   /* crisp cool slate metadata */
--border:              #22222B;   /* razor-sharp 1px border */
--input:               #2E2E3A;

/* Signature Punchy Accent */
--primary:             #FF5C00;   /* hyper-saturated neon sunset tangerine */
--primary-hover:       #FF7426;
--primary-foreground:  #FFFFFF;
--accent:              #26150C;   /* deep amber-tangerine tint */
--accent-foreground:   #FFA26B;

/* Operational Status Colors */
--success:             #00E599;   /* high-voltage neo-mint: ready tickets, paid tabs */
--warning:             #FFB800;   /* electric gold amber: cooking, simmering */
--destructive:         #FF3B56;   /* razor rose-red: urgent alerts, overdue tickets */
--info:                #38BDF8;   /* electric sky */
```

### Light Mode (Warm Frost & Hot Tangerine)
Clean, brilliant, glare-free light mode with vibrant orange CTAs.
```css
--background:          #F8F9FA;   /* crisp frost canvas */
--card:                #FFFFFF;   /* pure white elevated surface */
--card-foreground:     #0D0D11;   /* intense carbon black text */
--foreground:          #0D0D11;
--muted-foreground:    #63636E;   /* legible secondary text */
--border:              #E2E4E8;   /* sharp boundary structure */
--input:               #D0D3D9;

/* Signature Punchy Accent */
--primary:             #FF5C00;   /* radiant sunset tangerine */
--primary-hover:       #E05200;
--primary-foreground:  #FFFFFF;
--accent:              #FFF0E6;   /* luminous tangerine wash */
--accent-foreground:   #D94E00;

/* Operational Status Colors */
--success:             #059669;   /* vivid emerald */
--warning:             #D97706;   /* vivid amber */
--destructive:         #E11D48;   /* intense ruby */
--info:                #0284C7;
```

## 2. Typography & Numbers

- **Font Family**: Plus Jakarta Sans / Geist Sans (`--font-sans`).
- **Tabular Numerals**: `font-variant-numeric: tabular-nums; tracking-tight` enabled for all live ticket IDs, real-time revenue, item pricing, and kitchen countdowns.
- **Scale**:
  - **Hero Display**: `32px–42px` (600/700 weight, tight tracking).
  - **Section Headings (H1/H2)**: `18px–24px` (600 weight).
  - **Body / Interactive Rows**: `14px` (400 regular, 500 medium).
  - **Metadata & Timestamps**: `12px` (500 medium).
  - **Badges / Live Status**: `11px` (600 semibold, sentence case).

## 3. Responsive Targets

1. **Desktop / PC (>= 1280px)**: Multi-column panoramic dashboard with live kitchen radar and revenue trendline.
2. **Tablet / Counter POS (768px – 1024px)**: Dual-column grid, generous touch targets (min 44px) for rapid finger taps.
3. **Mobile Phone (< 768px)**: Fast single-column feed with thumb-accessible horizontal quick actions.


this is an internal operator tool, not a client-facing brand identity where
that stakes-based ask-first call would apply. Revisit only if a real
restaurant-brand pass (logo, physical signage) later demands matching an
existing brand color instead.

## Typography

Font: Geist (or Inter as fallback) — one premium sans, no mixing.

| Role | Size | Weight |
|---|---|---|
| Dashboard title | 32px | semibold |
| Section title | 24px | semibold |
| Card title | 18px | medium |
| Body | 15–16px | regular |
| Small label | 13px | medium, muted |
| Numbers (KPIs) | large, bold, tabular-nums | — |

## Layout

Top nav (workspace switcher, search/command palette, notifications, user
menu) + collapsible icon+label sidebar + content area. Sidebar collapses to
an off-canvas drawer below `lg` (this is a correctness requirement, not
cosmetic — `nodedr-pos` shipped a fixed-256px sidebar that ate 66% of a
phone viewport before it was caught and fixed; do not repeat that here,
verify at ~375px/~768px/desktop with real screenshots before calling any
layout done).

Dashboard uses a bento-grid layout where it fits (mixed card sizes, not a
uniform 3-column grid of identical boxes).

## Components (all in `packages/ui`, one consistent spacing/shadow/radius scale)

Cards: 24px padding, 16px radius, soft shadow, hover elevation.
Tables: TanStack Table wrapper — sticky header, rounded corners, hover
row, inline edit, bulk actions, column visibility, filters, sort, search,
pagination, skeleton loading, real empty states (illustration + helper
text + primary action, never a blank div).
Buttons: rounded, consistent sizing, loading/disabled/success states,
icon support.
Forms: generous spacing, floating labels, inline validation, searchable
selects, date/time pickers.
Charts: Recharts, theme-aware via CSS vars, animated, interactive.
Full primitive list to build: Button, Input, Select, Card, Table/DataGrid,
Chart wrapper, Dialog, Drawer, Toast, Tabs, Breadcrumbs, Avatar, Badge,
Progress, Timeline, Calendar, Command Palette, Search, Empty State,
Skeleton.

## Motion

Fast, natural: fade/slide/scale/spring on hover, press, page transition,
drawer open/close, toast enter/exit. Avoid excessive animation — every
motion should communicate state change, not decorate.

## Accessibility

WCAG AA minimum. Keyboard-navigable everywhere (POS and KDS screens
especially — they're used under time pressure). Visible focus states.
Screen-reader labels on icon-only buttons. Run `accesslint`'s `audit` skill
(live-DOM, not just static code read) before marking any UI surface done.

## Surface-specific notes

- **POS order screen:** built for speed — large touch targets, fast search,
  keyboard shortcuts, instant checkout, minimal clicks. This screen trades
  some of the "spacious" aesthetic for density/speed deliberately; that's a
  considered exception, not an inconsistency.
- **KDS:** large legible tickets, visible timers, color-coded status,
  drag between status columns, full-screen mode, touch-optimized — this
  screen is read from 2-3 meters away in a kitchen, so type size floors are
  higher than the rest of the app.
- **Reservation calendar:** timeline view, drag-to-reschedule, color-coded
  by status/table.
