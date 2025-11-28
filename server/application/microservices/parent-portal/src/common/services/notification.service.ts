/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Notification Service - SES/SNS integration for sending notifications to parents
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { DynamoDBClientService } from '../dynamodb-client.service';
import type { Parent } from '@edforge/shared-types';

export interface NotificationPreferences {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  notificationTypes: {
    grades: boolean;
    attendance: boolean;
    invoices: boolean;
    announcements: boolean;
  };
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly sesClient: SESClient;
  private readonly snsClient: SNSClient;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly configService: ConfigService
  ) {
    this.sesClient = new SESClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.snsClient = new SNSClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.fromEmail = this.configService.get<string>('SES_FROM_EMAIL') || 'noreply@edforge.net';
    this.fromName = this.configService.get<string>('SES_FROM_NAME') || 'EdForge';
  }

  /**
   * Get parent notification preferences
   */
  private async getNotificationPreferences(
    tenantId: string,
    parentId: string
  ): Promise<NotificationPreferences> {
    try {
      const parent = await this.dynamoDBClient.getItem(
        tenantId,
        `PARENT#${parentId}`
      ) as Parent;

      if (!parent) {
        // Default preferences if parent not found
        return {
          emailEnabled: true,
          smsEnabled: false,
          pushEnabled: false,
          notificationTypes: {
            grades: true,
            attendance: true,
            invoices: true,
            announcements: true
          }
        };
      }

      // Extract preferences from parent entity
      const accountAccess = parent.accountAccess || {};
      const notificationPrefs = parent.notificationPreferences || {};

      return {
        emailEnabled: accountAccess.portalEnabled !== false && (notificationPrefs.emailEnabled !== false),
        smsEnabled: notificationPrefs.smsEnabled === true,
        pushEnabled: notificationPrefs.pushEnabled === true,
        notificationTypes: {
          grades: notificationPrefs.grades !== false,
          attendance: notificationPrefs.attendance !== false,
          invoices: notificationPrefs.invoices !== false,
          announcements: notificationPrefs.announcements !== false
        }
      };
    } catch (error: any) {
      this.logger.error(`Failed to get notification preferences: ${error.message}`);
      // Return default preferences on error
      return {
        emailEnabled: true,
        smsEnabled: false,
        pushEnabled: false,
        notificationTypes: {
          grades: true,
          attendance: true,
          invoices: true,
          announcements: true
        }
      };
    }
  }

  /**
   * Send email notification via SES
   */
  async sendEmailNotification(
    tenantId: string,
    parentId: string,
    subject: string,
    body: string,
    notificationType?: 'grades' | 'attendance' | 'invoices' | 'announcements'
  ): Promise<void> {
    try {
      // Check notification preferences
      const preferences = await this.getNotificationPreferences(tenantId, parentId);
      
      if (!preferences.emailEnabled) {
        this.logger.debug(`Email notifications disabled for parent ${parentId}`);
        return;
      }

      if (notificationType && !preferences.notificationTypes[notificationType]) {
        this.logger.debug(`Email notifications disabled for type ${notificationType} for parent ${parentId}`);
        return;
      }

      // Get parent email
      const parent = await this.dynamoDBClient.getItem(
        tenantId,
        `PARENT#${parentId}`
      ) as Parent;

      if (!parent || !parent.contactInfo?.email) {
        this.logger.warn(`Parent ${parentId} not found or has no email address`);
        return;
      }

      const toEmail = parent.contactInfo.email;

      // Send email via SES
      const command = new SendEmailCommand({
        Source: `${this.fromName} <${this.fromEmail}>`,
        Destination: {
          ToAddresses: [toEmail]
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
              Data: body.replace(/<[^>]*>/g, ''), // Strip HTML for text version
              Charset: 'UTF-8'
            }
          }
        }
      });

      const response = await this.sesClient.send(command);
      this.logger.log(`Email sent to ${toEmail} for parent ${parentId}: ${response.MessageId}`);
    } catch (error: any) {
      this.logger.error(`Failed to send email notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Send SMS notification via SNS
   */
  async sendSMSNotification(
    tenantId: string,
    parentId: string,
    message: string,
    notificationType?: 'grades' | 'attendance' | 'invoices' | 'announcements'
  ): Promise<void> {
    try {
      // Check notification preferences
      const preferences = await this.getNotificationPreferences(tenantId, parentId);
      
      if (!preferences.smsEnabled) {
        this.logger.debug(`SMS notifications disabled for parent ${parentId}`);
        return;
      }

      if (notificationType && !preferences.notificationTypes[notificationType]) {
        this.logger.debug(`SMS notifications disabled for type ${notificationType} for parent ${parentId}`);
        return;
      }

      // Get parent phone number
      const parent = await this.dynamoDBClient.getItem(
        tenantId,
        `PARENT#${parentId}`
      ) as Parent;

      if (!parent || !parent.contactInfo?.phone) {
        this.logger.warn(`Parent ${parentId} not found or has no phone number`);
        return;
      }

      const phoneNumber = parent.contactInfo.phone;

      // Send SMS via SNS
      const command = new PublishCommand({
        PhoneNumber: phoneNumber,
        Message: message,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': {
            DataType: 'String',
            StringValue: 'Transactional'
          }
        }
      });

      const response = await this.snsClient.send(command);
      this.logger.log(`SMS sent to ${phoneNumber} for parent ${parentId}: ${response.MessageId}`);
    } catch (error: any) {
      this.logger.error(`Failed to send SMS notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Send push notification via SNS (future implementation)
   */
  async sendPushNotification(
    tenantId: string,
    parentId: string,
    title: string,
    body: string,
    notificationType?: 'grades' | 'attendance' | 'invoices' | 'announcements'
  ): Promise<void> {
    try {
      // Check notification preferences
      const preferences = await this.getNotificationPreferences(tenantId, parentId);
      
      if (!preferences.pushEnabled) {
        this.logger.debug(`Push notifications disabled for parent ${parentId}`);
        return;
      }

      if (notificationType && !preferences.notificationTypes[notificationType]) {
        this.logger.debug(`Push notifications disabled for type ${notificationType} for parent ${parentId}`);
        return;
      }

      // TODO: Implement push notification via SNS
      // This requires device tokens to be stored in the parent entity
      this.logger.warn(`Push notifications not yet implemented for parent ${parentId}`);
    } catch (error: any) {
      this.logger.error(`Failed to send push notification: ${error.message}`, error.stack);
      throw error;
    }
  }
}

