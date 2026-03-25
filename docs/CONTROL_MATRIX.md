## Control Matrix

This template documents the implemented safeguards that ship out of the box and calls out the deployer-owned gaps that still need to be satisfied before any HIPAA/NIST/HITRUST-ready claim can be made.

### Administrative safeguards (app scope)

- Workforce access and role boundaries: Better Auth roles, Convex auth guards, organization access checks documented above; deployers must still define HR/operations policies outside the codebase.
- Security awareness and stronger authentication: enforced MFA posture, MFA-gated site-admin access, and recent-step-up checks for high-risk exports with evidence captured in the posture dashboard.
- Evaluation and audit review: audit log exports and hash-chain integrity checks are available, but incident response reporting and third-party reviews remain deployer tasks.

### Physical and technical safeguards (app scope)

- Unique user identification and session controls: Better Auth session management with secure cookies, database-backed sessions, verified-email enforcement, MFA-gated admin access, and repo-pinned edge security headers; deployers still need to operate WAF, TLS certs, and key rotation.
- Transmission and access protection: strict trusted-origin checks, canonical Better Auth base URL validation, short-lived session freshness, and policy-driven attachment lifecycle controls; external VPNs or network ACLs must be layered externally.
- Audit controls: hash-linked audit events, export logging, document scan records, and retention job history generate the raw evidence for an audit file; deployers still need centralized log aggregation, retention, and review processes.
- Integrity: file-type/signature verification plus quarantining hooks support the document flow, and the default regulated upload boundary is limited to PDF, plain text, CSV, and JPEG/PNG/GIF/WEBP images; any broader Office-style intake or production malware/DLP scanning remains the deployer’s responsibility.

### Operational evidence

- `/app/admin/security` exposes posture summaries for MFA coverage, scan outcomes, retention jobs, backup verification, and audit integrity; it is intended for internal walkthroughs, not third-party attestations.
- `api.securityReports.generateEvidenceReport` emits a structured evidence snapshot and persists it to `evidenceReports` so teams can package compliance-ready exports.
- `retentionJobs`, `documentScanEvents`, and `backupVerificationReports` provide timestamped evidence records that operators should link with their deployment runbooks.

### Important limitations

- This template explicitly ships controls it can enforce; certification, attestation, or third-party compliance reports must still be delivered by the deployer/operator.
- Deployers remain responsible for controls beyond the shipped baseline: WAF tuning, operational backup execution, incident response, BAA/legal documentation, and any paid third-party services (SOC 2 readiness, HITRUST assessment, dedicated AV engines) they choose to add.
