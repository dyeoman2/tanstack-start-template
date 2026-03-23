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

## Annual review

Annual review is a revalidation workflow, not a parallel truth system.

It should:

- surface stale, partial, and missing support
- collect attestations and linked documents
- materialize fresh review-origin evidence
- preserve provenance and review history

It should not directly mark checklist items or controls complete.
