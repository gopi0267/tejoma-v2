# Route Safety Audit - PHASE 1

## Monolith Routes Mounted (src/api/index.ts)

### Routes Explicitly Routed Through Gateway (LIVE)

| Route File | Gateway Routing | Service | Paths | Status |
|-----------|-----------------|---------|-------|--------|
| health.routes.ts | Not routed | Monolith | /api/health/* | **UNCERTAIN** - health check may be used internally |
| auth.routes.ts | /api/auth | identity-service | /api/auth/* | **KEEP** - identity-service owns auth |
| candidate-auth.routes.ts | /api/candidate-auth | identity-service | /api/candidate-auth/* | **KEEP** - identity-service owns auth |
| company-requests.routes.ts | /api/company-registration | platform-governance-service | /api/company-registration/* | **KEEP** - platform-governance owns |
| admin/company-requests | /api/admin/company-requests | platform-governance-service | /api/admin/company-requests/* | **KEEP** |
| users.routes.ts | /api/users | identity-service | /api/users/* | **KEEP** - identity-service owns users |
| candidate-profile.routes.ts | /api/candidate-profile | candidate-service | /api/candidate-profile/* | **KEEP** |
| candidate-resume.routes.ts | /api/candidate-resume | resume-service | /api/candidate-resume/* | **KEEP** |
| candidate-jobs.routes.ts | /api/candidate-jobs | candidate-service | /api/candidate-jobs/* | **KEEP** |
| candidate-decisions.routes.ts | /api/candidate-decisions | candidate-service | /api/candidate-decisions/* | **KEEP** |
| candidate-matches.routes.ts | /api/candidate-matches | candidate-service | /api/candidate-matches/* | **KEEP** |
| candidate-notifications.routes.ts | /api/candidate-notifications | candidate-service | /api/candidate-notifications/* | **KEEP** |
| candidate-applications.routes.ts | /api/candidate-applications | candidate-service | /api/candidate-applications/* | **KEEP** |
| candidate-analytics.routes.ts | /api/candidate-analytics | candidate-service | /api/candidate-analytics/* | **KEEP** |
| candidate-search.routes.ts | /api/candidate-search | candidate-service | /api/candidate-search/* | **KEEP** |
| job.routes.ts | /api/jobs | job-service | /api/jobs/* | **KEEP** |
| jd-parser.routes.ts | /api/jobs/parse-description | jd-parser-service | /api/jobs/parse-description* | **KEEP** |
| chat.routes.ts | /api/chat | chat-service | /api/chat/* | **KEEP** |
| candidate-router (candidate.routes.ts) | NOT EXPLICITLY ROUTED | ? | /api/candidate/* | **UNCERTAIN** |
| swipe.routes.ts | /api/swipes | matching-decision-service | /api/swipes/* | **KEEP** |
| recruiter-review.routes.ts | /api/recruiter-review | matching-decision-service | /api/recruiter-review/* | **KEEP** |
| recruiter-matches.routes.ts | /api/matches (recruiting-service exact) | recruiting-service | /api/matches | **UNCERTAIN** - recruiter-matches file vs recruiting-service |
| recruiter-notifications.routes.ts | /api/recruiter-notifications | recruiting-service | /api/recruiter-notifications/* | **KEEP** |
| analytics.routes.ts | /api/analytics | analytics-service | /api/analytics/* | **KEEP** |
| ml.routes.ts | /api/ml/* | matching-evaluation-service + matching-scoring-service | /api/ml/evaluate, /api/ml/train, etc. | **KEEP** |
| upload.routes.ts | NOT EXPLICITLY ROUTED | ? | /api/upload/* | **UNCERTAIN** |
| skill-intelligence.routes.ts | NOT EXPLICITLY ROUTED | ? | /api/skill-intelligence/* | **UNCERTAIN** |
| proficiency-analytics.routes.ts | /api/proficiency-analytics | matching-evaluation-service | /api/proficiency-analytics/* | **KEEP** |

### Routes NOT Explicitly in Gateway (Fall Through to Monolith)

These routes will ONLY be reached if:
1. Frontend calls them directly
2. Service-to-service calls them
3. Tests call them

Candidates for deletion:
- candidate.routes.ts (monolithic candidate CRUD?)
- skill-intelligence.routes.ts (shadow implementation?)
- upload.routes.ts (old upload handler?)

## Next Steps

For each UNCERTAIN/potentially dead route:
1. Search for references in frontend code
2. Search for references in service-to-service calls
3. Check if tests require it
4. Check nginx/gateway configuration
5. Check Docker Compose environment variables
6. Review route implementations to understand scope
