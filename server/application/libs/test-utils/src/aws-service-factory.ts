/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * AWS Service Factory - Factory for creating mocked AWS services
 */

import { MockDynamoDBService } from '@app/aws-mocks';
import { MockEventBridgeService } from '@app/aws-mocks';
import { MockS3Service } from '@app/aws-mocks';
import { MockAthenaService } from '@app/aws-mocks';
import { MockCognitoService } from '@app/aws-mocks';

/**
 * Create all AWS mock services for testing
 */
export function createAwsMockServices() {
  return {
    dynamodb: new MockDynamoDBService(),
    eventbridge: new MockEventBridgeService(),
    s3: new MockS3Service(),
    athena: new MockAthenaService(),
    cognito: new MockCognitoService()
  };
}

/**
 * Clear all AWS mock services
 */
export function clearAwsMockServices(services: ReturnType<typeof createAwsMockServices>): void {
  services.dynamodb.clear();
  services.eventbridge.clear();
  services.s3.clear();
  services.athena.clear();
  services.cognito.clear();
}

