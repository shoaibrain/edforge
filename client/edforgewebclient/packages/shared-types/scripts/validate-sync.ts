#!/usr/bin/env ts-node

/**
 * Sync Validation Script
 * 
 * Validates that shared types match NestJS DTO classes.
 * This is a basic validation - manual review is still recommended.
 */

import * as fs from 'fs';
import * as path from 'path';

// Get current directory - works in CommonJS (ts-node)
// @ts-ignore - __dirname is available in CommonJS runtime
const scriptDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(process.argv[1] || '');

interface ValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Extract property names and types from a TypeScript interface
 */
function extractInterfaceProperties(content: string, interfaceName: string): Map<string, string> {
  const properties = new Map<string, string>();
  
  // Find the interface definition
  const interfaceRegex = new RegExp(
    `export\\s+interface\\s+${interfaceName}[^{]*\\{([^}]+)\\}`,
    's'
  );
  const match = content.match(interfaceRegex);
  
  if (!match) {
    return properties;
  }
  
  const body = match[1];
  
  // Extract property declarations
  const propertyRegex = /(\w+)(\??):\s*([^;]+);/g;
  let propMatch;
  
  while ((propMatch = propertyRegex.exec(body)) !== null) {
    const [, name, optional, type] = propMatch;
    properties.set(name, type.trim());
  }
  
  return properties;
}

/**
 * Extract property names from a NestJS DTO class
 * Improved regex to handle decorators and multi-line properties
 */
function extractClassProperties(content: string, className: string): Map<string, boolean> {
  const properties = new Map<string, boolean>();
  
  // Find the class definition - handle nested braces better
  const classRegex = new RegExp(
    `export\\s+class\\s+${className}[^{]*\\{([\\s\\S]*?)\\n\\s*\\}`,
    'm'
  );
  const match = content.match(classRegex);
  
  if (!match) {
    return properties;
  }
  
  const body = match[1];
  
  // Split by lines and process each property declaration
  const lines = body.split('\n');
  let currentProperty: string | null = null;
  let isOptional = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines, comments, and decorators
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('@')) {
      continue;
    }
    
    // Match property declaration: propertyName?: type;
    // Handle decorators before the property
    const propertyMatch = trimmed.match(/^(\w+)(\??):\s*([^;]+);/);
    if (propertyMatch) {
      const [, name, optionalMarker] = propertyMatch;
      properties.set(name, optionalMarker === '?');
      currentProperty = null;
      continue;
    }
    
    // Match property declaration with decorators on previous lines
    // Look for: @Decorator()\n propertyName?: type;
    if (trimmed.match(/^\w+(\??):/)) {
      const propMatch = trimmed.match(/^(\w+)(\??):/);
      if (propMatch) {
        const [, name, optionalMarker] = propMatch;
        properties.set(name, optionalMarker === '?');
      }
    }
  }
  
  return properties;
}

/**
 * Validate that shared types match DTOs
 */
function validateSync(): ValidationResult {
  const result: ValidationResult = {
    success: true,
    errors: [],
    warnings: []
  };
  
  const sharedTypesPath = path.join(scriptDir, '../src/school/dto.ts');
  const dtoPath = path.join(scriptDir, '../../../server/application/microservices/school/src/schools/dto/school.dto.ts');
  
  if (!fs.existsSync(sharedTypesPath)) {
    result.errors.push(`Shared types file not found: ${sharedTypesPath}`);
    result.success = false;
    return result;
  }
  
  if (!fs.existsSync(dtoPath)) {
    result.errors.push(`DTO file not found: ${dtoPath}`);
    result.success = false;
    return result;
  }
  
  const sharedTypesContent = fs.readFileSync(sharedTypesPath, 'utf-8');
  const dtoContent = fs.readFileSync(dtoPath, 'utf-8');
  
  // List of DTOs to validate
  const dtosToValidate = [
    { dtoClass: 'CreateSchoolDto', sharedInterface: 'CreateSchoolRequest' },
    { dtoClass: 'UpdateSchoolDto', sharedInterface: 'UpdateSchoolRequest' },
    { dtoClass: 'CreateAcademicYearDto', sharedInterface: 'CreateAcademicYearRequest' },
    { dtoClass: 'UpdateAcademicYearDto', sharedInterface: 'UpdateAcademicYearRequest' },
    { dtoClass: 'CreateGradingPeriodDto', sharedInterface: 'CreateGradingPeriodRequest' },
    { dtoClass: 'CreateHolidayDto', sharedInterface: 'CreateHolidayRequest' },
    { dtoClass: 'CreateDepartmentDto', sharedInterface: 'CreateDepartmentRequest' },
  ];
  
  for (const { dtoClass, sharedInterface } of dtosToValidate) {
    const dtoProperties = extractClassProperties(dtoContent, dtoClass);
    const sharedProperties = extractInterfaceProperties(sharedTypesContent, sharedInterface);
    
    if (dtoProperties.size === 0 && sharedProperties.size === 0) {
      result.warnings.push(`No properties found for ${dtoClass} / ${sharedInterface} - may not exist`);
      continue;
    }
    
    // Check for missing properties in shared types
    for (const [propName, isOptional] of dtoProperties) {
      if (!sharedProperties.has(propName)) {
        result.errors.push(
          `Missing property in ${sharedInterface}: ${propName} (from ${dtoClass})`
        );
        result.success = false;
      }
    }
    
    // Check for extra properties in shared types (warn but don't fail)
    for (const propName of sharedProperties.keys()) {
      if (!dtoProperties.has(propName)) {
        result.warnings.push(
          `Extra property in ${sharedInterface}: ${propName} (not in ${dtoClass})`
        );
      }
    }
  }
  
  return result;
}

/**
 * Main execution
 */
function main() {
  console.log('🔍 Validating shared types sync with backend DTOs...\n');
  
  const result = validateSync();
  
  if (result.warnings.length > 0) {
    console.log('⚠️  Warnings:');
    result.warnings.forEach(warning => console.log(`   ${warning}`));
    console.log('');
  }
  
  if (result.errors.length > 0) {
    console.log('❌ Errors found:');
    result.errors.forEach(error => console.log(`   ${error}`));
    console.log('\n❌ Validation failed!');
    process.exit(1);
  }
  
  if (result.success) {
    console.log('✅ All shared types match backend DTOs!');
    process.exit(0);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { validateSync };

