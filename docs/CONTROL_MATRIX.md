## Control Matrix

This template is a regulated-first starter. It maps implemented controls to common HIPAA Security Rule and NIST SP 800-66 style control families for internal review.

### Administrative safeguards

- Workforce access and role boundaries: Better Auth roles, Convex auth guards, organization access checks.
- Security awareness and stronger authentication: enforced MFA posture and recent-step-up checks for high-risk exports.
- Evaluation and audit review: audit log exports, audit integrity failure tracking, security posture dashboard.

### Physical and technical safeguards

- Unique user identification and session controls: Better Auth session management with secure cookies and database-backed sessions.
- Transmission and access protection: trusted-origin checks, short-lived session freshness, attachment lifecycle controls.
- Audit controls: hash-linked audit events, export logging, document scan records, retention job history.
- Integrity: local signature-based document verification and quarantine flow for suspicious uploads.

### Operational evidence

- `/app/admin/security` exposes posture summaries for MFA coverage, scan outcomes, retention jobs, backup verification, and audit integrity.
- `api.security.generateEvidenceReport` emits a JSON evidence snapshot and persists it to `evidenceReports`.
- `retentionJobs`, `documentScanEvents`, and `backupVerificationReports` provide timestamped evidence records for operator review.

### Important limitations

- This template does not claim HIPAA certification, SOC 2, or HITRUST certification.
- Deployers remain responsible for infrastructure hardening, backup execution, incident response, and BAA/legal requirements.
