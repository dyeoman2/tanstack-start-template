export const SECURITY_POLICY_DOCUMENTS: Record<string, string> = {
  'docs/security-policies/access-control-policy.md': `# Access Control Policy

## Purpose

This policy defines how the provider approves, enforces, and limits access to provider-managed systems and services.

## Requirements

- Access is provisioned through approved account-management workflows.
- Access enforcement mechanisms restrict access based on approved roles.
- Privileged access follows least-privilege expectations and is reviewed regularly.
`,
  'docs/security-policies/audit-logging-and-log-review-policy.md': `# Audit Logging and Log Review Policy

## Purpose

This policy defines the provider requirements for audit logging, audit record protection, and log review.

## Requirements

- Security-relevant events are logged in provider-managed systems.
- Audit records are protected against unauthorized modification or deletion.
- Audit logs are reviewed and reported through documented provider procedures.
- Audit review findings and related follow-up actions are retained through the provider security review workflow.
- Audit review procedures are revalidated during the annual security review.
`,
  'docs/security-policies/backup-contingency-and-disaster-recovery-policy.md': `# Backup, Contingency, and Disaster Recovery Policy

## Purpose

This policy defines the provider requirements for backups, contingency planning, and recovery testing.

## Requirements

- Backup procedures are documented and retained.
- Contingency planning and restoration expectations are reviewed annually.
- Recovery and restore verification evidence is retained for annual review.
`,
  'docs/security-policies/configuration-and-change-management-policy.md': `# Configuration and Change Management Policy

## Purpose

This policy defines baseline configuration, approved change control, component inventory, and unsupported component handling requirements for provider-managed systems.

## Requirements

- Managed baselines are documented and reviewed.
- Production-impacting changes follow an approved change path.
- Provider-managed component inventory remains current.
- Unsupported components are identified and addressed.
`,
  'docs/security-policies/continuous-monitoring-and-security-operations-policy.md': `# Continuous Monitoring and Security Operations Policy

## Purpose

This policy defines the provider requirements for continuous monitoring, vulnerability review, and operational security oversight.

## Requirements

- Continuous monitoring signals are collected and reviewed.
- Security alerts and monitored findings are triaged through provider review and tracked follow-up workflows.
- Vulnerabilities and security findings are tracked through provider workflows.
- Monitoring outputs are retained for annual review and security reporting.
`,
  'docs/security-policies/cryptography-and-data-protection-policy.md': `# Cryptography and Data Protection Policy

## Purpose

This policy defines the provider requirements for protecting customer and provider information through cryptography and key management.

## Requirements

- Information in transit is protected through approved transport protections.
- Information at rest is protected through approved encryption safeguards.
- Cryptographic key management follows documented provider standards.
`,
  'docs/security-policies/identity-and-authentication-policy.md': `# Identity and Authentication Policy

## Purpose

This policy defines how the provider identifies users and manages authenticators used to access provider-managed systems.

## Requirements

- Provider-managed accounts use approved authentication mechanisms.
- Authenticator lifecycle management is documented and reviewed.
- Changes to authentication posture are reviewed as part of the annual security review.

## Cookie Security Posture

- Session cookies use \`SameSite=Strict\`, \`HttpOnly\`, and \`Secure\` (HTTPS) attributes. Cookie caching is disabled so server-side session revocation takes effect immediately.
- Step-up challenge cookies use \`SameSite=Lax\` instead of \`Strict\`. This is an intentional design choice: post-MFA redirect flows (e.g., passkey or TOTP verification followed by a redirect back to the protected action) require Lax to preserve the cookie across the top-level navigation. Compensating controls include a 10-minute max-age, \`HttpOnly\`, UUID-format validation, and one-time-use semantics (the claim is consumed on first successful use).
`,
  'docs/security-policies/incident-response-policy.md': `# Incident Response Policy

## Purpose

This policy defines the provider requirements for incident response planning, training, testing, and handling.

## Requirements

- The provider maintains a documented incident response plan and procedure set.
- Incident response training and testing occur on the defined cadence.
- Incident response exercises are conducted at least annually as part of the annual security review.
- The incident response plan and procedure set are reviewed during the provider annual security review.
- Incident handling evidence is retained for annual review.
`,
  'docs/security-policies/information-security-governance-policy.md': `# Information Security Governance Policy

## Purpose

This policy defines the governance structure used to oversee the provider security program, maintain documented plans, and verify that planned security activities are reviewed on an annual basis.

## Requirements

- The provider maintains a documented security program that is reviewed at least annually.
- Security planning, control assessment, and tracked remediation remain part of the documented governance process.
- Open follow-up actions serve as the provider plan of action and milestones (POA&M) and are reviewed during each annual security review.
- Policy and control review outcomes are retained as part of the annual review record.
`,
  'docs/security-policies/malware-protection-and-software-integrity-policy.md': `# Malware Protection and Software Integrity Policy

## Purpose

This policy defines the provider safeguards used to protect against malicious code and preserve software integrity.

## Requirements

- Uploaded or processed content is inspected through approved safeguards.
- Integrity protections are applied to software and managed information.
- Integrity-relevant monitoring outputs are retained as evidence.
`,
  'docs/security-policies/network-security-and-boundary-protection-policy.md': `# Network Security and Boundary Protection Policy

## Purpose

This policy defines the provider boundary protection requirements used to restrict and monitor network access.

## Requirements

- Boundary protections are documented for provider-managed environments.
- Network ingress and egress pathways are restricted through approved controls.
- Boundary changes are reviewed as part of normal provider change management.

## Content Security Policy

The application enforces a nonce-based Content Security Policy on all responses:

- \`script-src\` requires a per-request cryptographic nonce; inline scripts without the nonce are blocked.
- \`'unsafe-eval'\` is permitted **only** in development builds where \`NODE_ENV=development\`, to support Vite HMR module transforms. Production builds never include \`'unsafe-eval'\` in the CSP.
- \`style-src-attr 'unsafe-inline'\` is an accepted residual risk documented in the CSP builder. Tailwind CSS and shadcn/ui apply inline style attributes (e.g., \`style="--radix-*"\`) that cannot be nonce-gated. CSS attribute injection is lower severity than script injection and cannot execute JavaScript.
- CSP violations are reported to \`/api/csp-report\` and logged as security telemetry events.
- The CSP mode (enforce vs. report-only) is configurable via the \`CSP_MODE\` environment variable; the default is enforce.
`,
  'docs/security-policies/personnel-security-policy.md': `# Personnel Security Policy

## Purpose

This policy defines the provider requirements for workforce screening, termination, and external personnel handling.

## Requirements

- Personnel screening requirements are documented for relevant workforce access.
- Termination and offboarding steps are documented and reviewed.
- External personnel with provider access are handled under documented security expectations.
`,
  'docs/security-policies/security-awareness-and-training-policy.md': `# Security Awareness and Training Policy

## Purpose

This policy defines the provider requirements for security awareness and role-based training.

## Requirements

- The provider maintains a documented security awareness program.
- Role-based security training expectations are defined and reviewed annually.
- Training program review evidence is retained in the annual security review.
`,
  'docs/security-policies/third-party-risk-management-policy.md': `# Third-Party Risk Management Policy

## Purpose

This policy defines the provider requirements for approving, reviewing, and monitoring third-party services and external personnel.

## Requirements

- External services are approved before use in regulated workflows.
- Third-party posture is reviewed during the annual security review.
- External personnel access is governed through documented review expectations.
`,
};
