#!/usr/bin/env ts-node

/**
 * Ed-Fi TypeScript Models Generator
 * Reads local swagger.json and generates TypeScript interfaces organized by domain
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { compile, Options } from 'json-schema-to-typescript';
import { mapEntityToDomain, getAllDomains } from './domain-mapper';

interface SchemaDefinition {
  [key: string]: any;
}

interface OpenAPISchema {
  components: {
    schemas: SchemaDefinition;
  };
}

/**
 * Convert camelCase to PascalCase
 */
function toPascalCase(str: string): string {
  // Remove edFi_ prefix if present
  const cleaned = str.replace(/^edFi_/, '');
  // Convert first letter to uppercase
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Recursively transform $ref paths from OpenAPI format to JSON Schema format
 */
function transformRefs(obj: any, allSchemas: SchemaDefinition): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => transformRefs(item, allSchemas));
  }

  if (typeof obj === 'object') {
    const transformed: any = {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (key === '$ref' && typeof value === 'string') {
        // Transform "#/components/schemas/edFi_xxx" to "#/definitions/edFi_xxx"
        if (value.startsWith('#/components/schemas/')) {
          const refName = value.replace('#/components/schemas/', '');
          transformed[key] = `#/definitions/${refName}`;
        } else {
          transformed[key] = value;
        }
      } else {
        transformed[key] = transformRefs(value, allSchemas);
      }
    }
    
    return transformed;
  }

  return obj;
}

/**
 * Generate TypeScript interface from JSON schema
 * Creates a wrapper schema document so $ref references can be resolved
 */
async function generateInterface(
  entityName: string,
  schema: any,
  outputPath: string,
  allSchemas: SchemaDefinition
): Promise<void> {
  const interfaceName = toPascalCase(entityName);
  
  // Schema is already transformed, just create wrapper with definitions
  // Create a wrapper schema document that includes all schemas in definitions
  // This allows $ref references to be resolved
  const wrapperSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    ...schema,
    // Add definitions after spreading to ensure it's not overwritten
    definitions: allSchemas,
  };

  const options: Partial<Options> = {
    bannerComment: '',
    strictIndexSignatures: true,
    style: {
      bracketSpacing: true,
      printWidth: 120,
      semi: true,
      singleQuote: true,
      tabWidth: 2,
      trailingComma: 'es5',
    },
    unknownAny: false,
    unreachableDefinitions: true,
  };

  try {
    // Generate TypeScript code
    const tsCode = await compile(wrapperSchema, interfaceName, options);
    
    // Write to file
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, tsCode, 'utf-8');
  } catch (error) {
    console.error(`Error generating interface for ${entityName}:`, error);
    throw error;
  }
}

/**
 * Generate barrel export file for a domain
 */
async function generateDomainBarrel(
  domain: string,
  entities: string[]
): Promise<void> {
  const domainPath = path.join(__dirname, '..', 'src', 'models', 'domains', domain);
  const indexPath = path.join(domainPath, 'index.ts');

  // Only export the main interface from each file to avoid duplicate exports
  // (each file also exports all its referenced types, which would cause conflicts)
  const exports = entities
    .map(entity => {
      const interfaceName = toPascalCase(entity);
      const fileName = interfaceName;
      return `export { ${interfaceName} } from './${fileName}';`;
    })
    .sort()
    .join('\n');

  await fs.ensureDir(domainPath);
  await fs.writeFile(indexPath, exports + '\n', 'utf-8');
}

/**
 * Generate root barrel export
 */
async function generateRootBarrel(domainEntities: Map<string, string[]>): Promise<void> {
  const modelsIndexPath = path.join(__dirname, '..', 'src', 'models', 'index.ts');
  const srcIndexPath = path.join(__dirname, '..', 'src', 'index.ts');

  // Generate src/models/index.ts
  const modelExports: string[] = [];
  for (const [domain, entities] of domainEntities.entries()) {
    if (entities.length > 0) {
      modelExports.push(`export * from './domains/${domain}';`);
    }
  }
  modelExports.sort();

  await fs.writeFile(modelsIndexPath, modelExports.join('\n') + '\n', 'utf-8');

  // Generate src/index.ts
  await fs.writeFile(srcIndexPath, "export * from './models';\n", 'utf-8');
}

/**
 * Main generation function
 */
