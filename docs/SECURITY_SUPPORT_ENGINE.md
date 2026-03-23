# Security Support Engine

This note defines the current support contract for the internal security workspace. It is the foundation the later policy layer should build on.

## Core truth path

Support is derived bottom-up:

`evidence(validUntil) -> checklist.support -> control.support`

The system does not store checklist or control support as authoritative database state. Those values are resolved from current evidence at read time.

## Evidence validity

Evidence counts toward support only when it is:

- active
- reviewed
- still valid

Validity is based on `validUntil`.

- `now <= validUntil`: evidence still counts
- `now > validUntil`: evidence no longer counts

If evidence has not been reviewed yet, it may contribute to a partial state, but it cannot fully satisfy support.

## Seeded evidence

Seeded evidence counts as real support for now.

- seeded evidence is treated as reviewed bootstrap support
- seeded evidence uses a default `12 month` validity window
- once that validity window expires, it no longer counts toward support
- annual review should renew seeded-backed support by materializing fresh review-origin evidence, not by directly patching support

## Checklist support

Each checklist item exposes one derived field:

- `missing`
- `partial`
- `complete`

Rules:

- `complete`: at least one valid reviewed evidence artifact is sufficient
- `partial`: some non-zero support exists, but not enough to be complete
- `missing`: no currently valid support exists

There are no optional checklist items in the current model.

## Control support

Each control exposes one derived field:

- `missing`
- `partial`
- `complete`

Rules:

- `complete`: every checklist item is complete
- `missing`: every checklist item is missing
- `partial`: anything in between

This is the control rollup contract the future policy layer should rely on.

## Adjacent domains

Findings, vendor review state, and annual review workflow are connected to controls, but they are not part of the base support rollup.

Current rule:

- `control.support` is derived only from checklist support
- checklist support is derived only from current evidence

That means:

- findings do not directly change control support
- vendor review state does not directly change control support
- annual review status does not directly change control support

Those domains are overlays around the support engine. They explain risk, review posture, and follow-up work, but they do not replace proof-backed support.

The future policy layer should start from the same rule:

- `policy.support` should roll up from mapped `control.support`
- findings, vendor posture, and review state can be added later as linked overlays, not as the base support signal

## Policy source of truth

Policy support extends the same proof-backed model:

`evidence(validUntil) -> checklist.support -> control.support -> policy.support`

Policy ownership is split intentionally:

- repo markdown is canonical policy prose
- `securityPolicies` is canonical policy metadata and review state
- `securityPolicyControlMappings` is canonical policy-to-control mapping state

Repo sync is the only path that refreshes repo-owned policy fields from the seeded catalog:

- `title`
- `summary`
- `sourcePath`
- `contentHash`
- `customerSummary`
- `internalNotes`
- seeded policy-control mappings

Annual review owns policy review metadata:

- `lastReviewedAt`
- `nextReviewAt`

Repo sync must preserve those review fields. Annual review updates them through policy attestation tasks.

Current policy contract:

- `policy.support` is derived only from mapped `control.support`
- policy review tasks are attestation-only
- policy review does not create checklist/control evidence
- findings, vendor posture, and review workflow remain overlays, not policy support inputs

## Governance terms

These terms are now locked for the next governance phase:

- `support` = proof-backed completeness derived from current evidence and rollups
- `review` = formal governance attestation or revalidation workflow
- `finding` = detected gap or issue linked to the governance graph
- `vendor review` = governed third-party assessment state

Important boundary:

- findings do not change `control.support`
- findings do not change `policy.support`
- vendor review state does not change `control.support`
- vendor review state does not change `policy.support`

Those records affect posture, annual review outputs, and follow-up workflows. They do not replace proof-backed support.

## Governance context seam

The support engine remains the base truth path. Cross-object governance linking should now flow through a shared governance-context layer instead of being assembled ad hoc inside review or workspace modules.

Current shared context includes:

- policy object summaries
- control-to-policy related context

Future governance expansion should extend that seam with:

- vendor context
- finding context
- annual review umbrella context

## Annual review

Annual review is a revalidation workflow, not a parallel truth system.

It should:

- surface stale, partial, and missing support
- collect attestations and linked documents
- materialize fresh review-origin evidence
- preserve provenance and review history

It should not directly mark checklist items or controls complete.
