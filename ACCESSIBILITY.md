# Accessibility statement

Last updated 15 August 2026. Also published as a live page at `/docs/accessibility` on any running deployment.

## Our target

Nodedr OrderRestro targets **WCAG 2.1 Level AA** across the marketing site and the product application (POS, dashboard, kitchen display, settings). This is the standard referenced by India's Rights of Persons with Disabilities Act, 2016 and its associated accessibility rules, and is the de facto baseline for software sold or deployed in India today.

This statement is a good-faith, current snapshot — not a certification. We have not engaged a third-party auditor or obtained formal WCAG-AA certification for this product.

## What we actually do

- Semantic HTML and landmark regions (`header`/`main`/`nav`) throughout, not div soup with click handlers standing in for real interactive elements.
- Keyboard navigation for every interactive control, including the mobile navigation menu, tab panels, and form flows — nothing is mouse-only.
- Visible focus indicators (focus-visible rings) on all interactive elements, not suppressed via `outline: none`.
- Color contrast checked against the design system's own light and dark token pairs (see [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)) for text-on-background combinations used in primary UI.
- All animation respects `prefers-reduced-motion` — page transitions, scroll reveals, and counters resolve instantly instead of animating when the OS setting requests it.
- Alt text on informative images; decorative graphics are marked `aria-hidden` so screen readers don't announce them.
- Forms (login, signup, checkout) associate every input with a visible label and surface validation errors as text, not color alone.

## How we test

We run automated accessibility audits (axe-core based tooling) against live pages during development, and review keyboard-only and screen-reader navigation manually for new or substantially changed screens before shipping them.

We have not yet performed a full manual audit with users who rely on assistive technology day-to-day. That is the single biggest gap between an automated-clean audit and genuine accessibility, and we are not going to claim otherwise.

## Known gaps

- No dedicated screen-reader testing pass on the Kitchen Display / real-time ticket views yet — the live-update pattern (sockets pushing new tickets) needs an `aria-live` region audit.
- No published VPAT (Voluntary Product Accessibility Template) yet.
- Third-party components (browser print dialogs, OS file pickers) inherit their accessibility from the host OS/browser, outside our control.

## Reporting a problem

If you encounter an accessibility barrier anywhere in this product, please [open an issue on GitHub](https://github.com/Raktim94/nodedr-restaurant-pos/issues) with as much detail as you can (page, assistive technology used, what you expected vs. what happened). This is an open-source project — accessibility fixes are treated as real bugs, not feature requests.
