import { describe, expect, it } from 'vitest';
import { parseStackOutputs } from '../../scripts/lib/aws-cloudformation';

describe('parseStackOutputs', () => {
  it('maps CloudFormation outputs to a flat object', () => {
    expect(
      parseStackOutputs([
        { OutputKey: 'StorageBrokerRuntimeUrl', OutputValue: 'https://broker.example.com' },
        { OutputKey: 'StorageBrokerAccessKeyId', OutputValue: 'AKIAEXAMPLE' },
      ]),
    ).toEqual({
      StorageBrokerAccessKeyId: 'AKIAEXAMPLE',
      StorageBrokerRuntimeUrl: 'https://broker.example.com',
    });
  });

  it('ignores incomplete output entries', () => {
    expect(
      parseStackOutputs([
        { OutputKey: 'AuditArchiveBucketName' },
        { OutputValue: 'arn:aws:kms:us-west-1:123:key/demo' },
        { OutputKey: 'AuditArchiveRoleArn', OutputValue: 'arn:aws:iam::123:role/demo' },
      ]),
    ).toEqual({
      AuditArchiveRoleArn: 'arn:aws:iam::123:role/demo',
    });
  });
});
