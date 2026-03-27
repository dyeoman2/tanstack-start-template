import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildVendorAuditMetadata,
  getVendorBoundarySnapshot,
  resolveVendorBoundaryDecision,
  VendorBoundaryError,
} from './vendor-boundary.server';

const ORIGINAL_ENV = { ...process.env };

describe('vendor-boundary.server', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      APP_DEPLOYMENT_ENV: 'production',
      NODE_ENV: 'production',
    };
    delete process.env.ENABLE_GOOGLE_FAVICON_EGRESS;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.BETTER_AUTH_GOOGLE_CLIENT_ID;
    delete process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('includes google_favicons in the runtime snapshot and keeps it disabled by default', () => {
    expect(getVendorBoundarySnapshot()).toContainEqual(
      expect.objectContaining({
        allowedDataClasses: ['public_web_metadata'],
        approvalEnvVar: 'ENABLE_GOOGLE_FAVICON_EGRESS',
        approved: false,
        approvedByDefault: false,
        vendor: 'google_favicons',
      }),
    );
  });

  it('includes google_workspace_oauth in the runtime snapshot and blocks it until credentials exist', () => {
    expect(getVendorBoundarySnapshot()).toContainEqual(
      expect.objectContaining({
        allowedDataClasses: ['account_metadata'],
        approvalEnvVar: null,
        approved: false,
        approvedByDefault: false,
        vendor: 'google_workspace_oauth',
      }),
    );
  });

  it('requires explicit approval before allowing favicon egress', () => {
    expect(() =>
      resolveVendorBoundaryDecision({
        vendor: 'google_favicons',
        dataClasses: ['public_web_metadata'],
      }),
    ).toThrow(VendorBoundaryError);

    process.env.ENABLE_GOOGLE_FAVICON_EGRESS = 'true';

    expect(
      resolveVendorBoundaryDecision({
        vendor: 'google_favicons',
        dataClasses: ['public_web_metadata'],
      }),
    ).toMatchObject({
      dataClasses: ['public_web_metadata'],
      vendor: 'google_favicons',
    });
  });

  it('requires configured Google OAuth credentials before allowing hosted-domain verification', () => {
    expect(() =>
      resolveVendorBoundaryDecision({
        vendor: 'google_workspace_oauth',
        dataClasses: ['account_metadata'],
      }),
    ).toThrow(VendorBoundaryError);

    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';

    expect(
      resolveVendorBoundaryDecision({
        vendor: 'google_workspace_oauth',
        dataClasses: ['account_metadata'],
      }),
    ).toMatchObject({
      dataClasses: ['account_metadata'],
      vendor: 'google_workspace_oauth',
    });
  });

  it('builds generic vendor audit metadata', () => {
    const decision = resolveVendorBoundaryDecision({
      vendor: 'openrouter',
      dataClasses: ['chat_metadata', 'chat_prompt'],
    });

    expect(
      JSON.parse(
        buildVendorAuditMetadata({
          context: {
            model: 'openai/gpt-5.4',
            runId: 'run-1',
          },
          decision,
          operation: 'chat_generation',
          sourceSurface: 'chat.run_generation',
        }),
      ),
    ).toEqual({
      context: {
        model: 'openai/gpt-5.4',
        runId: 'run-1',
      },
      dataClasses: ['chat_metadata', 'chat_prompt'],
      operation: 'chat_generation',
      sourceSurface: 'chat.run_generation',
      vendor: 'openrouter',
    });
  });
});
