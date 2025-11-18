#!/usr/bin/env ts-node

/**
 * Local DynamoDB Table Creation Script
 * 
 * Creates all tables and GSIs in local DynamoDB for development.
 * 
 * Usage:
 *   npm run dynamodb:create-tables
 *   or
 *   ts-node infrastructure/local-dynamodb/create-tables.ts
 */

import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';
import {
  SCHOOL_TABLE_DEFINITION,
  FINANCE_TABLE_DEFINITION,
  getAttributeDefinitions,
  TableDefinition,
} from './tables';

const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

/**
 * Create a table in local DynamoDB
 */
async function createTable(
  client: DynamoDBClient,
  tableDef: TableDefinition
): Promise<void> {
  const tableName = tableDef.tableName;
  
  try {
    // Check if table already exists
    try {
      await client.send(new DescribeTableCommand({ TableName: tableName }));
      console.log(`✅ Table ${tableName} already exists`);
      return;
    } catch (error: any) {
      if (error.name !== 'ResourceNotFoundException') {
        throw error;
      }
      // Table doesn't exist, continue to create
    }

    console.log(`📦 Creating table: ${tableName}...`);

    const command = new CreateTableCommand({
      TableName: tableName,
      AttributeDefinitions: getAttributeDefinitions(tableDef),
      KeySchema: [
        { AttributeName: tableDef.partitionKey.AttributeName, KeyType: 'HASH' },
        { AttributeName: tableDef.sortKey.AttributeName, KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: tableDef.gsis.length > 0 ? tableDef.gsis : undefined,
      BillingMode: tableDef.billingMode,
    });

    await client.send(command);
    console.log(`✅ Table ${tableName} created successfully`);
    console.log(`   - GSIs: ${tableDef.gsis.length}`);
  } catch (error: any) {
    if (error instanceof ResourceInUseException) {
      console.log(`⚠️  Table ${tableName} already exists`);
    } else {
      console.error(`❌ Failed to create table ${tableName}:`, error.message);
      throw error;
    }
  }
}

/**
 * Wait for table to become active
 */
async function waitForTableActive(
  client: DynamoDBClient,
  tableName: string,
  maxWaitSeconds: number = 30
): Promise<void> {
  const startTime = Date.now();
  const maxWait = maxWaitSeconds * 1000;

  while (Date.now() - startTime < maxWait) {
    try {
      const response = await client.send(
        new DescribeTableCommand({ TableName: tableName })
      );
      
      if (response.Table?.TableStatus === 'ACTIVE') {
        console.log(`✅ Table ${tableName} is active`);
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        // Table not created yet, wait
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        throw error;
      }
    }
  }

  throw new Error(`Table ${tableName} did not become active within ${maxWaitSeconds} seconds`);
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting local DynamoDB table creation...');
  console.log(`📍 Endpoint: ${DYNAMODB_ENDPOINT}`);
  console.log(`🌍 Region: ${AWS_REGION}\n`);

  const client = new DynamoDBClient({
    endpoint: DYNAMODB_ENDPOINT,
    region: AWS_REGION,
    credentials: {
      accessKeyId: 'local',
      secretAccessKey: 'local',
    },
  });

  try {
    // Create school table
    await createTable(client, SCHOOL_TABLE_DEFINITION);
    await waitForTableActive(client, SCHOOL_TABLE_DEFINITION.tableName);

    // Create finance table
    await createTable(client, FINANCE_TABLE_DEFINITION);
    await waitForTableActive(client, FINANCE_TABLE_DEFINITION.tableName);

    console.log('\n✅ All tables created successfully!');
    console.log('\n📊 Tables created:');
    console.log(`   - ${SCHOOL_TABLE_DEFINITION.tableName} (${SCHOOL_TABLE_DEFINITION.gsis.length} GSIs)`);
    console.log(`   - ${FINANCE_TABLE_DEFINITION.tableName} (${FINANCE_TABLE_DEFINITION.gsis.length} GSIs)`);
  } catch (error: any) {
    console.error('\n❌ Error creating tables:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { createTable, waitForTableActive };

