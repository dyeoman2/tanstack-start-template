import { describe, expect, it } from 'vitest';
import {
  checkAwsCredentials,
  checkCdkBootstrap,
  checkConvexProdAccess,
  checkGitHubMutationReadiness,
  checkNetlifyMutationReadiness,
  checkSnsEmailSubscriptionConfirmed,
  parseSnsSubscriptionConfirmed,
} from './provider-preflight';

describe('provider preflight', () => {
  it('fails when AWS credentials are missing', () => {
    const result = checkAwsCredentials({
      region: 'us-west-1',
      runner: () => ({ ok: false, stderr: 'no auth', stdout: '' }),
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('AWS credentials are unavailable');
  });

  it('fails when CDK bootstrap is missing', () => {
    const result = checkCdkBootstrap({
      region: 'us-west-1',
      runner: () => ({ ok: false, stderr: 'missing', stdout: '' }),
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('CDK bootstrap stack');
  });

  it('fails when Convex production env access is missing', () => {
    const result = checkConvexProdAccess(() => {
      throw new Error('forbidden');
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('Convex production env access is unavailable');
  });

  it('fails when Netlify mutation is requested without auth', () => {
    const result = checkNetlifyMutationReadiness({
      runStatus: () => ({ exitCode: 1, ok: false, stderr: '', stdout: '' }),
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('Netlify CLI is not authenticated');
  });

  it('fails when GitHub mutation is requested without auth', () => {
    let calls = 0;
    const result = checkGitHubMutationReadiness(() => {
      calls += 1;
      return calls === 1
        ? { ok: true, stderr: '', stdout: 'origin' }
        : { ok: false, stderr: 'auth missing', stdout: '' };
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('GitHub CLI is not authenticated');
  });

  it('parses confirmed SNS subscriptions', () => {
    expect(
      parseSnsSubscriptionConfirmed(
        JSON.stringify({
          Subscriptions: [
            {
              Endpoint: 'ops@example.com',
              SubscriptionArn: 'arn:aws:sns:us-west-1:123:topic:abc',
            },
          ],
        }),
        'ops@example.com',
      ),
    ).toBe(true);
  });

  it('treats pending SNS subscriptions as unconfirmed', () => {
    const result = checkSnsEmailSubscriptionConfirmed({
      emailAddress: 'ops@example.com',
      region: 'us-west-1',
      runner: () => ({
        ok: true,
        stderr: '',
        stdout: JSON.stringify({
          Subscriptions: [
            {
              Endpoint: 'ops@example.com',
              SubscriptionArn: 'PendingConfirmation',
            },
          ],
        }),
      }),
      topicArn: 'arn:aws:sns:us-west-1:123:alerts',
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('pending confirmation');
  });
});
