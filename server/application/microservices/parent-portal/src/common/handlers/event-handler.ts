/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Parent Portal Event Handler - Lambda function to consume events for Parent Portal
 * 
 * Handles GradePublished, InvoiceGenerated, and AttendanceRecorded events
 * by sending notifications to parents based on their preferences.
 */

import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'us-east-1'
});
const snsClient = new SNSClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const TABLE_NAME = process.env.TABLE_NAME || 'school-table-v2-basic';
const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@edforge.net';
const FROM_NAME = process.env.SES_FROM_NAME || 'EdForge';

interface Parent {
  tenantId: string;
  parentId: string;
  firstName?: string;
  lastName?: string;
  contactInfo?: {
    email?: string;
    phone?: string;
  };
  notificationPreferences?: {
    emailEnabled?: boolean;
    smsEnabled?: boolean;
    grades?: boolean;
    attendance?: boolean;
    invoices?: boolean;
  };
}

/**
 * Get parents by student ID using GSI12
 */
async function getParentsByStudent(tenantId: string, studentId: string): Promise<Parent[]> {
  try {
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI12',
      KeyConditionExpression: 'studentId = :studentId',
      FilterExpression: 'tenantId = :tenantId AND entityType = :entityType',
      ExpressionAttributeValues: {
        ':studentId': studentId,
        ':tenantId': tenantId,
        ':entityType': 'PARENT'
      },
      Limit: 100
    });

    const response = await docClient.send(command);
    return (response.Items || []) as Parent[];
  } catch (error: any) {
    console.error(`Failed to get parents for student ${studentId}:`, error);
    return [];
  }
}

/**
 * Check if parent should receive notification for this event type
 */
function shouldNotify(parent: Parent, eventType: string): boolean {
  const prefs = parent.notificationPreferences || {};
  
  // Check if email/SMS is enabled
  if (!prefs.emailEnabled && !prefs.smsEnabled) {
    return false;
  }

  // Check event type preference
  switch (eventType) {
    case 'GradePublished':
      return prefs.grades !== false;
    case 'AttendanceRecorded':
      return prefs.attendance !== false;
    case 'InvoiceGenerated':
      return prefs.invoices !== false;
    default:
      return true; // Default to notify for unknown types
  }
}

/**
 * Send email notification via SES
 */
async function sendEmailNotification(
  parent: Parent,
  subject: string,
  body: string
): Promise<void> {
  if (!parent.contactInfo?.email) {
    console.warn(`Parent ${parent.parentId} has no email address`);
    return;
  }

  try {
    const command = new SendEmailCommand({
      Source: `${FROM_NAME} <${FROM_EMAIL}>`,
      Destination: {
        ToAddresses: [parent.contactInfo.email]
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: 'UTF-8'
        },
        Body: {
          Html: {
            Data: body,
            Charset: 'UTF-8'
          },
          Text: {
            Data: body.replace(/<[^>]*>/g, ''), // Strip HTML
            Charset: 'UTF-8'
          }
        }
      }
    });

    const response = await sesClient.send(command);
    console.log(`Email sent to ${parent.contactInfo.email} for parent ${parent.parentId}: ${response.MessageId}`);
  } catch (error: any) {
    console.error(`Failed to send email to parent ${parent.parentId}:`, error);
    throw error;
  }
}

/**
 * Send SMS notification via SNS
 */
async function sendSMSNotification(
  parent: Parent,
  message: string
): Promise<void> {
  if (!parent.contactInfo?.phone) {
    console.warn(`Parent ${parent.parentId} has no phone number`);
    return;
  }

  try {
    const command = new PublishCommand({
      PhoneNumber: parent.contactInfo.phone,
      Message: message
    });

    const response = await snsClient.send(command);
    console.log(`SMS sent to ${parent.contactInfo.phone} for parent ${parent.parentId}: ${response.MessageId}`);
  } catch (error: any) {
    console.error(`Failed to send SMS to parent ${parent.parentId}:`, error);
    throw error;
  }
}

/**
 * Format notification content based on event type
 */
