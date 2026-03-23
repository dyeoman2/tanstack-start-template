import { ACTIVE_CONTROL_REGISTER } from './control-register';

export type SecurityPolicySeedMapping = {
  internalControlId: string;
  isPrimary: boolean;
};

export type SecurityPolicySeedRecord = {
  customerSummary: string;
  internalNotes: string | null;
  mappings: SecurityPolicySeedMapping[];
  owner: string;
  policyId: string;
  sourcePath: string;
  summary: string;
  title: string;
};

export const SECURITY_POLICY_CATALOG: SecurityPolicySeedRecord[] = [
  {
    policyId: 'information-security-governance',
    title: 'Information Security Governance Policy',
    summary:
      'Defines the governance structure, assessment cadence, and planning expectations for the provider security program.',
    customerSummary:
      'Defines the provider security governance model, annual oversight, and documented planning expectations.',
    owner: 'Security team',
    sourcePath: 'docs/security-policies/information-security-governance-policy.md',
    internalNotes: null,
    mappings: [
      { internalControlId: 'CTRL-PL-002', isPrimary: true },
      { internalControlId: 'CTRL-CA-002', isPrimary: true },
      { internalControlId: 'CTRL-CA-005', isPrimary: true },
    ],
  },
  {
    policyId: 'access-control',
    title: 'Access Control Policy',
    summary:
      'Defines account provisioning, access enforcement, and least-privilege expectations for provider-managed systems.',
    customerSummary:
      'Defines how access is approved, enforced, and limited across provider-managed systems.',
    owner: 'Security team',
    sourcePath: 'docs/security-policies/access-control-policy.md',
    internalNotes: null,
    mappings: [
      { internalControlId: 'CTRL-AC-002', isPrimary: true },
      { internalControlId: 'CTRL-AC-003', isPrimary: true },
      { internalControlId: 'CTRL-AC-006', isPrimary: true },
    ],
  },
  {
    policyId: 'identity-and-authentication',
    title: 'Identity and Authentication Policy',
    summary:
      'Defines identity proofing, authenticator management, and strong authentication requirements for organizational users.',
    customerSummary:
      'Defines the provider requirements for user authentication and authenticator lifecycle management.',
    owner: 'Security team',
    sourcePath: 'docs/security-policies/identity-and-authentication-policy.md',
    internalNotes: null,
    mappings: [
      { internalControlId: 'CTRL-IA-002', isPrimary: true },
      { internalControlId: 'CTRL-IA-005', isPrimary: true },
    ],
  },
  {
    policyId: 'audit-logging-and-log-review',
    title: 'Audit Logging and Log Review Policy',
    summary:
      'Defines what audit events must be captured, protected, reviewed, and reported for the provider environment.',
    customerSummary:
      'Defines the provider requirements for audit logging, log protection, and ongoing log review.',
    owner: 'Security team',
    sourcePath: 'docs/security-policies/audit-logging-and-log-review-policy.md',
    internalNotes: null,
    mappings: [
      { internalControlId: 'CTRL-AU-002', isPrimary: true },
      { internalControlId: 'CTRL-AU-006', isPrimary: true },
      { internalControlId: 'CTRL-AU-009', isPrimary: true },
      { internalControlId: 'CTRL-AU-012', isPrimary: true },
    ],
  },
  {
    policyId: 'continuous-monitoring-and-security-operations',
    title: 'Continuous Monitoring and Security Operations Policy',
    summary:
      'Defines vulnerability monitoring, security monitoring, and ongoing operational review expectations.',
    customerSummary:
      'Defines the provider approach for continuous monitoring, vulnerability scanning, and operational security review.',
    owner: 'Security team',
    sourcePath: 'docs/security-policies/continuous-monitoring-and-security-operations-policy.md',
    internalNotes: null,
    mappings: [
      { internalControlId: 'CTRL-CA-007', isPrimary: true },
      { internalControlId: 'CTRL-RA-005', isPrimary: true },
      { internalControlId: 'CTRL-SI-004', isPrimary: true },
    ],
  },
  {
    policyId: 'configuration-and-change-management',
    title: 'Configuration and Change Management Policy',
    summary:
      'Defines baseline configuration, approved change control, component inventory, and unsupported component handling.',
    customerSummary:
      'Defines the provider requirements for managed baselines, approved changes, and component inventory maintenance.',
    owner: 'Security team',
    sourcePath: 'docs/security-policies/configuration-and-change-management-policy.md',
    internalNotes: null,
    mappings: [
      { internalControlId: 'CTRL-CM-002', isPrimary: true },
      { internalControlId: 'CTRL-CM-003', isPrimary: true },
      { internalControlId: 'CTRL-CM-006', isPrimary: true },
      { internalControlId: 'CTRL-CM-008', isPrimary: true },
      { internalControlId: 'CTRL-SA-022', isPrimary: true },
    ],
  },
  {
    policyId: 'malware-protection-and-software-integrity',
    title: 'Malware Protection and Software Integrity Policy',
    summary:
      'Defines protections against malicious code and integrity expectations for software, firmware, and information.',
    customerSummary:
      'Defines the provider safeguards for malware defense and software integrity monitoring.',
    owner: 'Security team',
    sourcePath: 'docs/security-policies/malware-protection-and-software-integrity-policy.md',
    internalNotes: null,
    mappings: [
      { internalControlId: 'CTRL-SI-003', isPrimary: true },
      { internalControlId: 'CTRL-SI-007', isPrimary: true },
    ],
  },
  {
    policyId: 'cryptography-and-data-protection',
    title: 'Cryptography and Data Protection Policy',
    summary:
      'Defines encryption, key management, and data protection requirements for information in transit and at rest.',
    customerSummary:
      'Defines the provider requirements for cryptography, key management, and protection of customer information.',
    owner: 'Security team',
    sourcePath: 'docs/security-policies/cryptography-and-data-protection-policy.md',
    internalNotes: null,
    mappings: [
      { internalControlId: 'CTRL-SC-008', isPrimary: true },
      { internalControlId: 'CTRL-SC-012', isPrimary: true },
      { internalControlId: 'CTRL-SC-013', isPrimary: true },
      { internalControlId: 'CTRL-SC-028', isPrimary: true },
    ],
  },
  {
    policyId: 'network-security-and-boundary-protection',
    title: 'Network Security and Boundary Protection Policy',
    summary:
      'Defines boundary protections, segmentation, and ingress or egress controls for provider-managed environments.',
    customerSummary:
      'Defines the provider network boundary protections used to restrict and monitor traffic.',
    owner: 'Security team',
    sourcePath: 'docs/security-policies/network-security-and-boundary-protection-policy.md',
    internalNotes: null,
    mappings: [{ internalControlId: 'CTRL-SC-007', isPrimary: true }],
  },
  {
    policyId: 'backup-contingency-and-disaster-recovery',
    title: 'Backup, Contingency, and Disaster Recovery Policy',
    summary:
      'Defines backup retention, contingency planning, recovery testing, and restoration expectations.',
    customerSummary:
      'Defines the provider backup, contingency, and restoration requirements used to support resilience.',
    owner: 'Security team',
    sourcePath: 'docs/security-policies/backup-contingency-and-disaster-recovery-policy.md',
    internalNotes: null,
    mappings: [
      { internalControlId: 'CTRL-CP-002', isPrimary: true },
      { internalControlId: 'CTRL-CP-004', isPrimary: true },
      { internalControlId: 'CTRL-CP-009', isPrimary: true },
    ],
  },
  {
    policyId: 'incident-response',
    title: 'Incident Response Policy',
    summary:
      'Defines incident response training, testing, planning, and handling expectations for the provider environment.',
    customerSummary:
      'Defines how the provider prepares for, tests, and handles security incidents.',
    owner: 'Security team',
    sourcePath: 'docs/security-policies/incident-response-policy.md',
    internalNotes: null,
    mappings: [
      { internalControlId: 'CTRL-IR-002', isPrimary: true },
      { internalControlId: 'CTRL-IR-003', isPrimary: true },
      { internalControlId: 'CTRL-IR-004', isPrimary: true },
      { internalControlId: 'CTRL-IR-008', isPrimary: true },
    ],
  },
  {
    policyId: 'third-party-risk-management',
    title: 'Third-Party Risk Management Policy',
    summary:
      'Defines provider requirements for approving, reviewing, and monitoring external services and external personnel.',
    customerSummary:
      'Defines the provider requirements for third-party service approval and external personnel oversight.',
    owner: 'Security team',
    sourcePath: 'docs/security-policies/third-party-risk-management-policy.md',
    internalNotes: null,
    mappings: [
      { internalControlId: 'CTRL-SA-009', isPrimary: true },
      { internalControlId: 'CTRL-PS-007', isPrimary: true },
    ],
  },
  {
    policyId: 'personnel-security',
    title: 'Personnel Security Policy',
    summary:
      'Defines screening, termination, and external personnel security expectations for workforce members with system access.',
    customerSummary:
      'Defines the provider personnel screening and termination requirements tied to privileged or regulated access.',
    owner: 'Security team',
    sourcePath: 'docs/security-policies/personnel-security-policy.md',
    internalNotes: null,
    mappings: [
      { internalControlId: 'CTRL-PS-003', isPrimary: true },
      { internalControlId: 'CTRL-PS-004', isPrimary: true },
      { internalControlId: 'CTRL-PS-007', isPrimary: false },
    ],
  },
  {
    policyId: 'security-awareness-and-training',
    title: 'Security Awareness and Training Policy',
    summary: 'Defines awareness and role-based training expectations for the provider workforce.',
    customerSummary:
      'Defines the provider requirements for security awareness and role-based training.',
    owner: 'Security team',
    sourcePath: 'docs/security-policies/security-awareness-and-training-policy.md',
    internalNotes: null,
    mappings: [
      { internalControlId: 'CTRL-AT-002', isPrimary: true },
      { internalControlId: 'CTRL-AT-003', isPrimary: true },
    ],
  },
];

