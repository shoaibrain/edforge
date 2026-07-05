import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PdfLogoOptimizerService } from '../common/services/pdf-logo-optimizer.service';
import { SequenceService } from '../common/services/sequence.service';
import { InvoicesService } from '../invoices/invoices.service';
import { StudentAccountsService } from '../student-accounts/student-accounts.service';
import { renderReceiptToPdfBuffer } from './receipt-pdf.renderer';
import type {
  ReceiptTemplateConfig,
  Archetype as PdfArchetype,
} from '@aibrains/pdf-renderer';

/**
 * Derive a BCP-47 locale string from a template's `labelLanguages` tuple
 * — defensive against malformed JSON-boundary input. Mirror of the helper
 * in invoices.service.ts (Sprint C.1.5 CodeRabbit catch). Lockstep
 * implementation; if one changes, change both.
 */
function resolvePrimaryLocale(labelLanguages: unknown): string {
  if (!Array.isArray(labelLanguages) || labelLanguages.length === 0) {
    return 'en-US';
  }
  return labelLanguages[0] === 'ne' ? 'ne-NP' : 'en-US';
}
import { planPaymentAllocation } from './payment-allocation.planner';
import { GatewayAdapterRegistryService } from '../payment-gateways/adapters/gateway-adapter-registry.service';
import { PaymentGatewaysService } from '../payment-gateways/payment-gateways.service';
import type { GatewayVerifyResult } from '../payment-gateways/adapters/gateway-adapter.interface';
import {
  PaymentEntity,
  PaymentApplication,
  RefundData,
  createPaymentEntity,
} from '../common/entities/payment.entity';
import { InvoiceEntity } from '../common/entities/invoice.entity';
import { BillingAccountEntity } from '../common/entities/billing-account.entity';
import { EntityKeyBuilder, GSIKeyBuilder, RequestContext, decodeCursor } from '../common/entities/base.entity';
import { paymentEntityToDto } from '../common/mappers/payment.mapper';
import type {
  Payment,
  Receipt,
  RecordManualPaymentDto,
  CreateRefundDto,
  InitiatePaymentRequest,
  InitiatePaymentResponse,
  VerifyPaymentResponse,
} from '@aibrains/shared-types';
import { FinanceErrors } from '../common/errors/finance-errors';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: FinanceEventsService,
    private readonly sequenceService: SequenceService,
    private readonly invoicesService: InvoicesService,
    private readonly studentAccountsService: StudentAccountsService,
    private readonly gatewayRegistry: GatewayAdapterRegistryService,
    private readonly gatewayConfigService: PaymentGatewaysService,
    // Sprint C.1.6 — identityClient is needed for `getReceiptPdf` to fetch
    // branding + the current RECEIPT template. Injected alongside the
    // existing payment dependencies; IdentityClientService is already
    // listed in PaymentsModule.providers.
    private readonly identityClient: IdentityClientService,
    // Plan §5d — logo optimization for the individual-receipt PDF endpoint.
    // Symmetric with the parallel wiring in InvoicesService.
    private readonly pdfLogoOptimizer: PdfLogoOptimizerService,
  ) {}

  /**
   * Record a manual (offline) payment — cash, bank_transfer, cheque.
   * Atomically: create payment + update invoice(s) + record ledger entries.
   *
   * Two input shapes (exactly one, schema-enforced):
   *   - `invoiceId` — legacy single-target path, byte-identical behavior
   *     (pinned by payments.service.recordManualPayment.golden.spec.ts).
   *   - `applications[]` — EPIC-FB FB-4.4 multi-target family payment
   *     (one cheque settles several siblings' invoices).
   *
   * The idempotency check runs BEFORE the branch: one key covers the
   * whole payment regardless of shape.
   */
  async recordManualPayment(
    schoolId: string,
    dto: RecordManualPaymentDto,
    context: RequestContext,
  ): Promise<Payment> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // 1. Idempotency check
    if (dto.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(schoolId, dto.idempotencyKey, context);
      if (existing) return paymentEntityToDto(existing);
    }

    if (dto.applications) {
      return this.recordMultiTargetManualPayment(schoolId, dto, dto.applications, context);
    }

    // Schema superRefine guarantees exactly-one-of; defensive re-check so a
    // bypassing caller can't fall through with neither shape.
    const dtoInvoiceId = dto.invoiceId;
    if (!dtoInvoiceId) {
      throw new BadRequestException(
        `recordManualPayment requires exactly one of 'invoiceId' or 'applications'.`,
      );
    }

    // 2. Validate invoice
    const invoice = await this.invoicesService.getEntity(schoolId, dtoInvoiceId, context);

    if (invoice.status === 'paid') {
      throw new BadRequestException({ code: FinanceErrors.INVOICE_ALREADY_PAID, message: 'Invoice is already fully paid' });
    }
    if (invoice.status === 'cancelled' || invoice.status === 'written_off') {
      throw new BadRequestException({ code: FinanceErrors.INVOICE_CANCELLED, message: `Cannot pay a ${invoice.status} invoice` });
    }

    // 2a. Sprint C2.T2 — payment currency must match invoice currency.
    // If the DTO declares a currency, it must match the invoice's; if it
    // doesn't declare one, we inherit from the invoice (the invariant
    // source of truth — invoice currency was set from
    // WorkspaceSettings.regional.defaultCurrency at create time).
    if (dto.currency && dto.currency !== invoice.currency) {
      throw new BadRequestException({
        code: FinanceErrors.PAYMENT_CURRENCY_MISMATCH,
        message: `Payment currency (${dto.currency}) does not match invoice currency (${invoice.currency})`,
        params: { paymentCurrency: dto.currency, invoiceCurrency: invoice.currency },
      });
    }

    // 2b. Pilot PD.2.3 — fetch the BillingAccount NOW (before the
    // PAYMENT_EXCEEDS_ALLOCATABLE check) so we can compute the
    // allocatable cap = invoice.amountDue + openingBalanceRemaining.
    // We re-use the same `account` further down for the
    // TransactWriteItems composite write (no second GetItem needed).
    const accountKey = EntityKeyBuilder.billingAccount(schoolId, invoice.studentId);
    const account = await this.dynamoDBClient.getItem<BillingAccountEntity>(
      client,
      context.tenantId,
      accountKey,
    );
    if (!account) {
      throw new NotFoundException({
        code: FinanceErrors.ACCOUNT_NOT_FOUND,
        message: `Billing account for student ${invoice.studentId} at school ${schoolId} not found`,
      });
    }

    // 2c. Pilot PD.2.3 — allocation planning.
    //   toInvoice  = min(payment, invoice.amountDue)
    //   toOpening  = min(payment − toInvoice, openingBalance − openingBalanceSettled)
    //   leftover   = payment − toInvoice − toOpening  → MUST be 0
    //                else PAYMENT_EXCEEDS_ALLOCATABLE
    // Invoice settlement ALWAYS precedes opening-balance settlement
    // (older debt first; codified ledger ordering contract per
    // sprint-plan §PD.2.3).
    const openingTotal = account.openingBalance ?? 0;
    const openingSettled = account.openingBalanceSettled ?? 0;
    const openingRemaining = Math.max(0, openingTotal - openingSettled);

    const toInvoice = Math.min(dto.amount, invoice.amountDue);
    const toOpening = Math.min(dto.amount - toInvoice, openingRemaining);
    const leftover = dto.amount - toInvoice - toOpening;

    if (leftover > 0) {
      // Plan §PD.2.3 case 5: overpayment beyond invoice + opening is
      // rejected outright. The credit-memo flow doesn't exist in V1;
      // see runbook PD.4.1 for the operator workaround (issue a $0
      // adjustment invoice OR record two smaller payments).
      throw new BadRequestException({
        code: FinanceErrors.PAYMENT_EXCEEDS_ALLOCATABLE,
        message:
          `Payment amount (${dto.amount}) exceeds total allocatable `
          + `(invoice due ${invoice.amountDue} + opening remaining ${openingRemaining}). `
          + `Reduce the payment to at most ${invoice.amountDue + openingRemaining}.`,
        params: {
          amount: dto.amount,
          invoiceDue: invoice.amountDue,
          openingRemaining,
          allocatable: invoice.amountDue + openingRemaining,
        },
      });
    }

    // Build the per-target allocation breakdown. Invoice entry FIRST
    // (ledger ordering); opening entry OPTIONAL (only when toOpening > 0).
    const applications: PaymentApplication[] = [];
    if (toInvoice > 0) {
      applications.push({ targetType: 'invoice', invoiceId: dtoInvoiceId, amount: toInvoice });
    }
    if (toOpening > 0) {
      applications.push({ targetType: 'opening_balance', amount: toOpening });
    }
    // Pilot PD.2 Phase C CORR-2 fix — explicit empty-applications guard.
    // Pre-Phase-C the comment claimed "an invoice-only payment ALWAYS
    // has toInvoice > 0 because the invoice status checks above prevent
    // paying a paid/cancelled/written-off invoice" — true today, but a
    // future code path that lifts the status check could make this
    // empty. The composite-ledger helper would then throw a generic
    // runtime Error; this guard surfaces an early 400 instead.
    if (applications.length === 0) {
      throw new BadRequestException({
        code: FinanceErrors.NO_ALLOCATABLE_TARGETS,
        message:
          `Payment amount ${dto.amount} produced no allocatable targets `
          + `(invoice.amountDue=${invoice.amountDue}, openingRemaining=${openingRemaining}). `
          + 'This usually means amount=0 or an upstream validation gap.',
      });
    }

    // Pilot PD.2 Phase C CONC-7 fix — chronology guard. The operator
    // can supply `dto.paidDate` (manual back-dating for late-recorded
    // cash payments). When the account has an opening-balance snapshot
    // with an explicit `openingBalanceAsOf`, the payment's paidDate
    // must NOT predate the opening-balance effective date — otherwise
    // the ledger reads "payment received BEFORE the carry-forward
    // existed" which is incoherent for reconciliation.
    if (
      account.openingBalanceAsOf
      && dto.paidDate
      && dto.paidDate < account.openingBalanceAsOf
    ) {
      throw new BadRequestException({
        code: FinanceErrors.PAYMENT_PAID_DATE_BEFORE_OPENING_AS_OF,
        message:
          `Payment paidDate (${dto.paidDate}) is earlier than the account's `
          + `opening-balance effective date (${account.openingBalanceAsOf}). `
          + `A payment cannot be recorded BEFORE the carry-forward it would settle. `
          + `Adjust paidDate to ≥ ${account.openingBalanceAsOf}.`,
        params: {
          paidDate: dto.paidDate,
          openingBalanceAsOf: account.openingBalanceAsOf,
        },
      });
    }

    // 3. Create payment entity.
    // Sprint A.2: denormalize gradeLevel + resolution status from the
    // parent invoice. Snapshot semantics — never updated on promotion,
    // mirrors InvoiceEntity.gradeLevel.
    // Pilot PD.2.3: also pass `applications` for the per-target breakdown.
    const paymentEntity = createPaymentEntity(
      context.tenantId,
      schoolId,
      {
        invoiceId: dtoInvoiceId,
        studentAccountId: invoice.studentAccountId,
        studentId: invoice.studentId,
        amount: dto.amount,
        currency: invoice.currency,
        gateway: dto.gateway,
        paidBy: context.userId,
        idempotencyKey: dto.idempotencyKey,
        gradeLevel: invoice.gradeLevel,
        gradeLevelResolutionStatus: invoice.gradeLevelResolutionStatus,
        applications,
      },
      context.userId,
    );

    // 4. Complete the payment immediately (manual payments)
    const now = new Date().toISOString();
    paymentEntity.status = 'completed';
    paymentEntity.paidAt = dto.paidDate || now;
    paymentEntity.gsi1sk = GSIKeyBuilder.entitySort('PAYMENT', `completed#${paymentEntity.paidAt}`);
    // Sprint A.5 Codex P2 — re-key gsi14sk to PAYMENT#{paidAt} so the
    // GSI14 list-by-grade ordering reflects the actual processed
    // (paid) time, not the creation time. For late-entered manual
    // receipts the operator-supplied `paidDate` is honored. Sparse:
    // only re-key when this payment carries a gradeLevel snapshot.
    if (paymentEntity.gradeLevel) {
      paymentEntity.gsi14sk = GSIKeyBuilder.entitySort('PAYMENT', paymentEntity.paidAt);
    }

    // 5. Generate receipt number
    paymentEntity.receiptNumber = await this.sequenceService.nextReceiptNumber(
      client,
      context.tenantId,
      schoolId,
    );

    if (dto.referenceNumber) {
      paymentEntity.gatewayTransactionId = dto.referenceNumber;
    }
    if (dto.notes) {
      paymentEntity.metadata = { ...paymentEntity.metadata, notes: dto.notes };
    }

    // 6. Sprint C2.B.T4 — atomic write of payment + invoice + ledger(s) + account.
    // Pilot PD.2.3 extends this to support N ledger entries (1 per
    // PaymentApplication) via `buildCompositeLedgerTransactItems`, plus
    // an `openingBalanceSettled` increment on the account Update when
    // `toOpening > 0`. (Original BUG-F3 closure invariants preserved:
    // any failure rolls ALL writes back; receipt-number advance is fine.)
    const tableName = this.dynamoDBClient.getTableName();
    const applyItem = this.invoicesService.buildApplyPaymentTransactItem(
      invoice,
      toInvoice, // Only the invoice-allocated portion lands on the invoice
      context,
    );

    // Pilot PD.2.3 — one ledger Put per application, ordered (invoice
    // FIRST, opening LAST). Per-entry description names the target so
    // operators can read the ledger without joining back to the
    // payment row.
    const composite = this.studentAccountsService.buildCompositeLedgerTransactItems(
      account,
      applications.map(app => ({
        entryType: 'payment' as const,
        referenceId: paymentEntity.paymentId,
        description:
          app.targetType === 'invoice'
            ? `Payment ${paymentEntity.receiptNumber} via ${dto.gateway} → invoice ${invoice.invoiceNumber}`
            : `Payment ${paymentEntity.receiptNumber} via ${dto.gateway} → opening balance`,
        debit: 0,
        credit: app.amount,
      })),
      context,
    );

    // Pilot PD.2.3 — when this payment settles part of the opening
    // balance, the account Update must ALSO bump
    // `openingBalanceSettled` (used by PD.1.6 mapper to compute
    // `openingBalanceRemaining = openingBalance − openingBalanceSettled`).
    // Append the SET fragment to the account Update that
    // buildCompositeLedgerTransactItems produced (last item in the
    // returned items array).
    if (toOpening > 0) {
      const accountUpdateItem: any = composite.items[composite.items.length - 1];
      accountUpdateItem.Update.UpdateExpression +=
        ', openingBalanceSettled = if_not_exists(openingBalanceSettled, :zero) + :toOpening';
      accountUpdateItem.Update.ExpressionAttributeValues[':zero'] = 0;
      accountUpdateItem.Update.ExpressionAttributeValues[':toOpening'] = toOpening;
      // Pilot PD.2 Phase C CONC-3 fix — reference the LIVE
      // `openingBalance` attribute (not a snapshot) in both the
      // openingBalance match AND the over-settle ceiling. Pre-fix the
      // condition compared against `:openingTotal` snapshotted from GET
      // time; a concurrent setOpeningBalance that revised openingBalance
      // DOWN between GET and TX would have left the condition unsound
      // (allowing settlement against a smaller-than-snapshotted balance).
      //
      // The version check (`#v = :currentVersion`, set by the composite
      // helper) already catches the race in practice — setOpeningBalance
      // bumps the version — but referencing the live attribute makes the
      // guard correct on its own terms, not just incidentally protected
      // by a sibling clause.
      accountUpdateItem.Update.ExpressionAttributeValues[':snapshotOpeningBalance'] = openingTotal;
      accountUpdateItem.Update.ConditionExpression +=
        ' AND openingBalance = :snapshotOpeningBalance'
        + ' AND if_not_exists(openingBalanceSettled, :zero) + :toOpening <= openingBalance';
    }

    try {
      await this.dynamoDBClient.transactWrite(client, [
        {
          Put: {
            TableName: tableName,
            Item: paymentEntity,
            ConditionExpression: 'attribute_not_exists(entityKey)',
          },
        },
        applyItem.item,
        ...composite.items,
      ]);
    } catch (err: any) {
      // TransactionCanceledException carries CancellationReasons[] in the
      // SDK error; surface a 409 + the per-op reason so the operator can
      // tell whether it was a version drift, a status drift, or worse.
      // Pilot PD.2.3 — labels grow dynamically with the composite ledger
      // count (1 ledger Put per application + 1 account Update).
      const errorName = err?.name ?? '';
      if (errorName === 'TransactionCanceledException') {
        const reasons = (err?.CancellationReasons as { Code?: string; Message?: string }[] | undefined) ?? [];
        const ledgerLabels = applications.map((app, i) =>
          `ledger_put_${i}_${app.targetType}`,
        );
        const labels = ['payment_put', 'invoice_apply', ...ledgerLabels, 'account_update'];
        const detail = reasons.map((r, i) => `${labels[i] ?? `op_${i}`}=${r?.Code ?? 'OK'}`).join(', ');
        this.logger.warn({
          action: 'payment.manual_transaction_cancelled',
          schoolId,
          invoiceId: dtoInvoiceId,
          paymentId: paymentEntity.paymentId,
          applications: applications.map(a => a.targetType),
          detail,
        });
        throw new ConflictException({
          code: FinanceErrors.CONCURRENT_UPDATE,
          message: `Payment write rolled back due to concurrent modification. Reasons: ${detail}. Please retry.`,
        });
      }
      throw err;
    }

    this.logger.log({
      action: 'payment.manual_recorded',
      schoolId,
      invoiceId: dtoInvoiceId,
      paymentId: paymentEntity.paymentId,
      gateway: dto.gateway,
      amount: dto.amount,
      receiptNumber: paymentEntity.receiptNumber,
      // PD.2.3 — emit allocation breakdown for ops visibility.
      applications: applications.map(a => ({ targetType: a.targetType, amount: a.amount })),
      ledgerEntryIds: composite.ledgerEntries.map(le => le.entryId),
    });

    // 7. Publish event AFTER the transaction commits. EventBridge isn't
    // transactional with DDB; fire-and-forget the post-commit signal.
    this.eventsService.publishPaymentCompleted(
      context.tenantId,
      schoolId,
      paymentEntity.paymentId,
      dtoInvoiceId,
      dto.amount,
      dto.gateway,
    ).catch(err => this.logger.error(`Failed to publish PaymentCompleted: ${err.message}`));

    return paymentEntityToDto(paymentEntity);
  }

  /**
   * EPIC-FB FB-4.4 — multi-target manual payment: one cheque settles
   * 2..20 sibling invoices (possibly across multiple students' billing
   * accounts) in ONE TransactWriteItems.
   *
   * Transact composition (item order is the CancellationReasons contract):
   *   [0]              payment Put (attribute_not_exists)
   *   [1..N]           invoice apply Update per target, in canonical plan
   *                    order (dueDate asc, invoiceNumber asc)
   *   [N+1..]          per affected ACCOUNT, grouped in first-appearance
   *                    order of the plan: K ledger Puts (one per target on
   *                    that account) followed by that account's single
   *                    Update (version-conditioned) — the composite-helper
   *                    shape, repeated M times
   *
   * Ceiling: 1 + N + (N + M) ≤ 1 + 20 + 40 = 61, far under DDB's 100-item
   * transactWrite limit; asserted defensively anyway.
   *
   * Deliberately NOT here (V1): opening-balance settlement (multi-target
   * payments never touch opening balances — see payment-allocation.planner
   * header), gradeLevel snapshot + GSI14 keys (a family payment spans
   * grades; grade-scoped payment lists remain single-student views).
   */
  private async recordMultiTargetManualPayment(
    schoolId: string,
    dto: RecordManualPaymentDto,
    applicationsInput: NonNullable<RecordManualPaymentDto['applications']>,
    context: RequestContext,
  ): Promise<Payment> {
    // Defense-in-depth behind the schema's min(2): a 1-entry multi row
    // (null scalar ids) would fall into every consumer's single-target
    // branch and break void/refund/receipts (review P1-1).
    if (applicationsInput.length < 2) {
      throw new BadRequestException({
        code: FinanceErrors.INVALID_PAYMENT_APPLICATIONS,
        message: "applications[] requires at least 2 targets; use 'invoiceId' for a single-invoice payment",
      });
    }
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // 1. Fetch every target invoice. getEntity is school-scoped, so a
    // wrong-school target 404s here — the "same school" rule for free.
    const invoiceEntities = await Promise.all(
      applicationsInput.map(app => this.invoicesService.getEntity(schoolId, app.invoiceId, context)),
    );
    const invoiceById = new Map(invoiceEntities.map(inv => [inv.invoiceId, inv]));

    // 2. Per-target status validation (same codes as the single path).
    for (const invoice of invoiceEntities) {
      if (invoice.status === 'paid') {
        throw new BadRequestException({
          code: FinanceErrors.INVOICE_ALREADY_PAID,
          message: `Invoice ${invoice.invoiceNumber} is already fully paid`,
        });
      }
      if (invoice.status === 'cancelled' || invoice.status === 'written_off') {
        throw new BadRequestException({
          code: FinanceErrors.INVOICE_CANCELLED,
          message: `Cannot pay a ${invoice.status} invoice (${invoice.invoiceNumber})`,
        });
      }
    }

    // 3. Currency coherence: every target must share ONE currency, and a
    // caller-declared currency must match it (Sprint C2.T2 rule, widened).
    const currencies = [...new Set(invoiceEntities.map(inv => inv.currency))];
    if (currencies.length > 1) {
      throw new BadRequestException({
        code: FinanceErrors.PAYMENT_CURRENCY_MISMATCH,
        message: `Target invoices carry mixed currencies (${currencies.join(', ')}); a payment settles one currency.`,
        params: { currencies },
      });
    }
    const currency = invoiceEntities[0].currency;
    if (dto.currency && dto.currency !== currency) {
      throw new BadRequestException({
        code: FinanceErrors.PAYMENT_CURRENCY_MISMATCH,
        message: `Payment currency (${dto.currency}) does not match invoice currency (${currency})`,
        params: { paymentCurrency: dto.currency, invoiceCurrency: currency },
      });
    }

    // 4. amountDue coherence — a requested allocation above the CURRENT
    // amountDue means the operator acted on a stale view (a concurrent
    // payment landed): 409, not 400, so the client re-fetches and retries.
    for (const app of applicationsInput) {
      const invoice = invoiceById.get(app.invoiceId)!;
      if (app.amount - invoice.amountDue > 0.01) {
        throw new ConflictException({
          code: FinanceErrors.PAYMENT_APPLICATION_EXCEEDS_DUE,
          message:
            `Allocation (${app.amount}) for invoice ${invoice.invoiceNumber} exceeds its `
            + `current amount due (${invoice.amountDue}). The invoice changed since it was `
            + `loaded — refresh and retry.`,
          params: {
            invoiceId: invoice.invoiceId,
            invoiceNumber: invoice.invoiceNumber,
            allocated: app.amount,
            amountDue: invoice.amountDue,
          },
        });
      }
    }

    // 5. Canonical plan via the FB-4.3 planner (explicit strategy):
    // re-validates distinctness + Σ === amount, and emits entries in
    // dueDate-asc / invoiceNumber-asc order regardless of caller order.
    const plan = planPaymentAllocation(
      dto.amount,
      invoiceEntities.map(inv => ({
        invoiceId: inv.invoiceId,
        invoiceNumber: inv.invoiceNumber,
        studentAccountId: inv.studentAccountId,
        amountDue: inv.amountDue,
        dueDate: inv.dueDate,
      })),
      'explicit',
      applicationsInput,
    );
    const orderedInvoices = plan.map(p => invoiceById.get(p.invoiceId)!);

    // 6. Billing accounts — one per DISTINCT student, in first-appearance
    // order of the plan (this fixes the per-account grouping order in the
    // transaction and in the cancellation labels).
    const orderedStudentIds = [...new Set(orderedInvoices.map(inv => inv.studentId))];
    const accountByStudentId = new Map<string, BillingAccountEntity>();
    for (const studentId of orderedStudentIds) {
      const account = await this.dynamoDBClient.getItem<BillingAccountEntity>(
        client,
        context.tenantId,
        EntityKeyBuilder.billingAccount(schoolId, studentId),
      );
      if (!account) {
        throw new NotFoundException({
          code: FinanceErrors.ACCOUNT_NOT_FOUND,
          message: `Billing account for student ${studentId} at school ${schoolId} not found`,
        });
      }
      accountByStudentId.set(studentId, account);
    }

    // 7. Chronology guard per affected account (CONC-7, per-account): a
    // back-dated paidDate must not predate ANY affected account's
    // opening-balance effective date. 409 naming the violating account.
    if (dto.paidDate) {
      for (const account of accountByStudentId.values()) {
        if (account.openingBalanceAsOf && dto.paidDate < account.openingBalanceAsOf) {
          throw new ConflictException({
            code: FinanceErrors.PAYMENT_PAID_DATE_BEFORE_OPENING_AS_OF,
            message:
              `Payment paidDate (${dto.paidDate}) is earlier than the opening-balance `
              + `effective date (${account.openingBalanceAsOf}) of student ${account.studentId}'s `
              + `account (${account.accountId}). Adjust paidDate to ≥ ${account.openingBalanceAsOf}.`,
            params: {
              paidDate: dto.paidDate,
              openingBalanceAsOf: account.openingBalanceAsOf,
              accountId: account.accountId,
              studentId: account.studentId,
            },
          });
        }
      }
    }

    // 8. Payment entity — multi-target identity: null scalars, GSI2 keys
    // absent (created conditionally by the factory), optional familyId.
    const paymentEntity = createPaymentEntity(
      context.tenantId,
      schoolId,
      {
        invoiceId: null,
        studentAccountId: null,
        studentId: null,
        familyId: dto.familyId,
        amount: dto.amount,
        currency,
        gateway: dto.gateway,
        paidBy: context.userId,
        idempotencyKey: dto.idempotencyKey,
        applications: plan,
      },
      context.userId,
    );

    const now = new Date().toISOString();
    paymentEntity.status = 'completed';
    paymentEntity.paidAt = dto.paidDate || now;
    paymentEntity.gsi1sk = GSIKeyBuilder.entitySort('PAYMENT', `completed#${paymentEntity.paidAt}`);
    paymentEntity.receiptNumber = await this.sequenceService.nextReceiptNumber(
      client,
      context.tenantId,
      schoolId,
    );
    if (dto.referenceNumber) {
      paymentEntity.gatewayTransactionId = dto.referenceNumber;
    }
    if (dto.notes) {
      paymentEntity.metadata = { ...paymentEntity.metadata, notes: dto.notes };
    }

    // 9. One TransactWriteItems (see method header for the composition).
    const tableName = this.dynamoDBClient.getTableName();
    const transactItems: Parameters<DynamoDBClientService['transactWrite']>[1] = [
      {
        Put: {
          TableName: tableName,
          Item: paymentEntity,
          ConditionExpression: 'attribute_not_exists(entityKey)',
        },
      },
    ];
    const labels: string[] = ['payment_put'];

    for (const [i, planEntry] of plan.entries()) {
      const invoice = orderedInvoices[i];
      transactItems.push(
        this.invoicesService.buildApplyPaymentTransactItem(invoice, planEntry.amount, context).item,
      );
      labels.push(`invoice_apply_${i}_${invoice.invoiceNumber}`);
    }

    const allLedgerEntryIds: string[] = [];
    for (const studentId of orderedStudentIds) {
      const account = accountByStudentId.get(studentId)!;
      const accountPlanEntries = plan.filter(
        p => invoiceById.get(p.invoiceId)!.studentId === studentId,
      );
      const composite = this.studentAccountsService.buildCompositeLedgerTransactItems(
        account,
        accountPlanEntries.map(p => ({
          entryType: 'payment' as const,
          referenceId: paymentEntity.paymentId,
          description:
            `Payment ${paymentEntity.receiptNumber} via ${dto.gateway} → invoice `
            + `${invoiceById.get(p.invoiceId)!.invoiceNumber}`,
          debit: 0,
          credit: p.amount,
        })),
        context,
      );
      transactItems.push(...composite.items);
      accountPlanEntries.forEach((_, k) => labels.push(`ledger_put_${studentId}_${k}`));
      labels.push(`account_update_${studentId}`);
      allLedgerEntryIds.push(...composite.ledgerEntries.map(le => le.entryId));
    }

    // DDB hard ceiling — schema cap 20 keeps us ≤ 61; assert anyway so a
    // future widening can't silently split the atomicity guarantee.
    if (transactItems.length > 100) {
      throw new Error(
        `Multi-target payment produced ${transactItems.length} transact items; `
        + `DDB TransactWriteItems supports at most 100.`,
      );
    }

    try {
      await this.dynamoDBClient.transactWrite(client, transactItems);
    } catch (err: any) {
      if ((err?.name ?? '') === 'TransactionCanceledException') {
        const reasons = (err?.CancellationReasons as { Code?: string; Message?: string }[] | undefined) ?? [];
        const detail = reasons.map((r, i) => `${labels[i] ?? `op_${i}`}=${r?.Code ?? 'OK'}`).join(', ');
        this.logger.warn({
          action: 'payment.multi_target_transaction_cancelled',
          schoolId,
          paymentId: paymentEntity.paymentId,
          familyId: dto.familyId,
          targets: plan.map(p => p.invoiceId),
          detail,
        });
        throw new ConflictException({
          code: FinanceErrors.CONCURRENT_UPDATE,
          message: `Payment write rolled back due to concurrent modification. Reasons: ${detail}. Please retry.`,
        });
      }
      throw err;
    }

    this.logger.log({
      action: 'payment.manual_recorded',
      schoolId,
      multiTarget: true,
      familyId: dto.familyId,
      paymentId: paymentEntity.paymentId,
      gateway: dto.gateway,
      amount: dto.amount,
      receiptNumber: paymentEntity.receiptNumber,
      applications: plan.map(p => ({ invoiceId: p.invoiceId, amount: p.amount })),
      accounts: orderedStudentIds,
      ledgerEntryIds: allLedgerEntryIds,
    });

    // Post-commit event — invoiceId is null by design (no single target);
    // per-invoice movement is on the ledger entries.
    this.eventsService.publishPaymentCompleted(
      context.tenantId,
      schoolId,
      paymentEntity.paymentId,
      null,
      dto.amount,
      dto.gateway,
    ).catch(err => this.logger.error(`Failed to publish PaymentCompleted: ${err.message}`));

    return paymentEntityToDto(paymentEntity);
  }

  /**
   * Resolve a payment session to its schoolId and studentId for ownership checks.
   * O(1) DynamoDB GetItem on the SESSION mapping entity.
   */
  async resolveSessionContext(
    sessionId: string,
    context: RequestContext,
  ): Promise<{ schoolId: string; studentId: string }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const sessionMapping = await this.dynamoDBClient.getItem<{
      paymentId: string;
      schoolId: string;
      invoiceId: string;
      studentId?: string;
    }>(client, context.tenantId, EntityKeyBuilder.paymentSession(sessionId));

    if (!sessionMapping) {
      throw new NotFoundException(`Payment session ${sessionId} not found`);
    }

    // studentId is stored on session entity for new sessions.
    // For older sessions created before this field was added, fall back to payment entity lookup.
    if (sessionMapping.studentId) {
      return { schoolId: sessionMapping.schoolId, studentId: sessionMapping.studentId };
    }

    const paymentEntityKey = EntityKeyBuilder.payment(sessionMapping.schoolId, sessionMapping.paymentId);
    const payment = await this.dynamoDBClient.getItem<PaymentEntity>(
      client,
      context.tenantId,
      paymentEntityKey,
    );
    // FB-4.4 — sessions only exist for gateway payments, which are always
    // single-student; a null studentId here means the session points at a
    // row it can't own-check. Fail closed.
    if (!payment || !payment.studentId) {
      throw new NotFoundException(`Payment not found for session ${sessionId}`);
    }
    return { schoolId: sessionMapping.schoolId, studentId: payment.studentId };
  }

  /**
   * Expose invoice studentId for ownership checks in the controller.
   */
  async getInvoiceForOwnershipCheck(
    schoolId: string,
    invoiceId: string,
    context: RequestContext,
  ): Promise<{ studentId: string; studentAccountId: string }> {
    const entity = await this.invoicesService.getEntity(schoolId, invoiceId, context);
    return { studentId: entity.studentId, studentAccountId: entity.studentAccountId };
  }

  async get(
    schoolId: string,
    paymentId: string,
    context: RequestContext,
  ): Promise<Payment> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.payment(schoolId, paymentId);

    const entity = await this.dynamoDBClient.getItem<PaymentEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!entity) throw new NotFoundException(`Payment ${paymentId} not found`);

    return paymentEntityToDto(entity);
  }

  async listBySchool(
    schoolId: string,
    context: RequestContext,
    options: { status?: string; gateway?: string; limit?: number; cursor?: string } = {},
  ): Promise<{ items: Payment[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const filterParts: string[] = [];
    const filterValues: Record<string, any> = {};

    if (options.status) {
      filterParts.push('#status = :status');
      filterValues[':status'] = options.status;
    }
    if (options.gateway) {
      filterParts.push('gateway = :gateway');
      filterValues[':gateway'] = options.gateway;
    }

    const result = await this.dynamoDBClient.queryGSI<PaymentEntity>(
      client,
      'GSI1',
      gsi1pk,
      'PAYMENT',
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(filterValues).length > 0 ? filterValues : undefined,
      filterParts.some(p => p.includes('#status')) ? { '#status': 'status' } : undefined,
      options.limit || 50,
      false,
      decodeCursor(options.cursor),
    );

    // Enrich payments with student name + invoice number from related
    // invoices. FB-4.5: multi-target family payments carry invoiceId=null —
    // they list fine, just without single-invoice enrichment (their
    // breakdown is in applications[]).
    const invoiceIds = [...new Set(result.items.map(p => p.invoiceId))]
      .filter((id): id is string => !!id);
    const invoiceKeys = invoiceIds.map(invoiceId => ({
      tenantId: context.tenantId,
      entityKey: EntityKeyBuilder.invoice(schoolId, invoiceId),
    }));

    let invoiceMap: Map<string, { studentName: string; invoiceNumber: string }> = new Map();
    try {
      const invoices = await this.dynamoDBClient.batchGetItems<InvoiceEntity>(client, invoiceKeys);
      invoiceMap = new Map(
        invoices.map(inv => [inv.invoiceId, { studentName: inv.studentName, invoiceNumber: inv.invoiceNumber }]),
      );
    } catch (err: any) {
      this.logger.warn(`Failed to enrich payments with invoice data: ${err.message}`);
    }

    return {
      items: result.items.map(p => paymentEntityToDto(p, p.invoiceId ? invoiceMap.get(p.invoiceId) : undefined)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * List payments for a specific (school, gradeLevel) pair — Sprint A.4.
   *
   * Mirror of `InvoicesService.listBySchoolAndGrade`. Uses GSI14 with
   * `begins_with(gsi14sk, 'PAYMENT#')` to narrow within the shared
   * (invoice + payment) GSI namespace. Sparse — only payments whose
   * snapshot `gradeLevel` is truthy appear here.
   *
   * Same invoice-enrichment as `list()` so the response carries
   * studentName + invoiceNumber alongside each payment.
   */
  async listBySchoolAndGrade(
    schoolId: string,
    gradeLevel: string,
    context: RequestContext,
    options: { status?: string; gateway?: string; limit?: number; cursor?: string } = {},
  ): Promise<{ items: Payment[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    if (!gradeLevel || !gradeLevel.trim()) {
      throw new BadRequestException(
        `listBySchoolAndGrade requires a non-empty gradeLevel; got ${JSON.stringify(gradeLevel)}`,
      );
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi14pk = GSIKeyBuilder.schoolGradeScope(context.tenantId, schoolId, gradeLevel);

    const filterParts: string[] = [];
    const filterValues: Record<string, unknown> = {};
    const filterNames: Record<string, string> = {};

    if (options.status) {
      filterParts.push('#status = :status');
      filterValues[':status'] = options.status;
      filterNames['#status'] = 'status';
    }
    if (options.gateway) {
      filterParts.push('gateway = :gateway');
      filterValues[':gateway'] = options.gateway;
    }

    const result = await this.dynamoDBClient.queryGSI<PaymentEntity>(
      client,
      'GSI14',
      gsi14pk as string,
      'PAYMENT',
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(filterValues).length > 0 ? filterValues : undefined,
      Object.keys(filterNames).length > 0 ? filterNames : undefined,
      options.limit || 50,
      false,
      decodeCursor(options.cursor),
    );

    this.logger.log(
      `listBySchoolAndGrade entity=PAYMENT schoolId=${schoolId} grade=${gradeLevel} returned=${result.items.length}`,
    );

    // Enrich payments with student name + invoice number from related
    // invoices (mirror of `list()`). FB-4.5: null-invoiceId tolerance —
    // multi-target payments never appear here (no gradeLevel → no GSI14
    // keys) but the guard keeps the two enrichment blocks identical.
    const invoiceIds = [...new Set(result.items.map(p => p.invoiceId))]
      .filter((id): id is string => !!id);
    const invoiceKeys = invoiceIds.map(invoiceId => ({
      tenantId: context.tenantId,
      entityKey: EntityKeyBuilder.invoice(schoolId, invoiceId),
    }));

    let invoiceMap: Map<string, { studentName: string; invoiceNumber: string }> = new Map();
    try {
      const invoices = await this.dynamoDBClient.batchGetItems<InvoiceEntity>(client, invoiceKeys);
      invoiceMap = new Map(
        invoices.map(inv => [inv.invoiceId, { studentName: inv.studentName, invoiceNumber: inv.invoiceNumber }]),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`listBySchoolAndGrade: failed to enrich payments with invoice data: ${msg.slice(0, 200)}`);
    }

    return {
      items: result.items.map(p => paymentEntityToDto(p, p.invoiceId ? invoiceMap.get(p.invoiceId) : undefined)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  async listByInvoice(
    schoolId: string,
    invoiceId: string,
    context: RequestContext,
  ): Promise<Payment[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    // FB-4.5 — a multi-target family payment that settled this invoice has
    // invoiceId=null; it's matched via the denormalized
    // `applicationInvoiceIds` list (a DDB filter can't reach into the
    // applications[] object list). Single-target rows match the scalar.
    const result = await this.dynamoDBClient.queryGSI<PaymentEntity>(
      client,
      'GSI1',
      gsi1pk,
      'PAYMENT',
      'begins_with',
      'invoiceId = :invoiceId OR contains(applicationInvoiceIds, :invoiceId)',
      { ':invoiceId': invoiceId },
    );

    return result.items.map((entity) => paymentEntityToDto(entity));
  }

  async getReceipt(
    schoolId: string,
    paymentId: string,
    context: RequestContext,
  ): Promise<Receipt> {
    const { receipt } = await this.getReceiptWithOwnershipTargets(schoolId, paymentId, context);
    return receipt;
  }

  /**
   * Review F3 (owner decision 2026-07-05): multi-target family receipts
   * require ownership of ALL target students on the parent-facing path.
   * Returns the receipt plus the DISTINCT studentIds the controller must
   * run `enforceStudentOwnership` over before releasing the receipt (JSON
   * or PDF): single-target → `[invoice.studentId]`, byte-identical to the
   * legacy single check; multi-target → every distinct target invoice's
   * studentId, in application order.
   */
  async getReceiptWithOwnershipTargets(
    schoolId: string,
    paymentId: string,
    context: RequestContext,
  ): Promise<{ receipt: Receipt; ownershipStudentIds: string[] }> {
    const payment = await this.get(schoolId, paymentId, context);

    if (payment.status !== 'completed') {
      throw new BadRequestException('Receipt is only available for completed payments');
    }

    // EPIC-FB FB-4.5 — multi-target family payment: no single invoice to
    // project line items from; the receipt renders one breakdown line per
    // target invoice instead.
    const multiInvoiceApps = (payment.applications ?? []).filter(
      (a): a is Extract<NonNullable<Payment['applications']>[number], { targetType: 'invoice' }> =>
        a.targetType === 'invoice',
    );
    if (!payment.invoiceId && multiInvoiceApps.length >= 2) {
      return this.getMultiTargetReceipt(schoolId, payment, multiInvoiceApps, context);
    }

    // Fetch the invoice for line item details, then look up the student
    // identity to surface the governance-correct identifiers (school roll
    // number + CEHRD/IEMIS) that replace the internal `studentId` UUID on
    // the operator-facing receipt. Identity lookup is best-effort: on
    // failure it returns null and the receipt falls back to the legacy
    // shape (studentId-only) rather than 5xx-ing.
    const invoice = await this.invoicesService.get(schoolId, payment.invoiceId!, context);
    const student = await this.identityClient.getStudentInfo(invoice.studentId, context);

    // `payment.paidBy` is the *recorder* — the staff user who entered the
    // payment — stored as a userId UUID. Resolve it to a display name so
    // the receipt's "Recorded By" line carries a human name, not a UUID.
    const recordedBy = await this.resolveRecordedBy(payment.paidBy, invoice.studentName, context);

    const receipt: Receipt = {
      receiptNumber: payment.receiptNumber || `RCP-${paymentId.substring(0, 8)}`,
      paymentId: payment.id,
      invoiceNumber: invoice.invoiceNumber,
      transactionId: payment.gatewayTransactionId || payment.id,
      studentName: invoice.studentName,
      studentId: invoice.studentId,
      studentNumber: student?.studentNumber,
      emisStudentId: student?.emisStudentId,
      schoolName: invoice.schoolName,
      paidDate: payment.paidAt || payment.createdAt,
      amount: payment.amount,
      currency: payment.currency,
      gateway: payment.gateway,
      gatewayDisplayName: payment.gateway.charAt(0).toUpperCase() + payment.gateway.slice(1),
      lineItems: invoice.lineItems.map(li => ({
        description: li.description,
        amount: li.amount,
        taxAmount: li.taxAmount,
        total: li.total,
      })),
      subtotal: invoice.subtotal,
      taxTotal: invoice.taxTotal,
      discountTotal: invoice.discountTotal,
      grandTotal: invoice.grandTotal,
      taxBreakdown: {
        taxableAmount: invoice.subtotal - invoice.discountTotal,
        taxAmount: invoice.taxTotal,
      },
      paidBy: recordedBy,
    };
    return { receipt, ownershipStudentIds: [invoice.studentId] };
  }

  /**
   * EPIC-FB FB-4.5 — receipt JSON for a multi-target family payment.
   *
   * One breakdown line per target invoice (`Invoice {number} — {student}`,
   * amount = that target's allocation). Tax/discount detail stays on the
   * individual invoices — this is a PAYMENT receipt (money received), so
   * its own tax columns are zero and `grandTotal === payment.amount`.
   *
   * `studentId`/`studentName`: the Receipt contract predates multi-target
   * payments and requires a single studentId; we emit the FIRST target's
   * student (canonical plan order) with all names joined in `studentName`.
   * Review F3 (owner decision 2026-07-05): multi-target family receipts
   * require ownership of ALL target students on the parent-facing path —
   * the controller loops `enforceStudentOwnership` over the returned
   * `ownershipStudentIds` (every distinct target student), so the
   * first-target `studentId` is display plumbing only, never the
   * access-control key.
   *
   * Invoice numbers are fetched with ONE BatchGetItems over the target
   * keys, not N GetItems.
   */
  private async getMultiTargetReceipt(
    schoolId: string,
    payment: Payment,
    invoiceApps: Array<{ targetType: 'invoice'; invoiceId: string; amount: number }>,
    context: RequestContext,
  ): Promise<{ receipt: Receipt; ownershipStudentIds: string[] }> {
    const targets = await this.getTargetInvoiceEntities(schoolId, invoiceApps.map(a => a.invoiceId), context);
    const first = targets[0];
    const ownershipStudentIds = [...new Set(targets.map(t => t.studentId))];
    const uniqueNames = [...new Set(targets.map(t => t.studentName))];
    const recordedBy = await this.resolveRecordedBy(payment.paidBy, uniqueNames.join(', '), context);
    const allocated = invoiceApps.reduce((s, a) => s + a.amount, 0);
    const targetById = new Map(targets.map(t => [t.invoiceId, t]));

    const receipt: Receipt = {
      receiptNumber: payment.receiptNumber || `RCP-${payment.id.substring(0, 8)}`,
      paymentId: payment.id,
      invoiceNumber: `${invoiceApps.length} invoices`,
      transactionId: payment.gatewayTransactionId || payment.id,
      studentName: uniqueNames.join(', '),
      studentId: first.studentId,
      schoolName: first.schoolName,
      paidDate: payment.paidAt || payment.createdAt,
      amount: payment.amount,
      currency: payment.currency,
      gateway: payment.gateway,
      gatewayDisplayName: payment.gateway.charAt(0).toUpperCase() + payment.gateway.slice(1),
      lineItems: invoiceApps.map(app => {
        const target = targetById.get(app.invoiceId)!;
        return {
          description: `Invoice ${target.invoiceNumber} — ${target.studentName}`,
          amount: app.amount,
          taxAmount: 0,
          total: app.amount,
        };
      }),
      subtotal: allocated,
      taxTotal: 0,
      discountTotal: 0,
      grandTotal: payment.amount,
      taxBreakdown: {
        taxableAmount: allocated,
        taxAmount: 0,
      },
      paidBy: recordedBy,
    };
    return { receipt, ownershipStudentIds };
  }

  /**
   * FB-4.5 — load the target invoice ENTITIES of a multi-target payment in
   * APPLICATION order via one BatchGetItems. Throws 404 if any target row
   * has vanished (data corruption — a payment must never reference a
   * missing invoice).
   */
  private async getTargetInvoiceEntities(
    schoolId: string,
    invoiceIds: string[],
    context: RequestContext,
  ): Promise<InvoiceEntity[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const rows = await this.dynamoDBClient.batchGetItems<InvoiceEntity>(
      client,
      invoiceIds.map(id => ({
        tenantId: context.tenantId,
        entityKey: EntityKeyBuilder.invoice(schoolId, id),
      })),
    );
    const byId = new Map(rows.map(r => [r.invoiceId, r]));
    return invoiceIds.map(id => {
      const row = byId.get(id);
      if (!row) {
        throw new NotFoundException({
          code: FinanceErrors.INVOICE_NOT_FOUND,
          message: `Invoice ${id} referenced by a payment application was not found`,
        });
      }
      return row;
    });
  }

  /**
   * Resolve the `paidBy` value stored on a payment to a human-readable
   * "Recorded By" string for receipt rendering. Today `payment.paidBy`
   * is set to `context.userId` (a UUID) at record time — see
   * `recordManualPayment`. To surface a real name on the receipt:
   *   1. If it looks like a UUID → look up the user's display name.
   *   2. If lookup fails OR the value was never UUID-shaped (legacy
   *      records where some operators may have stored a free-form
   *      name directly) → trust the stored value.
   *   3. If still empty → fall back to the student name (mirrors the
   *      pdf-renderer fallback in `receipt-pdf.renderer.ts`).
   *
   * This is a read-time projection. The product follow-up is to capture
   * either an actual payer name (parent/guardian) OR a denormalized
   * recordedByName at payment record time; until then this resolver
   * keeps the UUID out of customer-facing documents.
   */
  private async resolveRecordedBy(
    paidByValue: string | null | undefined,
    studentNameFallback: string,
    context: RequestContext,
  ): Promise<string> {
    const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (paidByValue && uuidShape.test(paidByValue)) {
      const displayName = await this.identityClient.getUserDisplayName(paidByValue, context);
      if (displayName && displayName.trim().length > 0) {
        return displayName;
      }
    } else if (paidByValue && paidByValue.trim().length > 0) {
      return paidByValue;
    }
    return studentNameFallback;
  }

  /**
   * Render the payment receipt as a PDF buffer. Sprint C.1.6 — the
   * second user-visible PDF endpoint in EdForge (closes C.1 phase).
   *
   * Orchestration only — every piece of rendering logic lives in
   * `renderReceiptToPdfBuffer`. This method:
   *   1. Loads Payment + Invoice ENTITIES (raw, not DTOs) in parallel
   *      with branding + template config from identity. The renderer
   *      needs the full entity shape (more fields than the JSON DTOs).
   *   2. Enforces `status === 'completed'` — receipts are only valid for
   *      completed payments (mirror of the existing `getReceipt()` JSON
   *      endpoint's check, but with a typed errorCode for the binary
   *      endpoint).
   *   3. Parallel-fetches branding (catch-and-degrade to null) +
   *      template config (relies on C.1.4 5xx fallback).
   *   4. Calls the pure renderer.
   *   5. Emits a structured `pdf_generated` CloudWatch log line
   *      (sizeBytes + templateSource + paymentId, mirror of C.1.5). When
   *      `PDF_TIMING_ENABLED=true` is set on the task definition, the log
   *      line carries per-call stage timings: `stagePaymentDdbMs`,
   *      `stageInvoiceDdbMs`, `stageBrandingMs`, `stageTemplateMs`,
   *      `stageFanout1WallMs`, `stageStudentInfoMs`, `stageRecordedByMs`,
   *      `stageFanout2WallMs`, `stageRenderMs`. Gated so it is off by
   *      default in prod per the locked Sprint 0.1 plan.
   *
   * Ownership enforcement happens at the CONTROLLER before this is
   * called (mirror of the existing `getReceipt` controller pattern).
   *
   * `fallbackArchetype: 'PABSON'` is passed to `getCurrentTemplate` so
   * if identity is mid-deploy and 5xx-ing, PABSON tenants still get the
   * dual-language Nepali defaults rather than degrading to GENERIC.
   */
  async getReceiptPdf(
    schoolId: string,
    paymentId: string,
    context: RequestContext,
    options?: { fallbackArchetype?: PdfArchetype },
  ): Promise<Buffer> {
    const tStart = Date.now();
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const payment = await this.dynamoDBClient.getItem<PaymentEntity>(
      client,
      context.tenantId,
      EntityKeyBuilder.payment(schoolId, paymentId),
    );
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);
    const tAfterPaymentDdb = Date.now();

    // Mirror of `getReceipt()` invariant: receipts (PDF or JSON) are only
    // emitted for completed payments. Voided / refunded receipt PDFs are
    // a future C.1.6+ feature (would land alongside the renderer's
    // existing 'voided' | 'refunded' watermark cases).
    if (payment.status !== 'completed') {
      throw new BadRequestException(
        `Receipt PDF is only available for completed payments (current status: ${payment.status})`,
      );
    }

    // EPIC-FB FB-4.5 — multi-target family payment: no single parent
    // invoice. All target entities load in one BatchGetItems; the FIRST
    // (canonical plan order) supplies the school-level context and the
    // renderer gets a per-invoice breakdown instead of line items.
    const pdfInvoiceApps = (payment.applications ?? []).filter(
      (a): a is Extract<PaymentApplication, { targetType: 'invoice' }> => a.targetType === 'invoice',
    );
    const isMultiTarget = !payment.invoiceId && pdfInvoiceApps.length >= 2;

    // Fan-out 1: invoice entity/entities (DDB) + branding (identity HTTP) +
    // template config (identity HTTP). Sprint 0.1 times each call
    // individually so the spike can isolate which call dominates
    // — not just the combined wall-clock of the Promise.all.
    const invoiceDdbStart = Date.now();
    const invoicePromise = (
      isMultiTarget
        ? this.getTargetInvoiceEntities(schoolId, pdfInvoiceApps.map(a => a.invoiceId), context)
        : this.invoicesService.getEntity(schoolId, payment.invoiceId!, context).then(inv => [inv])
    ).then((result) => ({ result, ms: Date.now() - invoiceDdbStart }));

    const brandingStart = Date.now();
    const brandingPromise = this.identityClient
      .getBranding(schoolId, context)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `getReceiptPdf: branding fetch failed schoolId=${schoolId} paymentId=${paymentId}: ` +
            `${message.slice(0, 200)} — rendering without branding`,
        );
        return { branding: null, urls: undefined };
      })
      .then((result) => ({ result, ms: Date.now() - brandingStart }));

    const templateStart = Date.now();
    const templatePromise = this.identityClient
      .getCurrentTemplate(schoolId, 'RECEIPT', context, {
        fallbackArchetype: options?.fallbackArchetype ?? 'PABSON',
      })
      .then((result) => ({ result, ms: Date.now() - templateStart }));

    // FB-0.2 — resolve the CURRENT school name for the receipt header;
    // stored invoice snapshot stays the fallback. Never throws (defensive
    // try/catch so a failure degrades to the snapshot, mirroring branding).
    const schoolNamePromise = (async (): Promise<string | null> => {
      try {
        const name = await this.identityClient.getSchoolName(schoolId, context);
        if (!name) {
          this.logger.warn(
            `getReceiptPdf: school name lookup returned no name for schoolId=${schoolId} ` +
              `— falling back to stored snapshot`,
          );
        }
        return name;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `getReceiptPdf: school name lookup failed schoolId=${schoolId}: ` +
            `${message.slice(0, 200)} — falling back to stored snapshot`,
        );
        return null;
      }
    })();

    const [invoiceTimed, brandingTimed, templateTimed, currentSchoolName] = await Promise.all([
      invoicePromise,
      brandingPromise,
      templatePromise,
      schoolNamePromise,
    ]);
    const targetInvoices = invoiceTimed.result;
    const invoice = targetInvoices[0];
    const brandingResult = brandingTimed.result;
    const templateResponse = templateTimed.result;
    const tAfterFanout1 = Date.now();

    // Fan-out 2: student lookup + recordedBy resolution. Both depend on
    // `invoice` (resolved above) and are best-effort — lookup failure
    // degrades the receipt rather than 5xx. Each call individually timed
    // so the spike can attribute fan-out-2 cost. FB-4.5: a multi-target
    // payment has no single student — the roll-number/IEMIS block is
    // skipped and recordedBy falls back to the joined sibling names.
    const multiStudentNames = [...new Set(targetInvoices.map(t => t.studentName))].join(', ');
    const studentInfoStart = Date.now();
    const studentInfoPromise = (
      isMultiTarget
        ? Promise.resolve(null)
        : this.identityClient.getStudentInfo(invoice.studentId, context)
    ).then((result) => ({ result, ms: Date.now() - studentInfoStart }));

    const recordedByStart = Date.now();
    const recordedByPromise = this.resolveRecordedBy(
      payment.paidBy,
      isMultiTarget ? multiStudentNames : invoice.studentName,
      context,
    ).then((result) => ({ result, ms: Date.now() - recordedByStart }));

    const [studentTimed, recordedByTimed] = await Promise.all([
      studentInfoPromise,
      recordedByPromise,
    ]);
    const student = studentTimed.result;
    const recordedBy = recordedByTimed.result;
    const tAfterFanout2 = Date.now();

    // Same cast-at-JSON-boundary rationale as the invoice path (C.1.5).
    const templateConfig = templateResponse.templateConfig as unknown as ReceiptTemplateConfig;

    // Plan §5d — logo optimization parity with the bulk receipt worker.
    // See the parallel comment in invoices.service.ts:getPdf for the byte-
    // forensic rationale. Fail-open: on any error the optimizer returns
    // the original URL unchanged. Individual endpoints use the service's
    // default 3 s fetch timeout (bulk workers pass 10 s explicitly).
    const optimizedLogoSrc = await this.pdfLogoOptimizer.optimize(
      brandingResult.urls?.logo,
    );
    const urlsWithOptimizedLogo = brandingResult.urls
      ? { ...brandingResult.urls, logo: optimizedLogoSrc }
      : undefined;

    // Override `payment.paidBy` for the renderer with the resolved name
    // so the receipt's "Recorded By" line shows a human, not a UUID.
    // The renderer's existing `payment.paidBy ?? invoice.studentName`
    // fallback continues to work for callers that don't resolve.
    const buffer = await renderReceiptToPdfBuffer({
      payment: { ...payment, paidBy: recordedBy },
      invoice: currentSchoolName ? { ...invoice, schoolName: currentSchoolName } : invoice,
      branding: brandingResult.branding,
      urls: urlsWithOptimizedLogo,
      templateConfig,
      locale: resolvePrimaryLocale(templateConfig.labelLanguages),
      studentNumber: student?.studentNumber,
      emisStudentId: student?.emisStudentId,
      ...(isMultiTarget
        ? {
            multiTargetBreakdown: pdfInvoiceApps.map(app => {
              const target = targetInvoices.find(t => t.invoiceId === app.invoiceId)!;
              return {
                invoiceId: app.invoiceId,
                invoiceNumber: target.invoiceNumber,
                studentName: target.studentName,
                amount: app.amount,
              };
            }),
          }
        : {}),
    });
    const tAfterRender = Date.now();

    // Fire-and-forget structured audit log — same shape as invoice path.
    // Stage-level timings gated behind PDF_TIMING_ENABLED so the log
    // shape stays identical to the pre-Sprint-0.1 audit line by default.
    const timingEnabled = process.env.PDF_TIMING_ENABLED === 'true';
    this.logger.log(
      JSON.stringify({
        event: 'pdf_generated',
        docType: 'RECEIPT',
        schoolId,
        paymentId,
        invoiceId: payment.invoiceId,
        receiptNumber: payment.receiptNumber ?? `RCP-${paymentId.substring(0, 8)}`,
        userId: context.userId,
        tenantId: context.tenantId,
        sizeBytes: buffer.length,
        templateSource: templateResponse.source,
        templateId: templateResponse.templateId,
        durationMs: tAfterRender - tStart,
        ...(timingEnabled && {
          stagePaymentDdbMs: tAfterPaymentDdb - tStart,
          stageInvoiceDdbMs: invoiceTimed.ms,
          stageBrandingMs: brandingTimed.ms,
          stageTemplateMs: templateTimed.ms,
          stageFanout1WallMs: tAfterFanout1 - tAfterPaymentDdb,
          stageStudentInfoMs: studentTimed.ms,
          stageRecordedByMs: recordedByTimed.ms,
          stageFanout2WallMs: tAfterFanout2 - tAfterFanout1,
          stageRenderMs: tAfterRender - tAfterFanout2,
        }),
      }),
    );

    return buffer;
  }

  /**
   * Initiate a gateway payment session.
   * Creates a pending payment, calls the gateway adapter for redirect info.
   */
  async initiatePayment(
    schoolId: string,
    dto: InitiatePaymentRequest,
    context: RequestContext,
  ): Promise<InitiatePaymentResponse> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // 1. Validate invoice
    const invoice = await this.invoicesService.getEntity(schoolId, dto.invoiceId, context);

    if (invoice.status === 'paid') {
      throw new BadRequestException({ code: FinanceErrors.INVOICE_ALREADY_PAID, message: 'Invoice is already fully paid' });
    }
    if (invoice.status === 'cancelled' || invoice.status === 'written_off') {
      throw new BadRequestException({ code: FinanceErrors.INVOICE_CANCELLED, message: `Cannot pay a ${invoice.status} invoice` });
    }
    if (dto.amount > invoice.amountDue) {
      throw new BadRequestException({
        code: FinanceErrors.PAYMENT_EXCEEDS_DUE,
        message: `Payment amount (${dto.amount}) exceeds amount due (${invoice.amountDue})`,
        params: { amount: dto.amount, amountDue: invoice.amountDue },
      });
    }

    // 1a. Sprint C2.T2 — payment currency must match invoice currency.
    if (dto.currency && dto.currency !== invoice.currency) {
      throw new BadRequestException({
        code: FinanceErrors.PAYMENT_CURRENCY_MISMATCH,
        message: `Payment currency (${dto.currency}) does not match invoice currency (${invoice.currency})`,
        params: { paymentCurrency: dto.currency, invoiceCurrency: invoice.currency },
      });
    }

    // 2. Check for existing pending payment for same invoice + gateway (within 60 min)
    const existingPending = await this.findPendingForInvoice(schoolId, dto.invoiceId, dto.gateway, context);
    if (existingPending && existingPending.gatewaySessionId) {
      const ageMs = Date.now() - new Date(existingPending.createdAt).getTime();
      if (ageMs < 60 * 60 * 1000) {
        this.logger.log({
          action: 'payment.duplicate_prevented',
          schoolId,
          invoiceId: dto.invoiceId,
          existingPaymentId: existingPending.paymentId,
          existingSessionId: existingPending.gatewaySessionId,
        });
        // Return the existing session's redirect info
        const callbackBase = process.env.PAYMENT_CALLBACK_URL || dto.returnUrl;
        return {
          paymentSessionId: existingPending.gatewaySessionId,
          redirectUrl: `${callbackBase}?sessionId=${existingPending.gatewaySessionId}&gateway=${dto.gateway}&amount=${dto.amount}`,
          expiresAt: new Date(new Date(existingPending.createdAt).getTime() + 30 * 60 * 1000).toISOString(),
          method: 'redirect' as const,
        };
      }
    }

    // 3. Create a pending payment.
    // Sprint A.2 — same gradeLevel snapshot as the manual path above.
    const sessionId = uuid();
    const paymentEntity = createPaymentEntity(
      context.tenantId,
      schoolId,
      {
        invoiceId: dto.invoiceId,
        studentAccountId: invoice.studentAccountId,
        studentId: invoice.studentId,
        amount: dto.amount,
        currency: invoice.currency,
        gateway: dto.gateway,
        gatewaySessionId: sessionId,
        paidBy: context.userId,
        gradeLevel: invoice.gradeLevel,
        gradeLevelResolutionStatus: invoice.gradeLevelResolutionStatus,
      },
      context.userId,
    );

    paymentEntity.metadata = {
      returnUrl: dto.returnUrl,
      cancelUrl: dto.cancelUrl,
    };

    await this.dynamoDBClient.putItem(client, paymentEntity);

    // Store SESSION mapping entity for O(1) verification lookup (replaces partition scan)
    const sessionEntity = {
      tenantId: context.tenantId,
      entityKey: EntityKeyBuilder.paymentSession(sessionId),
      entityType: 'PAYMENT_SESSION' as const,
      paymentId: paymentEntity.paymentId,
      schoolId,
      invoiceId: dto.invoiceId,
      studentId: invoice.studentId,
      ttl: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24h auto-cleanup
      createdAt: new Date().toISOString(),
      createdBy: context.userId,
      updatedAt: new Date().toISOString(),
      updatedBy: context.userId,
      version: 1,
    };
    await this.dynamoDBClient.putItem(client, sessionEntity);

    this.logger.log({
      action: 'payment.initiated',
      schoolId,
      invoiceId: dto.invoiceId,
      paymentId: paymentEntity.paymentId,
      gateway: dto.gateway,
      amount: dto.amount,
      sessionId,
    });

    // 3. Call gateway adapter if available
    if (this.gatewayRegistry.hasAdapter(dto.gateway)) {
      const gatewayConfig = await this.gatewayConfigService.getEntity(schoolId, dto.gateway, context);

      if (!gatewayConfig.isEnabled) {
        throw new BadRequestException({ code: FinanceErrors.GATEWAY_NOT_ENABLED, message: `Gateway '${dto.gateway}' is not enabled for this school` });
      }

      const adapter = this.gatewayRegistry.getAdapter(dto.gateway);
      const adapterResult = await adapter.initiatePayment(
        {
          transactionId: sessionId,
          amount: dto.amount,
          taxAmount: 0,
          successUrl: dto.returnUrl,
          failureUrl: dto.cancelUrl,
          productName: `Invoice payment - ${dto.invoiceId.substring(0, 8)}`,
        },
        gatewayConfig,
      );

      // Store gateway-specific session ID if different from ours (e.g. Khalti pidx)
      if (adapterResult.gatewaySessionId && adapterResult.gatewaySessionId !== sessionId) {
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          paymentEntity.entityKey,
          'SET metadata.gatewayPidx = :pidx',
          { ':pidx': adapterResult.gatewaySessionId },
        );
      }

      return {
        paymentSessionId: sessionId,
        redirectUrl: adapterResult.redirectUrl,
        expiresAt: adapterResult.expiresAt || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        method: adapterResult.method,
        ...(adapterResult.formData ? { formData: adapterResult.formData } : {}),
      };
    }

    // Fallback for gateways without adapters (e.g. future gateways)
    const callbackBase = process.env.PAYMENT_CALLBACK_URL || dto.returnUrl;
    return {
      paymentSessionId: sessionId,
      redirectUrl: `${callbackBase}?sessionId=${sessionId}&gateway=${dto.gateway}&amount=${dto.amount}`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      method: 'redirect' as const,
    };
  }

  /**
   * Verify a payment after gateway callback redirect.
   * Calls the gateway adapter to verify, then marks completed or failed.
   */
  async verifyPayment(
    sessionId: string,
    callbackData: Record<string, string>,
    context: RequestContext,
  ): Promise<VerifyPaymentResponse> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // O(1) session lookup via SESSION mapping entity (replaces partition scan)
    const sessionMapping = await this.dynamoDBClient.getItem<{
      paymentId: string;
      schoolId: string;
      invoiceId: string;
    }>(client, context.tenantId, EntityKeyBuilder.paymentSession(sessionId));

    if (!sessionMapping) {
      throw new NotFoundException(`Payment session ${sessionId} not found`);
    }

    const paymentEntityKey = EntityKeyBuilder.payment(sessionMapping.schoolId, sessionMapping.paymentId);
    const payment = await this.dynamoDBClient.getItem<PaymentEntity>(
      client,
      context.tenantId,
      paymentEntityKey,
    );

    if (!payment) {
      throw new NotFoundException(`Payment ${sessionMapping.paymentId} not found for session ${sessionId}`);
    }

    // If already completed/failed, return current state (idempotent)
    if (payment.status !== 'pending') {
      this.logger.log({
        action: 'payment.verify_idempotent',
        sessionId,
        paymentId: payment.paymentId,
        existingStatus: payment.status,
      });
      const paymentDto = paymentEntityToDto(payment);
      const invoice = await this.invoicesService.get(payment.schoolId, payment.invoiceId, context);
      return {
        payment: paymentDto,
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          amountDue: invoice.amountDue,
          grandTotal: invoice.grandTotal,
        },
        receipt: payment.status === 'completed'
          ? await this.getReceipt(payment.schoolId, payment.paymentId, context)
          : null,
        status: payment.status as 'completed' | 'failed' | 'cancelled',
      };
    }

    // Call gateway adapter for real verification
    if (this.gatewayRegistry.hasAdapter(payment.gateway)) {
      const gatewayConfig = await this.gatewayConfigService.getEntity(
        payment.schoolId,
        payment.gateway,
        context,
      );
      const adapter = this.gatewayRegistry.getAdapter(payment.gateway);

      let verifyResult: GatewayVerifyResult;
      try {
        verifyResult = await adapter.verifyPayment(
          { transactionId: sessionId, amount: payment.amount, callbackData },
          gatewayConfig,
        );
      } catch (error: any) {
        this.logger.error(`Gateway verification error for ${sessionId}: ${error.message}`);
        verifyResult = {
          success: false,
          status: 'failed',
          failureReason: `Gateway error: ${error.message}`,
        };
      }

      if (verifyResult.success) {
        return this.completePayment(payment, verifyResult.gatewayTransactionId, context);
      } else if (verifyResult.status === 'pending') {
        // Still pending at gateway — return current state without updating
        const paymentDto = paymentEntityToDto(payment);
        const invoice = await this.invoicesService.get(payment.schoolId, payment.invoiceId, context);
        return {
          payment: paymentDto,
          invoice: {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            amountDue: invoice.amountDue,
            grandTotal: invoice.grandTotal,
          },
          receipt: null,
          status: 'failed', // report as failed for now; frontend can retry
        };
      } else {
        return this.failPayment(payment, verifyResult.failureReason, context);
      }
    }

    // Fallback: auto-complete for gateways without adapters
    return this.completePayment(payment, undefined, context);
  }

  /**
   * Mark a pending payment as completed, apply to invoice, record ledger.
   */
  private async completePayment(
    payment: PaymentEntity,
    gatewayTransactionId: string | undefined,
    context: RequestContext,
  ): Promise<VerifyPaymentResponse> {
    // EPIC-FB FB-4.4 — gateway payments are single-invoice by construction
    // (initiatePayment always stamps invoiceId + studentId; multi-target
    // exists only on the manual path, which never lands here as 'pending').
    // Guard so the nullable FB-4.1 fields can never flow into the
    // single-invoice completion math below.
    if (!payment.invoiceId || !payment.studentId) {
      throw new BadRequestException(
        `completePayment requires a single-invoice payment; payment ${payment.paymentId} `
        + `carries no single invoiceId/studentId (multi-target payments complete at record time).`,
      );
    }
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();
    const receiptNumber = await this.sequenceService.nextReceiptNumber(
      client,
      context.tenantId,
      payment.schoolId,
    );

    // Sprint C2.B.T4 — atomic completion: collapse the four DDB writes
    // (mark payment completed + apply to invoice + ledger entry +
    // billing account update) into a single TransactWriteItems. Receipt
    // sequence (above) is monotonic — wasted numbers on a rolled-back
    // transaction are fine.
    const accountKey = EntityKeyBuilder.billingAccount(payment.schoolId, payment.studentId);
    const account = await this.dynamoDBClient.getItem<BillingAccountEntity>(
      client,
      context.tenantId,
      accountKey,
    );
    if (!account) {
      throw new NotFoundException({
        code: FinanceErrors.ACCOUNT_NOT_FOUND,
        message: `Billing account for student ${payment.studentId} at school ${payment.schoolId} not found`,
      });
    }
    const invoiceEntity = await this.invoicesService.getEntity(payment.schoolId, payment.invoiceId, context);
    if (!invoiceEntity) {
      throw new NotFoundException({
        code: FinanceErrors.INVOICE_NOT_FOUND,
        message: `Invoice ${payment.invoiceId} not found`,
      });
    }

    let paymentUpdateExpr =
      'SET #status = :newStatus, paidAt = :now, receiptNumber = :receipt, updatedAt = :now, #v = #v + :one, gsi1sk = :newGsi1sk';
    const paymentExprValues: Record<string, any> = {
      ':newStatus': 'completed',
      ':now': now,
      ':receipt': receiptNumber,
      ':one': 1,
      ':currentVersion': payment.version,
      ':newGsi1sk': GSIKeyBuilder.entitySort('PAYMENT', `completed#${now}`),
    };
    if (gatewayTransactionId) {
      paymentUpdateExpr += ', gatewayTransactionId = :gtxId';
      paymentExprValues[':gtxId'] = gatewayTransactionId;
    }
    // Sprint A.5 Codex P2 — re-key gsi14sk on completion so the
    // GSI14 list-by-grade ordering reflects the actual processed
    // time (when the gateway confirmed), not the initial creation
    // time. Sparse: only re-key when this payment carries the
    // gradeLevel snapshot — pending payments without grade don't
    // populate gsi14pk/sk at all.
    if (payment.gradeLevel) {
      paymentUpdateExpr += ', gsi14sk = :newGsi14sk';
      paymentExprValues[':newGsi14sk'] = GSIKeyBuilder.entitySort('PAYMENT', now);
    }

    const tableName = this.dynamoDBClient.getTableName();
    const applyItem = this.invoicesService.buildApplyPaymentTransactItem(
      invoiceEntity,
      payment.amount,
      context,
    );
    const ledger = this.studentAccountsService.buildLedgerEntryTransactItems(
      account,
      'payment',
      payment.paymentId,
      `Payment ${receiptNumber} via ${payment.gateway}`,
      0,
      payment.amount,
      context,
    );

    try {
      await this.dynamoDBClient.transactWrite(client, [
        {
          Update: {
            TableName: tableName,
            Key: { tenantId: payment.tenantId, entityKey: payment.entityKey },
            UpdateExpression: paymentUpdateExpr,
            ExpressionAttributeValues: paymentExprValues,
            ExpressionAttributeNames: { '#status': 'status', '#v': 'version' },
            ConditionExpression: '#v = :currentVersion',
          },
        },
        applyItem.item,
        ...ledger.items,
      ]);
    } catch (err: any) {
      const errorName = err?.name ?? '';
      if (errorName === 'TransactionCanceledException') {
        const reasons = (err?.CancellationReasons as { Code?: string; Message?: string }[] | undefined) ?? [];
        const labels = ['payment_complete', 'invoice_apply', 'ledger_put', 'account_update'];
        const detail = reasons.map((r, i) => `${labels[i] ?? `op_${i}`}=${r?.Code ?? 'OK'}`).join(', ');
        this.logger.warn({
          action: 'payment.complete_transaction_cancelled',
          schoolId: payment.schoolId,
          invoiceId: payment.invoiceId,
          paymentId: payment.paymentId,
          detail,
        });
        throw new ConflictException({
          code: FinanceErrors.CONCURRENT_UPDATE,
          message: `Payment completion rolled back due to concurrent modification. Reasons: ${detail}. Please retry.`,
        });
      }
      throw err;
    }

    this.logger.log({
      action: 'payment.completed',
      paymentId: payment.paymentId,
      schoolId: payment.schoolId,
      invoiceId: payment.invoiceId,
      amount: payment.amount,
      gateway: payment.gateway,
      receiptNumber,
      gatewayTransactionId,
      ledgerEntryId: ledger.ledgerEntry.entryId,
    });

    // Publish event AFTER the transaction commits.
    this.eventsService.publishPaymentCompleted(
      context.tenantId,
      payment.schoolId,
      payment.paymentId,
      payment.invoiceId,
      payment.amount,
      payment.gateway,
    ).catch(err => this.logger.error(`Failed to publish PaymentCompleted: ${err.message}`));

    // Build the response DTO with post-transaction state. The Payment row's
    // version + paidAt + receiptNumber were just bumped in the transaction;
    // synthesize the in-memory shape rather than re-fetching.
    const paymentDto = paymentEntityToDto({
      ...payment,
      status: 'completed',
      paidAt: now,
      receiptNumber,
      version: payment.version + 1,
      ...(gatewayTransactionId ? { gatewayTransactionId } : {}),
      gsi1sk: GSIKeyBuilder.entitySort('PAYMENT', `completed#${now}`),
      updatedAt: now,
    });
    const invoice = await this.invoicesService.get(payment.schoolId, payment.invoiceId, context);

    return {
      payment: paymentDto,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        amountDue: invoice.amountDue,
        grandTotal: invoice.grandTotal,
      },
      receipt: await this.getReceipt(payment.schoolId, payment.paymentId, context),
      status: 'completed',
    };
  }

  /**
   * Mark a pending payment as failed.
   */
  private async failPayment(
    payment: PaymentEntity,
    reason: string | undefined,
    context: RequestContext,
  ): Promise<VerifyPaymentResponse> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();

    await this.dynamoDBClient.updateItem<PaymentEntity>(
      client,
      context.tenantId,
      payment.entityKey,
      'SET #status = :newStatus, updatedAt = :now, metadata.failureReason = :reason, #v = #v + :one',
      {
        ':newStatus': 'failed',
        ':now': now,
        ':reason': reason || 'Payment verification failed',
        ':one': 1,
        ':currentVersion': payment.version,
      },
      '#v = :currentVersion',
      { '#status': 'status', '#v': 'version' },
    );

    const paymentDto = paymentEntityToDto({ ...payment, status: 'failed' });
    const invoice = await this.invoicesService.get(payment.schoolId, payment.invoiceId, context);

    return {
      payment: paymentDto,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        amountDue: invoice.amountDue,
        grandTotal: invoice.grandTotal,
      },
      receipt: null,
      status: 'failed',
    };
  }

  async voidPayment(
    schoolId: string,
    paymentId: string,
    reason: string,
    context: RequestContext,
  ): Promise<Payment> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.payment(schoolId, paymentId);

    const existing = await this.dynamoDBClient.getItem<PaymentEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) throw new NotFoundException({ code: FinanceErrors.PAYMENT_NOT_FOUND, message: `Payment ${paymentId} not found` });

    if (existing.status !== 'completed') {
      throw new BadRequestException({ code: FinanceErrors.PAYMENT_VOID_NOT_COMPLETED, message: `Cannot void a ${existing.status} payment` });
    }

    this.logger.log({
      action: 'payment.voiding',
      paymentId,
      schoolId,
      invoiceId: existing.invoiceId,
      amount: existing.amount,
      reason,
    });

    // EPIC-FB FB-4.5 — multi-target family payment: void reverses EVERY
    // application atomically (payment status + N invoice restores + per-
    // account reversing ledger entries + M account updates in ONE
    // transactWrite). The single-target path below keeps its pre-existing
    // sequential structure untouched.
    const voidInvoiceApps = (existing.applications ?? []).filter(
      (a): a is Extract<PaymentApplication, { targetType: 'invoice' }> => a.targetType === 'invoice',
    );
    if (!existing.invoiceId && voidInvoiceApps.length >= 2) {
      return this.voidMultiTargetPayment(schoolId, existing, voidInvoiceApps, reason, context);
    }

    const updated = await this.dynamoDBClient.updateItem<PaymentEntity>(
      client,
      context.tenantId,
      entityKey,
      'SET #status = :newStatus, updatedAt = :now, metadata.voidReason = :reason, #v = #v + :one',
      {
        ':newStatus': 'cancelled',
        ':now': new Date().toISOString(),
        ':reason': reason,
        ':one': 1,
        ':currentVersion': existing.version,
      },
      '#v = :currentVersion',
      { '#status': 'status', '#v': 'version' },
    );

    // Pilot PD.2 hardening (Phase C SPEC-3 fix): for split payments,
    // reverse the invoice by the INVOICE-allocated portion only, not
    // the full payment.amount (over-credits the invoice by the
    // opening-balance portion).
    //
    //   Legacy single-invoice payment (applications undefined OR
    //   1 invoice entry) → reverse full existing.amount (unchanged).
    //   Split payment (applications has invoice + opening entries) →
    //   reverse only applications[invoice].amount.
    const invoiceApp = existing.applications?.find(a => a.targetType === 'invoice');
    const openingApp = existing.applications?.find(a => a.targetType === 'opening_balance');
    const invoiceReversal = invoiceApp?.amount ?? existing.amount;

    await this.invoicesService.reversePaymentOnInvoice(
      schoolId,
      existing.invoiceId,
      invoiceReversal,
      context,
    );

    // Post void debit to student account ledger. The ledger entry
    // records the FULL payment amount (this is the void of the entire
    // payment); the openingBalanceSettled counter decrement (below)
    // handles the opening-portion bookkeeping separately.
    const accountKey = EntityKeyBuilder.billingAccount(schoolId, existing.studentId);
    const account = await this.dynamoDBClient.getItem<BillingAccountEntity>(client, context.tenantId, accountKey);
    if (account) {
      await this.studentAccountsService.recordLedgerEntry(
        account,
        'adjustment',
        paymentId,
        `Payment ${existing.receiptNumber} voided: ${reason}`,
        existing.amount,
        0,
        context,
      );
    }

    // Pilot PD.2 hardening (Phase C SPEC-1 fix): if the voided payment
    // had an opening-balance allocation, decrement the
    // openingBalanceSettled counter so openingBalanceRemaining returns
    // to the pre-payment value. Sequential write (NOT in the same
    // transaction as the invoice reversal) because voidPayment's
    // existing structure already issues separate writes; the V1
    // acceptable failure mode is a counter drift that operators
    // recover via a manual setOpeningBalance revision (documented in
    // PD.4.1 runbook).
    if (openingApp && account) {
      try {
        await this.studentAccountsService.decrementOpeningBalanceSettled(
          account.accountId,
          openingApp.amount,
          context,
        );
      } catch (err: any) {
        // Defensive: if decrement fails, log + continue. The payment
        // is already marked cancelled + ledger has the reversal entry;
        // counter drift is operator-recoverable. Failure to surface
        // would mask the bug; logging at WARN does.
        this.logger.warn({
          action: 'payment.void_opening_balance_decrement_failed',
          paymentId,
          schoolId,
          accountId: account.accountId,
          openingAmount: openingApp.amount,
          error: err?.message ?? String(err),
        });
      }
    }

    return paymentEntityToDto(updated);
  }

  /**
   * EPIC-FB FB-4.5 — atomic void of a multi-target family payment.
   *
   * ONE TransactWriteItems:
   *   [0]      payment Update → status 'cancelled' (version-conditioned)
   *   [1..N]   per-target invoice restore (buildReversePaymentTransactItem)
   *            in application order
   *   [N+1..]  per affected account: reversing 'adjustment' ledger Puts
   *            (debit = that target's allocation) + the account Update —
   *            the composite-helper shape, repeated per account
   *
   * No openingBalanceSettled handling: multi-target payments never touch
   * opening balances (planner contract).
   */
  private async voidMultiTargetPayment(
    schoolId: string,
    existing: PaymentEntity,
    invoiceApps: Array<{ targetType: 'invoice'; invoiceId: string; amount: number }>,
    reason: string,
    context: RequestContext,
  ): Promise<Payment> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();

    const targets = await this.getTargetInvoiceEntities(
      schoolId,
      invoiceApps.map(a => a.invoiceId),
      context,
    );
    const targetById = new Map(targets.map(t => [t.invoiceId, t]));

    const orderedStudentIds = [...new Set(targets.map(t => t.studentId))];
    const accountByStudentId = new Map<string, BillingAccountEntity>();
    for (const studentId of orderedStudentIds) {
      const account = await this.dynamoDBClient.getItem<BillingAccountEntity>(
        client,
        context.tenantId,
        EntityKeyBuilder.billingAccount(schoolId, studentId),
      );
      if (!account) {
        throw new NotFoundException({
          code: FinanceErrors.ACCOUNT_NOT_FOUND,
          message: `Billing account for student ${studentId} at school ${schoolId} not found`,
        });
      }
      accountByStudentId.set(studentId, account);
    }

    const tableName = this.dynamoDBClient.getTableName();
    const transactItems: Parameters<DynamoDBClientService['transactWrite']>[1] = [
      {
        Update: {
          TableName: tableName,
          Key: { tenantId: existing.tenantId, entityKey: existing.entityKey },
          UpdateExpression:
            'SET #status = :newStatus, updatedAt = :now, metadata.voidReason = :reason, #v = #v + :one',
          ExpressionAttributeValues: {
            ':newStatus': 'cancelled',
            ':now': now,
            ':reason': reason,
            ':one': 1,
            ':currentVersion': existing.version,
          },
          ExpressionAttributeNames: { '#status': 'status', '#v': 'version' },
          ConditionExpression: '#v = :currentVersion',
        },
      },
    ];

    for (const app of invoiceApps) {
      transactItems.push(
        this.invoicesService.buildReversePaymentTransactItem(
          targetById.get(app.invoiceId)!,
          app.amount,
          context,
        ).item,
      );
    }

    for (const studentId of orderedStudentIds) {
      const account = accountByStudentId.get(studentId)!;
      const accountApps = invoiceApps.filter(a => targetById.get(a.invoiceId)!.studentId === studentId);
      const composite = this.studentAccountsService.buildCompositeLedgerTransactItems(
        account,
        accountApps.map(a => ({
          entryType: 'adjustment' as const,
          referenceId: existing.paymentId,
          description:
            `Payment ${existing.receiptNumber} voided: ${reason} → invoice `
            + `${targetById.get(a.invoiceId)!.invoiceNumber}`,
          debit: a.amount,
          credit: 0,
        })),
        context,
      );
      transactItems.push(...composite.items);
    }

    try {
      await this.dynamoDBClient.transactWrite(client, transactItems);
    } catch (err: any) {
      if ((err?.name ?? '') === 'TransactionCanceledException') {
        const reasons = (err?.CancellationReasons as { Code?: string }[] | undefined) ?? [];
        const detail = reasons.map((r, i) => `op_${i}=${r?.Code ?? 'OK'}`).join(', ');
        this.logger.warn({
          action: 'payment.multi_target_void_cancelled',
          paymentId: existing.paymentId,
          schoolId,
          detail,
        });
        throw new ConflictException({
          code: FinanceErrors.CONCURRENT_UPDATE,
          message: `Void rolled back due to concurrent modification. Reasons: ${detail}. Please retry.`,
        });
      }
      throw err;
    }

    this.logger.log({
      action: 'payment.multi_target_voided',
      paymentId: existing.paymentId,
      schoolId,
      familyId: existing.familyId,
      reversedInvoiceIds: invoiceApps.map(a => a.invoiceId),
      accounts: orderedStudentIds,
      amount: existing.amount,
    });

    return paymentEntityToDto({
      ...existing,
      status: 'cancelled',
      metadata: { ...existing.metadata, voidReason: reason },
      version: existing.version + 1,
      updatedAt: now,
    });
  }

  async refund(
    schoolId: string,
    paymentId: string,
    dto: CreateRefundDto,
    context: RequestContext,
  ): Promise<Payment> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.payment(schoolId, paymentId);

    const existing = await this.dynamoDBClient.getItem<PaymentEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) throw new NotFoundException({ code: FinanceErrors.PAYMENT_NOT_FOUND, message: `Payment ${paymentId} not found` });

    if (existing.status !== 'completed' && existing.status !== 'partially_refunded') {
      throw new BadRequestException({ code: FinanceErrors.PAYMENT_REFUND_NOT_ELIGIBLE, message: `Cannot refund a ${existing.status} payment` });
    }

    const existingRefunds = existing.refunds ?? [];
    const totalRefunded = existingRefunds.reduce((sum, r) => sum + (r.status === 'completed' ? r.amount : 0), 0);
    if (totalRefunded + dto.amount > existing.amount) {
      throw new BadRequestException({
        code: FinanceErrors.PAYMENT_REFUND_EXCEEDS_AMOUNT,
        message: `Refund amount (${dto.amount}) exceeds refundable amount (${existing.amount - totalRefunded})`,
        params: { refundAmount: dto.amount, refundableAmount: existing.amount - totalRefunded },
      });
    }

    // Pilot PD.2 hardening (Phase C SPEC-2 fix): split-payment partial
    // refund requires pro-rata math across invoice + opening
    // allocations that is V1.5 scope. V1 supports FULL refunds only on
    // split payments. Operator workaround for partial: void the
    // payment + re-record at the desired amount.
    const invoiceApp = existing.applications?.find(a => a.targetType === 'invoice');
    const openingApp = existing.applications?.find(a => a.targetType === 'opening_balance');
    const isSplitPayment = !!openingApp;
    if (isSplitPayment && dto.amount < existing.amount - totalRefunded) {
      throw new BadRequestException({
        code: FinanceErrors.PAYMENT_REFUND_SPLIT_PARTIAL_UNSUPPORTED,
        message:
          `Partial refund (${dto.amount} of ${existing.amount}) on a split-allocation `
          + `payment is not supported in V1. To refund a portion, void this payment `
          + `and re-record at the desired amount.`,
        params: {
          paymentAmount: existing.amount,
          refundAmount: dto.amount,
          applications: existing.applications,
        },
      });
    }

    // EPIC-FB FB-4.5 — refunds reference the PAYMENT, not a single invoice.
    // For a multi-target family payment V1 supports FULL refunds only
    // (pro-rata partials across N invoices are V1.5 — same policy as the
    // split-payment rule above); the reversal restores EVERY target.
    const refundInvoiceApps = (existing.applications ?? []).filter(
      (a): a is Extract<PaymentApplication, { targetType: 'invoice' }> => a.targetType === 'invoice',
    );
    const isMultiTargetRefund = !existing.invoiceId && refundInvoiceApps.length >= 2;
    if (isMultiTargetRefund && dto.amount < existing.amount - totalRefunded) {
      throw new BadRequestException({
        code: FinanceErrors.PAYMENT_REFUND_MULTI_TARGET_PARTIAL_UNSUPPORTED,
        message:
          `Partial refund (${dto.amount} of ${existing.amount}) on a multi-invoice family `
          + `payment is not supported in V1. Refund the full amount, or void and re-record.`,
        params: {
          paymentAmount: existing.amount,
          refundAmount: dto.amount,
          applications: existing.applications,
        },
      });
    }

    const refund: RefundData = {
      id: uuid(),
      paymentId: existing.paymentId,
      amount: dto.amount,
      reason: dto.reason,
      status: 'completed',
      refundedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const newRefunds = [...existingRefunds, refund];
    const newTotalRefunded = totalRefunded + dto.amount;
    const newStatus = newTotalRefunded >= existing.amount ? 'refunded' : 'partially_refunded';

    this.logger.log({
      action: 'payment.refunding',
      paymentId,
      schoolId,
      refundId: refund.id,
      refundAmount: dto.amount,
      totalRefunded: newTotalRefunded,
      newStatus,
    });

    if (isMultiTargetRefund) {
      return this.refundMultiTargetPayment(
        schoolId,
        existing,
        refundInvoiceApps,
        refund,
        newRefunds,
        newStatus,
        context,
      );
    }

    const updated = await this.dynamoDBClient.updateItem<PaymentEntity>(
      client,
      context.tenantId,
      entityKey,
      'SET #status = :newStatus, refunds = :refunds, updatedAt = :now, #v = #v + :one',
      {
        ':newStatus': newStatus,
        ':refunds': newRefunds,
        ':now': new Date().toISOString(),
        ':one': 1,
        ':currentVersion': existing.version,
      },
      '#v = :currentVersion',
      { '#status': 'status', '#v': 'version' },
    );

    // Pilot PD.2 hardening (Phase C SPEC-2 fix): for split payments,
    // a full refund reverses (a) the invoice by the invoice-allocated
    // portion only AND (b) the openingBalanceSettled counter by the
    // opening-allocated portion. Legacy single-invoice payments
    // continue to reverse the full dto.amount on the invoice with no
    // counter touch.
    const invoiceReversal = isSplitPayment ? (invoiceApp?.amount ?? 0) : dto.amount;
    await this.invoicesService.reversePaymentOnInvoice(
      schoolId,
      existing.invoiceId,
      invoiceReversal,
      context,
    );

    // Record refund ledger entry. The ledger entry records the FULL
    // refund amount (operator-facing total); the openingBalanceSettled
    // decrement (below) handles the opening-portion bookkeeping
    // separately on a split payment.
    const accountKey = EntityKeyBuilder.billingAccount(schoolId, existing.studentId);
    const account = await this.dynamoDBClient.getItem<BillingAccountEntity>(client, context.tenantId, accountKey);
    if (account) {
      await this.studentAccountsService.recordLedgerEntry(
        account,
        'refund',
        refund.id,
        `Refund for payment ${existing.receiptNumber}: ${dto.reason}`,
        dto.amount,
        0,
        context,
      );
    }

    // Pilot PD.2 hardening (Phase C SPEC-2 fix): if the refunded
    // payment had an opening-balance allocation, decrement the
    // openingBalanceSettled counter by the opening portion (only
    // applicable on FULL refunds — the V1 partial-refund-on-split
    // guard above ensures we're at full reversal here).
    if (isSplitPayment && openingApp && account) {
      try {
        await this.studentAccountsService.decrementOpeningBalanceSettled(
          account.accountId,
          openingApp.amount,
          context,
        );
      } catch (err: any) {
        this.logger.warn({
          action: 'payment.refund_opening_balance_decrement_failed',
          paymentId,
          schoolId,
          accountId: account.accountId,
          openingAmount: openingApp.amount,
          error: err?.message ?? String(err),
        });
      }
    }

    this.eventsService.publishRefundProcessed(
      context.tenantId,
      schoolId,
      paymentId,
      refund.id,
      dto.amount,
    ).catch(err => this.logger.error(`Failed to publish RefundProcessed: ${err.message}`));

    return paymentEntityToDto(updated);
  }

  /**
   * EPIC-FB FB-4.5 — atomic FULL refund of a multi-target family payment.
   * Same composition as `voidMultiTargetPayment` (payment Update + N
   * invoice restores + per-account 'refund' ledger entries + M account
   * updates in ONE transactWrite); the payment Update writes the refunds
   * array + terminal 'refunded' status instead of a void.
   */
  private async refundMultiTargetPayment(
    schoolId: string,
    existing: PaymentEntity,
    invoiceApps: Array<{ targetType: 'invoice'; invoiceId: string; amount: number }>,
    refund: RefundData,
    newRefunds: RefundData[],
    newStatus: string,
    context: RequestContext,
  ): Promise<Payment> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();

    const targets = await this.getTargetInvoiceEntities(
      schoolId,
      invoiceApps.map(a => a.invoiceId),
      context,
    );
    const targetById = new Map(targets.map(t => [t.invoiceId, t]));

    const orderedStudentIds = [...new Set(targets.map(t => t.studentId))];
    const accountByStudentId = new Map<string, BillingAccountEntity>();
    for (const studentId of orderedStudentIds) {
      const account = await this.dynamoDBClient.getItem<BillingAccountEntity>(
        client,
        context.tenantId,
        EntityKeyBuilder.billingAccount(schoolId, studentId),
      );
      if (!account) {
        throw new NotFoundException({
          code: FinanceErrors.ACCOUNT_NOT_FOUND,
          message: `Billing account for student ${studentId} at school ${schoolId} not found`,
        });
      }
      accountByStudentId.set(studentId, account);
    }

    const tableName = this.dynamoDBClient.getTableName();
    const transactItems: Parameters<DynamoDBClientService['transactWrite']>[1] = [
      {
        Update: {
          TableName: tableName,
          Key: { tenantId: existing.tenantId, entityKey: existing.entityKey },
          UpdateExpression:
            'SET #status = :newStatus, refunds = :refunds, updatedAt = :now, #v = #v + :one',
          ExpressionAttributeValues: {
            ':newStatus': newStatus,
            ':refunds': newRefunds,
            ':now': now,
            ':one': 1,
            ':currentVersion': existing.version,
          },
          ExpressionAttributeNames: { '#status': 'status', '#v': 'version' },
          ConditionExpression: '#v = :currentVersion',
        },
      },
    ];

    for (const app of invoiceApps) {
      transactItems.push(
        this.invoicesService.buildReversePaymentTransactItem(
          targetById.get(app.invoiceId)!,
          app.amount,
          context,
        ).item,
      );
    }

    for (const studentId of orderedStudentIds) {
      const account = accountByStudentId.get(studentId)!;
      const accountApps = invoiceApps.filter(a => targetById.get(a.invoiceId)!.studentId === studentId);
      const composite = this.studentAccountsService.buildCompositeLedgerTransactItems(
        account,
        accountApps.map(a => ({
          entryType: 'refund' as const,
          referenceId: refund.id,
          description:
            `Refund for payment ${existing.receiptNumber}: ${refund.reason} → invoice `
            + `${targetById.get(a.invoiceId)!.invoiceNumber}`,
          debit: a.amount,
          credit: 0,
        })),
        context,
      );
      transactItems.push(...composite.items);
    }

    try {
      await this.dynamoDBClient.transactWrite(client, transactItems);
    } catch (err: any) {
      if ((err?.name ?? '') === 'TransactionCanceledException') {
        const reasons = (err?.CancellationReasons as { Code?: string }[] | undefined) ?? [];
        const detail = reasons.map((r, i) => `op_${i}=${r?.Code ?? 'OK'}`).join(', ');
        this.logger.warn({
          action: 'payment.multi_target_refund_cancelled',
          paymentId: existing.paymentId,
          schoolId,
          detail,
        });
        throw new ConflictException({
          code: FinanceErrors.CONCURRENT_UPDATE,
          message: `Refund rolled back due to concurrent modification. Reasons: ${detail}. Please retry.`,
        });
      }
      throw err;
    }

    this.eventsService.publishRefundProcessed(
      context.tenantId,
      schoolId,
      existing.paymentId,
      refund.id,
      refund.amount,
    ).catch(err => this.logger.error(`Failed to publish RefundProcessed: ${err.message}`));

    return paymentEntityToDto({
      ...existing,
      status: newStatus as PaymentEntity['status'],
      refunds: newRefunds,
      version: existing.version + 1,
      updatedAt: now,
    });
  }

  async reconcilePayment(
    schoolId: string,
    paymentId: string,
    context: RequestContext,
  ): Promise<{ status: string; action: string }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.payment(schoolId, paymentId);

    const existing = await this.dynamoDBClient.getItem<PaymentEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) {
      throw new NotFoundException({ code: FinanceErrors.PAYMENT_NOT_FOUND, message: `Payment ${paymentId} not found` });
    }

    // Already in a terminal state — nothing to reconcile
    if (existing.status === 'completed' || existing.status === 'refunded' || existing.status === 'cancelled') {
      return { status: existing.status, action: 'none' };
    }

    // Check gateway for current status
    if (!this.gatewayRegistry.hasAdapter(existing.gateway)) {
      return { status: existing.status, action: 'no_adapter' };
    }

    const gatewayConfig = await this.gatewayConfigService.getEntity(schoolId, existing.gateway, context);
    const adapter = this.gatewayRegistry.getAdapter(existing.gateway);

    let verifyResult: GatewayVerifyResult;
    try {
      verifyResult = await adapter.verifyPayment(
        { transactionId: existing.gatewaySessionId ?? paymentId, amount: existing.amount, callbackData: {} },
        gatewayConfig,
      );
    } catch (error: any) {
      this.logger.error(`Reconcile gateway error for ${paymentId}: ${error.message}`);
      return { status: existing.status, action: 'gateway_error' };
    }

    if (verifyResult.success && existing.status === 'pending') {
      await this.completePayment(existing, verifyResult.gatewayTransactionId, context);
      return { status: 'completed', action: 'completed' };
    } else if (!verifyResult.success && verifyResult.status === 'failed') {
      await this.failPayment(existing, verifyResult.failureReason, context);
      return { status: 'failed', action: 'failed' };
    }

    return { status: existing.status, action: 'none' };
  }

  /**
   * Stream payments as CSV rows for export. Memory-efficient via async generator.
   */
  async *streamPaymentsCsvRows(
    schoolId: string,
    context: RequestContext,
  ): AsyncGenerator<string> {
    yield 'Receipt #,Student,Invoice #,Amount,Gateway,Status,Paid Date,Created Date\n';

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    let lastKey: Record<string, any> | undefined;
    let totalRows = 0;
    const MAX_ROWS = 10000;
    const escapeCsv = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;

    do {
      const result = await this.dynamoDBClient.queryGSI<PaymentEntity>(
        client,
        'GSI1',
        gsi1pk,
        'PAYMENT',
        'begins_with',
        undefined,
        undefined,
        undefined,
        100,
        false,
        lastKey,
      );

      // Batch-fetch related invoices for student name + invoice number.
      // FB-4.5: multi-target rows (invoiceId=null) are skipped here and
      // rendered with a 'multiple' invoice marker below.
      const invoiceIds = [...new Set(result.items.map(p => p.invoiceId))]
        .filter((id): id is string => !!id);
      const invoiceKeys = invoiceIds.map(id => ({
        tenantId: context.tenantId,
        entityKey: EntityKeyBuilder.invoice(schoolId, id),
      }));

      let invoiceMap: Map<string, { studentName: string; invoiceNumber: string }> = new Map();
      try {
        const invoices = await this.dynamoDBClient.batchGetItems<InvoiceEntity>(client, invoiceKeys);
        invoiceMap = new Map(
          invoices.map(inv => [inv.invoiceId, { studentName: inv.studentName, invoiceNumber: inv.invoiceNumber }]),
        );
      } catch (err: any) {
        this.logger.warn(`CSV export: failed to enrich with invoice data: ${err.message}`);
      }

      for (const entity of result.items) {
        if (totalRows >= MAX_ROWS) break;
        const enrichment = entity.invoiceId ? invoiceMap.get(entity.invoiceId) : undefined;
        // FB-4.5 — multi-target family payments have no single invoice;
        // the CSV invoice column reads `multiple (N)`.
        const invoiceCell = enrichment?.invoiceNumber
          || entity.invoiceId?.slice(0, 8)
          || `multiple (${entity.applicationInvoiceIds?.length ?? 0})`;
        yield `${escapeCsv(entity.receiptNumber || entity.paymentId.slice(0, 8))},${escapeCsv(enrichment?.studentName || '')},${escapeCsv(invoiceCell)},${entity.amount},${escapeCsv(entity.gateway)},${escapeCsv(entity.status)},${escapeCsv(entity.paidAt || '')},${escapeCsv(entity.createdAt)}\n`;
        totalRows++;
      }

      // Hotfix 2026-05-24 — base64 decode (see dashboard.service.ts:387
      // for the contract reference). Same bug pattern, same fix.
      lastKey = result.lastEvaluatedKey
        ? JSON.parse(Buffer.from(result.lastEvaluatedKey, 'base64').toString())
        : undefined;
    } while (lastKey && totalRows < MAX_ROWS);
  }

  private async findPendingForInvoice(
    schoolId: string,
    invoiceId: string,
    gateway: string,
    context: RequestContext,
  ): Promise<PaymentEntity | null> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const result = await this.dynamoDBClient.queryGSI<PaymentEntity>(
      client,
      'GSI1',
      gsi1pk,
      'PAYMENT#pending',
      'begins_with',
      'invoiceId = :invoiceId AND gateway = :gateway',
      { ':invoiceId': invoiceId, ':gateway': gateway },
      undefined,
      1,
    );

    return result.items.length > 0 ? result.items[0] : null;
  }

  private async findByIdempotencyKey(
    schoolId: string,
    idempotencyKey: string,
    context: RequestContext,
  ): Promise<PaymentEntity | null> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const result = await this.dynamoDBClient.queryGSI<PaymentEntity>(
      client,
      'GSI1',
      gsi1pk,
      'PAYMENT',
      'begins_with',
      'idempotencyKey = :idempKey',
      { ':idempKey': idempotencyKey },
      undefined,
      1,
    );

    return result.items.length > 0 ? result.items[0] : null;
  }
}
