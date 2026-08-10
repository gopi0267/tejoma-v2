# Monitoring & Alerting Configuration

**Version**: 1.0  
**Date**: 2026-08-07  
**Purpose**: Production canary monitoring for Phase 1 + Phase 2 deployment  
**Owner**: Platform Ops + On-Call Team  

---

## PROMETHEUS METRICS

### Application Metrics

```yaml
# File: prometheus/scrape-configs/tejoma-services.yml

scrape_configs:
  - job_name: 'job-service'
    static_configs:
      - targets: ['job-service:8080']
    metrics_path: '/metrics'
    scrape_interval: 15s

  - job_name: 'candidate-core-service'
    static_configs:
      - targets: ['candidate-core-service:8080']
    scrape_interval: 15s

  - job_name: 'candidate-service'
    static_configs:
      - targets: ['candidate-service:8080']
    scrape_interval: 15s

  - job_name: 'matching-decision-service'
    static_configs:
      - targets: ['matching-decision-service:8080']
    scrape_interval: 15s

  - job_name: 'recruiting-service'
    static_configs:
      - targets: ['recruiting-service:8080']
    scrape_interval: 15s

  - job_name: 'chat-service'
    static_configs:
      - targets: ['chat-service:8080']
    scrape_interval: 15s
```

### Metrics to Collect

```
# HTTP Requests (all services)
http_requests_total{service="job-service", method="GET", status="200"}
http_requests_total{service="job-service", method="GET", status="404"}
http_requests_total{service="job-service", method="POST", status="201"}
http_requests_total{service="job-service", method="POST", status="500"}

# Request Duration (latency)
http_request_duration_seconds{service="job-service", method="GET", path="/jobs/:id"}
http_request_duration_seconds{service="candidate-service", method="PUT", path="/candidate-profile/me"}

# Dual-Write Lag (critical)
dual_write_lag_seconds{service="job-service", endpoint="POST /jobs"}
dual_write_lag_seconds{service="matching-decision-service", endpoint="POST /swipes"}

# Feature Flag State
feature_flag_enabled{flag="JOB_DETAIL_CUTOVER_ENABLED"}
feature_flag_enabled{flag="CANDIDATE_RESUME_CUTOVER_ENABLED"}
feature_flag_enabled{flag="RECRUITER_MATCHES_CUTOVER_ENABLED"}

# Database Connections
db_connections_active{service="job-service", pool="primary"}
db_connections_total{service="job-service", pool="primary"}

# Cross-Service Calls
cross_service_calls_total{from="job-service", to="candidate-core-service", status="200"}
cross_service_calls_duration_seconds{from="job-service", to="matching-scoring-service"}

# Cache Hit Rate
cache_hits_total{service="candidate-service", key="candidate-by-id"}
cache_misses_total{service="candidate-service", key="candidate-by-id"}

# Error Types
errors_total{service="job-service", error_type="timeout"}
errors_total{service="job-service", error_type="database"}
errors_total{service="job-service", error_type="validation"}
```

---

## GRAFANA DASHBOARDS

### Dashboard 1: Service Health Overview

```
Panels:
1. Service Status (Green/Red)
   - job-service: up/down
   - candidate-core-service: up/down
   - candidate-service: up/down
   - matching-decision-service: up/down
   - recruiting-service: up/down
   - chat-service: up/down

2. Error Rate (% over last hour)
   - job-service: 0.01%
   - candidate-service: 0.00%
   - matching-decision-service: 0.02%
   - Others: 0.00%

3. Latency P99 (ms over last hour)
   - job-service: 450ms
   - candidate-service: 150ms
   - matching-decision-service: 800ms

4. Requests Per Second
   - Total: 450 req/s
   - By service breakdown

5. Dual-Write Lag (seconds)
   - Max: 2s
   - P99: 1s
   - P50: 0.5s
```

### Dashboard 2: Phase 1 Read Operations

```
Panels:
1. GET /api/jobs/:id
   - Request count: 50/s
   - Error rate: 0.00%
   - P99 latency: 450ms
   - Cache hit rate: 95%

2. GET /api/candidates/:id/resume
   - Request count: 25/s
   - Error rate: 0.00%
   - P99 latency: 50ms
   - Cache hit rate: 98%

3. GET /api/recruiter-matches
   - Request count: 15/s
   - Error rate: 0.00%
   - P99 latency: 750ms
   - Cross-service call latency:
     - candidate-service: 200ms
     - job-service: 150ms
     - candidate-core-service: 300ms

4. Feature Flags
   - JOB_DETAIL_CUTOVER_ENABLED: true (at 10% traffic)
   - CANDIDATE_RESUME_CUTOVER_ENABLED: true (at 10% traffic)
   - RECRUITER_MATCHES_CUTOVER_ENABLED: true (at 10% traffic)
```

