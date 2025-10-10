import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { AutoScalingGroup } from 'aws-cdk-lib/aws-autoscaling';
import { type Construct } from 'constructs';
import { CustomEniTrunking } from './eni-trunking';
import { addTemplateTag } from '../utilities/helper-functions';

export interface EcsClusterProps extends cdk.NestedStackProps {
  vpc: ec2.IVpc
  stageName: string
  tenantId: string
  tier: string
  isEc2Tier: boolean
}

export class EcsCluster extends cdk.NestedStack {
  cluster: ecs.ICluster;

  constructor (scope: Construct, id: string, props: EcsClusterProps) {
    super(scope, id, props);
    addTemplateTag(this, 'EcsClusterStack');
    
    let clusterName = 'advanced' === props.tier.toLocaleLowerCase() 
        ? `${props.stageName}-advanced-${cdk.Stack.of(this).account}`
        : `${props.stageName}-${props.tenantId}`;

    this.cluster = new ecs.Cluster(this, 'EcsCluster', {
      clusterName,
      vpc: props.vpc,
      containerInsights: true,
    });

    if (props.isEc2Tier) {
      const trunking = new CustomEniTrunking(this, "EniTrunking");

      // Add ECS-specific user data
      const userData = ec2.UserData.forLinux();
      userData?.addCommands(
        `echo ECS_CLUSTER=${this.cluster.clusterName} >> /etc/ecs/ecs.config`
      );
      const launchTemplateRole = new iam.Role(this.cluster, "launchTemplateRole", { assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com") })
      launchTemplateRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role'))
      
      const launchTemplate = new ec2.LaunchTemplate(this, `EcsLaunchTemplate-${props.tenantId}`, {
        // Development cost optimization: Using t3.medium instead of m5.large
        // t3.medium has 2 vCPUs, 4 GB RAM - sufficient for development workloads
        // This reduces costs by ~70% compared to m5.large (2 vCPUs, 8 GB RAM)
        // instanceType: ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.LARGE),
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
        machineImage: ecs.EcsOptimizedImage.amazonLinux2023(),
        userData,
        role: trunking.ec2Role,
        // role: launchTemplateRole,
        requireImdsv2: true,
        securityGroup: new ec2.SecurityGroup(this, 'LaunchTemplateSG', {
          vpc: props.vpc,
          description: 'Allow ECS instance traffic',
          allowAllOutbound: true
        }),
      });

      const autoScalingGroup = new AutoScalingGroup(this, `ecs-autoscaleG-${props.tenantId}`, {
        vpc: props.vpc,
        launchTemplate: launchTemplate,
        // Development cost optimization: Reduced capacity settings
        // These settings are appropriate for early-stage development
        // Production should use higher capacity (desiredCapacity: 2, minCapacity: 2, maxCapacity: 10)
        desiredCapacity: 1, // Start with 1 instance for development
        minCapacity: 1,     // Keep minimum at 1 instance
        maxCapacity: 3,     // Reduced from 10 to 3 for development (sufficient for testing)
      });

      // autoScalingGroup.role.addManagedPolicy(
      //   iam.ManagedPolicy.fromAwsManagedPolicyName( 'service-role/AmazonEC2ContainerServiceforEC2Role' )
      // );

      const capacityProvider = new ecs.AsgCapacityProvider(this, `AsgCapacityProvider-${props.tenantId}`, {
          autoScalingGroup,
          enableManagedScaling: true,
          targetCapacityPercent: 85, // Scale when 80% capacity is reached (less aggressive)
          minimumScalingStepSize: 1, // Scale one instance at a time
          maximumScalingStepSize: 1, // Prevent scaling multiple instances at once
          enableManagedTerminationProtection: false // Allow scale in
        }
      );
      const thisCluster = this.cluster as ecs.Cluster;
      thisCluster.addAsgCapacityProvider(capacityProvider);
    }
  
  }
}
