# Generated Compliance Artifacts

This directory contains repo-generated compliance artifacts derived from the source files in [`../sources`](/Users/yeoman/Desktop/tanstack/tanstack-start-template/compliance/sources) and normalized mappings in [`../mappings`](/Users/yeoman/Desktop/tanstack/tanstack-start-template/compliance/mappings).

## Files

- `nist-800-53-moderate-controls.json`
  - Normalized `800-53` moderate baseline control catalog used as the primary control source.
- `nist-800-66-controls.json`
  - Normalized `800-66` HIPAA guidance catalog with key activities, sample questions, and publication crosswalk references.
- `csf-2.0-informative-references.json`
  - Normalized CSF 2.0 reference data with a reverse index from `800-53` controls to CSF subcategories.
- `soc-2-trust-services-criteria.json`
  - Normalized SOC 2 Trust Services Criteria data with a reverse index from `800-53` controls to SOC 2 criteria.
- `active-control-register.seed.json`
  - Curated active register consumed by the admin security UI.

## Important Distinction

These files combine:

- source-derived mapping data
- curated internal control selection
- seeded implementation metadata like status, owner, review status, and evidence placeholders

That means they are operational repo artifacts, not official standards publications.

## Regeneration

Regenerate everything with:

```bash
pnpm run compliance:refresh
```
