/**
 * Local DynamoDB Table Schema Definitions
 * 
 * This file defines the table schemas for local development that match production.
 * Tables are created using AWS SDK directly (not CDK) for local DynamoDB.
 */

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  AttributeDefinition,
  KeySchemaElement,
  GlobalSecondaryIndex,
  Projection,
  BillingMode,
  TableClass,
} from '@aws-sdk/client-dynamodb';

export interface TableDefinition {
  tableName: string;
  partitionKey: AttributeDefinition;
  sortKey: AttributeDefinition;
  gsis: GlobalSecondaryIndex[];
  billingMode: BillingMode;
}

/**
 * School Table Schema (Shared by most services)
 * 
 * Matches production: school-table-v2-basic
 * Partition Key: tenantId
 * Sort Key: entityKey
 * GSIs: GSI1-GSI12
 */
export const SCHOOL_TABLE_DEFINITION: TableDefinition = {
  tableName: 'school-table-v2-basic',
  partitionKey: {
    AttributeName: 'tenantId',
    AttributeType: 'S',
  },
  sortKey: {
    AttributeName: 'entityKey',
    AttributeType: 'S',
  },
  billingMode: BillingMode.PAY_PER_REQUEST, // For local dev
  gsis: [
    // GSI1: School Index - Query all entities for a specific school
    {
      IndexName: 'GSI1',
      KeySchema: [
        { AttributeName: 'gsi1pk', KeyType: 'HASH' },
        { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI2: Academic Year Index - Query entities within academic year
    {
      IndexName: 'GSI2',
      KeySchema: [
        { AttributeName: 'gsi2pk', KeyType: 'HASH' },
        { AttributeName: 'gsi2sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI3: Status Index - Filter by status, pagination
    {
      IndexName: 'GSI3',
      KeySchema: [
        { AttributeName: 'gsi3pk', KeyType: 'HASH' },
        { AttributeName: 'gsi3sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI4: Activity Log Index (Time-series) - Audit log queries
    {
      IndexName: 'GSI4',
      KeySchema: [
        { AttributeName: 'gsi4pk', KeyType: 'HASH' },
        { AttributeName: 'gsi4sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI5: Classroom Index - Query classrooms by teacher/academic year
    {
      IndexName: 'GSI5',
      KeySchema: [
        { AttributeName: 'gsi5pk', KeyType: 'HASH' },
        { AttributeName: 'gsi5sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI6: Assignment Index - Query assignments by classroom/teacher
    {
      IndexName: 'GSI6',
      KeySchema: [
        { AttributeName: 'gsi6pk', KeyType: 'HASH' },
        { AttributeName: 'gsi6sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI7: Student Index - Query students by school/academic year
    {
      IndexName: 'GSI7',
      KeySchema: [
        { AttributeName: 'gsi7pk', KeyType: 'HASH' },
        { AttributeName: 'gsi7sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI8: Enrollment Index - Query enrollments by student/classroom
    {
      IndexName: 'GSI8',
      KeySchema: [
        { AttributeName: 'gsi8pk', KeyType: 'HASH' },
        { AttributeName: 'gsi8sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI9: Parent Index - Query parents by student/email
    {
      IndexName: 'GSI9',
      KeySchema: [
        { AttributeName: 'gsi9pk', KeyType: 'HASH' },
        { AttributeName: 'gsi9sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI10: Invoice Index - Query invoices by student/account
    {
      IndexName: 'GSI10',
      KeySchema: [
        { AttributeName: 'gsi10pk', KeyType: 'HASH' },
        { AttributeName: 'gsi10sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI11: Staff Index - Query staff by school/department
    {
      IndexName: 'GSI11',
      KeySchema: [
        { AttributeName: 'gsi11pk', KeyType: 'HASH' },
        { AttributeName: 'gsi11sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI12: Attendance Index - Query attendance by classroom/date
    {
      IndexName: 'GSI12',
      KeySchema: [
        { AttributeName: 'gsi12pk', KeyType: 'HASH' },
        { AttributeName: 'gsi12sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
  ],
};

/**
 * Finance Table Schema (Separate table for PCI compliance)
 * 
 * Matches production: finance-table-v2-{tier}
 * Same structure as school table but isolated for security
 */
export const FINANCE_TABLE_DEFINITION: TableDefinition = {
  tableName: 'finance-table-v2-basic',
  partitionKey: {
    AttributeName: 'tenantId',
    AttributeType: 'S',
  },
  sortKey: {
    AttributeName: 'entityKey',
    AttributeType: 'S',
  },
  billingMode: BillingMode.PAY_PER_REQUEST,
  gsis: [
    // GSI1: Account Index - Query billing accounts by student
    {
      IndexName: 'GSI1',
      KeySchema: [
        { AttributeName: 'gsi1pk', KeyType: 'HASH' },
        { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI2: Invoice Index - Query invoices by account/date
    {
      IndexName: 'GSI2',
      KeySchema: [
        { AttributeName: 'gsi2pk', KeyType: 'HASH' },
        { AttributeName: 'gsi2sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI3: Payment Index - Query payments by invoice/date
    {
      IndexName: 'GSI3',
      KeySchema: [
        { AttributeName: 'gsi3pk', KeyType: 'HASH' },
        { AttributeName: 'gsi3sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI7: Student Index - Query financial records by student
    {
      IndexName: 'GSI7',
      KeySchema: [
        { AttributeName: 'gsi7pk', KeyType: 'HASH' },
        { AttributeName: 'gsi7sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
    // GSI10: Invoice Number Index - Query by invoice number
    {
      IndexName: 'GSI10',
      KeySchema: [
        { AttributeName: 'gsi10pk', KeyType: 'HASH' },
        { AttributeName: 'gsi10sk', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
    },
  ],
};

/**
 * All attribute definitions required for tables and GSIs
 */
export function getAttributeDefinitions(tableDef: TableDefinition): AttributeDefinition[] {
  const attrs = new Map<string, AttributeDefinition>();
  
  // Add primary key attributes
  attrs.set(tableDef.partitionKey.AttributeName, tableDef.partitionKey);
  attrs.set(tableDef.sortKey.AttributeName, tableDef.sortKey);
  
  // Add GSI key attributes
  tableDef.gsis.forEach(gsi => {
    gsi.KeySchema?.forEach(key => {
      if (!attrs.has(key.AttributeName)) {
        attrs.set(key.AttributeName, {
          AttributeName: key.AttributeName,
          AttributeType: 'S', // All keys are strings
        });
      }
    });
  });
  
  return Array.from(attrs.values());
}

