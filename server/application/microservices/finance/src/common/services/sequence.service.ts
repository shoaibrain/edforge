/**
 * Sequence Generator Service
 *
 * Generates sequential, human-readable numbers for invoices and receipts.
 * Uses DynamoDB atomic counter (UpdateItem with ADD) for thread-safe sequences.
 *
 * Format: INV-{schoolPrefix}-{YYMM}-{seq} e.g. INV-ACD-2503-0001
 *         RCP-{schoolPrefix}-{YYMM}-{seq} e.g. RCP-ACD-2503-0001
 */

import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EntityKeyBuilder } from '../entities/base.entity';

@Injectable()
export class SequenceService {
  private readonly logger = new Logger(SequenceService.name);
  private readonly tableName: string;

  constructor() {
    this.tableName = process.env.TABLE_NAME || 'edforge-finance';
  }

  async nextInvoiceNumber(
    client: DynamoDBDocumentClient,
    tenantId: string,
    schoolId: string,
    schoolPrefix?: string,
  ): Promise<string> {
    const prefix = schoolPrefix || schoolId.substring(0, 3).toUpperCase();
    const yyMM = this.getYYMM();
    const sequenceType = `INVOICE#${yyMM}`;
    const seq = await this.incrementSequence(client, tenantId, schoolId, sequenceType);
    return `INV-${prefix}-${yyMM}-${String(seq).padStart(4, '0')}`;
  }

  async nextReceiptNumber(
    client: DynamoDBDocumentClient,
    tenantId: string,
    schoolId: string,
    schoolPrefix?: string,
  ): Promise<string> {
    const prefix = schoolPrefix || schoolId.substring(0, 3).toUpperCase();
    const yyMM = this.getYYMM();
    const sequenceType = `RECEIPT#${yyMM}`;
    const seq = await this.incrementSequence(client, tenantId, schoolId, sequenceType);
    return `RCP-${prefix}-${yyMM}-${String(seq).padStart(4, '0')}`;
  }

  private async incrementSequence(
    client: DynamoDBDocumentClient,
    tenantId: string,
    schoolId: string,
    sequenceType: string,
  ): Promise<number> {
    const entityKey = EntityKeyBuilder.sequence(schoolId, sequenceType);

    const result = await client.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { tenantId, entityKey },
      UpdateExpression: 'SET #val = if_not_exists(#val, :zero) + :inc, entityType = :et',
      ExpressionAttributeNames: { '#val': 'currentValue' },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':inc': 1,
        ':et': 'SEQUENCE',
      },
      ReturnValues: 'ALL_NEW',
    }));

    return (result.Attributes as any).currentValue as number;
  }

  private getYYMM(): string {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `${yy}${mm}`;
  }
}
