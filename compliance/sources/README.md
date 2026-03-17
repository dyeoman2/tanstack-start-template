# Compliance Source Manifest

This directory stores externally published framework source artifacts used to build the internal control register and mappings.

## Sources

### HHS / HIPAA

- `hhs/hipaa/title-45-part-164-subpart-c-2026-03-13.xml`
  - Source: <https://www.ecfr.gov/api/versioner/v1/full/2026-03-13/title-45.xml?part=164&subpart=C>
  - Notes: Official eCFR XML for Title 45 Part 164 Subpart C, pinned to the 2026-03-13 published version.

### NIST SP 800-53 Rev. 5

- `nist/800-53/NIST_SP-800-53_rev5_catalog.json`
  - Source: <https://github.com/usnistgov/oscal-content/blob/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json>
  - Notes: Full OSCAL JSON control catalog.

- `nist/800-53/NIST_SP-800-53_rev5_MODERATE-baseline-resolved-profile_catalog.json`
  - Source: <https://github.com/usnistgov/oscal-content/blob/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_MODERATE-baseline-resolved-profile_catalog.json>
  - Notes: Resolved moderate baseline profile used for the current extraction pipeline.

### NIST SP 800-66 Rev. 2

- `nist/800-66/SP800_66_2_0_0-cprt-export.json`
  - Source: <https://csrc.nist.gov/extensions/nudp/services/json/nudp/framework/version/sp800_66_2_0_0/export/json?element=all>
  - Notes: Official CPRT JSON export for SP 800-66 Rev. 2. This is the preferred machine-readable guidance source for `800-66` mappings.

### NIST CSF 2.0

- `nist/csf-2.0/csf-2.0-elements.json`
  - Source: <https://csrc.nist.gov/extensions/nudp/services/json/csf/elements>
  - Notes: Official CSF 2.0 Reference Tool JSON source containing the core hierarchy, implementation examples, and informative-reference relationships.

### AICPA / SOC 2

- `aicpa/soc-2/Trust-services-criteria.pdf`
  - Source: <https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022>
  - Notes: Official Trust Services Criteria publication used as the primary human-readable SOC 2 criteria source.

- `aicpa/soc-2/tsc_to_nist_800-53.xlsx`
  - Source: <https://www.aicpa-cima.com/resources/download/mapping-2017-trust-services-criteria-to-nist-800-53>
  - Notes: Official AICPA workbook mapping Trust Services Criteria to NIST 800-53. This is the preferred machine-readable SOC 2 mapping source for the current pipeline.

- `aicpa/soc-2/Description Criteria.pdf`
  - Source: <https://www.aicpa-cima.com/resources/download/get-description-criteria-for-your-organizations-soc-2-r-report>
  - Notes: Official SOC 2 description criteria publication kept as supporting provenance for future system-description work.

## Working Guidance

- Prefer the XML, JSON, and workbook artifacts in this directory over HTML landing pages when building extractors.
