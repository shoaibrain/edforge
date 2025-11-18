/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Finance Service - Tuition, Invoice, and Payment management
 * 
 * ARCHITECTURE:
 * - Atomic transactions for payment processing
 * - Invoice generation on enrollment
 * - Overdue detection via GSI10
 */

import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/dynamodb-client.service';
import {
  TuitionConfiguration,
  StudentBillingAccount,
  Invoice,
  Payment,
  RequestContext
} from '../common/entities/finance.entities';
import { EntityKeyBuilder } from '../common/entities/base.entity';
import { CreateTuitionConfigurationDto, CreatePaymentDto } from './dto/finance.dto';
import { Enrollment } from '../common/entities/enrollment.entities';
import { InvoiceNotFoundException, PaymentException } from '../common/errors/enrollment-exception';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService
  ) {}

  /**
   * Create Tuition Configuration
   */
  async createTuitionConfiguration(
    tenantId: string,
    createDto: CreateTuitionConfigurationDto,
    context: RequestContext
  ): Promise<TuitionConfiguration> {
    const timestamp = new Date().toISOString();

    const config: TuitionConfiguration = {
      tenantId,
      entityKey: EntityKeyBuilder.tuitionConfig(createDto.schoolId, createDto.academicYearId),
      entityType: 'TUITION_CONFIG',
      
      schoolId: createDto.schoolId,
      academicYearId: createDto.academicYearId,
      
      tuitionRates: createDto.tuitionRates,
      fees: createDto.fees || [],
      discountPolicies: createDto.discountPolicies || [],
      paymentPlans: [],
      
      createdAt: timestamp,
      createdBy: context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: 1,
      
      gsi1pk: createDto.schoolId,
      gsi1sk: `TUITION_CONFIG#${createDto.academicYearId}`,
      gsi2pk: `${createDto.schoolId}#${createDto.academicYearId}`,
      gsi2sk: 'TUITION_CONFIG#current'
    };

    await this.dynamoDBClient.putItem(config);
    this.logger.log(`Tuition configuration created for school ${createDto.schoolId}, year ${createDto.academicYearId}`);
    return config;
  }

  /**
   * Get Tuition Configuration
   */
  async getTuitionConfiguration(
    tenantId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<TuitionConfiguration> {
    const entityKey = EntityKeyBuilder.tuitionConfig(schoolId, academicYearId);
    const config = await this.dynamoDBClient.getItem(tenantId, entityKey);

    if (!config || config.entityType !== 'TUITION_CONFIG') {
      throw new Error(`Tuition configuration not found for school ${schoolId}, year ${academicYearId}`);
    }

    return config as TuitionConfiguration;
  }

  /**
   * Calculate Invoice - Pure function (no DB operations)
   * Returns calculated invoice data without creating it
   */
  calculateInvoice(
    enrollment: Enrollment,
    tuitionConfig: TuitionConfiguration
  ): {
    lineItems: Invoice['lineItems'];
    subtotal: number;
    discounts: number;
    tax: number;
    total: number;
    currency: string;
  } {
    const tuitionRate = tuitionConfig.tuitionRates[enrollment.gradeLevel];
    if (!tuitionRate) {
      throw new Error(`No tuition rate configured for grade ${enrollment.gradeLevel}`);
    }

    // Build line items
    const lineItems: Invoice['lineItems'] = [];

    // Tuition line item
    lineItems.push({
      itemId: uuid(),
      description: `Tuition for Grade ${enrollment.gradeLevel}`,
      category: 'tuition',
      quantity: 1,
      unitPrice: tuitionRate.amount,
      amount: tuitionRate.amount,
      sourceConfig: {
        tuitionConfigId: tuitionConfig.entityKey
      }
    });

    // Fees (mandatory and applicable)
    const applicableFees = this.getApplicableFees(tuitionConfig.fees, enrollment.gradeLevel);
    applicableFees.forEach(fee => {
      lineItems.push({
        itemId: uuid(),
        description: fee.feeName,
        category: 'fee',
        quantity: 1,
        unitPrice: fee.amount,
        amount: fee.amount,
        sourceConfig: {
          feeId: fee.feeId || uuid()
        }
      });
    });

    // Calculate subtotal
    const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);

    // Apply discounts
    const discountResult = this.applyDiscounts(lineItems, tuitionConfig.discountPolicies, enrollment);
    const discounts = discountResult.discountAmount;
    const discountLineItems = discountResult.discountLineItems;
    lineItems.push(...discountLineItems);

    // Calculate tax
    const tax = this.calculateTax(subtotal - discounts, tuitionConfig.taxSettings);

    // Calculate total
    const total = subtotal - discounts + tax;

    return {
      lineItems,
      subtotal,
      discounts,
      tax,
      total,
      currency: tuitionRate.currency
    };
  }

  /**
   * Get Applicable Fees - Enhanced fee filtering logic
   */
  private getApplicableFees(
    fees: TuitionConfiguration['fees'],
    gradeLevel: string
  ): TuitionConfiguration['fees'] {
    return fees.filter(fee => {
      // Only mandatory fees are applied automatically
      if (!fee.isMandatory) return false;

      // If no applicable grades specified, applies to all grades
      if (!fee.applicableGrades || fee.applicableGrades.length === 0) return true;

      // Check if grade level is in applicable grades
      return fee.applicableGrades.includes(gradeLevel);
    });
  }

  /**
   * Apply Discounts - Calculate and apply discount policies
   */
  private applyDiscounts(
    lineItems: Invoice['lineItems'],
    discountPolicies: TuitionConfiguration['discountPolicies'],
    enrollment: Enrollment
  ): { discountAmount: number; discountLineItems: Invoice['lineItems'] } {
    let totalDiscount = 0;
    const discountLineItems: Invoice['lineItems'] = [];

    if (!discountPolicies || discountPolicies.length === 0) {
      return { discountAmount: 0, discountLineItems: [] };
    }

    // Apply each applicable discount policy
    for (const policy of discountPolicies) {
      let policyDiscount = 0;
      let applicableItems: Invoice['lineItems'] = [];

      // Determine which line items the discount applies to
      if (policy.applicableTo === 'tuition') {
        applicableItems = lineItems.filter(item => item.category === 'tuition');
      } else if (policy.applicableTo === 'fees') {
        applicableItems = lineItems.filter(item => item.category === 'fee');
      } else if (policy.applicableTo === 'both') {
        applicableItems = lineItems.filter(item => item.category === 'tuition' || item.category === 'fee');
      }

      if (applicableItems.length === 0) continue;

      // Calculate discount amount
      const applicableTotal = applicableItems.reduce((sum, item) => sum + item.amount, 0);

      if (policy.discountPercentage !== undefined) {
        policyDiscount = (applicableTotal * policy.discountPercentage) / 100;
      } else if (policy.discountAmount !== undefined) {
        policyDiscount = Math.min(policy.discountAmount, applicableTotal);
      }

      // Apply max discount cap if specified
      if (policy.maxDiscount !== undefined) {
        policyDiscount = Math.min(policyDiscount, policy.maxDiscount);
      }

      if (policyDiscount > 0) {
        totalDiscount += policyDiscount;

        // Add discount line item (negative amount)
        discountLineItems.push({
          itemId: uuid(),
          description: `Discount: ${policy.name}`,
          category: 'discount',
          quantity: 1,
          unitPrice: -policyDiscount,
          amount: -policyDiscount,
          sourceConfig: {
            discountPolicyId: policy.policyId || uuid()
          }
        });
      }
    }

    return { discountAmount: totalDiscount, discountLineItems };
  }

  /**
   * Calculate Tax - Apply tax based on tuition configuration
   */
  private calculateTax(
    taxableAmount: number,
    taxSettings?: TuitionConfiguration['taxSettings']
  ): number {
    if (!taxSettings || !taxSettings.taxEnabled) {
      return 0;
    }

    // Tax is calculated on taxable amount (after discounts)
    // Tax-exempt items are already excluded from line items
    return (taxableAmount * taxSettings.taxRate) / 100;
  }

  /**
   * Select Payment Plan - Choose payment plan from tuition configuration
   */
  selectPaymentPlan(
    tuitionConfig: TuitionConfiguration,
    total: number
  ): {
    paymentPlan: 'full' | 'installment' | 'custom';
    installmentCount?: number;
    installmentAmount?: number;
    nextDueDate?: string;
  } {
    // Default to full payment if no plans available
    if (!tuitionConfig.paymentPlans || tuitionConfig.paymentPlans.length === 0) {
      return { paymentPlan: 'full' };
    }

    // For MVP, select the first available plan
    // In production, this could be based on user selection or business rules
    const plan = tuitionConfig.paymentPlans[0];

    return {
      paymentPlan: plan.installmentCount === 1 ? 'full' : 'installment',
      installmentCount: plan.installmentCount,
      installmentAmount: plan.installmentAmount,
      nextDueDate: plan.dueDates?.[0]
    };
  }

  /**
   * Prepare Invoice Entity - Creates invoice entity without DB operations
   * Requires tuitionConfig to be passed in (already fetched)
   */
  prepareInvoiceEntity(
    tenantId: string,
    enrollment: Enrollment,
    tuitionConfig: TuitionConfiguration,
    invoiceCalculation: ReturnType<typeof this.calculateInvoice>,
    accountId: string,
    context: RequestContext
  ): Invoice {
    const invoiceId = uuid();
    const timestamp = new Date().toISOString();
    const invoiceNumber = `INV-${new Date().getFullYear()}-${uuid().substring(0, 8).toUpperCase()}`;

    // Get due date from tuition rate or default to 30 days
    const tuitionRate = tuitionConfig.tuitionRates[enrollment.gradeLevel];
    const dueDate = tuitionRate?.dueDates?.[0] || 
                    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const invoice: Invoice = {
      tenantId,
      entityKey: EntityKeyBuilder.invoice(
        enrollment.schoolId,
        enrollment.academicYearId,
        enrollment.studentId,
        invoiceId
      ),
      entityType: 'INVOICE',
      
      studentId: enrollment.studentId,
      schoolId: enrollment.schoolId,
      academicYearId: enrollment.academicYearId,
      accountId,
      invoiceId,
      invoiceNumber,
      
      issueDate: timestamp,
      dueDate,
      status: 'sent',
      
      lineItems: invoiceCalculation.lineItems,
      subtotal: invoiceCalculation.subtotal,
      tax: invoiceCalculation.tax,
      discounts: invoiceCalculation.discounts,
      total: invoiceCalculation.total,
      currency: invoiceCalculation.currency,
      
      payments: [],
      amountPaid: 0,
      amountDue: invoiceCalculation.total,
      
      createdAt: timestamp,
      createdBy: context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: 1,
      
      // GSI Keys - Updated to include invoiceId for efficient lookup
      gsi2pk: `${enrollment.schoolId}#${enrollment.academicYearId}`,
      gsi2sk: `INVOICE#sent#${dueDate}#${invoiceNumber}`,
      gsi7pk: enrollment.studentId,
      gsi7sk: `INVOICE#${invoiceId}#${dueDate}`, // Include invoiceId for efficient lookup
      gsi10pk: `${enrollment.schoolId}#${enrollment.academicYearId}#sent`,
      gsi10sk: `${dueDate}#${invoiceId}`
    };

    return invoice;
  }

  /**
   * Generate Invoice on Enrollment - ATOMIC TRANSACTION
   * 
   * Creates: Invoice + BillingAccount (or updates existing)
   * 
   * NOTE: This method is kept for backward compatibility but should be refactored
   * to use calculateInvoice() and prepareInvoiceEntity() for atomic enrollment transactions
   */
  async generateInvoiceOnEnrollment(
    tenantId: string,
    enrollment: Enrollment,
    context: RequestContext
  ): Promise<{ invoice: Invoice; account: StudentBillingAccount }> {
    // 1. Get tuition configuration
    const tuitionConfig = await this.getTuitionConfiguration(
      tenantId,
      enrollment.schoolId,
      enrollment.academicYearId
    );

    // 2. Calculate invoice using pure function
    const invoiceCalculation = this.calculateInvoice(enrollment, tuitionConfig);

    const invoiceId = uuid();
    const timestamp = new Date().toISOString();
    const invoiceNumber = `INV-${new Date().getFullYear()}-${uuid().substring(0, 8).toUpperCase()}`;
    const dueDate = tuitionConfig.tuitionRates[enrollment.gradeLevel].dueDates?.[0] || 
                     new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // 3. Create invoice using prepared entity method
    const invoice = this.prepareInvoiceEntity(
      tenantId,
      enrollment,
      tuitionConfig,
      invoiceCalculation,
      '', // accountId will be set after account creation
      context
    );
    
    // Update invoice with calculated values
    invoice.invoiceId = invoiceId;
    invoice.invoiceNumber = invoiceNumber;

    // 4. Get or create billing account
    const accountKey = EntityKeyBuilder.billingAccount(
      enrollment.schoolId,
      enrollment.academicYearId,
      enrollment.studentId
    );

    let account = await this.dynamoDBClient.getItem(tenantId, accountKey) as StudentBillingAccount | null;

    // Select payment plan
    const paymentPlanInfo = this.selectPaymentPlan(tuitionConfig, invoiceCalculation.total);

    if (!account) {
      const accountId = uuid();
      account = {
        tenantId,
        entityKey: accountKey,
        entityType: 'BILLING_ACCOUNT',
        
        studentId: enrollment.studentId,
        schoolId: enrollment.schoolId,
        academicYearId: enrollment.academicYearId,
        accountId,
        
        balance: {
          totalDue: invoiceCalculation.total,
          totalPaid: 0,
          totalOutstanding: invoiceCalculation.total,
          currency: invoiceCalculation.currency,
          lastUpdated: timestamp
        },
        
        paymentPlan: paymentPlanInfo.paymentPlan,
        installmentCount: paymentPlanInfo.installmentCount,
        installmentAmount: paymentPlanInfo.installmentAmount,
        nextDueDate: paymentPlanInfo.nextDueDate,
        status: 'active',
        
        createdAt: timestamp,
        createdBy: context.userId,
        updatedAt: timestamp,
        updatedBy: context.userId,
        version: 1,
        
        gsi2pk: `${enrollment.schoolId}#${enrollment.academicYearId}`,
        gsi2sk: `ACCOUNT#active#${enrollment.studentId}`,
        gsi7pk: enrollment.studentId,
        gsi7sk: `ACCOUNT#${enrollment.academicYearId}`
      };
    } else {
      // Update existing account
      account.balance.totalDue += invoiceCalculation.total;
      account.balance.totalOutstanding += invoiceCalculation.total;
      account.balance.lastUpdated = timestamp;
      account.updatedAt = timestamp;
      account.updatedBy = context.userId;
      account.version += 1;
    }

    // Set accountId in invoice
    invoice.accountId = account.accountId;

    // 5. Atomic transaction: Create invoice + Create/Update account
    const transactItems = [
      {
        Put: {
          TableName: this.dynamoDBClient.getTableName(),
          Item: invoice
        }
      },
      account.version === 1 ? {
        Put: {
          TableName: this.dynamoDBClient.getTableName(),
          Item: account
        }
      } : {
        Update: {
          TableName: this.dynamoDBClient.getTableName(),
          Key: {
            tenantId,
            entityKey: accountKey
          },
          UpdateExpression: 'SET balance.totalDue = balance.totalDue + :amount, balance.totalOutstanding = balance.totalOutstanding + :amount, balance.lastUpdated = :timestamp, updatedAt = :timestamp, updatedBy = :userId, #version = #version + :inc',
          ExpressionAttributeNames: {
            '#version': 'version'
          },
          ExpressionAttributeValues: {
            ':amount': invoiceCalculation.total,
            ':timestamp': timestamp,
            ':userId': context.userId,
            ':inc': 1,
            ':currentVersion': account.version - 1
          },
          ConditionExpression: '#version = :currentVersion'
        }
      }
    ];

    await this.dynamoDBClient.transactWrite(transactItems);

    this.logger.log(`Invoice generated: ${invoiceNumber} for student ${enrollment.studentId}`);
    return { invoice, account };
  }

  /**
   * Record Payment - ATOMIC TRANSACTION
   * 
   * Creates: Payment + Updates Invoice + Updates BillingAccount
   */
  async recordPayment(
    tenantId: string,
    createPaymentDto: CreatePaymentDto,
    context: RequestContext
  ): Promise<Payment> {
    // 1. Get invoice
    const invoice = await this.getInvoice(tenantId, createPaymentDto.invoiceId);

    if (invoice.amountDue < createPaymentDto.amount) {
      throw new PaymentException('Payment amount exceeds invoice amount due');
    }

    const paymentId = uuid();
    const timestamp = new Date().toISOString();

    // 2. Create payment
    const payment: Payment = {
      tenantId,
      entityKey: EntityKeyBuilder.payment(createPaymentDto.invoiceId, paymentId),
      entityType: 'PAYMENT',
      
      invoiceId: createPaymentDto.invoiceId,
      studentId: invoice.studentId,
      schoolId: invoice.schoolId,
      academicYearId: invoice.academicYearId,
      accountId: invoice.accountId,
      paymentId,
      
      amount: createPaymentDto.amount,
      currency: createPaymentDto.currency,
      paymentDate: createPaymentDto.paymentDate,
      paymentMethod: createPaymentDto.paymentMethod,
      status: 'completed',
      
      referenceNumber: createPaymentDto.referenceNumber,
      notes: createPaymentDto.notes,
      receivedBy: context.userId,
      
      createdAt: timestamp,
      createdBy: context.userId,
      updatedAt: timestamp,
      updatedBy: context.userId,
      version: 1,
      
      gsi7pk: invoice.studentId,
      gsi7sk: `PAYMENT#${createPaymentDto.paymentDate}#${paymentId}`
    };

    // 3. Update invoice
    const newAmountPaid = invoice.amountPaid + createPaymentDto.amount;
    const newAmountDue = invoice.total - newAmountPaid;
    const newStatus = newAmountDue === 0 ? 'paid' : (newAmountPaid > 0 ? 'partially_paid' : invoice.status);

    // 4. Get billing account
    const accountKey = EntityKeyBuilder.billingAccount(
      invoice.schoolId,
      invoice.academicYearId,
      invoice.studentId
    );
    const account = await this.dynamoDBClient.getItem(tenantId, accountKey) as StudentBillingAccount;

    if (!account) {
      throw new Error('Billing account not found');
    }

    // 5. Update account balance
    const newTotalPaid = account.balance.totalPaid + createPaymentDto.amount;
    const newTotalOutstanding = account.balance.totalDue - newTotalPaid;
    const newAccountStatus = newTotalOutstanding === 0 ? 'paid_in_full' : account.status;

    // 6. Atomic transaction: Payment + Invoice + Account
    const transactItems = [
      {
        Put: {
          TableName: this.dynamoDBClient.getTableName(),
          Item: payment
        }
      },
      {
        Update: {
          TableName: this.dynamoDBClient.getTableName(),
          Key: {
            tenantId,
            entityKey: invoice.entityKey
          },
          UpdateExpression: 'SET amountPaid = :amountPaid, amountDue = :amountDue, #status = :status, payments = list_append(payments, :payment), updatedAt = :timestamp, updatedBy = :userId, #version = #version + :inc',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#version': 'version'
          },
          ExpressionAttributeValues: {
            ':amountPaid': newAmountPaid,
            ':amountDue': newAmountDue,
            ':status': newStatus,
            ':payment': [{
              paymentId,
              amount: createPaymentDto.amount,
              paymentDate: createPaymentDto.paymentDate,
              paymentMethod: createPaymentDto.paymentMethod,
              referenceNumber: createPaymentDto.referenceNumber
            }],
            ':timestamp': timestamp,
            ':userId': context.userId,
            ':inc': 1,
            ':currentVersion': invoice.version
          },
          ConditionExpression: '#version = :currentVersion'
        }
      },
      {
        Update: {
          TableName: this.dynamoDBClient.getTableName(),
          Key: {
            tenantId,
            entityKey: accountKey
          },
          UpdateExpression: 'SET balance.totalPaid = :totalPaid, balance.totalOutstanding = :totalOutstanding, balance.lastUpdated = :timestamp, #status = :status, updatedAt = :timestamp, updatedBy = :userId, #version = #version + :inc',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#version': 'version'
          },
          ExpressionAttributeValues: {
            ':totalPaid': newTotalPaid,
            ':totalOutstanding': newTotalOutstanding,
            ':status': newAccountStatus,
            ':timestamp': timestamp,
            ':userId': context.userId,
            ':inc': 1,
            ':currentVersion': account.version
          },
          ConditionExpression: '#version = :currentVersion'
        }
      }
    ];

    await this.dynamoDBClient.transactWrite(transactItems);

    this.logger.log(`Payment recorded: ${paymentId} for invoice ${createPaymentDto.invoiceId}`);
    return payment;
  }

  /**
   * Get Invoice by Invoice ID
   * 
   * NOTE: This method requires scanning/querying since invoiceId is not in partition key.
   * For better performance, use getInvoiceByStudentAndId() when studentId is known.
   * 
   * For MVP: Query all invoices for tenant and filter by invoiceId.
   * This is acceptable for small scale (<500 students) but should be optimized for production.
   */
  async getInvoice(tenantId: string, invoiceId: string): Promise<Invoice> {
    // Query all invoices for tenant (using main table query)
    // Filter by invoiceId
    const items = await this.dynamoDBClient.query(
      tenantId,
      'SCHOOL#', // Query all school-related entities
      'entityType = :type AND invoiceId = :invoiceId',
      {
        ':type': 'INVOICE',
        ':invoiceId': invoiceId
      },
      undefined,
      100
    );

    if (items.length === 0) {
      throw new InvoiceNotFoundException(invoiceId);
    }

    return items[0] as Invoice;
  }

  /**
   * Get Invoice by Invoice ID and Student ID - More efficient lookup using GSI7
   */
  async getInvoiceByStudentAndId(
    tenantId: string,
    studentId: string,
    invoiceId: string
  ): Promise<Invoice> {
    // Use GSI7 with studentId and invoiceId in sort key
    const items = await this.dynamoDBClient.queryGSI(
      'GSI7',
      studentId,
      `INVOICE#${invoiceId}#`,
      'begins_with',
      'entityType = :type',
      {
        ':type': 'INVOICE'
      },
      undefined,
      10
    );

    const invoices = items.filter(
      item => item.tenantId === tenantId && 
              item.entityType === 'INVOICE' && 
              (item as any).invoiceId === invoiceId
    );

    if (invoices.length === 0) {
      throw new InvoiceNotFoundException(invoiceId);
    }

    return invoices[0] as Invoice;
  }

  /**
   * Get Invoices by Student (using GSI7)
   */
  async getInvoicesByStudent(tenantId: string, studentId: string): Promise<Invoice[]> {
    const items = await this.dynamoDBClient.queryGSI(
      'GSI7',
      studentId,
      'INVOICE#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      100
    );

    return items.filter(item => item.tenantId === tenantId && item.entityType === 'INVOICE') as Invoice[];
  }

  /**
   * Get Overdue Invoices (using GSI10)
   * 
   * GSI10 Pattern:
   * - Partition Key: schoolId#academicYearId#status (e.g., "school-123#year-456#sent")
   * - Sort Key: dueDate#invoiceId (e.g., "2024-01-15#invoice-789")
   * 
   * Query for overdue: status='sent' AND dueDate < today
   * Use 'between' to query from earliest date to today (exclusive)
   */
  async getOverdueInvoices(
    tenantId: string,
    schoolId: string,
    academicYearId: string
  ): Promise<Invoice[]> {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // Query GSI10 for invoices with status='sent' and dueDate < today
    // GSI10 PK: schoolId#academicYearId#sent
    // GSI10 SK: dueDate#invoiceId (sorted ascending)
    // Use 'between' to query from earliest date to yesterday (to get all overdue)
    const items = await this.dynamoDBClient.queryGSI(
      'GSI10',
      `${schoolId}#${academicYearId}#sent`,
      '1970-01-01', // Start from earliest date
      'between', // Query for dueDate between start and end
      'entityType = :type',
      {
        ':type': 'INVOICE',
        ':sk_start': '1970-01-01',
        ':sk_end': yesterday // Query up to yesterday (dueDate < today)
      },
      undefined,
      100
    );

    // Filter by tenant and dueDate < today (additional filter for safety)
    const overdueInvoices = items.filter(
      item => item.tenantId === tenantId && 
              item.entityType === 'INVOICE' &&
              item.dueDate < today &&
              item.status === 'sent'
    ) as Invoice[];

    return overdueInvoices;
  }
}

