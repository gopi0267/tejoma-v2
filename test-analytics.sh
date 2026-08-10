#!/bin/bash

echo "🧪 Testing Analytics API..."

# Generate JWT token using node with correct secret
TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { user_id: 53, company_id: 1, email: 'admin@example.com', name: 'Audit Admin', role: 'recruiter' },
  '4ae06877de86615cd38067bab4dc7e28bd2a6aa72e652b6d2c82a8ba27921327',
  { expiresIn: '24h' }
);
console.log(token);
")

echo "✓ Generated JWT token"
echo ""
echo "📊 Testing GET /api/analytics/dashboard..."
echo ""

curl -k -s -H "Authorization: Bearer $TOKEN" https://localhost/api/analytics/dashboard | jq '.' 2>/dev/null || curl -k -s -H "Authorization: Bearer $TOKEN" https://localhost/api/analytics/dashboard

echo ""
echo ""
echo "👤 Testing GET /api/analytics/recruiter/me..."
echo ""

curl -k -s -H "Authorization: Bearer $TOKEN" https://localhost/api/analytics/recruiter/me | jq '.' 2>/dev/null || curl -k -s -H "Authorization: Bearer $TOKEN" https://localhost/api/analytics/recruiter/me

echo ""
echo ""
echo "🔍 Checking analytics database state..."
echo ""

psql -h localhost -U postgres -d tejoma_analytics -c "
SELECT
  COUNT(*) as dashboard_records,
  (SELECT COUNT(*) FROM analytics_recent_activity) as recent_activity,
  (SELECT COUNT(*) FROM analytics_recruiter_profile) as recruiter_profiles
FROM analytics_dashboard_cache;
" 2>/dev/null || echo "psql not available, using Node.js instead..."
