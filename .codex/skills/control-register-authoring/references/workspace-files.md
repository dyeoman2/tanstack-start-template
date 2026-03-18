# Workspace Files

## Primary files

- `scripts/compliance/generate-active-control-register.ts`
  - Source of truth for active control blueprints, checklist items, seeded evidence, responsibility, and mapping overrides.
- `compliance/generated/active-control-register.seed.json`
  - Generated output consumed by the site admin workspace. Never hand-edit.
- `compliance/generated/nist-800-53-moderate-controls.json`
  - Canonical source for NIST control IDs, titles, families, and statements.
- `compliance/generated/csf-2.0-informative-references.json`
  - Source of inherited CSF 2.0 mappings.
- `compliance/generated/soc-2-trust-services-criteria.json`
  - Source of inherited SOC 2 mappings.
- `compliance/mappings/hipaa-security-rule-citations.json`
  - Source of HIPAA citations.
- `compliance/generated/nist-800-66-controls.json`
  - Source of NIST 800-66r2 relationships and related key activities.
- `convex/security.ts`
  - Site admin workspace materialization, evidence review flows, evidence report generation, and development reseed/reset mutation.

## Useful search patterns

Use these when extending or revising the generator:

```bash
rg -n "nist80053Id: 'AC-2'|nist80053Id: 'AU-6'" scripts/compliance/generate-active-control-register.ts
rg -n "\"nist80053Id\": \"CA-2\"" compliance/generated/nist-800-53-moderate-controls.json
rg -n "csf20Ids|soc2CriterionIds" scripts/compliance/generate-active-control-register.ts
rg -n "reseedSecurityControlWorkspaceForDevelopment|ACTIVE_CONTROL_REGISTER" convex/security.ts
```

## Repo-specific authoring constraints

- The generator currently supports explicit `csf20Ids` and `soc2CriterionIds` to narrow inherited mappings when the raw crosswalk is too broad.
- The site admin workspace synthesizes built-in checklist and evidence rows from `ACTIVE_CONTROL_REGISTER`; it does not store those seed rows directly.
- If built-in evidence attribution needs to look like a real actor, use the site admin profile resolution path in `convex/security.ts`.
- Keep provider-internal operational procedures distinct from customer responsibilities in buyer-facing controls.

## Common authoring mistakes

- Letting `implementationSummary` cover multiple controls at once.
- Letting the implementation summary claim more than the checklist items and seeded evidence actually prove.
- Treating buyer packet artifacts as checklist items when they should just be evidence or separate trust documents.
- Leaving inherited CSF and SOC 2 mappings untouched when they clearly overstate the repo evidence.
- Using checklist items that really belong in `customerResponsibilityNotes`.
- Marking a checklist item complete because a schema or mutation exists even though there is no actual retained evidence yet.
- Using generic labels like `Seeded register` in the site admin workspace when a real site admin actor can be resolved.
- Using vague actor words like `operator` when the real actor should be `provider`, `customer`, or `site admin`.
- Marking a control as `customer` while writing checklist items that read like platform-owned operating procedures.
- Softening a summary but leaving old checklist labels that still imply a broader program than the evidence supports.

## Typical update pattern

1. Confirm the control ID exists in `compliance/generated/nist-800-53-moderate-controls.json`.
2. Add or revise the blueprint in `scripts/compliance/generate-active-control-register.ts`.
3. Add `csf20Ids` and `soc2CriterionIds` if the inherited mapping needs narrowing.
4. Review wording for:
   - provider clarity
   - customer clarity
   - honest evidence scope
   - summary and checklist consistency
   - explicit actor naming
5. Regenerate the seed JSON.
6. If needed, update `convex/security.ts` so the site admin workspace materializes the control or attribution correctly.
7. Reseed the site admin workspace.

## Standard command sequence

```bash
pnpm run compliance:generate:active-control-register
npx convex run --typecheck=disable --push security:reseedSecurityControlWorkspaceForDevelopment '{"secret":"..."}'
```

Read `E2E_TEST_SECRET` from `.env.local` before the reseed command.
