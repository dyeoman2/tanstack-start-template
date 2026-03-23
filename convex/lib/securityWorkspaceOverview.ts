export type ControlEvidenceReadiness = 'missing' | 'partial' | 'ready';
export type ControlResponsibility = 'customer' | 'platform' | 'shared-responsibility';

export type SecurityWorkspaceControlSummary = {
  byEvidence: {
    missing: number;
    partial: number;
    ready: number;
  };
  byResponsibility: {
    customer: number;
    platform: number;
    sharedResponsibility: number;
  };
  totalControls: number;
};

export function createEmptySecurityWorkspaceControlSummary(): SecurityWorkspaceControlSummary {
  return {
    byEvidence: {
      missing: 0,
      partial: 0,
      ready: 0,
    },
    byResponsibility: {
      customer: 0,
      platform: 0,
      sharedResponsibility: 0,
    },
    totalControls: 0,
  };
}

export function addControlToSecurityWorkspaceSummary(
  summary: SecurityWorkspaceControlSummary,
  input: {
    evidenceReadiness: ControlEvidenceReadiness;
    responsibility: ControlResponsibility | null;
  },
) {
  summary.totalControls += 1;
  summary.byEvidence[input.evidenceReadiness] += 1;
  if (input.responsibility === null) {
    return summary;
  }
  if (input.responsibility === 'shared-responsibility') {
    summary.byResponsibility.sharedResponsibility += 1;
  } else {
    summary.byResponsibility[input.responsibility] += 1;
  }
  return summary;
}
