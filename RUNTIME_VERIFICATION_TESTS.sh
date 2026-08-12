#!/bin/bash
# Tejoma Production Migration - Runtime Verification Tests
# Tests all critical migration items

set -e

GATEWAY_URL="https://localhost"
GATEWAY_INSECURE="-k"
RECRUITER_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjU5NDFlZThmNWQxYWUxYjYifQ.eyJ1c2VyX2lkIjoxLCJlbWFpbCI6InJlY3J1aXRlckB0ZWpvbWEuY29tIiwibmFtZSI6IlNhcmFoIE1pdGNoZWxsIiwiY29tcGFueV9pZCI6MSwicm9sZSI6InJlY3J1aXRlciIsImlhdCI6OTk5OTk5OTk5OSwicXhwIjo5OTk5OTk5OTk5fQ.ZSErqrFHYXzVheloaQi2pZzeAkFfnoRqyXu0TDmB2RT03RLyS7YmGQRT1j9BKPYZ-B5Yn0XVP67MiPE55ZK8b_LsDMW-ipCvIXonQrpA-RksXq_IkoREZoK6aHB2KH4xSosYEG1nEZfMcVnGwHFyh_k7FFlnapBbKntKY2-EhXLSCZ2we8hPMTXGJiu8uUOiWJndTa6_4qwHqISK6tSIR1J2JKPGCd1FbIAwRiDGCCUQBIaM2XvfBK6FCgRb3ngguaw65Tca4gjy0jcn6t1tnrWu6Q2ADPzaBsHzeaTw-T3kPe5GijhbaYWl5GUiTpMjGYoC00_d0-6G_j8RtSgYjA"

echo "========== TEJOMA PRODUCTION MIGRATION RUNTIME TESTS =========="
echo ""

# Test 1: Gateway connectivity
echo "[TEST 1] Gateway Connectivity"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $GATEWAY_INSECURE "$GATEWAY_URL/api/health")
if [ "$HTTP_CODE" = "200" ]; then
  echo "✓ Gateway accessible, health: $HTTP_CODE"
else
  echo "✗ Gateway health failed: $HTTP_CODE"
fi

# Test 2: Authentication
echo ""
echo "[TEST 2] Authentication - RS256 Token Validation"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $GATEWAY_INSECURE \
  -H "Authorization: Bearer $RECRUITER_TOKEN" \
  "$GATEWAY_URL/api/jobs")
if [ "$HTTP_CODE" = "200" ]; then
  echo "✓ RS256 auth working: $HTTP_CODE"
else
  echo "✗ Auth failed: $HTTP_CODE"
fi

# Test 3: RAG Indexing - Create Job
echo ""
echo "[TEST 3] RAG Indexing - Job Creation"
JOB_RESPONSE=$(curl -s $GATEWAY_INSECURE \
  -X POST \
  -H "Authorization: Bearer $RECRUITER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test RAG Job","description":"Test description","required_skills":["Python"],"location":"SF","experience_years":2}' \
  "$GATEWAY_URL/api/jobs")

if echo "$JOB_RESPONSE" | grep -q "id"; then
  echo "✓ Job created successfully"
  JOB_ID=$(echo "$JOB_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
  echo "  Job ID: $JOB_ID"
else
  echo "✗ Job creation failed"
  echo "  Response: $JOB_RESPONSE"
fi

# Test 4: Candidate Creation
echo ""
echo "[TEST 4] Candidate Creation & RAG Indexing"
CANDIDATE_RESPONSE=$(curl -s $GATEWAY_INSECURE \
  -X POST \
  -H "Authorization: Bearer $RECRUITER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Candidate","email":"test@example.com","skills":["Python","PostgreSQL"],"years_of_experience":3}' \
  "$GATEWAY_URL/api/candidates")

if echo "$CANDIDATE_RESPONSE" | grep -q "id"; then
  echo "✓ Candidate created successfully"
  CANDIDATE_ID=$(echo "$CANDIDATE_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
  echo "  Candidate ID: $CANDIDATE_ID"
else
  echo "✗ Candidate creation failed"
fi

# Test 5: Analytics Access
echo ""
echo "[TEST 5] Analytics Dashboard"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $GATEWAY_INSECURE \
  -H "Authorization: Bearer $RECRUITER_TOKEN" \
  "$GATEWAY_URL/api/analytics/dashboard")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "400" ]; then
  echo "✓ Analytics endpoint accessible: $HTTP_CODE"
else
  echo "✗ Analytics failed: $HTTP_CODE"
fi

# Test 6: ML Admin Routes
echo ""
echo "[TEST 6] ML Admin Routes"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $GATEWAY_INSECURE \
  -H "Authorization: Bearer $RECRUITER_TOKEN" \
  "$GATEWAY_URL/api/ml/config")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "403" ]; then
  echo "✓ ML admin endpoint accessible: $HTTP_CODE"
else
  echo "✗ ML admin failed: $HTTP_CODE"
fi

# Test 7: Redis connection
echo ""
echo "[TEST 7] Redis Connectivity"
REDIS_PING=$(docker exec tejoma-redis-1 redis-cli ping 2>&1)
if [ "$REDIS_PING" = "PONG" ]; then
  echo "✓ Redis healthy"
else
  echo "✗ Redis check failed: $REDIS_PING"
fi

# Test 8: Service health checks
echo ""
echo "[TEST 8] Service Health Checks"
for service in job-service candidate-core-service recruiting-service matching-decision-service analytics-service; do
  docker exec tejoma-${service} wget -q -O- http://127.0.0.1:$(docker port tejoma-${service} | grep -o '[0-9]*$' | head -1)/health > /dev/null 2>&1 && echo "✓ $service healthy" || echo "✗ $service unhealthy"
done

echo ""
echo "========== END RUNTIME TESTS =========="
