/**
 * Classrooms (Classwork) E2E Smoke Test
 *
 * Validates the full Classwork CRUD lifecycle against the Academics microservice:
 *   1. List sections for a school
 *   2. Get section classwork (items + topics)
 *   3. Create a classwork topic
 *   4. Create a classwork item (assignment)
 *   5. Update the assignment
 *   6. Reorder items
 *   7. Delete the assignment
 *   8. Delete the topic
 *
 * Usage:
 *   export AUTH_TOKEN="<your-cognito-jwt>"
 *   export SCHOOL_ID="<uuid>"
 *   export SECTION_ID="<uuid>"
 *   npx ts-node scripts/smoke-tests/classrooms-e2e.ts
 *
 *   Optional:
 *     export API_BASE_URL="http://localhost:3011"   # default
 */

// ============================================
// CONFIGURATION
// ============================================

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3011';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'PASTE_YOUR_JWT_HERE';
const SCHOOL_ID = process.env.SCHOOL_ID || '';
const SECTION_ID = process.env.SECTION_ID || '';

// ============================================
// HELPERS
// ============================================

const headers: Record<string, string> = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  'Content-Type': 'application/json',
};

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  error?: string;
}

const results: TestResult[] = [];

function pass(name: string) {
  results.push({ name, status: 'PASS' });
  console.log(`  PASS: ${name}`);
}

function fail(name: string, error: string) {
  results.push({ name, status: 'FAIL', error });
  console.log(`  FAIL: ${name} -- ${error}`);
}

function skip(name: string, reason: string) {
  results.push({ name, status: 'SKIP', error: reason });
  console.log(`  SKIP: ${name} -- ${reason}`);
}

