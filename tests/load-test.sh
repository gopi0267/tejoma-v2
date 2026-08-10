#!/bin/bash
# Load Testing Script for Tejoma Microservices
# Generates realistic load and monitors performance

set -euo pipefail

API_URL="${API_URL:-http://localhost:4000}"
DURATION="${DURATION:-300}"  # 5 minutes
CONCURRENT="${CONCURRENT:-50}"  # concurrent users
RAMP_UP="${RAMP_UP:-60}"     # ramp up time in seconds

echo "Tejoma Load Test"
echo "=================="
echo "URL: $API_URL"
echo "Duration: ${DURATION}s"
echo "Concurrent users: $CONCURRENT"
echo "Ramp-up time: ${RAMP_UP}s"
echo ""

# Test scenarios
run_candidate_create_test() {
  echo "[TEST] Candidate creation load test..."

  ab -n 100 -c $CONCURRENT -p /dev/null \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer DUMMY_TOKEN" \
    $API_URL/api/candidates
}

run_job_create_test() {
  echo "[TEST] Job creation load test..."

  ab -n 100 -c $CONCURRENT \
    -H "Authorization: Bearer DUMMY_TOKEN" \
    $API_URL/api/jobs
}

run_chat_query_test() {
  echo "[TEST] Chat query load test..."

  # Simulate chat queries
  for i in {1..50}; do
    curl -s -X POST $API_URL/api/chat \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer DUMMY_TOKEN" \
      -d '{"message":"Find candidates with React skills"}' \
      > /dev/null &
  done

  wait
}

run_analytics_query_test() {
  echo "[TEST] Analytics dashboard load test..."

  # Simulate analytics queries
  for i in {1..20}; do
    curl -s $API_URL/api/analytics/dashboard \
      -H "Authorization: Bearer DUMMY_TOKEN" \
      > /dev/null &
  done

  wait
}

# Main load test sequence
echo "Starting load tests..."
echo ""

# Monitor baseline
echo "Collecting baseline metrics..."
kubectl top pods -n tejoma > baseline-metrics.txt 2>/dev/null || echo "Metrics not available (prometheus not deployed)"

# Run tests
run_candidate_create_test
run_job_create_test
run_chat_query_test
run_analytics_query_test

# Collect final metrics
echo ""
echo "Collecting post-load metrics..."
kubectl top pods -n tejoma > final-metrics.txt 2>/dev/null || echo "Metrics not available"

echo ""
echo "Load test complete."
echo "Check metrics in baseline-metrics.txt and final-metrics.txt"