async function generate(): Promise<void> {
  console.log('🚀 Starting Ed-Fi TypeScript Models Generation...\n');

  // Load schema
  const schemaPath = path.join(__dirname, '..', 'schemas', 'swagger.json');
  console.log(`📖 Reading schema from ${schemaPath}...`);
  
  if (!(await fs.pathExists(schemaPath))) {
    throw new Error(`Schema file not found at ${schemaPath}`);
  }

  const schemaContent = await fs.readJson(schemaPath) as OpenAPISchema;
  const schemas = schemaContent.components?.schemas;

  if (!schemas) {
    throw new Error('No schemas found in swagger.json');
  }

  console.log(`✅ Found ${Object.keys(schemas).length} total schemas\n`);

  // Transform all $ref paths in all schemas from OpenAPI format to JSON Schema format
  // This needs to be done once for all schemas before processing
  const transformedSchemas: SchemaDefinition = {};
  for (const [name, schema] of Object.entries(schemas)) {
    transformedSchemas[name] = transformRefs(schema, schemas);
  }

  // Filter for edFi_ prefixed schemas
  const edFiSchemas = Object.entries(transformedSchemas).filter(([name]) =>
    name.startsWith('edFi_')
  );

  console.log(`📋 Processing ${edFiSchemas.length} Ed-Fi entities...\n`);

  // Track entities by domain
  const domainEntities = new Map<string, string[]>();
  const unmappedEntities: string[] = [];
  const errors: Array<{ entity: string; error: string }> = [];

  // Initialize domain maps
  for (const domain of getAllDomains()) {
    domainEntities.set(domain, []);
  }

  // Process each entity
  let processedCount = 0;
  for (const [entityName, schema] of edFiSchemas) {
    try {
      const domain = mapEntityToDomain(entityName);
      
      if (domain === 'common') {
        unmappedEntities.push(entityName);
        console.warn(`⚠️  Unmapped entity: ${entityName} → common`);
      }

      // Generate interface file
      const interfaceName = toPascalCase(entityName);
      const domainPath = path.join(__dirname, '..', 'src', 'models', 'domains', domain);
      const filePath = path.join(domainPath, `${interfaceName}.ts`);

      await generateInterface(entityName, schema, filePath, transformedSchemas);

      // Track entity in domain
      const entities = domainEntities.get(domain) || [];
      entities.push(entityName);
      domainEntities.set(domain, entities);

      processedCount++;
      if (processedCount % 50 === 0) {
        console.log(`  ✓ Processed ${processedCount}/${edFiSchemas.length} entities...`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ entity: entityName, error: errorMsg });
      console.error(`❌ Error processing ${entityName}:`, errorMsg);
    }
  }

  console.log('\n📦 Generating barrel exports...\n');

  // Generate domain barrel files
  for (const [domain, entities] of domainEntities.entries()) {
    if (entities.length > 0) {
      await generateDomainBarrel(domain, entities);
      console.log(`  ✓ Generated ${domain}/index.ts (${entities.length} entities)`);
    }
  }

  // Generate root barrel files
  await generateRootBarrel(domainEntities);
  console.log(`  ✓ Generated models/index.ts`);
  console.log(`  ✓ Generated index.ts`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Generation Summary');
  console.log('='.repeat(60));
  
  let totalGenerated = 0;
  for (const [domain, entities] of domainEntities.entries()) {
    if (entities.length > 0) {
      console.log(`  ${domain.padEnd(35)} ${entities.length.toString().padStart(4)} entities`);
      totalGenerated += entities.length;
    }
  }

  console.log('  ' + '-'.repeat(58));
  console.log(`  ${'Total'.padEnd(35)} ${totalGenerated.toString().padStart(4)} entities`);

  if (unmappedEntities.length > 0) {
    console.log(`\n⚠️  ${unmappedEntities.length} entities mapped to 'common' domain:`);
    unmappedEntities.slice(0, 10).forEach(entity => {
      console.log(`     - ${entity}`);
    });
    if (unmappedEntities.length > 10) {
      console.log(`     ... and ${unmappedEntities.length - 10} more`);
    }
  }

  if (errors.length > 0) {
    console.log(`\n❌ ${errors.length} errors occurred during generation:`);
    errors.slice(0, 10).forEach(({ entity, error }) => {
      console.log(`     - ${entity}: ${error}`);
    });
    if (errors.length > 10) {
      console.log(`     ... and ${errors.length - 10} more errors`);
    }
  }

  console.log('\n✅ Generation complete!\n');
}

// Run generator
generate().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

