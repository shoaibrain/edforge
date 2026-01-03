/**
 * Jest Global Teardown for Integration Tests
 * 
 * Runs once after all integration tests to clean up.
 */

import { globalTeardown } from './setup';

export default async function teardown() {
  console.log('\n🧹 Tearing down integration test environment...\n');
  
  try {
    await globalTeardown();
    console.log('✅ Integration test teardown complete\n');
  } catch (error) {
    console.error('⚠️ Integration test teardown warning:', error);
  }
}

