#!/bin/bash
# ============================================================
# Wait for EdForge Services to be Ready
# ============================================================
#
# Waits for all EdForge local development services to be healthy.
# Useful for CI/CD pipelines and automated testing.
#
# Usage:
#   ./scripts/wait-for-services.sh [timeout_seconds]
#
# Exit codes:
#   0 - All services ready
#   1 - Timeout waiting for services
# ============================================================

set -e

TIMEOUT=${1:-120}  # Default 120 seconds timeout
INTERVAL=5         # Check every 5 seconds

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Waiting for EdForge services (timeout: ${TIMEOUT}s)...${NC}"

SERVICES=(
    "LocalStack:http://localhost:4566/_localstack/health"
    "DynamoDB:http://localhost:8000"
    "Identity:http://localhost:3010/health"
    "Academics:http://localhost:3011/health"
)

wait_for_url() {
    local name=$1
    local url=$2
    local elapsed=0

    while [ $elapsed -lt $TIMEOUT ]; do
        if curl -sf "$url" > /dev/null 2>&1; then
            return 0
        fi
        sleep $INTERVAL
        elapsed=$((elapsed + INTERVAL))
    done
    return 1
}

ALL_READY=true

for service in "${SERVICES[@]}"; do
    NAME="${service%%:*}"
    URL="${service#*:}"
    
    echo -n "  Checking $NAME... "
    
    if wait_for_url "$NAME" "$URL"; then
        echo -e "${GREEN}Ready${NC}"
    else
        echo -e "${RED}Failed${NC}"
        ALL_READY=false
    fi
done

if [ "$ALL_READY" = true ]; then
    echo -e "\n${GREEN}All services are ready!${NC}"
    exit 0
else
    echo -e "\n${RED}Some services failed to start within ${TIMEOUT}s${NC}"
    exit 1
fi

