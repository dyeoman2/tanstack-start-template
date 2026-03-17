# Compliance Sources

This directory stores external compliance framework source artifacts, mapping work, and generated outputs.

## Layout

- `sources/`: Raw framework source files downloaded from official publishers.
- `mappings/`: Hand-authored or scripted crosswalk files between frameworks and internal controls.
- `generated/`: Derived outputs generated from source artifacts and mappings.

## Current Source Paths

- `sources/nist/800-53/`: NIST SP 800-53 Rev. 5 source catalogs and resolved profiles.
- `sources/nist/800-66/`: NIST SP 800-66 Rev. 2 source documents or extracted mapping assets.
- `sources/hhs/hipaa/`: HIPAA Security Rule source text and related HHS guidance artifacts.

## Recommended File Placement

Save the NIST moderate resolved profile catalog here:

`sources/nist/800-53/NIST_SP-800-53_rev5_MODERATE-baseline-resolved-profile_catalog.json`