### Dashboard 3: Phase 2 Write Operations

```
Panels:
1. Write Operation Success Rate
   - POST /candidates: 99.99%
   - POST /jobs: 99.99%
   - POST /swipes: 99.98%
   - PUT /candidate-profile/me: 99.99%
   - DELETE /candidates/:id: 99.99%

2. Write Operation Latency (P99)
   - POST /candidates: 150ms
   - POST /jobs: 200ms
   - POST /swipes: 400ms
   - PUT /candidate-profile/me: 100ms

3. Dual-Write Status
   - Successful dual-writes: 99.8%
   - Failed dual-writes (retried): 0.2%
   - Monolith lag > 5s: 0.0%

4. Database Performance
   - Connections active: 45/50
   - Query latency (P99): 25ms
   - Transaction duration (P99): 50ms

5. Cascading Operations
   - Swipe + notification: 98% success
   - Job create + CQRS view: 99.5% success
```

### Dashboard 4: Cross-Service Dependencies

```
Panels:
1. Service-to-Service Calls
   - job-service → candidate-core-service: 150 calls/s, 200ms latency
   - job-service → matching-scoring-service: 150 calls/s, 300ms latency
   - matching-decision-service → candidate-core-service: 80 calls/s, 150ms latency
   - matching-decision-service → job-service: 80 calls/s, 150ms latency

2. Timeout Events
   - job-service calls timing out: 0
   - candidate-service calls timing out: 0
   - Total: 0 timeouts/hour

3. Circuit Breaker Status
   - All circuits: CLOSED (healthy)
   - No services in OPEN state

4. Data Consistency
   - Service DB ≠ Monolith DB: 0 mismatches
   - Parity drift: 0.0%
```

---

## ALERT RULES

### Prometheus Alert Rules (prometheus/rules/tejoma-alerts.yml)

```yaml
groups:
  - name: tejoma-canary-alerts
    interval: 30s
    rules:

      # Critical: High Error Rate
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.01
        for: 5m
        labels:
          severity: critical
          team: platform
        annotations:
          summary: "High error rate detected in {{ $labels.service }}"
          description: "Error rate is {{ $value | humanizePercentage }} (threshold: 1%)"
          action: "Check logs, consider rolling back feature flag"

      # Critical: High Latency (P99)
      - alert: HighLatencyP99
        expr: histogram_quantile(0.99, rate(http_request_duration_seconds[5m])) > 1.0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High latency detected: {{ $labels.service }}"
          description: "P99 latency is {{ $value | humanizeDuration }} (threshold: 1s)"

      # Critical: Dual-Write Lag
      - alert: HighDualWriteLag
        expr: dual_write_lag_seconds > 10
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Dual-write lag high: {{ $labels.service }}"
          description: "Monolith lag is {{ $value | humanizeDuration }} (threshold: 10s)"
          action: "Check monolith availability, consider reducing canary percentage"

      # Critical: Service Unhealthy
      - alert: ServiceUnhealthy
        expr: up{job=~"(job|candidate|matching|recruiting|chat)-service"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Service unhealthy: {{ $labels.job }}"
          description: "Service {{ $labels.job }} failed health check"
          action: "Check pod status, logs, consider restarting pod"

      # Critical: Database Connection Pool Exhausted
      - alert: DatabaseConnectionPoolExhausted
        expr: db_connections_active / db_connections_max > 0.9
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "DB connection pool {{ $value | humanizePercentage }} full"
          description: "Service {{ $labels.service }} approaching connection limit"

      # High: Parity Drift Detected
      - alert: ParityDriftDetected
        expr: parity_mismatch_total > 0
        for: 5m
        labels:
          severity: high
        annotations:
          summary: "Parity drift detected"
          description: "Service response differs from monolith for {{ $value }} requests"
          action: "Investigate which endpoint is drifting, check A/B test results"

      # High: Timeout Rate Increasing
      - alert: TimeoutRateIncreasing
        expr: rate(cross_service_timeout_total[5m]) > 0.001
        for: 5m
        labels:
          severity: high
        annotations:
          summary: "Timeout rate increasing: {{ $value | humanizePercentage }}"
          description: "Cross-service calls timing out {{ $value | humanizePercentage }} of time"

      # Medium: Database Query Latency High
      - alert: DatabaseQueryLatencyHigh
        expr: histogram_quantile(0.95, rate(db_query_duration_seconds[5m])) > 0.1
        for: 10m
        labels:
          severity: medium
        annotations:
          summary: "DB query latency high: {{ $value | humanizeDuration }}"
          description: "P95 database query latency exceeds 100ms"

      # Medium: Memory Usage High
      - alert: MemoryUsageHigh
        expr: container_memory_usage_bytes / container_spec_memory_limit_bytes > 0.8
        for: 5m
        labels:
          severity: medium
        annotations:
          summary: "Memory usage {{ $value | humanizePercentage }} on {{ $labels.pod }}"
          description: "Pod approaching memory limit"

      # Low: Feature Flag State Mismatch
      - alert: FeatureFlagMismatch
        expr: feature_flag_enabled{flag="JOB_DETAIL_CUTOVER_ENABLED"} != feature_flag_canary_percentage{flag="JOB_DETAIL_CUTOVER_ENABLED"}
        for: 10m
        labels:
          severity: low
        annotations:
          summary: "Feature flag state mismatch"
          description: "Flag state may not have propagated to all pods"
```

