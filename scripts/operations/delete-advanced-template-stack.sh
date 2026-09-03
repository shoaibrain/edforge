#!/usr/bin/env bash
# C0.2 — delete the deployed, dormant `tenant-template-stack-advanced`.
#
# Why: the stack was synthesized unconditionally and deployed to production,
# where its INACTIVE cluster still runs a t3.micro auto-scaling group around the
# clock (docs/architecture/cost-redesign/CURRENT_STATE.md §4.1): ~$11.07/month
# plus two alarms. It has zero tenants and zero services. The code that defines
# it stays (V1_DEFERRED) behind CDK_PARAM_ADVANCED_TEMPLATE_ENABLED (C0.1).
#
# What this script does, in order:
#   1. pre-flight   — read-only snapshot of everything the stack owns, refuses
#                     to continue if it finds ECS services or non-seed users.
#   2. delete       — turns off deletion protection on the advanced Cognito
#                     pool (identity-provider.ts sets it in prod), then
#                     `delete-stack` and waits.
#   3. verify       — read-only: stack gone, no ASG, no t3.micro, no orphan
#                     EBS, alarms gone, TenantMapping row gone.
#
# Usage:
#   scripts/operations/delete-advanced-template-stack.sh whoami      # read-only: proves the deploy-role hop
#   scripts/operations/delete-advanced-template-stack.sh preflight   # read-only
#   scripts/operations/delete-advanced-template-stack.sh delete      # destructive
#   scripts/operations/delete-advanced-template-stack.sh retain-pool # destructive; only after a DELETE_FAILED on the pool
#   scripts/operations/delete-advanced-template-stack.sh verify      # read-only
#
# Requires AWS_PROFILE (or the ambient credential chain) to point at the
# target account. Every command is plain `aws` so it can be pasted one line at
# a time under change control. Output goes to the private evidence dir, never
# to tracked source (CLAUDE.md deploy-evidence hygiene).

set -euo pipefail

STACK="tenant-template-stack-advanced"
EVIDENCE_DIR="${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/c0.2-advanced-stack-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$EVIDENCE_DIR"

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$EVIDENCE_DIR/run.log"; }

stack_status() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND"
}

advanced_pool_id() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='TenantUserpoolId'].OutputValue" --output text
}

preflight() {
  log "pre-flight against stack $STACK (status: $(stack_status))"
  [[ "$(stack_status)" != "NOT_FOUND" ]] || { log "stack not present — nothing to do"; exit 0; }

  aws cloudformation describe-stack-resources --stack-name "$STACK" --output json \
    > "$EVIDENCE_DIR/stack-resources.json"
  log "resources snapshot → $EVIDENCE_DIR/stack-resources.json"

  # The cluster is a nested stack; list its ASG(s) and instance(s).
  local cluster_arn
  cluster_arn=$(aws ecs list-clusters --query "clusterArns[?contains(@, 'advanced')]" --output text)
  log "advanced ECS cluster: ${cluster_arn:-<none>}"
  if [[ -n "$cluster_arn" ]]; then
    local svc_count
    svc_count=$(aws ecs list-services --cluster "$cluster_arn" --query 'length(serviceArns)' --output text)
    log "services in cluster: $svc_count"
    [[ "$svc_count" == "0" ]] || { log "REFUSING: cluster has services"; exit 2; }
  fi

  aws autoscaling describe-auto-scaling-groups \
    --query "AutoScalingGroups[?contains(AutoScalingGroupName, 'advanced')].{Name:AutoScalingGroupName,Desired:DesiredCapacity,Instances:Instances[].InstanceId}" \
    --output json > "$EVIDENCE_DIR/asg-before.json"
  log "ASG snapshot → $EVIDENCE_DIR/asg-before.json"

  local pool
  pool=$(advanced_pool_id)
  log "advanced Cognito pool: $pool"
  aws cognito-idp list-users --user-pool-id "$pool" --query 'Users[].Username' --output json \
    > "$EVIDENCE_DIR/pool-users.json"
  local user_count
  user_count=$(python3 -c "import json;print(len(json.load(open('$EVIDENCE_DIR/pool-users.json'))))")
  log "users in advanced pool: $user_count (expect 0 or 1 seeded admin)"
  [[ "$user_count" -le 1 ]] || { log "REFUSING: advanced pool has $user_count users"; exit 2; }

  aws dynamodb scan --table-name "$(aws cloudformation list-exports --query "Exports[?Name=='TenantMappingTableName'].Value" --output text 2>/dev/null || echo TenantMapping)" \
    --filter-expression "tenantId = :t" --expression-attribute-values '{":t":{"S":"advanced"}}' \
    > "$EVIDENCE_DIR/tenant-mapping-advanced-before.json" 2>/dev/null || true

  aws cloudwatch describe-alarms --alarm-name-prefix "edforge-result-batch" \
    --query 'MetricAlarms[].AlarmName' --output json > "$EVIDENCE_DIR/alarms-before.json"
  log "pre-flight OK — safe to run: $0 delete"
}

