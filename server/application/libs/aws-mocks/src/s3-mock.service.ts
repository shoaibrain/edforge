/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * S3 Mock Service - In-memory implementation for testing
 */

import { Injectable } from '@nestjs/common';
import {
  GetObjectCommandInput,
  GetObjectCommandOutput,
  PutObjectCommandInput,
  PutObjectCommandOutput,
  ListObjectsV2CommandInput,
  ListObjectsV2CommandOutput
} from '@aws-sdk/client-s3';

/**
 * In-memory S3 mock for unit and integration testing
 * Simulates S3 behavior with Map-based storage
 */
@Injectable()
export class MockS3Service {
  private store = new Map<string, Buffer>();

  /**
   * Clear all stored objects
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get object from store
   */
  async getObject(params: GetObjectCommandInput): Promise<GetObjectCommandOutput> {
    const key = `${params.Bucket}/${params.Key}`;
    const body = this.store.get(key);
    
    if (!body) {
      throw new Error(`Object not found: ${key}`);
    }

    return {
      Body: body as any,
      ContentLength: body.length,
      ContentType: 'application/json',
      LastModified: new Date()
    };
  }

  /**
   * Put object into store
   */
  async putObject(params: PutObjectCommandInput): Promise<PutObjectCommandOutput> {
    const key = `${params.Bucket}/${params.Key}`;
    const body = params.Body instanceof Buffer 
      ? params.Body 
      : Buffer.from(typeof params.Body === 'string' ? params.Body : JSON.stringify(params.Body));
    
    this.store.set(key, body);
    
    return {
      ETag: `"${this.generateETag(body)}"`,
      VersionId: 'mock-version-id'
    };
  }

  /**
   * List objects in bucket
   */
  async listObjectsV2(params: ListObjectsV2CommandInput): Promise<ListObjectsV2CommandOutput> {
    const prefix = params.Prefix || '';
    const bucket = params.Bucket || '';
    const objects: any[] = [];

    for (const [key] of this.store.entries()) {
      if (key.startsWith(`${bucket}/${prefix}`)) {
        const objectKey = key.replace(`${bucket}/`, '');
        objects.push({
          Key: objectKey,
          Size: this.store.get(key)?.length || 0,
          LastModified: new Date()
        });
      }
    }

    return {
      Contents: objects,
      KeyCount: objects.length,
      IsTruncated: false
    };
  }

  /**
   * Check if object exists
   */
  objectExists(bucket: string, key: string): boolean {
    return this.store.has(`${bucket}/${key}`);
  }

  /**
   * Generate mock ETag
   */
  private generateETag(buffer: Buffer): string {
    // Simple hash for ETag
    let hash = 0;
    for (let i = 0; i < buffer.length; i++) {
      hash = ((hash << 5) - hash) + buffer[i];
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}

