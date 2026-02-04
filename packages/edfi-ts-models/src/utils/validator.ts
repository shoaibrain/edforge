/**
 * Ed-Fi Schema Validator
 * Uses AJV to validate JSON payloads against Ed-Fi schemas
 */

import Ajv, { ValidateFunction, ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs-extra';
import * as path from 'path';

interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[] | null;
}

class EdFiValidator {
  private ajv: Ajv;
  private validators: Map<string, ValidateFunction> = new Map();
  private schemas: any = null;

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
      validateFormats: true,
    });
    addFormats(this.ajv);
  }

  /**
   * Load schemas from swagger.json
   */
  async loadSchemas(): Promise<void> {
    if (this.schemas) {
      return; // Already loaded
    }

    // Try multiple possible paths (development vs installed package)
    const possiblePaths = [
      path.join(__dirname, '..', '..', 'schemas', 'swagger.json'), // Development
      path.join(__dirname, '..', '..', '..', 'schemas', 'swagger.json'), // Installed
      path.join(process.cwd(), 'node_modules', '@your-org', 'edfi-ts-models', 'schemas', 'swagger.json'), // Installed (alternative)
    ];

    let schemaPath: string | null = null;
    for (const possiblePath of possiblePaths) {
      if (await fs.pathExists(possiblePath)) {
        schemaPath = possiblePath;
        break;
      }
    }

    if (!schemaPath) {
      throw new Error(`Schema file not found. Tried: ${possiblePaths.join(', ')}`);
    }
    const schemaContent = await fs.readJson(schemaPath);
    this.schemas = schemaContent.components?.schemas;

    if (!this.schemas) {
      throw new Error('No schemas found in swagger.json');
    }

    // Pre-compile validators for all edFi_ schemas
    for (const [schemaName, schema] of Object.entries(this.schemas)) {
      if (schemaName.startsWith('edFi_')) {
        try {
          const validator = this.ajv.compile(schema as any);
          this.validators.set(schemaName, validator);
        } catch (error) {
          console.warn(`Warning: Could not compile validator for ${schemaName}:`, error);
        }
      }
    }
  }

  /**
   * Validate a single entity against its schema
   * @param entityName - The entity name (e.g., "edFi_student" or "student")
   * @param data - The data to validate
   * @returns Validation result
   */
  async validateEntity(entityName: string, data: unknown): Promise<ValidationResult> {
    await this.loadSchemas();

    // Normalize entity name
    const normalizedName = entityName.startsWith('edFi_') ? entityName : `edFi_${entityName}`;

    const validator = this.validators.get(normalizedName);

    if (!validator) {
      throw new Error(`No validator found for entity: ${entityName}`);
    }

    const valid = validator(data);

    return {
      valid,
      errors: valid ? null : (validator.errors || []),
    };
  }

  /**
   * Validate an array of entities
   * @param entityName - The entity name
   * @param dataArray - Array of data to validate
   * @returns Array of validation results
   */
  async validateEntityArray(
    entityName: string,
    dataArray: unknown[]
  ): Promise<ValidationResult[]> {
    return Promise.all(
      dataArray.map(data => this.validateEntity(entityName, data))
    );
  }

  /**
   * Get all available entity names
   */
  async getAvailableEntities(): Promise<string[]> {
    await this.loadSchemas();
    return Array.from(this.validators.keys())
      .map(name => name.replace(/^edFi_/, ''))
      .sort();
  }

  /**
   * Check if an entity validator exists
   */
  async hasValidator(entityName: string): Promise<boolean> {
    await this.loadSchemas();
    const normalizedName = entityName.startsWith('edFi_') ? entityName : `edFi_${entityName}`;
    return this.validators.has(normalizedName);
  }
}

// Singleton instance
let validatorInstance: EdFiValidator | null = null;

/**
 * Get the validator instance
 */
export function getValidator(): EdFiValidator {
  if (!validatorInstance) {
    validatorInstance = new EdFiValidator();
  }
  return validatorInstance;
}

/**
 * Validate a single entity
 */
export async function validateEntity(
  entityName: string,
  data: unknown
): Promise<ValidationResult> {
  const validator = getValidator();
  return validator.validateEntity(entityName, data);
}

/**
 * Validate an array of entities
 */
export async function validateEntityArray(
  entityName: string,
  dataArray: unknown[]
): Promise<ValidationResult[]> {
  const validator = getValidator();
  return validator.validateEntityArray(entityName, dataArray);
}

/**
 * Get all available entity names
 */
export async function getAvailableEntities(): Promise<string[]> {
  const validator = getValidator();
  return validator.getAvailableEntities();
}

export type { ValidationResult };

