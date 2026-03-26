export const EXPORT_ARTIFACT_SCHEMA_VERSION = '2026-03-18.audit-evidence.v1';
export const BACKUP_DRILL_STALE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const RELEASE_PROVENANCE_CONTROL_ID = 'CTRL-CM-003';
export const RELEASE_PROVENANCE_ITEM_ID = 'controlled-change-path';
export const REVIEW_RUN_SOURCE_SURFACE = 'admin.security.reviews';
export const ANNUAL_REVIEW_TASK_FRESHNESS_DAYS = 365;

export const VENDOR_RELATED_CONTROL_LINKS_BY_VENDOR = {
  openrouter: [
    {
      internalControlId: 'CTRL-SA-009',
      itemId: 'external-service-approval-state-can-be-reviewed',
    },
    {
      internalControlId: 'CTRL-CM-008',
      itemId: 'component-posture-can-be-reviewed-in-site-admin',
    },
  ],
  resend: [
    {
      internalControlId: 'CTRL-SA-009',
      itemId: 'external-service-approval-state-can-be-reviewed',
    },
    {
      internalControlId: 'CTRL-AU-006',
      itemId: 'provider-review-procedure',
    },
  ],
  sentry: [
    {
      internalControlId: 'CTRL-SA-009',
      itemId: 'external-service-approval-state-can-be-reviewed',
    },
    {
      internalControlId: 'CTRL-CM-008',
      itemId: 'component-posture-can-be-reviewed-in-site-admin',
    },
    {
      internalControlId: 'CTRL-CA-007',
      itemId: 'evidence-report-from-monitoring-state',
    },
  ],
} as const;

export type ReviewTaskBlueprint = {
  allowException: boolean;
  controlLinks: Array<{
    internalControlId: string;
    itemId: string;
  }>;
  description: string;
  freshnessWindowDays: number | null;
  required: boolean;
  statementKey: string | null;
  statementText: string | null;
  taskType: 'automated_check' | 'attestation' | 'document_upload';
  templateKey: string;
  title: string;
  automationKind?:
    | 'audit_readiness'
    | 'backup_verification'
    | 'control_workspace_snapshot'
    | 'findings_snapshot'
    | 'release_provenance'
    | 'security_posture'
    | 'vendor_posture_snapshot';
};

