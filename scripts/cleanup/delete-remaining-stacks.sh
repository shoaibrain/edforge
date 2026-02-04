#!/bin/bash -e

# Delete remaining CloudFormation stacks after aws-nuke cleanup
# The stacks are likely broken because underlying resources were deleted

export AWS_PROFILE=${AWS_PROFILE:-dev}

echo "=============================================="
echo "Deleting Remaining CloudFormation Stacks"
echo "=============================================="
echo ""

# Helper function to check if a stack exists
check_stack_exists() {
    local stack_name=$1
    local status=$(AWS_PROFILE=$AWS_PROFILE aws cloudformation describe-stacks --stack-name "$stack_name" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DOES_NOT_EXIST")
    if [[ "$status" != "DOES_NOT_EXIST" && "$status" != "None" && -n "$status" ]]; then
        return 0  # Stack exists
    else
        return 1  # Stack does not exist
    fi
}

# Function to delete a stack, handling various error conditions
delete_stack() {
    local stack_name=$1
    echo "Attempting to delete: $stack_name"
    
    if ! check_stack_exists "$stack_name"; then
        echo "  ✅ Stack $stack_name does not exist, skipping."
        return 0
    fi
    
    local current_status=$(AWS_PROFILE=$AWS_PROFILE aws cloudformation describe-stacks --stack-name "$stack_name" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "UNKNOWN")
    echo "  Current status: $current_status"
    
    # Try direct deletion first
    echo "  Attempting delete-stack..."
    AWS_PROFILE=$AWS_PROFILE aws cloudformation delete-stack --stack-name "$stack_name" 2>&1 || {
        echo "  ⚠️  Direct delete failed, trying alternative methods..."
        
        # If direct delete fails, try to get stack resources and delete them manually
        echo "  Checking for remaining resources..."
        local resources=$(AWS_PROFILE=$AWS_PROFILE aws cloudformation describe-stack-resources --stack-name "$stack_name" --query 'StackResources[?ResourceStatus!=`DELETE_COMPLETE`].LogicalResourceId' --output text 2>/dev/null || echo "")
        
        if [[ -n "$resources" && "$resources" != "None" ]]; then
            echo "  Found remaining resources: $resources"
            echo "  ⚠️  Some resources may still exist. You may need to delete them manually."
        fi
        
        # Try delete with retain-resources (if stack is in DELETE_FAILED)
        if [[ "$current_status" == "DELETE_FAILED" ]]; then
            echo "  Stack is in DELETE_FAILED state, attempting delete with --retain-resources..."
            # Get all logical resource IDs
            local all_resources=$(AWS_PROFILE=$AWS_PROFILE aws cloudformation describe-stack-resources --stack-name "$stack_name" --query 'StackResources[].LogicalResourceId' --output text 2>/dev/null | tr '\t' ' ' || echo "")
            if [[ -n "$all_resources" && "$all_resources" != "None" ]]; then
                # Delete stack while retaining all resources (since they're already deleted by aws-nuke)
                AWS_PROFILE=$AWS_PROFILE aws cloudformation delete-stack --stack-name "$stack_name" --retain-resources $all_resources 2>&1 || {
                    echo "  ⚠️  Delete with retain-resources also failed."
                }
            fi
        fi
    }
    
    # Wait for deletion
    echo "  Waiting for deletion to complete (max 10 minutes)..."
    local max_wait=600
    local elapsed=0
    while [ $elapsed -lt $max_wait ]; do
        if ! check_stack_exists "$stack_name"; then
            echo "  ✅ Stack $stack_name successfully deleted!"
            return 0
        fi
        local status=$(AWS_PROFILE=$AWS_PROFILE aws cloudformation describe-stacks --stack-name "$stack_name" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DOES_NOT_EXIST")
        echo "    Status: $status (${elapsed}s elapsed)..."
        sleep 10
        elapsed=$((elapsed + 10))
    done
    
    if check_stack_exists "$stack_name"; then
        local final_status=$(AWS_PROFILE=$AWS_PROFILE aws cloudformation describe-stacks --stack-name "$stack_name" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "UNKNOWN")
        echo "  ❌ Stack $stack_name deletion timed out. Final status: $final_status"
        echo "  You may need to delete this stack manually from the AWS Console."
        return 1
    fi
}

# Step 1: Delete shared-infra-stack first (it imports from controlplane-stack)
echo "Step 1: Deleting shared-infra-stack..."
delete_stack "shared-infra-stack"

echo ""
sleep 5

# Step 2: Delete controlplane-stack
echo "Step 2: Deleting controlplane-stack..."
delete_stack "controlplane-stack"

echo ""
echo "=============================================="
echo "Stack deletion attempts complete!"
echo "=============================================="
echo ""
echo "If stacks are still stuck, try:"
echo "1. AWS Console: Go to CloudFormation > Select stack > Delete"
echo "2. If that fails, you may need to recreate the CDK execution role temporarily:"
echo "   Role ARN: arn:aws:iam::346698404105:role/cdk-hnb659fds-cfn-exec-role-346698404105-us-east-1"
echo ""