---

## ALERT ACTIONS & ESCALATION

### Alert Handling Procedure

#### Severity: CRITICAL (Page On-Call Immediately)
1. **Within 2 minutes**: On-call acknowledges alert
2. **Within 5 minutes**: On-call investigates
3. **Within 10 minutes**: Decision to mitigate or rollback
4. **Within 15 minutes**: Action taken (rollback or remediation)

**Rollback Decision Tree**:
- Error rate > 5% → Rollback immediately
- Latency P99 > 3 seconds → Rollback immediately
- Dual-write lag > 30s → Rollback immediately
- Data corruption detected → Rollback + escalate

**Mitigation Procedure**:
```bash
# 1. Flip feature flag to false (instant)
kubectl set env deployment/job-service \
  JOB_DETAIL_CUTOVER_ENABLED=false

# 2. Restart affected service (30 seconds)
kubectl rollout restart deployment/job-service

# 3. Monitor error rate (should drop within 30s)
# 4. Verify monolith handling all traffic
# 5. Investigate root cause (after stability)
```

#### Severity: HIGH (Alert On-Call, Investigate Next 30 minutes)
1. **Within 30 minutes**: On-call investigates
2. **Decision**: Is this trending upward (escalate) or isolated (monitor)?
3. **If trending**: Escalate to critical
4. **If isolated**: Continue monitoring, document

#### Severity: MEDIUM (Log Alert, Investigate Before Next Shift)
1. **Within 8 hours**: Review alert
2. **Decision**: Is this a real issue or false positive?
3. **Plan**: File ticket if needed, improve monitoring

#### Severity: LOW (Log Alert Only)
1. **Investigate**: During next routine review
2. **Action**: Update monitoring configuration if needed

---

## DASHBOARDS & ACCESS

### Grafana URL (Production)
```
https://grafana.production/d/tejoma-canary
```

### Prometheus Query Console
```
https://prometheus.production/graph
```

### Alert Manager
```
https://alertmanager.production
```

### Access Permissions
- QA Team: Read-only access to all dashboards
- Ops Team: Full access (read + edit)
- On-Call Engineer: Full access (read + edit)
- Platform Lead: Full access (read + edit + config)

---

## LOGGING CONFIGURATION

### ELK Stack (ElasticSearch + Logstash + Kibana)

```yaml
# logstash/tejoma-pipeline.conf

input {
  # Collect logs from all services
  file {
    path => "/var/log/tejoma/job-service.log"
    type => "job-service"
    tags => ["application", "job-service"]
  }
  file {
    path => "/var/log/tejoma/candidate-service.log"
    type => "candidate-service"
    tags => ["application", "candidate-service"]
  }
  # ... other services
}

filter {
  # Parse JSON logs
  json {
    source => "message"
  }

  # Add timestamp
  date {
    match => ["timestamp", "ISO8601"]
    target => "@timestamp"
  }

  # Add environment
  mutate {
    add_field => { "environment" => "production" }
    add_field => { "deployment_stage" => "canary" }
  }
}

output {
  # Send to ElasticSearch
  elasticsearch {
    hosts => ["elasticsearch:9200"]
    index => "tejoma-%{+YYYY.MM.dd}"
  }

  # Also send errors to Slack
  if [level] == "ERROR" {
    slack {
      url => "${SLACK_WEBHOOK_URL}"
      message => "%{service}: %{message}"
    }
  }
}
```