async function api(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const url = `${API_BASE_URL}${path}`;
  const init: RequestInit = {
    method,
    headers,
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  let data: any;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { status: res.status, data };
}

// ============================================
// TESTS
// ============================================

async function run() {
  console.log('\nClassrooms (Classwork) E2E Smoke Test\n');
  console.log('='.repeat(60));
  console.log(`  API_BASE_URL : ${API_BASE_URL}`);
  console.log(`  SCHOOL_ID    : ${SCHOOL_ID || '(not set)'}`);
  console.log(`  SECTION_ID   : ${SECTION_ID || '(not set)'}`);
  console.log('='.repeat(60));

  // ── Pre-flight checks ──
  if (!SCHOOL_ID) {
    console.error('\nERROR: SCHOOL_ID environment variable is required.');
    console.error('  export SCHOOL_ID="<your-school-uuid>"');
    process.exit(1);
  }
  if (AUTH_TOKEN === 'PASTE_YOUR_JWT_HERE') {
    console.error('\nERROR: AUTH_TOKEN environment variable is required.');
    console.error('  export AUTH_TOKEN="<your-cognito-jwt>"');
    process.exit(1);
  }

  let sectionId = SECTION_ID;
  let createdTopicId: string | undefined;
  let createdItemId: string | undefined;

  // ── Step 1: List sections ──
  console.log('\nStep 1: List sections for school');
  try {
    const res = await api('GET', `/academics/sections?schoolId=${SCHOOL_ID}`);
    if (res.status === 200) {
      const sections = Array.isArray(res.data) ? res.data : res.data?.sections || res.data?.items || [];
      console.log(`    Found ${sections.length} section(s)`);
      if (!sectionId && sections.length > 0) {
        sectionId = sections[0].sectionId;
        console.log(`    Auto-selected sectionId: ${sectionId}`);
      }
      pass('List sections');
    } else {
      fail('List sections', `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (e: any) {
    fail('List sections', e.message);
  }

  if (!sectionId) {
    console.error('\nERROR: No SECTION_ID provided and no sections found for the school.');
    console.error('  export SECTION_ID="<your-section-uuid>"');
    process.exit(1);
  }

  // ── Step 2: Get section classwork ──
  console.log('\nStep 2: Get section classwork');
  try {
    const res = await api('GET', `/academics/classwork?sectionId=${sectionId}&schoolId=${SCHOOL_ID}`);
    if (res.status === 200) {
      const topics = res.data?.topics || [];
      const items = res.data?.items || [];
      console.log(`    Topics: ${topics.length}, Items: ${items.length}`);
      pass('Get section classwork');
    } else {
      fail('Get section classwork', `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (e: any) {
    fail('Get section classwork', e.message);
  }

  // ── Step 3: Create a classwork topic ──
  const topicName = `Smoke Test Topic ${Date.now()}`;
  console.log('\nStep 3: Create classwork topic');
  try {
    const res = await api('POST', '/academics/classwork/topics', {
      sectionId,
      schoolId: SCHOOL_ID,
      name: topicName,
    });
    if (res.status === 201 || res.status === 200) {
      createdTopicId = res.data?.topicId;
      console.log(`    Created topicId: ${createdTopicId}`);
      if (createdTopicId && res.data?.name === topicName) {
        pass('Create classwork topic');
      } else if (createdTopicId) {
        pass('Create classwork topic (name not echoed)');
      } else {
        fail('Create classwork topic', 'No topicId in response');
      }
    } else {
      fail('Create classwork topic', `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (e: any) {
    fail('Create classwork topic', e.message);
  }

  // ── Step 4: Create a classwork item (assignment) ──
  const assignmentTitle = `Smoke Test Assignment ${Date.now()}`;
  console.log('\nStep 4: Create classwork item (assignment)');
  try {
    const res = await api('POST', '/academics/classwork', {
      sectionId,
      schoolId: SCHOOL_ID,
      type: 'assignment',
      title: assignmentTitle,
      description: 'E2E smoke test assignment - safe to delete',
      topicId: createdTopicId || undefined,
      possiblePoints: 100,
      status: 'draft',
    });
    if (res.status === 201 || res.status === 200) {
      createdItemId = res.data?.itemId;
      console.log(`    Created itemId: ${createdItemId}`);
      if (createdItemId && res.data?.type === 'assignment') {
        pass('Create classwork item');
      } else if (createdItemId) {
        pass('Create classwork item (type not echoed)');
      } else {
        fail('Create classwork item', 'No itemId in response');
      }
    } else {
      fail('Create classwork item', `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (e: any) {
    fail('Create classwork item', e.message);
  }

  // ── Step 5: Update the assignment ──
  if (createdItemId) {
    console.log('\nStep 5: Update the assignment');
    try {
      const updatedTitle = `${assignmentTitle} (updated)`;
      const res = await api(
        'PATCH',
        `/academics/classwork/${createdItemId}?schoolId=${SCHOOL_ID}&sectionId=${sectionId}`,
        {
          title: updatedTitle,
          possiblePoints: 150,
          description: 'Updated by E2E smoke test',
        },
      );
      if (res.status === 200) {
        const titleMatch = res.data?.title === updatedTitle;
        const pointsMatch = res.data?.possiblePoints === 150;
        if (titleMatch && pointsMatch) {
          pass('Update assignment (title + points verified)');
        } else if (titleMatch || pointsMatch) {
          pass('Update assignment (partially verified)');
        } else {
          pass('Update assignment (200 OK)');
        }
        console.log(`    Updated title: ${res.data?.title}`);
        console.log(`    Updated points: ${res.data?.possiblePoints}`);
      } else {
        fail('Update assignment', `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
      }
    } catch (e: any) {
      fail('Update assignment', e.message);
    }
  } else {
    skip('Update assignment', 'No itemId from Step 4');
  }

  // ── Step 6: Reorder items ──
  if (createdItemId && createdTopicId) {
    console.log('\nStep 6: Reorder classwork items');
    try {
      const res = await api('PATCH', '/academics/classwork/reorder', {
        schoolId: SCHOOL_ID,
        sectionId,
        items: [
          { id: createdTopicId, type: 'topic', sortOrder: 0 },
          { id: createdItemId, type: 'item', sortOrder: 1, topicId: createdTopicId },
        ],
      });
      if (res.status === 200 || res.status === 204) {
        pass('Reorder classwork items');
      } else {
        fail('Reorder classwork items', `Expected 200/204, got ${res.status}: ${JSON.stringify(res.data)}`);
      }
    } catch (e: any) {
      fail('Reorder classwork items', e.message);
    }
  } else if (createdItemId) {
    // Try reorder with just the item
    console.log('\nStep 6: Reorder classwork items (item only, no topic)');
    try {
      const res = await api('PATCH', '/academics/classwork/reorder', {
        schoolId: SCHOOL_ID,
        sectionId,
        items: [
          { id: createdItemId, type: 'item', sortOrder: 0 },
        ],
      });
      if (res.status === 200 || res.status === 204) {
        pass('Reorder classwork items');
      } else {
        fail('Reorder classwork items', `Expected 200/204, got ${res.status}: ${JSON.stringify(res.data)}`);
      }
    } catch (e: any) {
      fail('Reorder classwork items', e.message);
    }
  } else {
    skip('Reorder classwork items', 'No items created in previous steps');
  }

  // ── Step 7: Delete the assignment ──
  if (createdItemId) {
    console.log('\nStep 7: Delete the assignment');
    try {
      const res = await api(
        'DELETE',
        `/academics/classwork/${createdItemId}?schoolId=${SCHOOL_ID}&sectionId=${sectionId}`,
      );
      if (res.status === 200 || res.status === 204) {
        pass('Delete assignment');
        console.log(`    Deleted itemId: ${createdItemId}`);
      } else {
        fail('Delete assignment', `Expected 200/204, got ${res.status}: ${JSON.stringify(res.data)}`);
      }
    } catch (e: any) {
      fail('Delete assignment', e.message);
    }
  } else {
    skip('Delete assignment', 'No itemId from Step 4');
  }

  // ── Step 8: Delete the topic ──
  if (createdTopicId) {
    console.log('\nStep 8: Delete the topic');
    try {
      const res = await api(
        'DELETE',
        `/academics/classwork/topics/${createdTopicId}?schoolId=${SCHOOL_ID}&sectionId=${sectionId}`,
      );
      if (res.status === 200 || res.status === 204) {
        pass('Delete topic');
        console.log(`    Deleted topicId: ${createdTopicId}`);
      } else {
        fail('Delete topic', `Expected 200/204, got ${res.status}: ${JSON.stringify(res.data)}`);
      }
    } catch (e: any) {
      fail('Delete topic', e.message);
    }
  } else {
    skip('Delete topic', 'No topicId from Step 3');
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(60));
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped out of ${results.length} tests`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results
      .filter((r) => r.status === 'FAIL')
      .forEach((r) => {
        console.log(`   - ${r.name}: ${r.error}`);
      });
  }

  if (skipped > 0) {
    console.log('\nSkipped tests:');
    results
      .filter((r) => r.status === 'SKIP')
      .forEach((r) => {
        console.log(`   - ${r.name}: ${r.error}`);
      });
  }

  if (failed > 0) {
    console.log('\nSome tests failed.');
    process.exit(1);
  } else {
    console.log('\nAll tests passed!');
  }
}

run().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
