/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * AWS Mocks Module
 */

import { Module } from '@nestjs/common';
import { MockDynamoDBService } from './dynamodb-mock.service';
import { MockEventBridgeService } from './eventbridge-mock.service';
import { MockS3Service } from './s3-mock.service';
import { MockAthenaService } from './athena-mock.service';
import { MockCognitoService } from './cognito-mock.service';

@Module({
  providers: [
    MockDynamoDBService,
    MockEventBridgeService,
    MockS3Service,
    MockAthenaService,
    MockCognitoService
  ],
  exports: [
    MockDynamoDBService,
    MockEventBridgeService,
    MockS3Service,
    MockAthenaService,
    MockCognitoService
  ]
})
export class AwsMocksModule {}

