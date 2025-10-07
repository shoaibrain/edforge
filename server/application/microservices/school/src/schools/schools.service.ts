/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 */

import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CreateSchoolDto, UpdateSchoolDto, CreateDepartmentDto, CreateAcademicYearDto, CreateSchoolConfigurationDto, GenerateSchoolReportDto } from './dto/create-school.dto';
import { Department, AcademicYear, SchoolConfiguration, SchoolReport } from './entities/school.entity';
import { v4 as uuid } from 'uuid';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  ScanCommand
} from '@aws-sdk/lib-dynamodb';
import { ClientFactoryService } from '@app/client-factory';

@Injectable()
export class SchoolsService {
  constructor(private readonly clientFac: ClientFactoryService) {}
  
  // Use single table pattern like existing services
  tableName: string = process.env.TABLE_NAME || 'SCHOOL_TABLE_NAME';

  // School Management
  async createSchool(tenantId: string, createSchoolDto: CreateSchoolDto, jwtToken: string): Promise<any> {
    const schoolId = uuid();
    const newSchool = {
      schoolId,
      tenantId,
      ...createSchoolDto,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      const client = await this.fetchClient(tenantId, jwtToken);
      const cmd = new PutCommand({
        Item: {
          ...newSchool,
          entityType: 'SCHOOL',
          entityId: schoolId
        },
        TableName: this.tableName
      });
      await client.send(cmd);
      return newSchool;
    } catch (error) {
      console.error('Error creating school:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getSchools(tenantId: string, jwtToken: string): Promise<any[]> {
    try {
      const client = await this.fetchClient(tenantId, jwtToken);
      const cmd = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :t_id',
        FilterExpression: 'entityType = :entity_type',
        ExpressionAttributeValues: {
          ':t_id': tenantId,
          ':entity_type': 'SCHOOL'
        }
      });
      const response = await client.send(cmd);
      
      return response.Items?.map(item => {
        const { entityType, entityId, ...schoolData } = item;
        return schoolData;
      }) || [];
    } catch (error) {
      console.error('Error getting schools:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getSchool(tenantId: string, schoolId: string, jwtToken: string): Promise<any> {
    try {
      const client = await this.fetchClient(tenantId, jwtToken);
      const cmd = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :t_id AND entityId = :school_id',
        FilterExpression: 'entityType = :entity_type',
        ExpressionAttributeValues: {
          ':t_id': tenantId,
          ':school_id': schoolId,
          ':entity_type': 'SCHOOL'
        }
      });
      const response = await client.send(cmd);
      
      if (!response.Items || response.Items.length === 0) {
        throw new HttpException('School not found', HttpStatus.NOT_FOUND);
      }

      const { entityType, entityId, ...schoolData } = response.Items[0];
      return schoolData;
    } catch (error) {
      console.error('Error getting school:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async updateSchool(tenantId: string, schoolId: string, updateSchoolDto: UpdateSchoolDto, jwtToken: string): Promise<any> {
    try {
      const client = await this.fetchClient(tenantId, jwtToken);
      const cmd = new UpdateCommand({
        TableName: this.tableName,
        Key: {
          tenantId,
          entityId: schoolId
        },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': updateSchoolDto.status || 'ACTIVE',
          ':updatedAt': new Date().toISOString(),
          ...Object.keys(updateSchoolDto).reduce((acc, key) => {
            acc[`:${key}`] = updateSchoolDto[key];
            return acc;
          }, {}),
          ':entity_type': 'SCHOOL'
        },
        ConditionExpression: 'entityType = :entity_type'
      });
      
      await client.send(cmd);
      return await this.getSchool(tenantId, schoolId, jwtToken);
    } catch (error) {
      console.error('Error updating school:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async deleteSchool(tenantId: string, schoolId: string, jwtToken: string): Promise<void> {
    try {
      const client = await this.fetchClient(tenantId, jwtToken);
      const cmd = new UpdateCommand({
        TableName: this.tableName,
        Key: {
          tenantId,
          entityId: schoolId
        },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'DELETED',
          ':updatedAt': new Date().toISOString(),
          ':entity_type': 'SCHOOL'
        },
        ConditionExpression: 'entityType = :entity_type'
      });
      
      await client.send(cmd);
    } catch (error) {
      console.error('Error deleting school:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // Department Management
  async createDepartment(tenantId: string, schoolId: string, createDepartmentDto: CreateDepartmentDto, jwtToken: string): Promise<Department> {
    const departmentId = uuid();
    const newDepartment: Department = {
      departmentId,
      tenantId,
      schoolId,
      ...createDepartmentDto,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      const client = await this.fetchClient(tenantId, jwtToken);
      const cmd = new PutCommand({
        Item: {
          ...newDepartment,
          entityType: 'DEPARTMENT',
          entityId: departmentId
        },
        TableName: this.tableName
      });
      await client.send(cmd);
      return newDepartment;
    } catch (error) {
      console.error('Error creating department:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getDepartments(tenantId: string, schoolId: string, jwtToken: string): Promise<Department[]> {
    try {
      const client = await this.fetchClient(tenantId, jwtToken);
      const cmd = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :t_id',
        FilterExpression: 'entityType = :entity_type AND schoolId = :school_id',
        ExpressionAttributeValues: {
          ':t_id': tenantId,
          ':entity_type': 'DEPARTMENT',
          ':school_id': schoolId
        }
      });
      const response = await client.send(cmd);
      
      return response.Items?.map(item => {
        const { entityType, entityId, ...departmentData } = item;
        return departmentData as Department;
      }) || [];
    } catch (error) {
      console.error('Error getting departments:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // Academic Year Management
  async createAcademicYear(tenantId: string, schoolId: string, createAcademicYearDto: CreateAcademicYearDto, jwtToken: string): Promise<AcademicYear> {
    const academicYearId = uuid();
    const newAcademicYear: AcademicYear = {
      academicYearId,
      tenantId,
      schoolId,
      yearName: createAcademicYearDto.yearName,
      startDate: createAcademicYearDto.startDate,
      endDate: createAcademicYearDto.endDate,
      isCurrent: createAcademicYearDto.isCurrent || false,
      semesters: createAcademicYearDto.semesters.map(semester => ({
        semesterId: uuid(),
        academicYearId,
        semesterName: semester.semesterName,
        startDate: semester.startDate,
        endDate: semester.endDate,
        isCurrent: semester.isCurrent || false,
        status: 'ACTIVE' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })),
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      const client = await this.fetchClient(tenantId, jwtToken);
      const cmd = new PutCommand({
        Item: {
          ...newAcademicYear,
          entityType: 'ACADEMIC_YEAR',
          entityId: academicYearId
        },
        TableName: this.tableName
      });
      await client.send(cmd);
      return newAcademicYear;
    } catch (error) {
      console.error('Error creating academic year:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getAcademicYears(tenantId: string, schoolId: string, jwtToken: string): Promise<AcademicYear[]> {
    try {
      const client = await this.fetchClient(tenantId, jwtToken);
      const cmd = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :t_id',
        FilterExpression: 'entityType = :entity_type AND schoolId = :school_id',
        ExpressionAttributeValues: {
          ':t_id': tenantId,
          ':entity_type': 'ACADEMIC_YEAR',
          ':school_id': schoolId
        }
      });
      const response = await client.send(cmd);
      
      return response.Items?.map(item => {
        const { entityType, entityId, ...academicYearData } = item;
        return academicYearData as AcademicYear;
      }) || [];
    } catch (error) {
      console.error('Error getting academic years:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async setCurrentAcademicYear(tenantId: string, schoolId: string, academicYearId: string, jwtToken: string): Promise<void> {
    try {
      const client = await this.fetchClient(tenantId, jwtToken);
      
      // First, set all academic years for this school to not current
      const updateAllCmd = new UpdateCommand({
        TableName: this.tableName,
        Key: {
          tenantId,
          entityId: academicYearId
        },
        UpdateExpression: 'SET isCurrent = :current, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':current': true,
          ':updatedAt': new Date().toISOString()
        }
      });
      
      await client.send(updateAllCmd);
    } catch (error) {
      console.error('Error setting current academic year:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // School Configuration Management
  async createSchoolConfiguration(tenantId: string, schoolId: string, createConfigDto: CreateSchoolConfigurationDto, jwtToken: string): Promise<SchoolConfiguration> {
    const newConfig: SchoolConfiguration = {
      schoolId,
      tenantId,
      ...createConfigDto,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      const client = await this.fetchClient(tenantId, jwtToken);
      const cmd = new PutCommand({
        Item: {
          ...newConfig,
          entityType: 'SCHOOL_CONFIG',
          entityId: schoolId
        },
        TableName: this.tableName
      });
      await client.send(cmd);
      return newConfig;
    } catch (error) {
      console.error('Error creating school configuration:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getSchoolConfiguration(tenantId: string, schoolId: string, jwtToken: string): Promise<SchoolConfiguration> {
    try {
      const client = await this.fetchClient(tenantId, jwtToken);
      const cmd = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :t_id',
        FilterExpression: 'entityType = :entity_type AND schoolId = :school_id',
        ExpressionAttributeValues: {
          ':t_id': tenantId,
          ':entity_type': 'SCHOOL_CONFIG',
          ':school_id': schoolId
        }
      });
      const response = await client.send(cmd);
      
      if (!response.Items || response.Items.length === 0) {
        throw new HttpException('School configuration not found', HttpStatus.NOT_FOUND);
      }

      const { entityType, entityId, ...configData } = response.Items[0];
      return configData as SchoolConfiguration;
    } catch (error) {
      console.error('Error getting school configuration:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // School Reporting
  async generateSchoolReport(tenantId: string, schoolId: string, generateReportDto: GenerateSchoolReportDto, jwtToken: string): Promise<SchoolReport> {
    const reportId = uuid();
    const newReport: SchoolReport = {
      schoolId,
      tenantId,
      reportType: generateReportDto.reportType,
      reportPeriod: {
        startDate: generateReportDto.startDate,
        endDate: generateReportDto.endDate
      },
      generatedBy: 'system', // This would be the actual user ID in a real implementation
      generatedAt: new Date().toISOString(),
      data: await this.collectReportData(tenantId, schoolId, generateReportDto, jwtToken),
      status: 'GENERATED'
    };

    try {
      const client = await this.fetchClient(tenantId, jwtToken);
      const cmd = new PutCommand({
        Item: {
          ...newReport,
          entityType: 'SCHOOL_REPORT',
          entityId: reportId
        },
        TableName: this.tableName
      });
      await client.send(cmd);
      return newReport;
    } catch (error) {
      console.error('Error generating school report:', error);
      throw new HttpException(
        { status: HttpStatus.INTERNAL_SERVER_ERROR, error },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private async collectReportData(tenantId: string, schoolId: string, reportDto: GenerateSchoolReportDto, jwtToken: string): Promise<any> {
    // This is a simplified implementation. In a real system, this would
    // aggregate data from multiple services and tables
    try {
      const client = await this.fetchClient(tenantId, jwtToken);
      
      // Collect basic school data
      const departments = await this.getDepartments(tenantId, schoolId, jwtToken);
      const academicYears = await this.getAcademicYears(tenantId, schoolId, jwtToken);
      const config = await this.getSchoolConfiguration(tenantId, schoolId, jwtToken);
      
      return {
        schoolId,
        reportType: reportDto.reportType,
        reportPeriod: reportDto,
        summary: {
          totalDepartments: departments.length,
          activeDepartments: departments.filter(d => d.status === 'ACTIVE').length,
          totalAcademicYears: academicYears.length,
          currentAcademicYear: academicYears.find(ay => ay.isCurrent)?.yearName || 'None'
        },
        departments: departments.map(d => ({
          departmentId: d.departmentId,
          departmentName: d.departmentName,
          headOfDepartment: d.headOfDepartment,
          status: d.status
        })),
        academicYears: academicYears.map(ay => ({
          academicYearId: ay.academicYearId,
          yearName: ay.yearName,
          isCurrent: ay.isCurrent,
          status: ay.status
        })),
        configuration: config
      };
    } catch (error) {
      console.error('Error collecting report data:', error);
      return { error: 'Failed to collect report data' };
    }
  }

  async fetchClient(tenantId: string, jwtToken: string) {
    return await this.clientFac.getClient(tenantId, jwtToken);
  }
}
