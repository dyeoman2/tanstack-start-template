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
- Ensure the implementation summary is fully supportable by the checklist items and seeded evidence. If the checklist or evidence is narrower than the summary, narrow the summary.
- Write for a customer security admin first. The target reader should understand what the control does, what evidence exists, and what remains their responsibility without needing repo knowledge.
- Keep shared-responsibility wording precise:
  - platform items describe what the hosted service does
  - customer responsibility notes describe what the customer must govern or operate
  - provider-internal process items should be clearly labeled as provider or operator duties, not customer guidance
- Prefer explicit actor labels. Use `Provider`, `Customer`, `Platform`, `Hosted service`, or `Site admin` instead of ambiguous terms like `operator` unless the actor is immediately clarified.
- Evidence should point to concrete code, config, UI, or schema artifacts already in the repo.
- Evidence descriptions must read like artifact descriptions, not just conclusions and not just file-path notes.
- Seed evidence at the checklist-item level, not only at the control level.
- When evidence only proves part of the claim, set sufficiency to `partial` and keep the checklist status honest.
- Preserve stable control IDs and checklist item IDs so reseeds do not create logical duplicates.

## Writing Style Contract

Treat every field as customer-facing unless it is clearly internal.

- `implementationSummary`
  - Write as a short control narrative.
  - State what the hosted service does.
  - State the relevant boundary if support is partial.
  - Do not mention file paths, schema files, route names, or repo mechanics here.
- checklist `label`
  - Write as one reviewable requirement or outcome.
  - Prefer plain compliance language over product-language like `surface`, `exposes`, or `workflow exists`.
  - A good label should still make sense if shown by itself in a buyer-facing UI.
- checklist `description`
  - Explain the requirement in one sentence.
  - Describe the hosted-service capability or provider procedure that should exist.
  - Avoid implementation details and avoid repeating the label word-for-word.
- evidence `title`
  - Name the artifact.
  - Prefer nouns like `Administrative audit review interface`, `Evidence report review metadata structure`, or `Audit review procedure`.
  - Avoid vague labels like `Seeded register` or engineering labels that only make sense to repo maintainers.
- evidence `description`
  - Describe the artifact itself in customer-readable language.
  - The description should answer `what is this artifact?` and `what part of the control does it relate to?`
  - Write it like a caption for an inspectable artifact that a customer security admin can review.
  - It may mention the artifact medium such as route, screen, schema, workflow, record, export, or procedure.
  - It should not read like a bare conclusion such as `Demonstrates that the control works.`
  - It should not lead with a file path or implementation note such as `src/routes/... exposes ...`
  - Prefer concrete nouns and visible content over abstract helper verbs like `providing`, `supporting`, or `allowing` when a more specific description is available.
- `customerResponsibilityNotes`
  - Describe what the customer must review, configure, govern, retain, or operate outside the hosted service.
  - Keep the note operational and direct.
  - Do not restate provider limitations unless they are needed to define the boundary clearly.

## Preferred Phrasing Patterns

Use these patterns consistently when the field content fits them.

- `implementationSummary`
  - `This control ensures ... The hosted service supports that objective through ...`
  - For partial support: `... but ... is not yet evidenced in this workspace.`
- checklist `label`
  - `Authorized personnel can review ...`
  - `Review records and follow-up details are retained`
  - `Provider procedure is documented`
- checklist `description`
  - `The hosted service provides ...`
  - `The platform retains ...`
  - `The provider maintains ...`
- evidence `title`
  - `Administrative security review route`
  - `Evidence report review record structure`
  - `Evidence report review and follow-up workflow`
- evidence `description`
  - `Administrative security route showing ...`
  - `Schema and stored metadata for ...`
  - `Workflow for ... including ...`
  - `Procedure describing ...`
  - `Export containing ...`
  - `Retained record showing ...`
- `customerResponsibilityNotes`
  - `Customer organizations are responsible for ...`
  - `Customers remain responsible for ... after ... leaves the hosted service.`

