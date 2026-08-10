# Current vs. Target Architecture Comparison

---

## CURRENT STATE (Aug 6, 2026) - Level 2: Strangler-Fig Pattern

```
                              External Clients
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   API Gateway        │
                         │ (routes by path)     │
                         └──────────┬───────────┘
                                    │
                  ┌─────────────────┼──────────────────┐
                  │                 │                  │
                  ▼                 ▼                  ▼
            ┌──────────┐     ┌────────────┐     ┌──────────────┐
            │Monolith  │     │Services    │     │Shadow Services
            │(70%)     │     │(5 endpoints)     │(17 services)
            └──┬───────┘     └────────────┘     └──────────────┘
               │                   │                     │
        ┌──────┼───────┐      ┌────┴────┐          (not used)
        │      │       │      │         │
        ▼      ▼       ▼      ▼         ▼
     ┌─────────────┐  ┌──────────────────────────┐
     │  Monolith   │  │   Service Databases      │
     │   tejoma    │  │  (mirror only)           │
     │    DB       │  │                          │
     │(canonical)  │  │ - tejoma_candidate      │
     │             │  │ - tejoma_candidate_core │
     │ 50 tables   │  │ - tejoma_identity       │
     │ (writable)  │  │ - tejoma_job            │
     │             │  │ - tejoma_matching_*     │
     └─────────────┘  │ - tejoma_chat           │
                      │ - (8 more, mostly empty)│
                      └──────────────────────────┘

Data Flow:
  1. Client → POST /api/swipes (monolith)
  2. Monolith writes to tejoma DB
  3. Dual-write hook fires (async)
  4. Service DB updated (eventually)
  5. Client → GET /api/jobs (service)
  6. Service reads local mirror

Characteristics:
  ✅ Gradual migration (no rewrite needed)
  ✅ Safe rollback (feature flags)
  ❌ Monolith still bottleneck
  ❌ Services still dependent on monolith
  ❌ No write distribution
```

---

## TARGET STATE (2027) - Level 5: True Microservices

```
                              External Clients
                                    │
                                    ▼
                    ┌────────────────────────────┐
                    │    API Gateway             │
                    │  (service mesh / Istio)    │
                    └────────────┬───────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
          ▼                      ▼                      ▼
    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
    │ Job Service  │      │Candidate Svc │      │Matching Svc  │
    │ (independent)│      │ (independent)│      │ (independent)│
    └──────┬───────┘      └──────┬───────┘      └──────┬───────┘
           │                     │                     │
           ▼                     ▼                     ▼
    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
    │ tejoma_job   │      │tejoma_cand   │      │tejoma_match  │
    │ (owns jobs)  │      │(owns cands)  │      │(owns swipes) │
    └──────────────┘      └──────────────┘      └──────────────┘
           │                     │                     │
           └─────────────────────┼─────────────────────┘
                                 │
                    ┌────────────────────────────┐
                    │  Event Bus (Kafka/RabbitMQ)│
                    │  (async communication)     │
                    └────────────────────────────┘

Service Interactions (Async):
  1. Client → POST /api/swipes (matching-service)
  2. Service writes to tejoma_match DB (local)
  3. Event emitted: "swipe.created"
  4. Other services subscribe + consume
  5. Each service updates its own data
  6. Client → GET /api/jobs (job-service)
  7. Service reads own tejoma_job DB (authoritative)

Characteristics:
  ✅ Fully independent services
  ✅ No shared database
  ✅ Async communication (eventual consistency)
  ✅ Each service owns its data
  ✅ Services can scale independently
  ✅ Monolith can be decommissioned
  ❌ More complex (eventual consistency)
  ❌ Requires event bus
  ❌ Requires service mesh
```

---

