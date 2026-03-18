export const VENDOR_KEYS = ['openrouter', 'resend', 'sentry'] as const;

export type VendorKey = (typeof VENDOR_KEYS)[number];

export type VendorDataClass =
  | 'account_metadata'
  | 'chat_metadata'
  | 'chat_prompt'
  | 'email_address'
  | 'email_content'
  | 'error_metadata'
  | 'external_search_terms'
  | 'operational_metrics';

export type VendorBoundaryPolicy = {
  approvalEnvVar: string | null;
  approvedByDefault: boolean;
  allowedDataClasses: readonly VendorDataClass[];
  allowedEnvironments: readonly ('development' | 'production' | 'test')[];
  displayName: string;
};

export const VENDOR_BOUNDARY_REGISTRY: Record<VendorKey, VendorBoundaryPolicy> = {
  openrouter: {
    approvalEnvVar: null,
    approvedByDefault: true,
    allowedDataClasses: ['chat_metadata', 'chat_prompt', 'external_search_terms'],
    allowedEnvironments: ['development', 'production', 'test'],
    displayName: 'OpenRouter',
  },
  resend: {
    approvalEnvVar: null,
    approvedByDefault: true,
    allowedDataClasses: ['account_metadata', 'email_address', 'email_content'],
    allowedEnvironments: ['development', 'production', 'test'],
    displayName: 'Resend',
  },
  sentry: {
    approvalEnvVar: 'ENABLE_SENTRY_EGRESS',
    approvedByDefault: false,
    allowedDataClasses: ['error_metadata', 'operational_metrics'],
    allowedEnvironments: ['development', 'production'],
    displayName: 'Sentry',
  },
};

function normalizeEnvironment(value: string | undefined): 'development' | 'production' | 'test' {
  if (value === 'production') {
    return 'production';
  }

  if (value === 'test') {
    return 'test';
  }

  return 'development';
}

export function resolveVendorEnvironment(
  nodeEnv: string | undefined,
): 'development' | 'production' | 'test' {
  return normalizeEnvironment(nodeEnv);
}

export function isTruthyConfigFlag(value: string | undefined) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function getVendorBoundaryPolicy(vendor: VendorKey) {
  return VENDOR_BOUNDARY_REGISTRY[vendor];
}

export function isVendorApproved(args: {
  environment: 'development' | 'production' | 'test';
  envValue?: string;
  vendor: VendorKey;
}) {
  const policy = getVendorBoundaryPolicy(args.vendor);
  if (
    !(policy.allowedEnvironments as readonly ('development' | 'production' | 'test')[]).includes(
      args.environment,
    )
  ) {
    return false;
  }

  if (policy.approvedByDefault) {
    return true;
  }

  return isTruthyConfigFlag(args.envValue);
}