## Phrasing To Avoid

These patterns tend to read like internal engineering notes rather than customer-facing control language.

- File-path-led descriptions such as `src/routes/... exposes ...`
- Generic implementation verbs like `exposes`, `wires up`, `hooks into`, or `defines` unless the artifact is truly a schema or definition
- UI jargon like `clickable route`, `surface`, or `screen` when a more precise artifact noun is available
- Bare conclusion statements such as `Demonstrates that authorized users can review evidence`
- Thin artifact captions such as `Route providing ...`, `Workflow supporting ...`, or `Interface allowing ...` when the visible review content can be named directly
- Repo-process phrasing like `not yet evidenced in this repo-backed workspace` when `not yet evidenced in this workspace` is enough
- Ambiguous ownership words like `operator` when `provider` or `customer` is clearer

## Field-Level Tests

Use these quick checks before finalizing wording.

- `implementationSummary`
  - Would a customer security admin understand what capability exists without knowing the codebase?
  - Is every sentence backed by at least one checklist item and its evidence?
- checklist `label`
  - Does this read like a requirement or outcome rather than a feature note?
  - Could it stand alone in the UI without sounding awkward?
- checklist `description`
  - Does it clarify the requirement without turning into implementation detail?
- evidence `title`
  - Does it identify the artifact cleanly?
- evidence `description`
  - If shown without the file path, would the reader still know what artifact they are looking at?
  - Does it sound like a caption for a screenshot, record, export, schema, or procedure?
  - Would a hospital or enterprise security admin understand why this artifact is worth reviewing?
  - Does it name the reviewable content in the artifact, not just the existence of the route or workflow?
  - Is it more than a claim, but less than a code comment?
- `customerResponsibilityNotes`
  - Would the customer know exactly what they own after reading this?
  - Is provider ownership kept out of this field?

## Control Template

When adding a new control blueprint, fill in this structure deliberately:

- `nist80053Id`
  - Must exist in the moderate controls JSON.
- `internalControlId`
  - Keep the existing `CTRL-<family>-<number>` pattern.
- `implementationSummary`
  - Explain what the hosted service actually does.
  - Avoid mentioning customer duties here except to frame boundaries.
  - Do not mention an evidence source or workflow here unless that support appears in the checklist evidence below.
  - Write for a customer reviewer, not for an engineer reading the repo.
- `responsibility`
  - Use `platform` when the checklist items describe hosted-service behavior we operate.
  - Use `shared-responsibility` when the control depends on both platform features and customer governance.
  - Use `customer` only when the workspace is mainly tracking a customer-operated obligation.
- `platformChecklistItems`
  - Use 2 to 4 items.
  - Each item should describe one reviewable requirement.
  - Prefer provider-language like `Provider`, `Platform`, or `Hosted service` when the item is ours.
  - Labels should sound like review outcomes or maintained procedures, not feature names.
- `seed.notes`
  - State what the repo proves today.
  - Do not state future intent.
- `seed.evidence`
  - Name one artifact at a time.
  - Describe the artifact in customer-readable language.
  - Make it clear how the artifact relates to the checklist item without turning the description into a bare conclusion.
  - Prefer captions that identify what the reviewer would actually see in the artifact.
- `customerResponsibilityNotes`
  - Keep this separate from the checklist.
  - Describe what the customer must configure, review, govern, or operate outside the hosted service.

## Evidence Description Examples

Prefer this style:

- `Administrative security route showing the control workspace and evidence review interface available to authorized security administrators.`
- `Evidence report schema and stored review metadata, including review status, reviewer identity, review timestamps, review notes, content hash, and export integrity information.`
- `Administrative review workflow and supporting backend handling for marking evidence reports as reviewed or requiring follow-up, with reviewer notes retained as part of the review record.`
- `Administrative security route showing audit review records, control records, and evidence review actions available to authorized security administrators.`
- `Review workflow for recording evidence report status, reviewer notes, and follow-up actions.`
- `Evidence report export containing report content, manifest data, and integrity metadata for reviewer distribution.`

