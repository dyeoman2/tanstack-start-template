// @ts-nocheck
const { randomBytes } = require('node:crypto');
const cdk = require('aws-cdk-lib');
const ec2 = require('aws-cdk-lib/aws-ec2');
const ecs = require('aws-cdk-lib/aws-ecs');
const elbv2 = require('aws-cdk-lib/aws-elasticloadbalancingv2');
const logs = require('aws-cdk-lib/aws-logs');
const rds = require('aws-cdk-lib/aws-rds');
const secretsmanager = require('aws-cdk-lib/aws-secretsmanager');

/**
 * @typedef {{
 *   auroraMaxAcu?: number;
 *   auroraMinAcu?: number;
 *   backendSubdomain?: string;
 *   convexImage?: string;
 *   cpu?: number;
 *   domain: string;
 *   env?: import('aws-cdk-lib').Environment;
 *   frontendSubdomain?: string;
 *   instanceSecretHex?: string;
 *   memoryMiB?: number;
 *   projectSlug?: string;
 *   siteSubdomain?: string;
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
    const backendSubdomain = props.backendSubdomain ?? 'dr-backend';
    const siteSubdomain = props.siteSubdomain ?? 'dr-site';
    const frontendSubdomain = props.frontendSubdomain ?? 'dr';
    const backendFqdn = `${backendSubdomain}.${props.domain}`;
    const siteFqdn = `${siteSubdomain}.${props.domain}`;
    const frontendFqdn = `${frontendSubdomain}.${props.domain}`;
    const convexImage = props.convexImage ?? 'ghcr.io/get-convex/convex-backend:latest';
    const instanceName = 'postgres';

    const vpc = new ec2.Vpc(this, 'DrVpc', {
      maxAzs: 2,
      natGateways: 0,
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
      secretName: `${projectSlug}/dr/aurora-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'convex_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    const instanceSecretHex = props.instanceSecretHex ?? randomBytes(32).toString('hex');
    const instanceSecret = new secretsmanager.Secret(this, 'InstanceSecret', {
      secretName: `${projectSlug}/dr/convex-instance-secret`,
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
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      credentials: rds.Credentials.fromSecret(dbCredentials),
      parameterGroup,
      securityGroups: [dbSecurityGroup],
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      storageEncrypted: true,
      backup: { retention: cdk.Duration.days(7) },
      cloudwatchLogsExports: ['postgresql'],
    });

    const databaseUrl = cdk.Fn.join('', [
      'postgresql://convex_admin:',
      dbCredentials.secretValueFromJson('password').unsafeUnwrap(),
      '@',
      dbCluster.clusterEndpoint.hostname,
      ':5432',
    ]);

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

    const caFilePath = '/tmp/rds-combined-ca-bundle.pem';
    const container = taskDef.addContainer('convex-backend', {
      image: ecs.ContainerImage.fromRegistry(convexImage),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'convex' }),
      entryPoint: ['/bin/sh', '-c'],
      command: [
        [
          `curl -sf -o ${caFilePath} https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`,
          'exec ./run_backend.sh',
        ].join(' && '),
      ],
      environment: {
        CONVEX_CLOUD_ORIGIN: `https://${backendFqdn}`,
        CONVEX_SITE_ORIGIN: `https://${siteFqdn}`,
        INSTANCE_NAME: instanceName,
        INSTANCE_SECRET: instanceSecret.secretValue.unsafeUnwrap(),
        PG_CA_FILE: caFilePath,
        POSTGRES_URL: databaseUrl,
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

    const httpListener = alb.addListener('Http', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    const service = new ecs.FargateService(this, 'ConvexService', {
      cluster,
      taskDefinition: taskDef,
      assignPublicIp: true,
      desiredCount: 1,
      minHealthyPercent: 0,
      securityGroups: [serviceSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      enableExecuteCommand: true,
    });

    httpListener.addTargets('ConvexBackend', {
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

    httpListener.addTargets('ConvexSite', {
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
      value: `https://${backendFqdn}`,
    });
    new cdk.CfnOutput(this, 'ConvexSiteUrl', {
      value: `https://${siteFqdn}`,
    });
    new cdk.CfnOutput(this, 'DrFrontendUrl', {
      value: `https://${frontendFqdn}`,
    });
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
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
