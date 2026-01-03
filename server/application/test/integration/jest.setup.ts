/**
 * Jest Global Setup for Integration Tests
 * 
 * Runs once before all integration tests to prepare the environment.
 */

import { globalSetup } from './setup';

export default async function setup() {
  console.log('\n🔧 Setting up integration test environment...\n');
  
  try {
    await globalSetup();
    console.log('\n✅ Integration test setup complete\n');
  } catch (error) {
    console.error('\n❌ Integration test setup failed:', error);
    console.error('\n💡 Make sure LocalStack is running:');
    console.error('   cd server && docker-compose -f docker-compose.local.yml up -d\n');
    throw error;
  }
}