export const ANNUAL_REVIEW_TASK_BLUEPRINTS: ReviewTaskBlueprint[] = [
  {
    allowException: false,
    automationKind: 'security_posture',
    controlLinks: [
      { internalControlId: 'CTRL-CA-007', itemId: 'posture-signals-collected' },
      { internalControlId: 'CTRL-CA-007', itemId: 'evidence-report-from-monitoring-state' },
    ],
    description: 'Generate and retain the current security posture summary for annual review.',
    freshnessWindowDays: 30,
    required: true,
    statementKey: null,
    statementText: null,
    taskType: 'automated_check',
    templateKey: 'annual:auto:security-posture',
    title: 'Security posture summary is current',
  },
  {
    allowException: false,
    automationKind: 'audit_readiness',
    controlLinks: [
      { internalControlId: 'CTRL-CA-007', itemId: 'evidence-report-from-monitoring-state' },
      { internalControlId: 'CTRL-CA-005', itemId: 'follow-up-findings-can-be-surfaced' },
    ],
    description: 'Generate the current audit readiness report and retain it for annual review.',
    freshnessWindowDays: 30,
    required: true,
    statementKey: null,
    statementText: null,
    taskType: 'automated_check',
    templateKey: 'annual:auto:audit-readiness',
    title: 'Audit readiness report is current',
  },
  {
    allowException: true,
    automationKind: 'findings_snapshot',
    controlLinks: [
      {
        internalControlId: 'CTRL-RA-005',
        itemId: 'security-findings-can-be-reviewed-and-prioritized',
      },
      { internalControlId: 'CTRL-CA-005', itemId: 'follow-up-findings-can-be-surfaced' },
    ],
    description:
      'Capture the current findings snapshot and verify any follow-up items are tracked.',
    freshnessWindowDays: 30,
    required: true,
    statementKey: null,
    statementText: null,
    taskType: 'automated_check',
    templateKey: 'annual:auto:findings-snapshot',
    title: 'Security findings snapshot is current',
  },
  {
    allowException: false,
    automationKind: 'vendor_posture_snapshot',
    controlLinks: [
      {
        internalControlId: 'CTRL-SA-009',
        itemId: 'external-service-approval-state-can-be-reviewed',
      },
      {
        internalControlId: 'CTRL-CM-008',
        itemId: 'component-posture-can-be-reviewed-in-site-admin',
      },
    ],
    description: 'Capture the current vendor posture and approval state used for annual review.',
    freshnessWindowDays: 30,
    required: true,
    statementKey: null,
    statementText: null,
    taskType: 'automated_check',
    templateKey: 'annual:auto:vendor-posture',
    title: 'Vendor posture snapshot is current',
  },
  {
    allowException: false,
    automationKind: 'control_workspace_snapshot',
    controlLinks: [
      { internalControlId: 'CTRL-AU-006', itemId: 'provider-review-procedure' },
      { internalControlId: 'CTRL-CA-007', itemId: 'evidence-report-from-monitoring-state' },
    ],
    description: 'Capture the current control workspace state for the annual review record.',
    freshnessWindowDays: 30,
    required: true,
    statementKey: null,
    statementText: null,
    taskType: 'automated_check',
    templateKey: 'annual:auto:control-workspace',
    title: 'Control workspace snapshot is current',
  },
  {
    allowException: true,
    automationKind: 'backup_verification',
    controlLinks: [
      { internalControlId: 'CTRL-CP-009', itemId: 'backup-verification-records-maintained' },
      { internalControlId: 'CTRL-CP-009', itemId: 'restore-testing-recorded' },
    ],
    description: 'Link the latest backup verification and restore evidence into the annual review.',
    freshnessWindowDays: 90,
    required: true,
    statementKey: null,
    statementText: null,
    taskType: 'automated_check',
    templateKey: 'annual:auto:backup-verification',
    title: 'Backup verification evidence is current',
  },
  {
    allowException: true,
    automationKind: 'release_provenance',
    controlLinks: [
      { internalControlId: 'CTRL-CM-003', itemId: 'automated-guardrail-checks' },
      { internalControlId: 'CTRL-CM-003', itemId: 'controlled-change-path' },
    ],
    description:
      'Link the latest release provenance and guardrail evidence into the annual review.',
    freshnessWindowDays: 90,
    required: true,
    statementKey: null,
    statementText: null,
    taskType: 'automated_check',
    templateKey: 'annual:auto:release-provenance',
    title: 'Release provenance evidence is current',
  },
  {
    allowException: true,
    controlLinks: [
      {
        internalControlId: 'CTRL-IR-003',
        itemId: 'provider-incident-response-exercise-program-documented',
      },
    ],
    description:
      'Conduct or document an incident response tabletop exercise and retain the results.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'incident-response-drill-completed',
    statementText:
      'I conducted or reviewed an incident response tabletop exercise and the results are retained.',
    taskType: 'attestation',
    templateKey: 'annual:attest:incident-response-drill',
    title: 'Incident response exercise completed',
  },
  {
    allowException: false,
    controlLinks: [
      {
        internalControlId: 'CTRL-CA-005',
        itemId: 'provider-poam-workflow-documented',
      },
    ],
    description:
      'Review all open follow-up actions, verify assignments and due dates are current, and attest the remediation backlog is actively managed.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'poam-review-current',
    statementText:
      'I reviewed all open follow-up actions and verified that remediation assignments and target dates are current.',
    taskType: 'attestation',
    templateKey: 'annual:attest:poam-review',
    title: 'Remediation backlog (POA&M) reviewed',
  },
  {
    allowException: false,
    controlLinks: [
      {
        internalControlId: 'CTRL-AT-002',
        itemId: 'provider-security-awareness-program-documented',
      },
    ],
    description:
      'Review the provider security-awareness training program and confirm it remains current.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'security-awareness-program-current',
    statementText:
      'I reviewed the provider security-awareness training program and it remains current.',
    taskType: 'attestation',
    templateKey: 'annual:attest:security-awareness-program',
    title: 'Security awareness training program reviewed',
  },
  {
    allowException: true,
    controlLinks: [
      { internalControlId: 'CTRL-IR-004', itemId: 'provider-incident-response-procedure' },
    ],
    description: 'Review the incident response procedure and attest that it remains current.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'incident-response-procedure-current',
    statementText:
      'I reviewed the incident response procedure and it remains current for the provider environment.',
    taskType: 'attestation',
    templateKey: 'annual:attest:incident-response-procedure',
    title: 'Incident response procedure reviewed',
  },
  {
    allowException: false,
    controlLinks: [{ internalControlId: 'CTRL-AU-006', itemId: 'provider-review-procedure' }],
    description:
      'Review the audit review procedure and attest that provider review cadence remains current.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'audit-review-procedure-current',
    statementText:
      'I reviewed the audit review procedure and it remains current for the provider environment.',
    taskType: 'attestation',
    templateKey: 'annual:attest:audit-review-procedure',
    title: 'Audit review procedure reviewed',
  },
];