### Kibana Queries

```
# Find all errors in last hour
type: * AND level: ERROR AND timestamp: [now-1h TO now]

# Find dual-write failures
message: "dual-write" AND level: WARN

# Find timeouts in cross-service calls
message: "timeout" AND from_service: *

# Find parity drift
message: "parity_mismatch" OR message: "response_differs"

# Find specific service errors
service: "job-service" AND level: ERROR
```

---

## CANARY-SPECIFIC MONITORING

### Traffic Distribution Monitoring

```
Dashboard: "Canary Traffic Split"

Panels:
1. Traffic By Endpoint
   - GET /jobs/:id
     - Monolith proxy: 90%
     - Service: 10%
   
2. Metrics By Route
   - Monolith route metrics (baseline)
   - Service route metrics (canary)
   - Comparison chart (should track closely)

3. Error Rate Comparison
   - Monolith: 0.00%
   - Service: 0.00%
   - Drift: 0.00%
```

### Parity Validation Monitoring

```
Dashboard: "A/B Parity Validation"

Panels:
1. Response Format Match
   - Requests with identical format: 100%
   - Field count mismatch: 0
   - Field value mismatch: 0

2. Latency Comparison
   - Monolith P99: 400ms
   - Service P99: 450ms
   - Service slower by: 50ms (acceptable)

3. Error Parity
   - Both return 404: 100%
   - Both return 500: 100%
   - Divergent responses: 0
```

---

## RUNBOOK: RESPONDING TO ALERTS

### High Error Rate Alert

```
1. CHECK IMMEDIATE STATUS
   - Look at Grafana dashboard
   - Identify which service/endpoint has high error rate
   - Check if trending up or isolated spike

2. CHECK LOGS
   - Go to Kibana
   - Query: service: "X" AND level: ERROR
   - Look for error messages and stack traces
   - Identify root cause (database, timeout, validation, etc.)

3. ASSESS SEVERITY
   - Error rate < 0.5%: Monitor, don't rollback yet
   - Error rate 0.5-2%: Escalate + investigate
   - Error rate > 2%: Rollback immediately

4. IF ROLLBACK DECISION
   - Flip feature flag to false
   - Restart service
   - Monitor error rate (should drop in 30s)
   - Verify monolith handling traffic

5. POST-INCIDENT
   - Document what happened
   - Schedule post-mortem
   - Update monitoring/alerting
```

### High Latency Alert

```
1. CHECK LATENCY BREAKDOWN
   - Is it the service slow, or its dependencies?
   - Check cross-service call latencies
   - Check database query times

2. ASSESS SEVERITY
   - P99 latency < 1.5x baseline: Monitor
   - P99 latency > 1.5x baseline: Investigate
   - P99 latency > 2x baseline: Consider rollback

3. IF ROLLBACK DECISION
   - Follow same procedure as error rate
   - Flip flag + restart

4. IF INVESTIGATION
   - Check if load is higher than expected
   - Check if database connections exhausted
   - Check if cross-service calls timing out
```

### Dual-Write Lag Alert

```
1. CHECK LAG MAGNITUDE
   - Lag < 5s: Monitor, this is expected
   - Lag 5-10s: Escalate, monolith may be slow
   - Lag > 10s: Page on-call, potential sync issue

2. CHECK MONOLITH STATUS
   - Is monolith healthy?
   - Is monolith CPU/memory high?
   - Are monolith writes slow?

3. DECISION
   - If monolith slow: Page monolith oncall
   - If service writes backing up: Consider reducing canary %
   - If isolated spike: Monitor for 5 minutes

4. COMMUNICATION
   - Alert team in Slack
   - Update status page if customer-facing
```

---

## SUCCESS CRITERIA (Monitoring)

✅ **All services reporting metrics**  
✅ **Error rate < 0.01%** (baseline)  
✅ **Latency stable** (P99 within 10% of baseline)  
✅ **Dual-write lag < 5 seconds** (P99)  
✅ **Zero parity drift** (0 mismatches)  
✅ **Alerts firing correctly** (tested during staging)  
✅ **On-call responds to alerts** (within SLA)  

---

**Prepared by**: Platform Ops  
**Last Updated**: 2026-08-07  
**Status**: READY FOR PRODUCTION CANARY
