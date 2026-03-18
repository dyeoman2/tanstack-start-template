---
name: control-register-authoring
description: Add or update buyer-facing security controls in this repo's site admin control workspace. Use when authoring or revising NIST-based controls, framework mappings, implementation summaries, checklist items, seeded evidence, or site admin reseed/reset behavior tied to the active control register generator and Convex security workspace.
---

# Control Register Authoring

Use this skill to add or revise controls that appear in the site admin security workspace.

## Workflow

1. Confirm the control exists in [references/workspace-files.md](references/workspace-files.md) under the NIST moderate source file before editing the generator.
2. Update [references/workspace-files.md](references/workspace-files.md) targets in this order:
   - `scripts/compliance/generate-active-control-register.ts`
   - only then regenerate `compliance/generated/active-control-register.seed.json`
   - update `convex/security.ts` only if site admin workspace materialization or reseed behavior must change
3. Keep the control readable to two audiences at once:
   - the internal site admin maintaining evidence
   - the customer security admin reviewing the control
4. Tie every checklist item to concrete repo evidence when available.
5. If repo support is partial, keep the checklist item and mark it partial or incomplete instead of overstating coverage.
6. Regenerate and reseed after changes.

## Authoring Rules

- Start from the NIST control title and statement in the generated moderate controls JSON. Do not invent control IDs.
- Do not hand-edit `compliance/generated/active-control-register.seed.json`. Always regenerate it from the script.
- Prefer explicit `csf20Ids` and `soc2CriterionIds` overrides when the inherited crosswalk is broader than the app evidence actually supports.
- Keep implementation summaries narrow. Do not let one control drift into adjacent controls.
- Keep shared-responsibility wording precise:
  - platform items describe what the hosted service does
  - customer responsibility notes describe what the customer must govern or operate
  - provider-internal process items should be clearly labeled as provider or operator duties, not customer guidance
- Evidence should point to concrete code, config, UI, or schema artifacts already in the repo.
- Seed evidence at the checklist-item level, not only at the control level.
- When evidence only proves part of the claim, set sufficiency to `partial` and keep the checklist status honest.
- Preserve stable control IDs and checklist item IDs so reseeds do not create logical duplicates.

## Control Template

When adding a new control blueprint, fill in this structure deliberately:

- `nist80053Id`
  - Must exist in the moderate controls JSON.
- `internalControlId`
  - Keep the existing `CTRL-<family>-<number>` pattern.
- `implementationSummary`
  - Explain what the hosted service actually does.
  - Avoid mentioning customer duties here except to frame boundaries.
- `responsibility`
  - Use `platform` when the checklist items describe hosted-service behavior we operate.
  - Use `shared-responsibility` when the control depends on both platform features and customer governance.
  - Use `customer` only when the workspace is mainly tracking a customer-operated obligation.
- `platformChecklistItems`
  - Use 2 to 4 items.
  - Each item should describe one reviewable requirement.
  - Prefer provider-language like `Provider`, `Platform`, or `Hosted service` when the item is ours.
- `seed.notes`
  - State what the repo proves today.
  - Do not state future intent.
- `seed.evidence`
  - Name one artifact at a time.
  - Explain why that artifact supports the item.
- `customerResponsibilityNotes`
  - Keep this separate from the checklist.
  - Describe what the customer must configure, review, govern, or operate outside the hosted service.

## Mapping Rubric

Use the smallest defensible mapping set.

- Keep a framework mapping only if the checklist and evidence materially support that mapped requirement.
- Override inherited CSF and SOC 2 mappings whenever the raw NIST crosswalk is broader than the app evidence.
- Prefer no mapping over a weak mapping that creates buyer questions.
- Remove mappings that imply:
  - a mature program you do not evidence
  - a provider operating procedure that is not documented
  - infrastructure or network controls the repo does not actually show
  - customer-governed obligations when the control is presented as a platform capability

Good defaults:

- `hipaaCitations`
  - Keep to citations the control clearly supports.
- `csf20Ids`
  - Add explicit overrides for buyer-facing controls whenever inherited subcategories feel too expansive.
- `soc2CriterionIds`
  - Add explicit overrides for buyer-facing controls whenever a criterion implies monitoring, governance, or vendor oversight you do not actually evidence.

## Review Before Merge

Before considering a control update complete, verify all of these:

- The control exists in the NIST moderate source file.
- The implementation summary does not drift into adjacent controls.
- Responsibility matches the actual checklist content.
- Customer responsibilities are not mixed into provider checklist items.
- Each checklist item has at least one concrete evidence artifact or is intentionally incomplete.
- Partial support is marked `partial` or incomplete instead of overstated as complete.
- CSF and SOC 2 mappings are explicitly narrowed when the inherited crosswalk is too broad.
- Provider-internal process items are labeled as provider or operator duties, not written like customer instructions.
- The regenerated seed changed only because of source edits, not hand edits.

## Checklist And Evidence Patterns

- A good checklist item describes one reviewable requirement.
- A good seeded note explains what the repo currently proves, not what the team hopes is true.
- A good evidence entry names one artifact and explains why it supports the checklist item.
- Avoid checklist items that are really buyer packet artifacts unless they are intentionally tracked as provider controls.
- Avoid evidence descriptions that bundle too many unrelated files or claims.

## Site Admin Workspace Rules

- The site admin security UI materializes built-in control data from `ACTIVE_CONTROL_REGISTER` in `convex/security.ts`.
- If seeded control evidence display or attribution needs to change, update the site admin materialization path instead of trying to persist fake seed rows.
- When site admin attribution is needed, resolve the actual site admin profile from the workspace rather than using a generic label.

## Validation

Run these after changes:

```bash
pnpm run compliance:generate:active-control-register
python3 /Users/yeoman/.codex/skills/.system/skill-creator/scripts/quick_validate.py ./.codex/skills/control-register-authoring
```

If the change should appear in the live site admin workspace, reseed with the local test secret from `.env.local`:

```bash
npx convex run --typecheck=disable --push security:reseedSecurityControlWorkspaceForDevelopment '{"secret":"..."}'
```

## Resources

- Read [references/workspace-files.md](references/workspace-files.md) before editing if you need the exact source files, commands, or repo-specific constraints.
