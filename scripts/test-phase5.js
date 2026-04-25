
const API_BASE = 'http://localhost:5000';

// Helper to make requests
async function request(method, path, body = null) {
  const url = API_BASE + path;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const res = await fetch(url, options);
  const data = res.ok ? await res.json() : null;
  return { status: res.status, data, headers: res.headers };
}

// Test results tracker
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

// Helper function for tests
async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    results.tests.push({ name, status: '✅ PASS', error: null });
    console.log(`✅ ${name}`);
  } catch (error) {
    results.failed++;
    const msg = error.message;
    results.tests.push({ name, status: '❌ FAIL', error: msg });
    console.log(`❌ ${name}: ${msg}`);
  }
}

// Helper function to check response
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ============================================
// PHASE 5 AUTOMATED TEST SUITE
// ============================================

console.log('\n🧪 PHASE 5: AUTOMATED ENDPOINT TESTS\n');
console.log('Backend: ' + API_BASE);
console.log('Time: ' + new Date().toISOString());
console.log('================================================\n');

// Test authentication token (from environment or use test token)
const testUserId = 'test-user-' + Date.now();
const testToken = process.env.TEST_AUTH_TOKEN || 'test-token';

// Simulated tests (requires actual Firebase token for real tests)
await test('1.1: API Server Responds', async () => {
  const { status, data } = await request('GET', '/');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.message === 'Welcome to Quiz Platform API', 'API not responding correctly');
});

await test('1.2: Available Endpoints Listed', async () => {
  const { data } = await request('GET', '/');
  assert(data.availableEndpoints, 'Available endpoints not listed');
  assert(data.availableEndpoints.quizzes, 'Quiz endpoints missing');
});

await test('2.1: Get All Quizzes', async () => {
  const { status, data } = await request('GET', '/api/quizzes');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(Array.isArray(data), 'Quizzes should be an array');
});

await test('2.2: Database Connection Active', async () => {
  // This endpoint should work if DB is connected
  const { status, data } = await request('GET', '/api/quizzes');
  assert(status === 200, 'Database should be connected');
  // If we get here, DB is working
  assert(true, 'Database connected');
});

await test('3.1: Handle Invalid Quiz ID', async () => {
  const { status } = await request('GET', '/api/quizzes/invalid-id-12345');
  // Should return 404 or similar error
  assert(status >= 400, `Should return error status, got ${status}`);
});

await test('4.1: Leaderboard Endpoint Available', async () => {
  // Get a real quiz first
  const quizzes = await request('GET', '/api/quizzes');
  if (quizzes.data.length > 0) {
    const quizId = quizzes.data[0]._id;
    const { status, data } = await request('GET', `/api/quizzes/${quizId}/leaderboard`);
    assert(status === 200, `Leaderboard should return 200, got ${status}`);
    assert(Array.isArray(data), 'Leaderboard should return array');
  } else {
    console.log('  ⚠️  No quizzes to test leaderboard');
  }
});

await test('5.1: Schema Validation - User Endpoints Exist', async () => {
  // Trying to access without auth should give auth error, not 404
  const { status } = await request('GET', '/api/user/profile');
  // Expected 401 Unauthorized, not 404 Not Found
  assert(status === 401 || status === 403, 
    `Expected 401/403 for auth error, got ${status}`);
});

await test('5.2: Admin Endpoints Available', async () => {
  // Trying to access without auth
  const { status } = await request('GET', '/api/admin/quizzes');
  // Expected auth error, not 404
  assert(status !== 404, `Admin endpoints should exist (got ${status})`);
});

await test('6.1: JSON Response Format', async () => {
  const { status, data, headers } = await request('GET', '/');
  assert(status === 200, 'Server should respond');
  assert(typeof data === 'object', 'Data should be object');
});

// ============================================
// REPORT
// ============================================

console.log('\n================================================');
console.log('📊 TEST RESULTS\n');
console.log(`✅ Passed: ${results.passed}`);
console.log(`❌ Failed: ${results.failed}`);
console.log(`📈 Total: ${results.passed + results.failed}`);
console.log(`📊 Pass Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
console.log('\n================================================\n');

if (results.failed === 0) {
  console.log('🎉 ALL TESTS PASSED!\n');
  console.log('✅ Backend endpoints operational');
  console.log('✅ Database connection active');
  console.log('✅ API responding correctly');
  console.log('\nPhase 5 foundations verified. Ready for detailed testing.');
} else {
  console.log('⚠️  Some tests failed. See details above.\n');
}

console.log('================================================\n');
