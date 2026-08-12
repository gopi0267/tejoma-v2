#!/bin/bash
# End-to-End Cutover Verification Test
# Verifies all migrated domains work through the API Gateway

set -e

JWT_SECRET="4ae06877de86615cd38067bab4dc7e28bd2a6aa72e652b6d2c82a8ba27921327"

# Generate test JWT tokens
RECRUITER_TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign({
  user_id: 501,
  email: 'recruiter@tejoma.com',
  name: 'Test Recruiter',
  company_id: 601,
  role: 'recruiter'
}, '$JWT_SECRET', { expiresIn: '15m' });
console.log(token);
" 2>/dev/null)

CANDIDATE_TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign({
  user_id: 1001,
  email: 'candidate@example.com',
  name: 'Test Candidate',
  company_id: 601,
  role: 'candidate'
}, '$JWT_SECRET', { expiresIn: '15m' });
console.log(token);
" 2>/dev/null)

echo "=========================================="
echo "E2E CUTOVER VERIFICATION"
echo "=========================================="
echo "Test Date: $(date)"
echo ""

# Test from within docker network
test_endpoint() {
  local name=$1
  local method=$2
  local path=$3
  local token=$4

  echo "Testing: $name"
  echo "  Path: $method $path"

  local response=$(docker compose exec -T api-gateway node -e "
    const http = require('http');
    const options = {
      hostname: 'api-gateway',
      port: 4000,
      path: '$path',
      method: '$method',
      headers: {
        'Cookie': 'access_token=$token',
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(res.statusCode);
        console.log(data);
      });
    });

    req.on('error', (e) => {
      console.log('ERROR: ' + e.message);
    });

    req.end();
  " 2>/dev/null)

  local status=$(echo "$response" | head -1)
  local body=$(echo "$response" | tail -1)

  if [ "$status" = "200" ] || [ "$status" = "201" ]; then
    echo "  ✓ Status: $status"
  else
    echo "  ✗ Status: $status"
    echo "  Response: $body"
  fi
  echo ""
}

echo "RECRUITER ENDPOINTS:"
echo "===================="
test_endpoint "Job List (JOB_LIST_CUTOVER_ENABLED)" "GET" "/api/jobs" "$RECRUITER_TOKEN"
test_endpoint "Recruiter Review List (RECRUITER_REVIEW_LIST_CUTOVER_ENABLED)" "GET" "/api/recruiter-review" "$RECRUITER_TOKEN"
test_endpoint "Recruiter Matches (RECRUITER_MATCHES_CUTOVER_ENABLED)" "GET" "/api/matches" "$RECRUITER_TOKEN"

echo "CANDIDATE ENDPOINTS:"
echo "===================="
test_endpoint "Candidate Jobs (JOB_LIST_CUTOVER_ENABLED)" "GET" "/api/candidate-jobs" "$CANDIDATE_TOKEN"
test_endpoint "Candidate Decisions" "GET" "/api/candidate-decisions" "$CANDIDATE_TOKEN"
test_endpoint "Candidate Applications" "GET" "/api/candidate-applications" "$CANDIDATE_TOKEN"
test_endpoint "Candidate Matches" "GET" "/api/candidate-matches" "$CANDIDATE_TOKEN"

echo "=========================================="
echo "VERIFICATION COMPLETE"
echo "=========================================="
