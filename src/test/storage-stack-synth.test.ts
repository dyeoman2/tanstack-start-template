import { describe, expect, it } from 'vitest';
import { synthesizeStorageStackTemplate } from '../../scripts/generate-storage-iam-report';

function getResourcesByType(
  template: {
    Resources?: Record<string, { Properties?: Record<string, unknown>; Type?: string }>;
  },
  type: string,
) {
  return Object.entries(template.Resources ?? {}).filter(([, resource]) => resource.Type === type);
}

function getInlinePolicyResourcesForRole(
  template: {
    Resources?: Record<string, { Properties?: Record<string, unknown>; Type?: string }>;
  },
  roleLogicalIdFragment: string,
) {
  return getResourcesByType(template, 'AWS::IAM::Policy').filter(([, resource]) =>
    JSON.stringify(resource.Properties?.Roles ?? []).includes(roleLogicalIdFragment),
  );
}

describe('storage stack synth', () => {
  it('trusts only the dedicated broker and private worker runtime roles for storage capabilities', () => {
    const { template } = synthesizeStorageStackTemplate({ stage: 'dev' });
    const roleMap = new Map(
      getResourcesByType(template, 'AWS::IAM::Role').map(([, resource]) => [
        String(resource.Properties?.RoleName ?? ''),
        resource,
      ]),
    );

    expect(
      roleMap.get('tanstack-start-template-dev-storage-broker-runtime')?.Properties
        ?.AssumeRolePolicyDocument,
    ).toMatchObject({
      Statement: [
        expect.objectContaining({
          Principal: {
            Service: 'lambda.amazonaws.com',
          },
        }),
      ],
    });
    expect(
      roleMap.get('tanstack-start-template-dev-storage-inspection-worker-runtime')?.Properties
        ?.AssumeRolePolicyDocument,
    ).toMatchObject({
      Statement: [
        expect.objectContaining({
          Principal: {
            Service: 'lambda.amazonaws.com',
          },
        }),
      ],
    });
    expect(
      roleMap.get('tanstack-start-template-dev-document-parse-worker-runtime')?.Properties
        ?.AssumeRolePolicyDocument,
    ).toMatchObject({
      Statement: [
        expect.objectContaining({
          Principal: {
            Service: 'lambda.amazonaws.com',
          },
        }),
      ],
    });

    for (const roleName of [
      'tanstack-start-template-dev-storage-upload-presign',
      'tanstack-start-template-dev-storage-download-presign',
      'tanstack-start-template-dev-storage-clean-put',
    ]) {
      expect(roleMap.get(roleName)?.Properties?.AssumeRolePolicyDocument).toMatchObject({
        Statement: [
          expect.objectContaining({
            Principal: {
              AWS: {
                'Fn::GetAtt': [expect.stringContaining('StorageBrokerRuntimeRole'), 'Arn'],
              },
            },
          }),
        ],
      });
    }

    for (const roleName of [
      'tanstack-start-template-dev-storage-promotion',
      'tanstack-start-template-dev-storage-rejection',
      'tanstack-start-template-dev-storage-cleanup',
      'tanstack-start-template-dev-storage-mirror',
    ]) {
      expect(roleMap.get(roleName)?.Properties?.AssumeRolePolicyDocument).toMatchObject({
        Statement: [
          expect.objectContaining({
            Principal: {
              AWS: {
                'Fn::GetAtt': [expect.stringContaining('StorageBrokerRuntimeRole'), 'Arn'],
              },
            },
          }),
        ],
      });
    }
  });

  it('removes the public worker Function URL and secures broker ingress behind API Gateway', () => {
    const { template } = synthesizeStorageStackTemplate({ stage: 'dev' });
    const functionUrls = getResourcesByType(template, 'AWS::Lambda::Url');
    const apis = getResourcesByType(template, 'AWS::ApiGateway::RestApi');
    const iamUsers = getResourcesByType(template, 'AWS::IAM::User');
    const accessKeys = getResourcesByType(template, 'AWS::IAM::AccessKey');
    const roleMap = new Map(
      getResourcesByType(template, 'AWS::IAM::Role').map(([, resource]) => [
        String(resource.Properties?.RoleName ?? ''),
        resource,
      ]),
    );
    const methodResources = getResourcesByType(template, 'AWS::ApiGateway::Method');

    expect(functionUrls).toHaveLength(0);
    expect(apis).toHaveLength(1);
    expect(iamUsers).toHaveLength(0);
    expect(accessKeys).toHaveLength(0);

    expect(
      roleMap.get('tanstack-start-template-dev-storage-broker-edge-invoke')?.Properties
        ?.AssumeRolePolicyDocument,
    ).toMatchObject({
      Statement: [
        expect.objectContaining({
          Principal: {
            AWS: {
              'Fn::GetAtt': [expect.stringContaining('StorageBrokerRuntimeRole'), 'Arn'],
            },
          },
        }),
      ],
    });
    expect(
      roleMap.get('tanstack-start-template-dev-storage-broker-control-invoke')?.Properties
        ?.AssumeRolePolicyDocument,
    ).toMatchObject({
      Statement: [
        expect.objectContaining({
          Principal: {
            AWS: {
              'Fn::GetAtt': [expect.stringContaining('StorageBrokerRuntimeRole'), 'Arn'],
            },
          },
        }),
      ],
    });

    const edgePolicies = getInlinePolicyResourcesForRole(template, 'StorageBrokerEdgeInvokeRole');
    expect(JSON.stringify(edgePolicies)).toContain('/internal/storage/upload-target');
    expect(JSON.stringify(edgePolicies)).not.toContain('/internal/storage/promote');

    const sessionMethods = methodResources.filter(
      ([, resource]) => resource.Properties?.AuthorizationType === 'NONE',
    );
    const iamMethods = methodResources.filter(
      ([, resource]) => resource.Properties?.AuthorizationType === 'AWS_IAM',
    );
    expect(sessionMethods).toHaveLength(2);
    expect(iamMethods.length).toBeGreaterThanOrEqual(13);
  });

  it('includes SNS email alerting and quarantine stuck alarms in production', () => {
    const { template } = synthesizeStorageStackTemplate({
      envOverrides: {
        AWS_STORAGE_ALERT_EMAIL: 'alerts@example.com',
      },
      stage: 'prod',
    });

    const topics = getResourcesByType(template, 'AWS::SNS::Topic');
    const subscriptions = getResourcesByType(template, 'AWS::SNS::Subscription');
    const alarms = getResourcesByType(template, 'AWS::CloudWatch::Alarm');
    const rules = getResourcesByType(template, 'AWS::Events::Rule');
    const monitorLambdas = getResourcesByType(template, 'AWS::Lambda::Function').filter(
      ([, resource]) => resource.Properties?.Handler === 'quarantine-stuck-monitor.handler',
    );

    expect(topics).toHaveLength(1);
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.[1].Properties).toMatchObject({
      Endpoint: 'alerts@example.com',
      Protocol: 'email',
    });
    expect(monitorLambdas).toHaveLength(1);
    expect(
      rules.some(([, resource]) =>
        String(resource.Properties?.ScheduleExpression).includes('rate(15 minutes)'),
      ),
    ).toBe(true);
    expect(
      alarms.some(
        ([, resource]) =>
          resource.Properties?.AlarmDescription === 'GuardDuty forwarder Lambda has errors.',
      ),
    ).toBe(true);
    expect(
      alarms.some(
        ([, resource]) =>
          resource.Properties?.AlarmDescription ===
          'Ingress inspector forwarder Lambda has errors.',
      ),
    ).toBe(true);
    expect(
      alarms.some(
        ([, resource]) =>
          resource.Properties?.AlarmDescription ===
          'One or more objects have been stuck in quarantine for over 30 minutes.',
      ),
    ).toBe(true);
    expect(
      alarms
        .filter(([, resource]) =>
          [
            'GuardDuty forwarder Lambda has errors.',
            'Ingress inspector forwarder Lambda has errors.',
            'Quarantine stuck monitor Lambda has errors.',
            'One or more objects have been stuck in quarantine for over 30 minutes.',
          ].includes(String(resource.Properties?.AlarmDescription ?? '')),
        )
        .every(([, resource]) => Array.isArray(resource.Properties?.AlarmActions)),
    ).toBe(true);
  });
});
