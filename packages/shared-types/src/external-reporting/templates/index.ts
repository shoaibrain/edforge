/**
 * External-reporting template registry — Sprint E.1.2.
 *
 * One TS export per supported template. The aggregation Lambda
 * (E.1.3) loads the runtime column-mapping JSON config from S3 at
 * invocation time (so CEHRD header renames can be hot-fixed without
 * backend redeploy). The TS exports here lock in the schema-version
 * + column dimensions for type safety + AdminWeb dropdowns.
 */

export {
  FLASH_I_TEMPLATE,
  FLASH_I_TEMPLATE_ID,
  FLASH_I_SCHEMA_VERSION,
  FLASH_I_COLUMNS,
} from './IEMIS_NPL_CEHRD_FLASH_I';
export type {
  FlashIColumnSpec,
  FlashISourcePath,
} from './IEMIS_NPL_CEHRD_FLASH_I';

export {
  FLASH_II_TEMPLATE,
  FLASH_II_TEMPLATE_ID,
  FLASH_II_SCHEMA_VERSION,
  FLASH_II_COLUMNS,
} from './IEMIS_NPL_CEHRD_FLASH_II';
export type {
  FlashIIColumnSpec,
  FlashIISourcePath,
} from './IEMIS_NPL_CEHRD_FLASH_II';
