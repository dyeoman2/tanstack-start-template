// @ts-nocheck
const { randomBytes } = require('node:crypto');
const cdk = require('aws-cdk-lib');
const acm = require('aws-cdk-lib/aws-certificatemanager');
const ec2 = require('aws-cdk-lib/aws-ec2');
const ecs = require('aws-cdk-lib/aws-ecs');
const elbv2 = require('aws-cdk-lib/aws-elasticloadbalancingv2');
const logs = require('aws-cdk-lib/aws-logs');
const rds = require('aws-cdk-lib/aws-rds');
const secretsmanager = require('aws-cdk-lib/aws-secretsmanager');
const wafv2 = require('aws-cdk-lib/aws-wafv2');

/**
 * @typedef {{
 *   auroraMaxAcu?: number;
 *   auroraMinAcu?: number;
 *   backendSubdomain?: string;
 *   certificateArn?: string;
 *   convexImage?: string;
 *   cpu?: number;
 *   domain?: string;
 *   env?: import('aws-cdk-lib').Environment;
 *   enableExecuteCommand?: boolean;
 *   frontendSubdomain?: string;
 *   hostnameStrategy?: 'custom-domain' | 'provider-hostnames';
 *   instanceSecretHex?: string;
 *   memoryMiB?: number;
 *   projectSlug?: string;
 *   rdsCaBundlePath?: string;
 *   siteSubdomain?: string;
 *   enableWaf?: boolean;
 * }} DrEcsStackProps
 */

