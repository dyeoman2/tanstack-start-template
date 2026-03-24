export type ControlSupport = 'missing' | 'partial' | 'complete';
export type ControlResponsibility = 'customer' | 'platform' | 'shared-responsibility';

export type SecurityWorkspaceControlSummary = {
  bySupport: {
    missing: number;
    partial: number;
    complete: number;
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
    bySupport: {
      missing: 0,
      partial: 0,
      complete: 0,
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
    support: ControlSupport;
    responsibility: ControlResponsibility | null;
  },
) {
  summary.totalControls += 1;
  summary.bySupport[input.support] += 1;
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
