export const VENDOR_KEYS = [
  'openrouter',
  'resend',
  'sentry',
  'google_favicons',
  'google_workspace_oauth',
] as const;

export type VendorKey = (typeof VENDOR_KEYS)[number];

export type VendorDataClass =
  | 'account_metadata'
  | 'chat_metadata'
  | 'chat_prompt'
  | 'email_address'
  | 'email_content'
  | 'error_metadata'
  | 'external_search_terms'
  | 'operational_metrics'
  | 'public_web_metadata';

export type VendorBoundaryPolicy = {
  approvalEnvVar: string | null;
  approvedByDefault: boolean;
  allowedDataClasses: readonly VendorDataClass[];
  allowedEnvironments: readonly ('development' | 'production' | 'test')[];
  displayName: string;
};

const VENDOR_BOUNDARY_REGISTRY: Record<VendorKey, VendorBoundaryPolicy> = {
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
  google_favicons: {
    approvalEnvVar: 'ENABLE_GOOGLE_FAVICON_EGRESS',
    approvedByDefault: false,
    allowedDataClasses: ['public_web_metadata'],
    allowedEnvironments: ['development', 'production', 'test'],
    displayName: 'Google Favicon Service',
  },
  google_workspace_oauth: {
    approvalEnvVar: null,
    approvedByDefault: false,
    allowedDataClasses: ['account_metadata'],
    allowedEnvironments: ['development', 'production', 'test'],
    displayName: 'Google Workspace OAuth / JWKS',
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
  appDeploymentEnv?: string | undefined,
): 'development' | 'production' | 'test' {
  // APP_DEPLOYMENT_ENV takes precedence for finer-grained control,
  // so preview/staging deployments running NODE_ENV=production can
  // still resolve to 'development' instead of 'production'.
  if (appDeploymentEnv) {
    const normalized = appDeploymentEnv.trim().toLowerCase();
    if (normalized === 'production') return 'production';
    if (normalized === 'test') return 'test';
    // preview, staging, development all map to development
    return 'development';
  }

  return normalizeEnvironment(nodeEnv);
}

function isTruthyConfigFlag(value: string | undefined) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isKnownVendorKey(vendor: string): vendor is VendorKey {
  return (VENDOR_KEYS as readonly string[]).includes(vendor);
}

export function getVendorBoundaryPolicy(vendor: VendorKey) {
  // Runtime defense-in-depth: reject unknown vendor keys even though
  // TypeScript constrains VendorKey at compile time. This guards against
  // dynamic strings or `as VendorKey` casts that bypass the type system.
  if (!isKnownVendorKey(vendor)) {
    throw new Error(
      `Unknown vendor key "${String(vendor)}". All outbound vendor integrations must be registered in VENDOR_BOUNDARY_REGISTRY.`,
    );
  }

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