const allControlIds = new Set(
  ACTIVE_CONTROL_REGISTER.controls.map((control) => control.internalControlId),
);
const mappedControlIds = new Set<string>();
const primaryMappingCountByControl = new Map<string, number>();

for (const policy of SECURITY_POLICY_CATALOG) {
  for (const mapping of policy.mappings) {
    if (!allControlIds.has(mapping.internalControlId)) {
      throw new Error(
        `Security policy catalog references unknown control: ${mapping.internalControlId}`,
      );
    }
    mappedControlIds.add(mapping.internalControlId);
    if (mapping.isPrimary) {
      primaryMappingCountByControl.set(
        mapping.internalControlId,
        (primaryMappingCountByControl.get(mapping.internalControlId) ?? 0) + 1,
      );
    }
  }
}

const unmappedControls = ACTIVE_CONTROL_REGISTER.controls
  .map((control) => control.internalControlId)
  .filter((controlId) => !mappedControlIds.has(controlId));
if (unmappedControls.length > 0) {
  throw new Error(
    `Security policy catalog must map every control. Missing: ${unmappedControls.join(', ')}`,
  );
}

const controlsWithoutPrimaryPolicy = ACTIVE_CONTROL_REGISTER.controls
  .map((control) => control.internalControlId)
  .filter((controlId) => (primaryMappingCountByControl.get(controlId) ?? 0) !== 1);
if (controlsWithoutPrimaryPolicy.length > 0) {
  throw new Error(
    `Each control must have exactly one primary policy mapping. Invalid: ${controlsWithoutPrimaryPolicy.join(', ')}`,
  );
}

export const SECURITY_POLICY_CATALOG_BY_ID = new Map(
  SECURITY_POLICY_CATALOG.map((policy) => [policy.policyId, policy] as const),
);
