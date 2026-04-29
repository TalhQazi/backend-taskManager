const axios = require('axios');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const BASE_URL = 'http://localhost:5001/api';
const JWT_SECRET = 'testsecret';

// Helper to generate a token for a given role
function getToken(role) {
  return jwt.sign(
    { sub: `user_${role}`, role: role, username: `test_${role}` },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const roles = ['super-admin', 'admin', 'manager', 'employee'];
const tokens = {};
roles.forEach(role => {
  tokens[role] = getToken(role);
});

// Helper to make a request with a specific role
async function makeRequest(role, method, endpoint, data = null) {
  try {
    const res = await axios({
      method,
      url: `${BASE_URL}${endpoint}`,
      data,
      headers: {
        Authorization: `Bearer ${tokens[role]}`,
      },
      validateStatus: () => true // Don't throw on 4xx/5xx
    });
    return res.status;
  } catch (err) {
    console.error(`Error requesting ${endpoint} as ${role}:`, err.message);
    return null;
  }
}

async function runTests() {
  console.log('--- Starting RBAC Verification Tests ---\n');
  let passed = 0;
  let failed = 0;

  function assertStatus(name, actual, expected) {
    if (actual === expected || (Array.isArray(expected) && expected.includes(actual))) {
      console.log(`✅ PASS: ${name} (Status: ${actual})`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${name} (Expected: ${expected}, Got: ${actual})`);
      failed++;
    }
  }

  // Test 1: Employee trying to access Compliance flags (Requires Manager+)
  let status = await makeRequest('employee', 'GET', '/compliance/flags');
  assertStatus('Employee accessing /compliance/flags', status, 403);

  // Test 2: Manager accessing Compliance flags (Allowed)
  status = await makeRequest('manager', 'GET', '/compliance/flags');
  // We expect 200 (OK), even if empty list
  assertStatus('Manager accessing /compliance/flags', status, 200);

  // Test 3: Employee trying to create a Project (Requires Manager+)
  status = await makeRequest('employee', 'POST', '/projects', { name: 'Test' });
  assertStatus('Employee creating project', status, 403);

  // Test 4: Admin creating a Project (Allowed - may fail validation with 400, but not 403)
  status = await makeRequest('admin', 'POST', '/projects', { name: 'Test' });
  assertStatus('Admin creating project', status, [201, 400]); // 400 means it passed RBAC but failed Zod validation

  // Test 5: Manager trying to create a Company (Requires Admin+)
  status = await makeRequest('manager', 'POST', '/companies', { name: 'Company' });
  assertStatus('Manager creating company', status, 403);

  // Test 6: Super-Admin creating a Company (Allowed)
  status = await makeRequest('super-admin', 'POST', '/companies', { name: 'Company' });
  assertStatus('Super-Admin creating company', status, [201, 400, 409]); 

  // Test 7: Manager trying to delete a location (Requires Admin+)
  status = await makeRequest('manager', 'DELETE', '/locations/123');
  assertStatus('Manager deleting location', status, 403);

  // Test 8: Admin trying to delete a location (Allowed - may 404 but not 403)
  status = await makeRequest('admin', 'DELETE', '/locations/60d5ecb8b392cb371c89f5bc');
  assertStatus('Admin deleting location', status, [200, 204, 404]);

  console.log(`\n--- Tests Completed: ${passed} Passed, ${failed} Failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

// Wait briefly for server to start, then run tests
setTimeout(runTests, 2000);
