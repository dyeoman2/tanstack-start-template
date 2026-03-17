# Compliance Workspace

This directory stores compliance source artifacts, normalized mappings, and generated internal control outputs.

## Layout

- `sources/`: Raw source artifacts downloaded from official publishers.
- `mappings/`: Repo-owned normalized mapping layers derived from authoritative sources.
- `generated/`: Derived outputs used by the app and compliance tooling.

## Source of Truth Model

- HIPAA citations come from the eCFR XML source in `sources/hhs/hipaa/`.
- NIST 800-53 controls come from OSCAL JSON in `sources/nist/800-53/`.
- NIST 800-66 guidance comes from the CPRT JSON export in `sources/nist/800-66/`.
- CSF 2.0 references come from the official CSF Reference Tool JSON source in `sources/nist/csf-2.0/`.
- SOC 2 criteria and `TSC -> 800-53` mappings come from the official AICPA PDF/XLSX source files in `sources/aicpa/soc-2/`.

The repo does not treat vendor PDFs, HTML pages, or hand-authored spreadsheets as the working format when a better machine-readable source is available.

## Current Generated Outputs

- `generated/nist-800-53-moderate-controls.json`
  - Normalized `800-53` moderate baseline control catalog.
- `generated/nist-800-66-controls.json`
  - Normalized `800-66` HIPAA-linked guidance records, including key activities and sample questions.
- `generated/csf-2.0-informative-references.json`
  - Normalized CSF 2.0 subcategories plus a reverse index into `800-53`.
- `generated/soc-2-trust-services-criteria.json`
  - Normalized SOC 2 criteria plus a reverse index into `800-53`.
- `generated/active-control-register.seed.json`
  - Curated active control register used by the app.

## Current Mapping Outputs

- `mappings/hipaa-security-rule-citations.json`
  - Canonical HIPAA Security Rule citation file generated from the eCFR XML source.

## Refresh Workflow

Run the full extraction chain with:

```bash
pnpm run compliance:refresh
```

That command regenerates the current normalized compliance artifacts in dependency order.
