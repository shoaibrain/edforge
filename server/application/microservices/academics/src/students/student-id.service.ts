/**
 * Student Unique ID (USI) Generation Service
 *
 * Generates unique student identifiers mapping to Ed-Fi `studentUniqueId`.
 * Uses DynamoDB atomic counter for sequential, gap-free IDs.
 *
 * Format: {SchoolCode}-{Year}-{Sequence} (e.g., WHS-2026-00001)
 */

import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';

@Injectable()
export class StudentIdService {
  private readonly logger = new Logger(StudentIdService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {}

  /**
   * Generate a unique student ID using atomic DynamoDB counter.
   * Format: {SchoolCode}-{Year}-{Sequence}
   * Example: WHS-2026-00001
   */
  async generateStudentUniqueId(
    tenantId: string,
    schoolId: string,
    schoolCode: string | undefined,
    jwtToken: string,
  ): Promise<string> {
    this.logger.debug(`generateStudentUniqueId: entry, schoolId=${schoolId}, schoolCode=${schoolCode || 'none'}`);
    const year = new Date().getFullYear();
    const prefix = this.buildSchoolPrefix(schoolCode, schoolId);

    // Atomic counter key: TENANT#{tid}#COUNTER#STUDENT_USI#{schoolId}#{year}
    const counterKey = `COUNTER#STUDENT_USI#${schoolId}#${year}`;

    const client = await this.dynamoDBClient.getClient(tenantId, jwtToken);

    const sequence = await this.incrementCounter(client, tenantId, counterKey);
    const paddedSequence = String(sequence).padStart(5, '0');

    const usi = `${prefix}-${year}-${paddedSequence}`;

    this.logger.debug(`Generated USI: ${usi} for school ${schoolId}`);

    return usi;
  }

  /**
   * Validate a student unique ID format.
   * Returns true if format matches {CODE}-{YEAR}-{SEQUENCE}
   */
  validateStudentUniqueId(id: string): boolean {
    const pattern = /^[A-Z0-9]{2,6}-\d{4}-\d{5}$/;
    return pattern.test(id);
  }

  /**
   * Check if a student unique ID already exists for a tenant.
   */
  async isUniqueIdTaken(
    tenantId: string,
    studentUniqueId: string,
    jwtToken: string,
  ): Promise<boolean> {
    this.logger.debug(`isUniqueIdTaken: entry, studentUniqueId=${studentUniqueId}`);
    const client = await this.dynamoDBClient.getClient(tenantId, jwtToken);

    // Query all students and check studentNumber (in-memory for now)
    // In production, would use a GSI on studentNumber
    const result = await this.dynamoDBClient.queryGSI<any>(
      client,
      'GSI1',
      `TENANT#${tenantId}`,
      'STUDENT#',
      'begins_with',
      'studentNumber = :usi',
      { ':usi': studentUniqueId },
      undefined,
      1,
    );

    const isTaken = result.items.length > 0;
    this.logger.debug(`isUniqueIdTaken: result=${isTaken}`);
    return isTaken;
  }

  /**
   * Build a school prefix from school code or ID.
   * Takes first 3-6 chars of school code, or generates from schoolId.
   */
  private buildSchoolPrefix(schoolCode: string | undefined, schoolId: string): string {
    if (schoolCode) {
      // Use school code, sanitize to uppercase alphanumeric, max 6 chars
      return schoolCode
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase()
        .substring(0, 6) || schoolId.substring(0, 3).toUpperCase();
    }
    // Fallback: use first 3 chars of schoolId
    return schoolId.substring(0, 3).toUpperCase();
  }

  /**
   * Atomic increment routed through the shared DDB primitive so every
   * counter in the service follows the same semantics (ADD on
   * counterValue, one ConditionalCheckFailed retry, consistent telemetry).
   */
  private async incrementCounter(
    client: any,
    tenantId: string,
    counterKey: string,
  ): Promise<number> {
    try {
      return await this.dynamoDBClient.atomicIncrement(
        client,
        tenantId,
        counterKey,
        1,
        { entityType: 'COUNTER' },
      );
    } catch (error) {
      this.logger.error(`Failed to increment counter ${counterKey}`, error);
      throw new BadRequestException('Failed to generate student unique ID');
    }
  }
}
