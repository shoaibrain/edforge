# Using aws-nuke for EdForge Cleanup

## ⚠️ WARNING
**aws-nuke will DELETE resources permanently. Use with extreme caution!**

## Quick Start

1. **Install aws-nuke:**
   ```bash
   # macOS
   brew install ekristen/tap/aws-nuke@3
   
   # Or download from: https://github.com/ekristen/aws-nuke/releases
   ```

2. **Run the setup script:**
   ```bash
   cd /Users/shoaibrain/edforge/scripts/cleanup
   AWS_PROFILE=dev ./aws-nuke-setup.sh
   ```

3. **Review what will be deleted (DRY RUN):**
   ```bash
   AWS_PROFILE=dev aws-nuke explain-config \
     -c ~/.aws-nuke/edforge-config.yaml \
     --with-filtered --with-included
   ```

4. **If everything looks correct, run the deletion:**
   ```bash
   AWS_PROFILE=dev aws-nuke run \
     -c ~/.aws-nuke/edforge-config.yaml
   ```

## What aws-nuke Will Delete

Based on the configuration, it will delete:
- CloudFormation stacks (shared-infra-stack, controlplane-stack, etc.)
- S3 buckets (matching edforge patterns)
- ECS clusters and services
- Lambda functions
- EventBridge rules
- DynamoDB tables
- API Gateway REST APIs
- CloudFront distributions
- Cognito user pools
- ECR repositories
- And other edforge-related resources

## Safety Features

- **Dry run first**: Always run `explain account` before `run`
- **Confirmation required**: You must type your account ID to confirm
- **Filtered**: Only resources matching the filters will be deleted
- **Ordered deletion**: aws-nuke handles dependencies automatically

## Manual Configuration

If you need to customize the config, edit:
```
~/.aws-nuke/edforge-config.yaml
```

## References

- [aws-nuke GitHub](https://github.com/ekristen/aws-nuke)
- [aws-nuke Documentation](https://ekristen.github.io/aws-nuke/)
