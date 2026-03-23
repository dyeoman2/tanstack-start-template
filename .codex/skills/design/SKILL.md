---
name: design
description: Design and restyle TanStack Start routes and React components in this repo using the March 2026 GPT-5.4 frontend guidance while preserving local conventions. Use when building or refining marketing pages, dashboards, admin surfaces, authenticated app views, page-level layouts, visual systems, or interaction polish in `src/routes/`, `src/features/**/components/`, `src/components/ui/`, or `src/styles/app.css`.
---

# Design

Use this skill to turn vague frontend requests into repo-compatible design decisions. Apply the article's emphasis on clear art direction, explicit constraints, strong hierarchy, and browser verification without replacing the repo's existing routing, token, shadcn, or copy patterns.

## Workflow

1. Read [references/repo-ui-patterns.md](references/repo-ui-patterns.md) before changing page-level layout, tokens, or visual tone.
2. Classify the surface before coding:
   - marketing or auth
   - authenticated app, admin, or operational workspace
3. Write a compact internal brief with:
   - visual thesis
   - content plan
   - interaction thesis
   - hard constraints
4. Keep the first viewport organized around one clear composition. Do not default to a generic grid of disconnected cards unless the surface is truly data-dense.
5. Implement with existing route, feature, and UI primitive boundaries.
6. Verify in the browser and refine spacing, hierarchy, responsive behavior, and states after the first pass.

## Surface Rules

### Marketing and Auth

- Allow more visual expressiveness than the app shell.
- Prefer one strong composition above the fold: headline, supporting proof, and one primary action.
- Use real product copy, not design commentary.
- Add imagery only when it clarifies the offer. Decorative texture alone is not a visual anchor.
- Preserve the repo's existing public-route pattern when creating or reshaping top-level marketing pages.

### App, Admin, and Operations

- Default to utility copy over marketing copy.
- Start with the working surface itself: KPIs, filters, tables, status, tasks, or current context.
- Do not add a hero section unless the user explicitly asks for one.
- Give each section one job: orient, explain status, show data, or enable action.
- Keep motion sparse and purposeful. Orientation and clarity come before flourish.

## Repo Guardrails

- Preserve the existing shadcn and Tailwind variable approach. Extend the system before inventing a new one.
- Prefer composing from `~/components/ui/*` before creating new primitives.
- Reuse `cn()` and existing variant patterns for class composition.
- Keep global token work in `src/styles/app.css`. Prefer adjusting CSS variables or section-level styling over hard-coded one-off palettes.
- Avoid global font swaps, dramatic visual rebrands, or wholesale restyling unless the user explicitly asks for them.
- Preserve TanStack Start route boundaries, pending states, and error boundaries.
- Keep UI components pure. Put business logic in hooks, Convex hooks, or server modules.
- Use `~/` aliases and static imports.

## Prompting Pattern

When the request is underspecified, infer the missing brief from repo context before editing:

- visual thesis: what the page should feel like
- content plan: what the user needs to understand or do first
- interaction thesis: what movement, hover, or transitions matter
- hard constraints: token limits, section count, imagery, copy tone, mobile behavior

Use those constraints to avoid generic outputs. Keep the brief short and actionable.

## Implementation Rules

- Use the article guidance to improve specificity, not to override the codebase.
- Keep copy concise. If removing 30 percent improves clarity, remove it.
- For app surfaces, prefer headings such as `Plan status`, `Top segments`, `Recent activity`, or `Last sync` over aspirational marketing language.
- Use gradients, highlights, and elevated surfaces deliberately. The repo already favors neutral backgrounds, tokenized accents, borders, and restrained shadows.
- Add comments only when a design-specific implementation would otherwise be hard to parse.

## Verification

- Verify the finished UI in a browser whenever the task changes layout, interaction, or responsive behavior.
- Check desktop and mobile balance, empty and loading states, hover and focus states, and light or dark token behavior if affected.
- Prefer the repo-local browser workflows from `AGENTS.md` for authenticated routes and interactive checks.

## Output Standard

Aim for intentional, polished work that still looks like this product. The success condition is not "more stylish than before"; it is "clearer, better composed, and more distinctive without breaking local patterns."