class DrEcsStack extends cdk.Stack {
  /**
   * @param {import('constructs').Construct} scope
   * @param {string} id
   * @param {DrEcsStackProps & import('aws-cdk-lib').StackProps} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    const projectSlug = props.projectSlug ?? 'tanstack-start-template';
    const resourcePrefix = `${projectSlug}-dr`;
    const hostnameStrategy = props.hostnameStrategy ?? 'custom-domain';
    const backendSubdomain = props.backendSubdomain ?? 'dr-backend';
    const siteSubdomain = props.siteSubdomain ?? 'dr-site';
    const frontendSubdomain = props.frontendSubdomain ?? 'dr';
    const backendFqdn = props.domain ? `${backendSubdomain}.${props.domain}` : '';
    const siteFqdn = props.domain ? `${siteSubdomain}.${props.domain}` : '';
    const frontendFqdn = props.domain ? `${frontendSubdomain}.${props.domain}` : '';
    const convexImage = props.convexImage ?? 'ghcr.io/get-convex/convex-backend:latest';
    const instanceName = 'postgres';
    const enableExecuteCommand = props.enableExecuteCommand ?? false;
    const certificateArn = props.certificateArn;
    const rdsCaBundlePath = props.rdsCaBundlePath ?? '/etc/ssl/certs/rds/global-bundle.pem';

    if (!certificateArn) {
      throw new Error('DrEcsStack requires certificateArn for HTTPS listeners.');
    }

    if (hostnameStrategy !== 'custom-domain') {
      throw new Error(
        'DrEcsStack requires hostnameStrategy="custom-domain" for hardened deployments.',
      );
    }

    if (!props.domain) {
      throw new Error('DrEcsStack requires domain for hardened custom-domain deployments.');
    }

    const vpc = new ec2.Vpc(this, 'DrVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: 'private-app',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          name: 'private-db',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      description: 'DR Aurora Serverless v2',
      vpc,
    });

    const serviceSg = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      description: 'DR Convex Fargate service',
      vpc,
    });

    dbSecurityGroup.addIngressRule(serviceSg, ec2.Port.tcp(5432), 'Allow Fargate to Aurora');

    const dbCredentials = new secretsmanager.Secret(this, 'DbCredentials', {
      secretName: `${resourcePrefix}-aurora-credentials-secret`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'convex_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    const instanceSecretHex = props.instanceSecretHex ?? randomBytes(32).toString('hex');
    const instanceSecret = new secretsmanager.Secret(this, 'InstanceSecret', {
      secretName: `${resourcePrefix}-convex-instance-secret`,
      secretStringValue: cdk.SecretValue.unsafePlainText(instanceSecretHex),
    });

    const parameterGroup = new rds.ParameterGroup(this, 'AuroraParams', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_17_6,
      }),
      parameters: {
        'rds.force_ssl': '1',
      },
    });

    const dbCluster = new rds.DatabaseCluster(this, 'DrAuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_17_6,
      }),
      serverlessV2MinCapacity: props.auroraMinAcu ?? 0.5,
      serverlessV2MaxCapacity: props.auroraMaxAcu ?? 4,
      writer: rds.ClusterInstance.serverlessV2('Writer'),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      credentials: rds.Credentials.fromSecret(dbCredentials),
      parameterGroup,
      securityGroups: [dbSecurityGroup],
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      storageEncrypted: true,
      backup: { retention: cdk.Duration.days(7) },
      cloudwatchLogsExports: ['postgresql'],
    });

    const cluster = new ecs.Cluster(this, 'DrEcsCluster', { vpc });
    const taskDef = new ecs.FargateTaskDefinition(this, 'ConvexTaskDef', {
      cpu: props.cpu ?? 2048,
      memoryLimitMiB: props.memoryMiB ?? 4096,
    });

    const logGroup = new logs.LogGroup(this, 'ConvexLogs', {
      logGroupName: `/ecs/${id}/convex-backend`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const caFilePath = rdsCaBundlePath;
    const container = taskDef.addContainer('convex-backend', {
      image: ecs.ContainerImage.fromRegistry(convexImage),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'convex' }),
      entryPoint: ['/bin/sh', '-c'],
      command: [
        [
          'export POSTGRES_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}"',
          'exec ./run_backend.sh',
        ].join(' && '),
      ],
      environment: {
        CONVEX_CLOUD_ORIGIN:
          hostnameStrategy === 'provider-hostnames' ? '' : `https://${backendFqdn}`,
        CONVEX_SITE_ORIGIN: hostnameStrategy === 'provider-hostnames' ? '' : `https://${siteFqdn}`,
        INSTANCE_NAME: instanceName,
        PG_CA_FILE: caFilePath,
        POSTGRES_HOST: dbCluster.clusterEndpoint.hostname,
        POSTGRES_PORT: '5432',
      },
      secrets: {
        INSTANCE_SECRET: ecs.Secret.fromSecretsManager(instanceSecret),
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, 'password'),
        POSTGRES_USER: ecs.Secret.fromSecretsManager(dbCredentials, 'username'),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'curl -sf http://localhost:3210/version || exit 1'],
        interval: cdk.Duration.seconds(15),
        timeout: cdk.Duration.seconds(5),
        retries: 2,
        startPeriod: cdk.Duration.seconds(15),
      },
    });

    container.addPortMappings(
      { containerPort: 3210, protocol: ecs.Protocol.TCP },
      { containerPort: 3211, protocol: ecs.Protocol.TCP },
    );

    const alb = new elbv2.ApplicationLoadBalancer(this, 'DrAlb', {
      internetFacing: true,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'DrAlbCertificate',
      certificateArn,
    );
    const redirectHttpListener = alb.addListener('HttpRedirect', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.redirect({
        permanent: true,
        port: '443',
        protocol: 'HTTPS',
      }),
    });
    const httpsListener = alb.addListener('Https', {
      certificates: [certificate],
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
    });

    const service = new ecs.FargateService(this, 'ConvexService', {
      cluster,
      taskDefinition: taskDef,
      assignPublicIp: false,
      desiredCount: 1,
      minHealthyPercent: 0,
      securityGroups: [serviceSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      enableExecuteCommand,
    });

    httpsListener.addTargets('ConvexBackend', {
      port: 3210,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [
        service.loadBalancerTarget({
          containerName: container.containerName,
          containerPort: 3210,
        }),
      ],
      healthCheck: {
        path: '/version',
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    httpsListener.addTargets('ConvexSite', {
      port: 3211,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [
        service.loadBalancerTarget({
          containerName: container.containerName,
          containerPort: 3211,
        }),
      ],
      conditions: [elbv2.ListenerCondition.hostHeaders([siteFqdn])],
      priority: 10,
      healthCheck: {
        path: '/',
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
        healthyHttpCodes: '200-499',
      },
    });

    // -----------------------------------------------------------------------
    // WAF: AWS Managed Rules + IP rate limiting for the DR ALB.
    // Enabled by default — set enableWaf: false to skip for cost savings
    // during non-production DR testing.
    // -----------------------------------------------------------------------
    const enableWaf = props.enableWaf ?? true;
    if (enableWaf) {
      const webAcl = new wafv2.CfnWebACL(this, 'DrWafWebAcl', {
        defaultAction: { allow: {} },
        scope: 'REGIONAL',
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${resourcePrefix}-waf`,
          sampledRequestsEnabled: true,
        },
        rules: [
          {
            name: 'AWSManagedRulesCommonRuleSet',
            priority: 10,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesCommonRuleSet',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${resourcePrefix}-waf-common`,
              sampledRequestsEnabled: true,
            },
          },
          {
            name: 'AWSManagedRulesKnownBadInputsRuleSet',
            priority: 20,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesKnownBadInputsRuleSet',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${resourcePrefix}-waf-bad-inputs`,
              sampledRequestsEnabled: true,
            },
          },
          {
            name: 'AWSManagedRulesSQLiRuleSet',
            priority: 30,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesSQLiRuleSet',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${resourcePrefix}-waf-sqli`,
              sampledRequestsEnabled: true,
            },
          },
          {
            name: 'RateLimitPerIP',
            priority: 40,
            action: { block: {} },
            statement: {
              rateBasedStatement: {
                limit: 2000,
                aggregateKeyType: 'IP',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${resourcePrefix}-waf-rate-limit`,
              sampledRequestsEnabled: true,
            },
          },
        ],
      });

      new wafv2.CfnWebACLAssociation(this, 'DrWafAlbAssociation', {
        resourceArn: alb.loadBalancerArn,
        webAclArn: webAcl.attrArn,
      });

      new cdk.CfnOutput(this, 'WafWebAclArn', {
        value: webAcl.attrArn,
      });
    }

    const backendUrl = `https://${backendFqdn}`;
    const siteUrl = `https://${siteFqdn}`;
    const frontendUrl = `https://${frontendFqdn}`;

    new cdk.CfnOutput(this, 'AuroraEndpoint', {
      value: dbCluster.clusterEndpoint.hostname,
    });
    new cdk.CfnOutput(this, 'AuroraSecretArn', {
      value: dbCluster.secret.secretArn,
    });
    new cdk.CfnOutput(this, 'InstanceSecretArn', {
      value: instanceSecret.secretArn,
    });
    new cdk.CfnOutput(this, 'ConvexBackendUrl', {
      value: backendUrl,
    });
    new cdk.CfnOutput(this, 'ConvexSiteUrl', {
      value: siteUrl,
    });
    new cdk.CfnOutput(this, 'DrFrontendUrl', {
      value: frontendUrl,
    });
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
    });
    new cdk.CfnOutput(this, 'HttpRedirectListenerArn', {
      value: redirectHttpListener.listenerArn,
    });
    new cdk.CfnOutput(this, 'HttpsListenerArn', {
      value: httpsListener.listenerArn,
    });
    new cdk.CfnOutput(this, 'EcsClusterName', {
      value: cluster.clusterName,
    });
    new cdk.CfnOutput(this, 'EcsServiceName', {
      value: service.serviceName,
    });
  }
}

module.exports = {
  DrEcsStack,
};
