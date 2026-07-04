/**
 * Family billing read service — EPIC-FB Sprint FB-4.6.
 *
 * One job: assemble the "pay for family" picture — the family's members
 * (via the academics API; finance never reads the academics table, epic
 * §3.0), every member's open invoices (finance GSI2), and a suggested
 * oldest-due-first allocation from the FB-4.3 planner. The FE feeds the
 * suggestion into the FB-4.4 multi-target recordManualPayment.
 *
 * Registered inside PaymentsModule (no standalone module): its dependency
 * set is a strict subset of the payments graph, mirroring how the bulk
 * receipt endpoint lives beside the single-receipt endpoint.
 */

import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { IdentityClientService } from '../common/services/identity-client.service';
import { InvoicesService } from '../invoices/invoices.service';
import { planPaymentAllocation, MAX_PAYMENT_TARGETS } from '../payments/payment-allocation.planner';
import type { RequestContext } from '../common/entities/base.entity';
import { FinanceErrors } from '../common/errors/finance-errors';

/**
 * Local response contracts (no shared-types schema yet — the endpoint is
 * backend-first; the FE task FB-4.8 consumes it and the shared schema
 * lands with that coordinated bump). P1d: no `isActive` anywhere.
 */
export interface FamilyOpenInvoiceDto {
  invoiceId: string;
  invoiceNumber: string;
  studentId: string;
  studentName: string;
  gradeLevel?: string;
  status: string;
  dueDate: string;
  amountDue: number;
  currency: string;
}

export interface FamilyOpenInvoicesResponseDto {
  familyId: string;
  familyName: string;
  students: Array<{ studentId: string; studentName: string }>;
  openInvoices: FamilyOpenInvoiceDto[];
  totalDue: number;
  /**
   * FB-4.3 planner output ('oldest_due_first', amount = totalDue): the
   * editable starting point for the FE's per-invoice amount fields.
   * Capped at 20 targets — when a family carries more open invoices than
   * that, the suggestion covers the 20 oldest and the operator settles
   * the rest in a second payment.
   */
  suggestedAllocation: Array<{ invoiceId: string; amount: number }>;
}

@Injectable()
export class FamilyBillingService {
  private readonly logger = new Logger(FamilyBillingService.name);

  constructor(
    private readonly identityClient: IdentityClientService,
    private readonly invoicesService: InvoicesService,
  ) {}

  async getFamilyOpenInvoices(
    schoolId: string,
    familyId: string,
    context: RequestContext,
  ): Promise<FamilyOpenInvoicesResponseDto> {
    const resolution = await this.identityClient.getFamilyMembers(familyId, schoolId, context);

    if (resolution.kind === 'not_found') {
      // Also the natural degradation when academics' FAMILY_GROUPS flag is
      // off — its guard 404s the family routes, so this endpoint needs no
      // feature flag of its own (and BILLING_AGREEMENTS_ENABLED would be
      // WRONG here: family payments work without agreements).
      throw new NotFoundException({
        code: FinanceErrors.FAMILY_NOT_FOUND,
        message: `Family ${familyId} not found at school ${schoolId}`,
      });
    }
    if (resolution.kind === 'members_unavailable') {
      throw new ServiceUnavailableException({
        code: FinanceErrors.FAMILY_MEMBERS_UNAVAILABLE,
        message:
          `Family ${familyId} exists but its members could not be resolved from the `
          + `academics service. Retry shortly; if this persists the academics `
          + `member-enumeration API is not deployed.`,
      });
    }

    const { family, members } = resolution;

    // Members of a family are same-school by construction (families are
    // school-scoped in academics), and the invoice query below filters
    // schoolId again — a member's invoices at OTHER schools never leak
    // into this school-scoped view (spec-pinned).
    const perStudent = await Promise.all(
      members.map(m => this.invoicesService.listOpenInvoiceEntitiesForStudent(schoolId, m.studentId, context)),
    );

    const memberNameById = new Map(members.map(m => [m.studentId, m.studentName]));
    const openInvoices: FamilyOpenInvoiceDto[] = perStudent
      .flat()
      .map(inv => ({
        invoiceId: inv.invoiceId,
        invoiceNumber: inv.invoiceNumber,
        studentId: inv.studentId,
        // Prefer the live student row's name from the invoice snapshot's
        // sibling source of truth (member row) — both are denormalized;
        // the member row is what the operator just picked from.
        studentName: memberNameById.get(inv.studentId) ?? inv.studentName,
        ...(inv.gradeLevel ? { gradeLevel: inv.gradeLevel } : {}),
        status: inv.status,
        dueDate: inv.dueDate,
        amountDue: inv.amountDue,
        currency: inv.currency,
      }))
      .sort((a, b) =>
        a.dueDate === b.dueDate
          ? a.invoiceNumber.localeCompare(b.invoiceNumber)
          : a.dueDate.localeCompare(b.dueDate),
      );

    const totalDue = Math.round(openInvoices.reduce((s, i) => s + i.amountDue, 0) * 100) / 100;

    // Suggested allocation: pay everything oldest-first. The planner caps
    // at 20 targets (DDB transactWrite ceiling) — plan only the 20 oldest
    // when the family exceeds it.
    const plannable = openInvoices.slice(0, MAX_PAYMENT_TARGETS);
    const plannableTotal = Math.round(plannable.reduce((s, i) => s + i.amountDue, 0) * 100) / 100;
    const suggestedAllocation =
      plannableTotal > 0
        ? planPaymentAllocation(
            plannableTotal,
            plannable.map(i => ({
              invoiceId: i.invoiceId,
              invoiceNumber: i.invoiceNumber,
              studentAccountId: '',
              amountDue: i.amountDue,
              dueDate: i.dueDate,
            })),
            'oldest_due_first',
          ).map(p => ({ invoiceId: p.invoiceId, amount: p.amount }))
        : [];

    this.logger.log(
      `getFamilyOpenInvoices familyId=${familyId} schoolId=${schoolId} members=${members.length} `
      + `openInvoices=${openInvoices.length} totalDue=${totalDue}`,
    );

    return {
      familyId: family.id,
      familyName: family.name,
      students: members,
      openInvoices,
      totalDue,
      suggestedAllocation,
    };
  }
}
