import {
  VENDOR_KEYS,
  getVendorBoundaryPolicy,
  isVendorApproved,
  resolveVendorEnvironment,
  type VendorDataClass,
  type VendorKey,
} from '../shared/vendor-boundary';

export type { VendorDataClass, VendorKey } from '../shared/vendor-boundary';
export { getVendorBoundaryPolicy } from '../shared/vendor-boundary';

export type VendorBoundaryViolation = 'approval' | 'data_class' | 'environment';

export type VendorAuditContext = Record<string, boolean | number | string | null>;

export type VendorBoundaryDecision = {
  allowedDataClasses: readonly VendorDataClass[];
  allowedEnvironments: readonly ('development' | 'production' | 'test')[];
  approvalEnvVar: string | null;
  approvedByDefault: boolean;
  dataClasses: readonly VendorDataClass[];
  displayName: string;
  environment: 'development' | 'production' | 'test';
  vendor: VendorKey;
};

export class VendorBoundaryError extends Error {
  constructor(
    public readonly vendor: VendorKey,
    public readonly violation: VendorBoundaryViolation,
    public readonly violatedValues: readonly string[],
    message: string,
  ) {
    super(message);
    this.name = 'VendorBoundaryError';
  }
}

function getConfiguredVendorValue(vendor: VendorKey) {
  switch (vendor) {
    case 'openrouter':
      return process.env.OPENROUTER_API_KEY;
    case 'resend':
      return process.env.RESEND_API_KEY;
    case 'sentry':
      return process.env.ENABLE_SENTRY_EGRESS;
    case 'google_favicons':
      return process.env.ENABLE_GOOGLE_FAVICON_EGRESS;
    case 'google_workspace_oauth': {
      const clientId = process.env.GOOGLE_CLIENT_ID ?? process.env.BETTER_AUTH_GOOGLE_CLIENT_ID;
      const clientSecret =
        process.env.GOOGLE_CLIENT_SECRET ?? process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET;
      return clientId && clientSecret ? 'true' : undefined;
    }
  }
}

function getVendorApprovalRequirement(vendor: VendorKey, approvalEnvVar: string | null) {
  if (approvalEnvVar) {
    return {
      requirementKey: approvalEnvVar,
      requirementLabel: `${approvalEnvVar} is enabled`,
    };
  }

  return {
    requirementKey: `${vendor}:configuration`,
    requirementLabel: 'required configuration is present',
  };
}

export function getVendorBoundarySnapshot() {
  const environment = resolveVendorEnvironment(
    process.env.NODE_ENV,
    process.env.APP_DEPLOYMENT_ENV,
  );

  return VENDOR_KEYS.map((vendor) => {
    const policy = getVendorBoundaryPolicy(vendor);
    const approved = isVendorApproved({
      vendor,
      environment,
      envValue: policy.approvalEnvVar
        ? process.env[policy.approvalEnvVar]
        : getConfiguredVendorValue(vendor),
    });

    return {
      vendor,
      displayName: policy.displayName,
      approved,
      approvedByDefault: policy.approvedByDefault,
      approvalEnvVar: policy.approvalEnvVar,
      allowedDataClasses: [...policy.allowedDataClasses],
      allowedEnvironments: [...policy.allowedEnvironments],
    };
  });
}

export function resolveVendorBoundaryDecision(args: {
  dataClasses: VendorDataClass[];
  vendor: VendorKey;
}): VendorBoundaryDecision {
  const environment = resolveVendorEnvironment(
    process.env.NODE_ENV,
    process.env.APP_DEPLOYMENT_ENV,
  );
  const policy = getVendorBoundaryPolicy(args.vendor);
  const configuredValue = getConfiguredVendorValue(args.vendor);
  const approved = isVendorApproved({
    vendor: args.vendor,
    environment,
    envValue: policy.approvalEnvVar ? process.env[policy.approvalEnvVar] : configuredValue,
  });

  if (!approved) {
    const approvalRequirement = getVendorApprovalRequirement(args.vendor, policy.approvalEnvVar);
    throw new VendorBoundaryError(
      args.vendor,
      'approval',
      [approvalRequirement.requirementKey],
      `${policy.displayName} outbound access is blocked until ${approvalRequirement.requirementLabel}.`,
    );
  }

  const normalizedDataClasses = [...new Set(args.dataClasses)] as VendorDataClass[];
  const unsupportedDataClasses = normalizedDataClasses.filter(
    (dataClass) => !(policy.allowedDataClasses as readonly VendorDataClass[]).includes(dataClass),
  );
  if (unsupportedDataClasses.length > 0) {
    throw new VendorBoundaryError(
      args.vendor,
      'data_class',
      unsupportedDataClasses,
      `${policy.displayName} does not allow outbound transmission for: ${unsupportedDataClasses.join(', ')}`,
    );
  }

  if (
    !(policy.allowedEnvironments as readonly ('development' | 'production' | 'test')[]).includes(
      environment,
    )
  ) {
    throw new VendorBoundaryError(
      args.vendor,
      'environment',
      [environment],
      `${policy.displayName} outbound access is not allowed in ${environment}.`,
    );
  }

  return {
    vendor: args.vendor,
    displayName: policy.displayName,
    approvalEnvVar: policy.approvalEnvVar,
    approvedByDefault: policy.approvedByDefault,
    environment,
    dataClasses: normalizedDataClasses,
    allowedDataClasses: [...policy.allowedDataClasses],
    allowedEnvironments: [...policy.allowedEnvironments],
  };
}

export function assertVendorBoundary(args: { dataClasses: VendorDataClass[]; vendor: VendorKey }) {
  return getVendorBoundaryPolicy(resolveVendorBoundaryDecision(args).vendor);
}

export function buildVendorAuditMetadata(args: {
  context?: VendorAuditContext;
  decision: Pick<VendorBoundaryDecision, 'dataClasses' | 'vendor'>;
  operation: string;
  sourceSurface: string;
}) {
  return JSON.stringify({
    vendor: args.decision.vendor,
    operation: args.operation,
    dataClasses: args.decision.dataClasses,
    sourceSurface: args.sourceSurface,
    context: args.context ?? {},
  });
}