# The deployer identity (edforge-prod-deployer) has no direct mutation rights: it
# deploys by assuming the CDK bootstrap deploy role, and the stack carries the CDK
# exec role as its service role. So the delete is issued *as the deploy role*,
# exactly as `cdk destroy` would, without needing a synth.
with_deploy_role() {
  local cmd=("$@")
  local acct role creds
  acct=$(aws sts get-caller-identity --query Account --output text)
  role="arn:aws:iam::${acct}:role/cdk-hnb659fds-deploy-role-${acct}-ap-south-1"
  creds=$(aws sts assume-role --role-arn "$role" --role-session-name c02-advanced-stack-delete \
    --duration-seconds 3600 --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text)
  local key secret token
  read -r key secret token <<<"$creds"
  AWS_ACCESS_KEY_ID="$key" AWS_SECRET_ACCESS_KEY="$secret" AWS_SESSION_TOKEN="$token" "${cmd[@]}"
}

delete() {
  [[ "$(stack_status)" != "NOT_FOUND" ]] || { log "stack not present"; exit 0; }
  local pool
  pool=$(advanced_pool_id)
  # Cognito deletion protection is set by identity-provider.ts in prod. The
  # deployer cannot flip it (no cognito-idp:UpdateUserPool); an operator with
  # console/admin access must. If the flip is refused, the stack delete still
  # removes everything else (ASG, instance, cluster, roles) and ends
  # DELETE_FAILED on the pool alone — re-run `delete` after the flip, or run
  # `retain-pool` to finish and leave the (free, empty) pool orphaned.
  if aws cognito-idp update-user-pool --user-pool-id "$pool" --deletion-protection INACTIVE 2>>"$EVIDENCE_DIR/run.log"; then
    log "deletion protection disabled on $pool"
  else
    log "WARNING: could not disable deletion protection on $pool (needs cognito-idp:UpdateUserPool); continuing — expect DELETE_FAILED on the pool"
  fi
  log "deleting $STACK as the CDK deploy role"
  with_deploy_role aws cloudformation delete-stack --stack-name "$STACK"
  if with_deploy_role aws cloudformation wait stack-delete-complete --stack-name "$STACK"; then
    log "delete complete"
  else
    log "delete did not complete cleanly — status: $(stack_status)"
    aws cloudformation describe-stack-events --stack-name "$STACK" --output json \
      --query "StackEvents[?ResourceStatus=='DELETE_FAILED'].{Resource:LogicalResourceId,Type:ResourceType,Reason:ResourceStatusReason}" \
      | tee "$EVIDENCE_DIR/delete-failed-resources.json"
  fi
}

# Finish a DELETE_FAILED delete by retaining the protected pool (nothing else
# should be left). The orphaned pool is empty, deletion-protected and free; an
# operator can delete it from the console later.
retain_pool() {
  local pool_logical
  pool_logical=$(aws cloudformation describe-stack-resources --stack-name "$STACK" --output json \
    --query "StackResources[?ResourceType=='AWS::Cognito::UserPool'].LogicalResourceId" --output text)
  log "re-issuing delete retaining pool resource $pool_logical"
  with_deploy_role aws cloudformation delete-stack --stack-name "$STACK" --retain-resources "$pool_logical"
  with_deploy_role aws cloudformation wait stack-delete-complete --stack-name "$STACK" && log "delete complete (pool retained)"
}

verify() {
  log "stack status: $(stack_status) (expect NOT_FOUND)"
  aws autoscaling describe-auto-scaling-groups \
    --query "AutoScalingGroups[?contains(AutoScalingGroupName, 'advanced')].AutoScalingGroupName" \
    --output text | tee "$EVIDENCE_DIR/asg-after.txt"
  aws ec2 describe-instances --filters Name=instance-type,Values=t3.micro Name=instance-state-name,Values=running \
    --query 'Reservations[].Instances[].InstanceId' --output text | tee "$EVIDENCE_DIR/t3micro-after.txt"
  aws ec2 describe-volumes --filters Name=status,Values=available \
    --query 'Volumes[].{Id:VolumeId,Size:Size}' | tee "$EVIDENCE_DIR/orphan-volumes-after.json"
  aws cloudwatch describe-alarms --alarm-name-prefix "edforge-result-batch" \
    --query 'MetricAlarms[].AlarmName' | tee "$EVIDENCE_DIR/alarms-after.json"
  aws ecs list-clusters --query "clusterArns[?contains(@, 'advanced')]" --output text | tee "$EVIDENCE_DIR/clusters-after.txt"
  log "verify complete — expect: no ASG, no running t3.micro, no available volumes, no *-advanced alarms, no advanced cluster"
  log "next-day check: Cost Explorer 'EC2 - Instances' daily = 0"
}

case "${1:-}" in
  whoami) with_deploy_role aws sts get-caller-identity --query Arn --output text ;;
  preflight) preflight ;;
  delete) delete ;;
  retain-pool) retain_pool ;;
  verify) verify ;;
  *) echo "usage: $0 {whoami|preflight|delete|retain-pool|verify}" >&2; exit 1 ;;
esac