function formatNotificationContent(eventType: string, detail: any): { subject: string; body: string; sms: string } {
  switch (eventType) {
    case 'GradePublished': {
      const studentName = detail.studentName || detail.studentId;
      const score = detail.score || 'N/A';
      const maxScore = detail.maxScore || 'N/A';
      const letterGrade = detail.letterGrade || 'N/A';
      const assignmentName = detail.assignmentName || 'Assignment';
      
      return {
        subject: `Grade Published: ${assignmentName}`,
        body: `
          <html>
            <body>
              <h2>Grade Published</h2>
              <p>Dear Parent,</p>
              <p>A new grade has been published for ${studentName}:</p>
              <ul>
                <li><strong>Assignment:</strong> ${assignmentName}</li>
                <li><strong>Score:</strong> ${score}/${maxScore}</li>
                <li><strong>Grade:</strong> ${letterGrade}</li>
              </ul>
              <p>Please log in to the parent portal to view more details.</p>
              <p>Best regards,<br>EdForge Team</p>
            </body>
          </html>
        `,
        sms: `Grade Published: ${studentName} - ${assignmentName}: ${score}/${maxScore} (${letterGrade})`
      };
    }
    
    case 'InvoiceGenerated': {
      const studentName = detail.studentName || detail.studentId;
      const invoiceId = detail.invoiceId || 'N/A';
      const total = detail.total || '0.00';
      const currency = detail.currency || 'USD';
      const dueDate = detail.dueDate || 'N/A';
      
      return {
        subject: `New Invoice Generated`,
        body: `
          <html>
            <body>
              <h2>New Invoice</h2>
              <p>Dear Parent,</p>
              <p>A new invoice has been generated for ${studentName}:</p>
              <ul>
                <li><strong>Invoice ID:</strong> ${invoiceId}</li>
                <li><strong>Amount:</strong> ${currency} ${total}</li>
                <li><strong>Due Date:</strong> ${dueDate}</li>
              </ul>
              <p>Please log in to the parent portal to view and pay the invoice.</p>
              <p>Best regards,<br>EdForge Team</p>
            </body>
          </html>
        `,
        sms: `New Invoice: ${studentName} - Amount: ${currency} ${total}, Due: ${dueDate}`
      };
    }
    
    case 'AttendanceRecorded': {
      const studentName = detail.studentName || detail.studentId;
      const status = detail.status || 'UNKNOWN';
      const date = detail.date || 'N/A';
      
      return {
        subject: `Attendance Recorded: ${status}`,
        body: `
          <html>
            <body>
              <h2>Attendance Update</h2>
              <p>Dear Parent,</p>
              <p>Attendance has been recorded for ${studentName}:</p>
              <ul>
                <li><strong>Date:</strong> ${date}</li>
                <li><strong>Status:</strong> ${status}</li>
              </ul>
              <p>Please log in to the parent portal to view attendance history.</p>
              <p>Best regards,<br>EdForge Team</p>
            </body>
          </html>
        `,
        sms: `Attendance: ${studentName} - ${date}: ${status}`
      };
    }
    
    default:
      return {
        subject: 'Notification from EdForge',
        body: `<p>You have a new notification from EdForge.</p>`,
        sms: 'You have a new notification from EdForge.'
      };
  }
}

/**
 * Unified event handler for all Parent Portal events
 */
export async function handler(event: EventBridgeEvent<string, any>): Promise<void> {
  const eventType = event['detail-type'];
  const detail = event.detail;
  const source = event.source;
  const eventId = event.id;
  const timestamp = event.time;
  const tenantId = detail.tenantId;
  const studentId = detail.studentId;

  console.log('=== Parent Portal Event Handler ===');
  console.log(`Event ID: ${eventId}`);
  console.log(`Event Type: ${eventType}`);
  console.log(`Source: ${source}`);
  console.log(`Timestamp: ${timestamp}`);
  console.log(`Tenant ID: ${tenantId}`);
  console.log(`Student ID: ${studentId}`);

  // Validate required fields
  if (!tenantId || !studentId) {
    console.error('Missing required fields: tenantId or studentId');
    return;
  }

  // Get parents for this student
  const parents = await getParentsByStudent(tenantId, studentId);
  console.log(`Found ${parents.length} parent(s) for student ${studentId}`);

  if (parents.length === 0) {
    console.log(`No parents found for student ${studentId}, skipping notification`);
    return;
  }

  // Format notification content
  const notification = formatNotificationContent(eventType, detail);

  // Send notifications to each parent
  const notificationPromises = parents.map(async (parent) => {
    // Check if parent should receive notification
    if (!shouldNotify(parent, eventType)) {
      console.log(`Skipping notification for parent ${parent.parentId} (preferences disabled)`);
      return;
    }

    const prefs = parent.notificationPreferences || {};

    // Send email if enabled
    if (prefs.emailEnabled !== false) {
      try {
        await sendEmailNotification(parent, notification.subject, notification.body);
      } catch (error: any) {
        console.error(`Failed to send email to parent ${parent.parentId}:`, error);
        // Continue with SMS even if email fails
      }
    }

    // Send SMS if enabled
    if (prefs.smsEnabled === true) {
      try {
        await sendSMSNotification(parent, notification.sms);
      } catch (error: any) {
        console.error(`Failed to send SMS to parent ${parent.parentId}:`, error);
        // Don't throw - email may have succeeded
      }
    }
  });

  // Wait for all notifications to be sent
  await Promise.allSettled(notificationPromises);
  console.log('=== Notification processing complete ===');
}

