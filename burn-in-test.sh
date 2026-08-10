#!/bin/bash

JWT=$(node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { user_id: 53, company_id: 1, email: 'test@example.com', name: 'Tester', role: 'recruiter' },
  '4ae06877de86615cd38067bab4dc7e28bd2a6aa72e652b6d2c82a8ba27921327',
  { expiresIn: '24h' }
);
console.log(token);
")

GATEWAY="https://localhost"
PASSED=0
FAILED=0
ERRORS=""

# Initialize counters
TOTAL_REQUESTS=0
FAILED_REQUESTS=0
SUCCESS_REQUESTS=0

test_endpoint() {
  local name="$1"
  local method="$2"
  local endpoint="$3"
  local data="$4"
  
  TOTAL_REQUESTS=$((TOTAL_REQUESTS + 1))
  
  if [ -z "$data" ]; then
    response=$(curl -k -s -w "\n%{http_code}" -X $method \
      -H "Authorization: Bearer $JWT" \
      "$GATEWAY$endpoint")
  else
    response=$(curl -k -s -w "\n%{http_code}" -X $method \
      -H "Authorization: Bearer $JWT" \
      -H "Content-Type: application/json" \
      -d "$data" \
      "$GATEWAY$endpoint")
  fi
  
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')
  
  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    echo "   ✓ $name [$http_code]"
    PASSED=$((PASSED + 1))
    SUCCESS_REQUESTS=$((SUCCESS_REQUESTS + 1))
  elif [ "$http_code" -ge 300 ] && [ "$http_code" -lt 400 ]; then
    echo "   ✓ $name [$http_code] (redirect)"
    PASSED=$((PASSED + 1))
    SUCCESS_REQUESTS=$((SUCCESS_REQUESTS + 1))
  else
    echo "   ✗ $name [$http_code]"
    FAILED=$((FAILED + 1))
    FAILED_REQUESTS=$((FAILED_REQUESTS + 1))
    ERRORS="$ERRORS\n   - $name: HTTP $http_code"
  fi
}

echo "==========================================="
echo "BURN-IN TEST: COMPREHENSIVE FEATURE CHECK"
echo "==========================================="
echo ""

echo "🔹 AUTHENTICATION"
test_endpoint "POST /auth/login" "POST" "/api/auth/login" '{"email":"test@example.com","password":"test"}'
test_endpoint "GET /auth/me" "GET" "/api/auth/me"
echo ""

echo "🔹 CANDIDATE MANAGEMENT"
test_endpoint "GET /candidates" "GET" "/api/candidates?limit=5"
test_endpoint "GET /candidates/:id" "GET" "/api/candidates/1"
test_endpoint "POST /candidates (create)" "POST" "/api/candidates" '{"name":"Test Candidate","email":"test.cand@example.com"}'
echo ""

echo "🔹 RESUME SERVICES"
test_endpoint "GET /candidate-resume" "GET" "/api/candidate-resume/1"
echo ""

echo "🔹 JOB MANAGEMENT"
test_endpoint "GET /jobs" "GET" "/api/jobs?limit=5"
test_endpoint "GET /jobs/:id" "GET" "/api/jobs/1"
test_endpoint "POST /jobs (create)" "POST" "/api/jobs" '{"title":"Test Job","description":"A test job"}'
echo ""

echo "🔹 MATCHING & SWIPES"
test_endpoint "GET /swipes/history" "GET" "/api/swipes/history?limit=10"
test_endpoint "GET /matches" "GET" "/api/matches?limit=10"
echo ""

echo "🔹 RECRUITER REVIEW"
test_endpoint "GET /recruiter-review" "GET" "/api/recruiter-review?limit=5"
echo ""

echo "🔹 ANALYTICS"
test_endpoint "GET /analytics/dashboard" "GET" "/api/analytics/dashboard"
echo ""

echo "🔹 CHAT & RAG"
test_endpoint "POST /chat" "POST" "/api/chat" '{"query":"test query"}'
echo ""

echo "🔹 NOTIFICATIONS"
test_endpoint "GET /recruiter-notifications" "GET" "/api/recruiter-notifications?limit=5"
test_endpoint "GET /candidate-notifications" "GET" "/api/candidate-notifications?limit=5"
echo ""

echo "🔹 HEALTH CHECKS"
test_endpoint "GET /health" "GET" "/api/health"
echo ""

echo "==========================================="
echo "RESULTS"
echo "==========================================="
echo "Total Requests: $TOTAL_REQUESTS"
echo "Successful: $SUCCESS_REQUESTS ✓"
echo "Failed: $FAILED_REQUESTS ✗"
echo "Success Rate: $(( SUCCESS_REQUESTS * 100 / TOTAL_REQUESTS ))%"
echo ""

if [ -n "$ERRORS" ]; then
  echo "Failed Endpoints:$ERRORS"
fi

echo "==========================================="
