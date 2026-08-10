# API Gateway

Tier 0 microservice (Phase 11/12 of the Tejoma enterprise architecture series). The single
public entry point - routes migrated `/api` paths to the appropriate Tier 0 service, and falls
back to the monolith (strangler-fig, Phase 11 section 12) for everything not yet migrated.

## Status

**Current batch (12):** fully implemented for everything migrated so far.

Routing table (`src/proxy.ts`):
| Path prefix | Target |
|---|---|
| `/api/auth/*`, `/api/candidate-auth/*` | Identity Service |
| `/api/company-registration`, `/api/admin/company-requests/*` | Platform Governance Service |
| `/internal/*` | explicitly rejected (404) - never proxied anywhere |
| everything else | the monolith, unchanged |

Also owns the Gateway-layer concerns every service built before it explicitly deferred rather
than duplicated: global + auth-specific rate limiting (`src/middleware/rateLimit.middleware.ts`),
and request-id origination (`src/middleware/requestId.middleware.ts` - this is the one Tier 0
service where a request's correlation id is usually actually *born*, not just forwarded).

Tenant Directory Service has no entry here on purpose - it exposes no public routes at all, only
`/internal/*` (service-to-service, e.g. by Platform Governance Service's approve saga), which
this Gateway explicitly never proxies.

## Local development

```
npm install
npm run dev
```

Requires `IDENTITY_SERVICE_URL`, `PLATFORM_GOVERNANCE_SERVICE_URL`, and `MONOLITH_URL` (e.g.
`http://localhost:3006`) - all three are hard startup requirements (see `src/config/env.ts`),
unlike the graceful-null pattern used for soft cross-service enrichment elsewhere in this series:
a Gateway that doesn't know where to send a request has nothing reasonable to fall back to.

No database - this is the one Tier 0 service that owns no data of its own.