## Migration Path (Phases 4-8)

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 4 (Aug): Extract 5 read endpoints                        │
│ ✅ Done: GET /api/jobs, shortlisted, recruiter-review, etc.    │
│ Status: Feature-flagged, ready for Phase 5 rollout             │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Phase 5 (Sept): Test & Rollout Phase 4                         │
│ Status: Testing infrastructure ready (A/B parity, load tests)  │
│ Rollout: Canary (10%) → Beta (50%) → GA (100%)                 │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Phase 6 (Oct-Nov): Extract more read endpoints (30+ items)     │
│ Endpoints: GET /api/jobs/:id, /candidates/:id, /chat/*, etc.  │
│ Pattern: Same strangler-fig + dual-write mirrors               │
│ Estimated: 3-4 months (20-30 endpoints)                        │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Phase 7 (Dec-Jan): Extract write operations                    │
│ Operations: POST/PUT/DELETE for jobs, candidates, swipes       │
│ Business Logic: Validation, matching algorithm, recommendations│
│ Estimated: 2-3 months (significant refactoring)                │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Phase 8 (Feb-Mar): Implement event-driven architecture         │
│ Event Bus: Kafka or RabbitMQ                                   │
│ Service Mesh: Istio or similar                                 │
│ Monitoring: Distributed tracing, service discovery             │
│ Estimated: 1-2 months (infrastructure work)                    │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Phase 9 (Apr): Decommission monolith                           │
│ Verify: All endpoints migrated, all business logic extracted   │
│ Cleanup: Archive old code, remove hybrid paths                 │
│ Estimated: 2-4 weeks                                           │
└─────────────────────────────────────────────────────────────────┘

Total Time: 9-12 months (from Aug 2026 to Apr-June 2027)
```

---

## Technical Decisions at Each Level

### Level 2 (Current): Strangler-Fig
```
Decision: Dual-write mirrors
Why: Safe, monolith remains source of truth
Trade-off: Eventual consistency (5-10 second lag)

Decision: Feature flags for routing
Why: Instant rollback, no deployment needed
Trade-off: Routing logic in monolith (codebase pollution)

Decision: Fire-and-forget errors
Why: Primary write never blocked
Trade-off: Validation scripts must detect drift

Decision: RPC (synchronous calls)
Why: Simpler than async, tight control
Trade-off: Latency (P99 can spike), coupling
```

### Level 3-4: More Endpoints
```
Decision: Same dual-write + feature flag pattern
Why: Proven in Phase 4, low risk
Trade-off: Scaling issues as more data flows dual-write

Decision: Add caching layer (Redis)
Why: Reduce monolith load
Trade-off: Cache invalidation complexity

Decision: Add service mesh (Istio)
Why: Circuit breakers, retries, observability
Trade-off: Operational complexity
```

### Level 5: True Microservices
```
Decision: Event-driven architecture
Why: Loose coupling, horizontal scaling
Trade-off: Eventual consistency, debugging complexity

Decision: CQRS + Event Sourcing
Why: Audit trail, temporal queries
Trade-off: Complexity, storage costs

Decision: Database per service
Why: True data independence
Trade-off: Distributed transactions, consistency challenges

Decision: Service mesh (Istio/Linkerd)
Why: Observability, resilience, traffic control
Trade-off: Operational overhead, learning curve
```

---

## Risk Analysis: Current vs. Target

### Current State Risks (Level 2)

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Monolith still single point of failure | 🔴 High | Feature flags, gradual rollout |
| Dual-write lag (eventual consistency) | 🟡 Medium | Validation scripts detect drift |
| Services depend on monolith (tight coupling) | 🟡 Medium | Clear internal boundaries |
| No write operation distribution | 🔴 High | Monolith must scale horizontally |
| Complex data flows (RPC + dual-write) | 🟡 Medium | Structured logging, monitoring |

### Target State Risks (Level 5)

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Eventual consistency (distributed) | 🟡 Medium | Event audit trail, versioning |
| Distributed transactions (data integrity) | 🔴 High | Saga pattern, compensating actions |
| Service-to-service failures (cascading) | 🟡 Medium | Circuit breakers, timeouts, retries |
| Debugging distributed flows | 🟡 Medium | Distributed tracing (Jaeger/Zipkin) |
| Operational complexity (many moving parts) | 🔴 High | Infrastructure automation, monitoring |

**Verdict**: Current state safer (monolith is single source of truth), target state more scalable but complex.

---

## Cost Analysis: Effort & Timeline

| Phase | Duration | Team Size | Key Work | Effort |
|-------|----------|-----------|----------|--------|
| 4 | 1 week | 3 eng | Extract 5 endpoints | 40 hours ✅ Done |
| 5 | 1 month | 2 eng | Test + rollout | 160 hours |
| 6 | 3 months | 2-3 eng | Extract 30+ endpoints | 480 hours |
| 7 | 3 months | 3-4 eng | Extract write + logic | 600 hours |
| 8 | 2 months | 2-3 eng | Event bus + service mesh | 320 hours |
| 9 | 1 month | 2 eng | Decommission monolith | 160 hours |
| **Total** | **9-12 months** | **2-4 eng avg** | **Full microservices** | **1760 hours** |

---

## Decision Matrix: Should You Continue?

| Factor | Assessment | Recommendation |
|--------|------------|-----------------|
| **Business Value** | High (scalability, resilience) | ✅ YES |
| **Time Investment** | 9-12 months | ✅ Manageable |
| **Cost** | $300-500k (eng salaries) | ✅ Justified by scale |
| **Complexity** | High (distributed systems) | ⚠️ Requires expertise |
| **Risk** | Medium (monolith fallback exists) | ✅ Manageable |
| **Team Readiness** | Good (phases 1-4 show competence) | ✅ YES |

**Recommendation**: ✅ **PROCEED** with Phase 5-9

---

## Summary

| Aspect | Current (Level 2) | Target (Level 5) |
|--------|-------------------|------------------|
| **Architecture** | Hybrid (monolith + 5 extracted) | True microservices (all independent) |
| **Data Authority** | Monolith | Each service (own DB) |
| **Write Operations** | Monolith only | Distributed (by service) |
| **Consistency Model** | Strong (monolith) | Eventual (event-driven) |
| **Scalability** | Limited (monolith bottleneck) | Unlimited (horizontal) |
| **Operational Complexity** | Medium | High |
| **Time to Achieve** | Already here | 12-18 months |
| **Risk Level** | Low | Medium |
| **Effort Remaining** | ~1700 hours | To full MS |

---

**Current Status**: 30% through microservices migration (Level 2 of 5)
**Next Milestone**: Phase 5 execution (Sept 15-30, 2026)
**Target Completion**: Q2 2027 (true microservices)
**Owner**: Platform Engineering
**Last Updated**: Aug 6, 2026
