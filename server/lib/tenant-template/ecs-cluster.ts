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

    // DEVELOPMENT COST OPTIMIZATION: Container Insights Disabled
    // Container Insights enables CloudWatch Container Insights which adds ~$15-20/month in costs
    // This provides advanced metrics, but is not essential for development
    // 
    // PRODUCTION MIGRATION:
    // Change `containerInsights: false` to `containerInsights: true` for production deployments
    // Benefits in production:
    //   - Advanced performance metrics (CPU, memory, network utilization)
    //   - Task-level metrics aggregation
    //   - Container-level observability for troubleshooting
    //   - Better cost visibility and optimization recommendations
    // 
    // Cost: ~$0.25 per vCPU-hour for Container Insights
    // For a single t3.micro instance: ~$15-20/month
    this.cluster = new ecs.Cluster(this, 'EcsCluster', {
      clusterName,
      vpc: props.vpc,
      containerInsights: false, // Disabled for development cost savings
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
      
      // DEVELOPMENT COST OPTIMIZATION: Using t3.micro (smallest, cheapest burstable instance)
      // 
      // WHY: EC2 instances are the largest cost driver (~$76/month = 39% of total costs)
      // Current: t3.medium (2 vCPU, 4GB RAM) ≈ $0.0416/hour ≈ $30/month
      // Target: t3.micro (2 vCPU, 1GB RAM) ≈ $0.0104/hour ≈ $7.50/month
      // SAVINGS: ~$22.50/month (75% reduction)
      //
      // INSTANCE SPECIFICATIONS:
      // - t3.micro: 2 vCPUs, 1GB RAM, Burstable performance (unlimited mode by default)
      // - Suitable for: Light development workloads, intermittent usage
      // - Burstable credits: Accumulates credits when idle, uses when needed
      // 
      // WHEN TO UPGRADE:
      // - If containers frequently run out of memory (OOM errors in logs)
      // - If CPU consistently hits 100% utilization
      // - When moving to staging/production environments
      //
      // PRODUCTION MIGRATION OPTIONS:
      // 1. For Basic Tier (moderate load): t3.small (2 vCPU, 2GB RAM) - $0.0208/hour ≈ $15/month
      // 2. For Premium Tier (high load): t3.medium (2 vCPU, 4GB RAM) - $0.0416/hour ≈ $30/month
      // 3. For Advanced Tier (very high load): m5.large (2 vCPU, 8GB RAM) - $0.096/hour ≈ $70/month
      // 4. For consistent high CPU: Consider m5 or c5 instances (no burst limits)
      //
      // ALTERNATIVES IF t3.micro IS TOO SMALL:
      // - t3.small: 2 vCPU, 2GB RAM - $0.0208/hour (still 50% cheaper than t3.medium)
      // - Consider Fargate instead of EC2 for true pay-per-use (no idle costs)
      const launchTemplate = new ec2.LaunchTemplate(this, `EcsLaunchTemplate-${props.tenantId}`, {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO), // Smallest, cheapest option
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

      // DEVELOPMENT COST OPTIMIZATION: Minimal Auto Scaling Configuration
      // 
      // WHY: Auto Scaling Group costs are primarily driven by instance count and runtime
      // Current settings: 1 instance running 24/7
      // Optimization: Keep at 1 instance, but can scale to 0 when not in active development
      //
      // COST BREAKDOWN:
      // - With desiredCapacity: 1, minCapacity: 1, maxCapacity: 1 → Always 1 instance running
      // - Cost: ~$7.50/month for t3.micro instance (24/7 runtime)
      // - For development: Consider manually scaling to 0 when not testing (saves 100%)
      //
      // WHEN TO SCALE:
      // - Manual scale-to-zero: When not actively developing/testing (via AWS Console or CLI)
      // - Scale-up: When ready to test/deploy (`aws autoscaling set-desired-capacity`)
      //
      // PRODUCTION MIGRATION:
      // - desiredCapacity: 2 (for high availability)
      // - minCapacity: 2 (ensure multi-AZ redundancy)
      // - maxCapacity: 10 (for traffic spikes)
      // - Enable predictive scaling for cost optimization
      // - Consider using Fargate Spot for non-critical tasks (up to 90% savings)
      const autoScalingGroup = new AutoScalingGroup(this, `ecs-autoscaleG-${props.tenantId}`, {
        vpc: props.vpc,
        launchTemplate: launchTemplate,
        desiredCapacity: 1, // Development: 1 instance (can manually scale to 0 when idle)
        minCapacity: 1,     // Development: Keep at 1 for convenience (scale to 0 manually if needed)
        maxCapacity: 3,     // Development: Sufficient for testing bursts (Production: 10+)
      });

      // autoScalingGroup.role.addManagedPolicy(
      //   iam.ManagedPolicy.fromAwsManagedPolicyName( 'service-role/AmazonEC2ContainerServiceforEC2Role' )
      // );

      // DEVELOPMENT COST OPTIMIZATION: Capacity Provider Configuration
      //
      // WHY: targetCapacityPercent controls when ECS provisions new instances
      // Current: 85% → New instance when cluster is 85% full
      // Target: 90-95% → Better utilization, fewer instances needed
      //
      // COST IMPACT:
      // - Lower targetCapacityPercent (e.g., 80%) → More instances provisioned (higher cost)
      // - Higher targetCapacityPercent (e.g., 95%) → Better utilization (lower cost)
      // - For development: 95% is safe (idle resources available)
      //
      // HOW IT WORKS:
      // - ECS calculates cluster capacity based on running tasks
      // - When utilization exceeds targetCapacityPercent, triggers scale-out
      // - Higher percentage = wait longer before scaling = better cost efficiency
      //
      // PRODUCTION MIGRATION:
      // - targetCapacityPercent: 80-85% (for faster scaling to handle traffic spikes)
      // - minimumScalingStepSize: 2 (scale faster during peak)
      // - maximumScalingStepSize: 5 (handle sudden traffic increases)
      // - enableManagedTerminationProtection: true (prevent accidental scale-in during deployments)
      const capacityProvider = new ecs.AsgCapacityProvider(this, `AsgCapacityProvider-${props.tenantId}`, {
          autoScalingGroup,
          enableManagedScaling: true,
          targetCapacityPercent: 95, // Development: Higher threshold for better cost efficiency (Production: 80-85%)
          minimumScalingStepSize: 1, // Development: Scale one at a time (Production: 2)
          maximumScalingStepSize: 1, // Development: Prevent aggressive scaling (Production: 5+)
          enableManagedTerminationProtection: false // Development: Allow scale-in for cost savings (Production: true)
        }
      );
      const thisCluster = this.cluster as ecs.Cluster;
      thisCluster.addAsgCapacityProvider(capacityProvider);
    }
  
  }
}
