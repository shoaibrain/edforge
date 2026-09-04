import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import { HttpNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';
import { getHashCode } from '../utilities/helper-functions';
import { type ContainerInfo } from '../interfaces/container-info';
import { addTemplateTag } from '../utilities/helper-functions';
import { getServiceName, createTaskDefinition, getContainerDefinitionOptions } from '../utilities/ecs-utils';
import { IdentityDetails } from '../interfaces/identity-details';

export interface EcsServiceProps {
  tenantId: string
  tenantName: string
  isEc2Tier: boolean
  isRProxy: boolean
  isTarget: boolean
  vpc: ec2.IVpc
  cluster: ecs.ICluster
  ecsSG: ec2.SecurityGroup 
  taskRole?: iam.IRole 

  namespace: HttpNamespace
  info: ContainerInfo
  identityDetails: IdentityDetails
}

export class EcsService extends Construct {
  public readonly service: ecs.FargateService | ecs.Ec2Service;

  constructor (scope: Construct, id: string, props: EcsServiceProps) {
    super(scope, id);

    const albSGId = cdk.Fn.importValue('AlbSgId'); // ALB Security Group ID
    const albSG = ec2.SecurityGroup.fromSecurityGroupId(this, 'albSG', albSGId);  // ALB Security Group

    const listener = elbv2.ApplicationListener.fromApplicationListenerAttributes(this, 'ecs-sbt-listener',
      {
        listenerArn: cdk.Fn.importValue('ListenerArn'),
        securityGroup: albSG
      }
    );

    if(props.isRProxy == true && props.isTarget == true){
      props.ecsSG.connections.allowFrom(albSG, ec2.Port.tcp(props.info.containerPort), `ALB to RProxy interface`);
    } else {
      props.ecsSG.connections.allowFrom(props.ecsSG, ec2.Port.tcp(props.info.containerPort), `Add ${props.info.name} Port into backend Security Group`);
    }

    const taskExecutionRole = new iam.Role(this, `ecsTaskExecutionRole-${props.tenantId}`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      ]
    })

    const stack = cdk.Stack.of(scope);

    // Sprint 1 S1.12 — the identity service needs an explicit LogGroup
    // so we can attach a MetricFilter that counts
    // `iemis.audit.emit_failure` log lines. Every other service keeps
    // the auto-created LogGroup (ONE_WEEK retention) via the default
    // branch of `getContainerDefinitionOptions`.
    const identityLogGroup = props.info.name === 'identity'
      ? new logs.LogGroup(this, 'IdentityLogGroup', {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
        })
      : undefined;

    const containerDef = getContainerDefinitionOptions(stack, props.info, props.identityDetails, identityLogGroup);
    const taskDefinition = createTaskDefinition(stack, props.isEc2Tier, taskExecutionRole, props.taskRole, containerDef);
    taskDefinition.addContainer( `${props.info.name}-container`, containerDef);

    // Sprint 1 S1.12 — MetricFilter + Alarm on iemis.audit.emit_failure
    //
    // Fires on any log line containing the structured phrase
    // `iemis.audit.emit_failure` emitted by IemisAuditLogger (S1.9)
    // when a DDB putItem on an audit event fails. The alarm signals
    // that audit events are being DROPPED — compliance-critical.
    //
    // SNS action: optional, wired only when `CDK_PARAM_OPERATOR_TOPIC_ARN`
    // is set. Keeps this tenant-template stack self-contained (no
    // cross-stack import of analytics-stack's operator topic); the
    // operator deploy process sets the env var before synth.
    if (identityLogGroup) {
      const emitFailureFilter = new logs.MetricFilter(this, 'IemisAuditEmitFailureFilter', {
        logGroup: identityLogGroup,
        metricNamespace: 'EdForge/IEMIS',
        metricName: 'AuditEmitFailures',
        filterPattern: logs.FilterPattern.literal('"iemis.audit.emit_failure"'),
        metricValue: '1',
        defaultValue: 0,
      });

      const emitFailureMetric = emitFailureFilter.metric({
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      });

      const emitFailureAlarm = new cloudwatch.Alarm(this, 'IemisAuditEmitFailuresAlarm', {
        alarmName: `edforge-iemis-audit-emit-failures-${props.tenantName}`,
        alarmDescription:
          'IEMIS audit events are being dropped due to DDB write failures. ' +
          'Compliance-critical: an operator action has happened but its ' +
          'audit row did not land. Runbook: docs/operations/saraswati-oncall.md ' +
          'section "IEMIS audit emit failures".',
        metric: emitFailureMetric,
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      const opsTopicArn = process.env.CDK_PARAM_OPERATOR_TOPIC_ARN;
      if (opsTopicArn) {
        const opsTopic = sns.Topic.fromTopicArn(this, 'OperatorAlertTopicRef', opsTopicArn);
        emitFailureAlarm.addAlarmAction(new cwActions.SnsAction(opsTopic));
      }
    }

    // const portDns = props.info.portMappings.map((port) => ({
    //   portMappingName: port.name,
    //   dnsName: `${port.name}-api.${props.namespace.namespaceName}.sc`,
    //   port: port.containerPort,
    //   discoveryName: `${port.name}-api`
    // }))

    // Sprint 6 (T6.8): every service ran at desiredCount=1 for the pilot (the
    // HA pair for identity and rproxy cost ~$20/month for a per-task crash
    // ECS replaces in 60–180 s anyway). Cost-redesign C4.4/C5.3: the count
    // comes from service-info per container so a service can be kept at 0
    // while its traffic is served by the Lambda functions.
    const serviceDesiredCount = props.info.desiredCount ?? 1;

    const serviceProps = {
      cluster: props.cluster,
      desiredCount: serviceDesiredCount,
      taskDefinition,
      securityGroups: [props.ecsSG],
      trunking: true,
      // 50%: Ensures at least one task remains healthy
      // during rolling deployments. With desiredCount=1, this means
      // deploy waits for new task before draining old one.
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      enableExecuteCommand: true, // Disable unnecessary features
      placementStrategy: props.isEc2Tier ? [
        ecs.PlacementStrategy.spreadAcrossInstances(),
        ecs.PlacementStrategy.packedByCpu()
      ] : undefined,
      serviceConnectConfiguration: {
        namespace: props.namespace.namespaceArn,
        services: props.info.portMappings.map((port) => ({
          portMappingName: port.name,
          dnsName: `${port.name}-api.${props.namespace.namespaceName}.sc`,
          port: port.containerPort,
          discoveryName: `${port.name}-api`
        })),
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: `${props.info.name}-sc-traffic-`,
          // Sprint 5 (T5.2): reduced ONE_MONTH → ONE_WEEK at pilot scale.
          // Service Connect traffic logs are high-volume operational data
          // that's only valuable for active debugging; 30-day retention
          // accumulated cost without payback. Bump back to ONE_MONTH
          // when scaling beyond pilot.
          logRetention: logs.RetentionDays.ONE_WEEK,
        }),
      }
    };



    this.service = props.isEc2Tier
      ? new ecs.Ec2Service(this, `${props.info.name}-service`, serviceProps)
      : new ecs.FargateService(this, `${props.info.name}-service`, serviceProps);

    getServiceName(this.service.node.defaultChild as ecs.CfnService, props.tenantName, props.info.name);

    if( props.isTarget ) {
      const targetGroupHttp = new elbv2.ApplicationTargetGroup( this, `target-group-${props.info.name}-${props.tenantId}`, {
          vpc: props.vpc,
          port: props.info.containerPort,
          protocol: elbv2.ApplicationProtocol.HTTP,
          targetType: elbv2.TargetType.IP,
          healthCheck: { 
            path: props.isRProxy? '/health': `/${props.info.name}/health`,
            protocol: elbv2.Protocol.HTTP,
// matcher removed - unnecessary as health check always returns 200
          }
        }
      );

      new elbv2.ApplicationListenerRule(this, `Rule-${props.info.name}-${props.tenantId}`, {
        listener: listener,
        priority: getHashCode(`${props.tenantId}-${props.info.name}`, 50000),
        action: elbv2.ListenerAction.forward([targetGroupHttp]),
        conditions: props.isRProxy ?[
          elbv2.ListenerCondition.httpHeader('tenantPath', [props.tenantId]),
        ] : [
          elbv2.ListenerCondition.httpHeader('tenantPath', [props.tenantId]),
          elbv2.ListenerCondition.pathPatterns([`/${props.info.name}*`])
        ]
      });
      this.service.attachToApplicationTargetGroup(targetGroupHttp);
      this.service.connections.allowFrom(listener, ec2.Port.tcp(props.info.containerPort));
    } 

    // Disable service-level auto scaling to prevent conflicts with ECS Managed Scaling
    // ECS Managed Scaling at cluster level handles capacity management
    // if (process.env.ENABLE_SERVICE_AUTOSCALING === 'true') {
    //   const scalableTarget = this.service.autoScaleTaskCount({
    //     minCapacity: 1,
    //     maxCapacity: 3
    //   });
    //
    //   scalableTarget.scaleOnMemoryUtilization('ScaleUpMem', {
    //     targetUtilizationPercent: 80,
    //     scaleInCooldown: cdk.Duration.seconds(60),
    //     scaleOutCooldown: cdk.Duration.seconds(60)
    //   });
    //
    //   scalableTarget.scaleOnCpuUtilization('ScaleUpCPU', {
    //     targetUtilizationPercent: 80,
    //     scaleInCooldown: cdk.Duration.seconds(60),
    //     scaleOutCooldown: cdk.Duration.seconds(60)
    //   });
    // }

  }
}


