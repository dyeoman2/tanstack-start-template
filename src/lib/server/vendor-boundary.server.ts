import {
  getVendorBoundaryPolicy,
  isVendorApproved,
  resolveVendorEnvironment,
  type VendorDataClass,
  type VendorKey,
} from '../shared/vendor-boundary';

export class VendorBoundaryError extends Error {
  constructor(
    public readonly vendor: VendorKey,
    message: string,
  ) {
    super(message);
    this.name = 'VendorBoundaryError';
  }
}

export function getVendorBoundarySnapshot() {
  const environment = resolveVendorEnvironment(process.env.NODE_ENV);

  return Object.entries({
    openrouter: process.env.OPENROUTER_API_KEY,
    resend: process.env.RESEND_API_KEY,
    sentry: process.env.ENABLE_SENTRY_EGRESS,
  }).map(([vendor, configuredValue]) => {
    const policy = getVendorBoundaryPolicy(vendor as VendorKey);
    const approved = isVendorApproved({
      vendor: vendor as VendorKey,
      environment,
      envValue: policy.approvalEnvVar ? process.env[policy.approvalEnvVar] : configuredValue,
    });

    return {
      vendor: vendor as VendorKey,
      displayName: policy.displayName,
      approved,
      approvedByDefault: policy.approvedByDefault,
      approvalEnvVar: policy.approvalEnvVar,
      allowedDataClasses: [...policy.allowedDataClasses],
      allowedEnvironments: [...policy.allowedEnvironments],
    };
  });
}

export function assertVendorBoundary(args: { dataClasses: VendorDataClass[]; vendor: VendorKey }) {
  const environment = resolveVendorEnvironment(process.env.NODE_ENV);
  const policy = getVendorBoundaryPolicy(args.vendor);
  const approved = isVendorApproved({
    vendor: args.vendor,
    environment,
    envValue: policy.approvalEnvVar ? process.env[policy.approvalEnvVar] : undefined,
  });

  if (!approved) {
    throw new VendorBoundaryError(
      args.vendor,
      `${policy.displayName} outbound access is blocked until ${policy.approvalEnvVar ?? 'an approval flag'} is enabled.`,
    );
  }

  const unsupportedDataClasses = args.dataClasses.filter(
    (dataClass) => !(policy.allowedDataClasses as readonly VendorDataClass[]).includes(dataClass),
  );
  if (unsupportedDataClasses.length > 0) {
    throw new VendorBoundaryError(
      args.vendor,
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
      `${policy.displayName} outbound access is not allowed in ${environment}.`,
    );
  }

  return policy;
}