Avoid this style:

- `src/routes/app/admin/security.tsx exposes control workspace and evidence review surfaces for security administrators.`
- `convex/schema.ts defines reviewStatus, reviewedAt, reviewedByUserId, reviewNotes, contentHash, and exportIntegritySummary fields for evidenceReports.`
- `src/routes/app/admin/security.tsx and convex/security.ts allow reviewers to mark evidence reports reviewed or needs follow-up with notes.`
- `Route providing control workspace and evidence review interfaces for security administrators.`
- `Workflow supporting reviewers who mark evidence reports as reviewed or requiring follow-up with notes.`

## Evidence Strength Heuristics

When multiple candidate artifacts exist, prefer the strongest evidence the repo can honestly support.

- Strongest buyer-facing evidence
  - Screenshot or route with visible review content
  - Export artifact or generated report
  - Retained record example
  - Written provider procedure or policy
- Strong supporting evidence
  - Schema or data model showing retained fields
  - Workflow implementation showing review-state handling
  - Audit event inventory or configuration definition
- Weaker when standing alone
  - Route or interface references that do not say what the reviewer can see there
  - Workflow references that describe plumbing but not the reviewable outcome
  - Generic summaries that only say a capability exists

When only technical evidence exists, say so clearly but still caption it as an artifact.

- Prefer `Schema describing retained review metadata, including ...`
- Prefer `Workflow for recording review status and reviewer notes.`
- Avoid `Schema proving ...`
- Avoid `Workflow supporting ...`

## Responsibility Patterns

Use these patterns consistently:

- `platform` control
  - Checklist items should primarily describe hosted-service behavior or provider-operated procedures.
- `shared-responsibility` control
  - Checklist items may include provider capabilities and provider-operated procedures, but customer duties should stay in `customerResponsibilityNotes` unless a checklist item is explicitly labeled as customer-owned.
- `customer` control
  - Only use this when the core control obligation is customer-operated.
  - If the platform merely supplies support artifacts, label the checklist items as support-oriented, for example:
    - `Investigation-supporting evidence can be exported`
    - `Provider artifacts can support customer review`
  - Do not make a customer-owned control read like a platform-operated procedure.

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
- Every sentence in the implementation summary is backed by at least one checklist item and its seeded evidence.
- Responsibility matches the actual checklist content.
- Customer responsibilities are not mixed into provider checklist items.
- Actor labels are explicit. Replace vague nouns like `operator` unless the ownership is unmistakable.
- Each checklist item has at least one concrete evidence artifact or is intentionally incomplete.
- Partial support is marked `partial` or incomplete instead of overstated as complete.
- CSF and SOC 2 mappings are explicitly narrowed when the inherited crosswalk is too broad.
- Provider-internal process items are labeled as provider or operator duties, not written like customer instructions.
- Checklist labels and descriptions match the softened scope of the summary. If the summary no longer claims a full subprocessor program, SSP, or monitoring program, the checklist labels should not imply one.
- Customer-owned controls that rely on provider evidence are clearly framed as provider support artifacts, not provider ownership of the full control.
- The regenerated seed changed only because of source edits, not hand edits.

## Checklist And Evidence Patterns

- A good checklist item describes one reviewable requirement.
- A good checklist label reads like a control requirement or maintained procedure, not a UI feature note.
- A good checklist description explains the requirement in plain reviewer language.
- A good seeded note explains what the repo currently proves, not what the team hopes is true.
- A good evidence entry names one artifact and describes that artifact in language a customer reviewer can understand.
- Evidence descriptions should read like artifact captions, not source-code commentary.
- Strong evidence descriptions say what is visible or retained in the artifact, not just that the artifact exists.
- If an artifact is technical rather than operational, the caption should still explain the review-relevant fields, actions, or outputs it contains.
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
