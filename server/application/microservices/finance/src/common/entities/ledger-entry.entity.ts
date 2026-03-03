/**
 * Ledger Entry Entity
 *
 * Append-only ledger entries tracking all financial transactions for a billing account.
 *
 * PK: tenantId
 * SK: LEDGER#{accountId}#{entryId}
 * GSI2PK: TENANT#{tid}#STUDENT#{studentId}
 * GSI2SK: LEDGER#{date}#{entryId}
 */

import { v4 as uuid } from 'uuid';
import { BaseEntity, EntityKeyBuilder, GSIKeyBuilder } from './base.entity';
import type { LedgerEntryType } from '@aibrains/shared-types';

export interface LedgerEntryEntity extends BaseEntity {
  entityType: 'LEDGER_ENTRY';
  entryId: string;
  studentAccountId: string;
  studentId: string;
  entryType: LedgerEntryType;
  referenceId: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  date: string;

  // GSI keys
  gsi2pk: string;
  gsi2sk: string;
}

export function createLedgerEntryEntity(
  tenantId: string,
  data: {
    studentAccountId: string;
    studentId: string;
    entryType: LedgerEntryType;
    referenceId: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
    date: string;
  },
  userId: string,
): LedgerEntryEntity {
  const entryId = uuid();
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: EntityKeyBuilder.ledgerEntry(data.studentAccountId, entryId),
    entityType: 'LEDGER_ENTRY',
    entryId,
    studentAccountId: data.studentAccountId,
    studentId: data.studentId,
    entryType: data.entryType,
    referenceId: data.referenceId,
    description: data.description,
    debit: data.debit,
    credit: data.credit,
    balance: data.balance,
    date: data.date,

    gsi2pk: GSIKeyBuilder.studentScope(tenantId, data.studentId),
    gsi2sk: `LEDGER#${data.date}#${entryId}`,

    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}
