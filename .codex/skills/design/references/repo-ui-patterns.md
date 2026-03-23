# Repo UI Patterns

Load this reference when changing page-level layout, route composition, styling tokens, or shared UI behavior.

## Design System

- `components.json` uses shadcn `new-york`, `baseColor: neutral`, and CSS variables in `src/styles/app.css`.
- `src/styles/app.css` defines the shared color tokens, border radii, and light and dark theme values.
- The visual baseline is neutral and restrained:
  - white or near-white backgrounds
  - blue primary accent
  - border-based separation
  - moderate radius
  - light shadows
- Prefer tokenized classes such as `bg-background`, `bg-card`, `text-muted-foreground`, `border-border`, and `bg-primary/10` over arbitrary values.

## Composition Patterns

- Marketing currently uses centered copy, rounded section containers, mild gradients, and icon-supported feature grids.
- Admin and authenticated app surfaces are more operational:
  - status first
  - data first
  - action first
- The repo already has card and table primitives. Do not multiply wrappers without a clear information-design reason.
- Use one strong idea per section. Avoid repeating the same headline, subhead, and CTA pattern in every block.

## Route Patterns

- Public marketing routes can use `staticData: true`.
- Authenticated `/app` routes already rely on client auth state, a route-level skeleton, and the shared authenticated shell.
- Preserve existing route boundaries. Do not move business logic into route components just to support a visual change.

## Component Patterns

- Shared primitives live in `src/components/ui/`.
- Reuse button, card, badge, table, dialog, sidebar, tabs, skeleton, and field primitives before inventing alternatives.
- `src/components/ui/button.tsx` and similar files use `class-variance-authority`; follow that style when a new variant is actually justified.
- Use `cn()` from `~/lib/utils` for class merging.

## Copy and Tone

- Marketing copy can be more expressive, but it should still sound like product language.
- App and admin copy should be direct and utility-oriented.
- Prefer labels that help users act:
  - `Selected KPIs`
  - `Recent activity`
  - `Organization members`
  - `Model catalog`
- Avoid placeholder-style phrases like `Powering the future`, `Everything you need`, or commentary about the design itself.

## Styling Guardrails

- Prefer local composition changes over global theme rewrites.
- Avoid adding a new font stack unless the task explicitly requires a brand-level typography change.
- Avoid decorative 3D art, fake dashboard chrome, or image collages that fight the UI.
- Use imagery mainly for marketing or editorial surfaces, not operational dashboards.

## Verification

- Validate meaningful layout changes in a browser.
- For authenticated flows, prefer the repo-local auth and inspect commands documented in `AGENTS.md`.
- Re-check after navigation, form submits, and viewport changes.
