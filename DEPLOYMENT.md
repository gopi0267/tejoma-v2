# Tejoma - Production Deployment Guide

This covers deploying Tejoma with Docker Compose: the Node app, both Python microservices
(JD-NLP, Matching-ML), Nginx (reverse proxy + TLS), and a Prometheus/Grafana monitoring stack.
**PostgreSQL stays native** (not containerized) - the Docker services connect out to it via
`host.docker.internal`. See the Rollback/Troubleshooting sections if something goes wrong.

## 1. Server Requirements

- Docker Engine 24+ and Docker Compose v2 (the `docker compose` subcommand, not the standalone
  `docker-compose` v1 binary).
- PostgreSQL 14+ running natively on the host (or reachable over the network - adjust `DB_HOST`
  accordingly if it's not on the same machine).
- At least **4 GB RAM** and **10 GB free disk** - the two Python images (spaCy/GLiNER/torch and
  sentence-transformers/scikit-learn/xgboost/lightgbm) are the heaviest part of the stack; budget
  more if you also expect meaningful Postgres/monitoring data volume growth.
- Ports `80`/`443` free for Nginx, `9090` (Prometheus) and `3000` (Grafana) if you want direct
  local access to those without going through Nginx.
- `openssl` available on the host for the self-signed dev cert script (bundled with Git for
  Windows/most Linux distros already).

## 2. First-Time Setup

```bash
# 1. Environment
cp .env.production.example .env.local   # fill in real values (DB password, JWT_SECRET, etc.)
cp .env.local .env                      # Compose itself reads a root .env for ${VAR}
                                         # substitution (postgres-exporter's DSN, Grafana's
                                         # admin password) - a different mechanism from
                                         # env_file:, so both files are needed and must match.

# 2. TLS cert (self-signed, for now - see the HTTPS section below for a real cert later)
bash scripts/generate-dev-certs.sh

# 3. Build and start everything
docker compose build
docker compose up -d

# 4. Confirm everything is healthy
docker compose ps
curl -k https://localhost/api/health
```

`docker compose ps` should show every service as `healthy` (or `running` for images without a
healthcheck, like Prometheus/Grafana/exporters) within about a minute - the Python services take
the longest to become healthy since they load ML models at startup.

## 3. Docker Images

Three custom images, all multi-stage to keep them slim:

| Image | Built from | Notes |
|---|---|---|
| `app` | `Dockerfile` (root) | Node 20 Alpine. Builds the Vite SPA + esbuild-bundles the server, then copies only `dist/` + production `node_modules` into the final stage. Runs as a non-root user. |
| `jd-nlp-service` | `python-services/jd-nlp-service/Dockerfile` | Python 3.11-slim + spaCy/GLiNER. Downloads `en_core_web_sm` at build time. |
| `matching-ml-service` | `python-services/matching-ml-service/Dockerfile` | Python 3.11-slim + sentence-transformers/scikit-learn/xgboost/lightgbm. Overrides its documented `--host 127.0.0.1` to `0.0.0.0` so it's reachable from the `app` container - **do not** "fix" this back to match the service's own docstring, that would break Docker networking. |

Trained ML model artifacts (`python-services/matching-ml-service/models/*.joblib`) persist across
rebuilds via the `ml-models` named Docker volume - a `docker compose down -v` would wipe them
(the model just retrains from swipe history again); a plain `docker compose down`/`up` does not.

## 4. Docker Compose Architecture

```
                         ┌─────────────────────────────────────────┐
  Internet/Browser       │              Docker host                │
        │                │                                         │
        │ :80 / :443     │   ┌────────┐                            │
        └───────────────►│   │ nginx  │  TLS termination,           │
                          │   │        │  reverse proxy, gzip,      │
                          │   └───┬────┘  security headers          │
                          │       │ :3006                          │
                          │       ▼                                │
                          │   ┌────────┐        ┌──────────────┐   │
                          │   │  app   │───────►│ jd-nlp-service│  │
                          │   │ (Node) │  :8008  │  (internal)  │  │
                          │   │        │         └──────────────┘  │
                          │   │        │        ┌──────────────┐   │
                          │   │        │───────►│matching-ml-  │   │
                          │   │        │  :8009  │service       │   │
                          │   └───┬────┘         │ (internal)   │   │
                          │       │              └──────────────┘  │
                          │       │ host.docker.internal:5432      │
                          │       ▼                                │
                          │   ┌─────────────────┐                  │
                          │   │ PostgreSQL       │ ← native, not    │
                          │   │ (native host)    │   containerized  │
                          │   └─────────────────┘                  │
                          │                                         │
                          │   ┌───────────┐  ┌─────────┐  ┌──────┐ │
                          │   │prometheus │◄─│ exporters│  │grafana│ │
                          │   └───────────┘  └─────────┘  └──────┘ │
                          └─────────────────────────────────────────┘
```

The two Python microservices have **no published ports** and no Nginx route pointing at them -
they are reachable only from the `app` container over the Docker-internal `internal` network,
exactly as they're called today via `JD_NLP_SERVICE_URL`/`MATCHING_ML_SERVICE_URL`. This was a
deliberate choice: the browser never calls them directly, so exposing them publicly would add
attack surface for no functional benefit.

**Updated by the full-migration cutover**: Nginx no longer proxies straight to `app`. It now
proxies to `api-gateway`, which explicitly routes every path already migrated to a Tier 0 service
(`api-gateway/src/proxy.ts`'s `ROUTES` table - identity-service, platform-governance-service,
jd-parser-service, candidate-service, chat-service, resume-service, recruiting-service,
analytics-service, matching-evaluation-service, matching-skill-discovery-service) and falls
through to `app` (`MONOLITH_URL`) for everything not yet migrated - which is most of the system:
the live-scoring engine, job posting, swipe/decision recording, recruiter review, and candidate
search all still live in `app`. `api-gateway` itself `depends_on` every service it can route to
directly, plus `app`, being healthy first; `nginx` then only needs to wait on `api-gateway`.
Several more Tier 0 services (`job-service`, `candidate-core-service`,
`matching-decision-service`, `role-intelligence-service`, `career-intelligence-service`,
`dynamic-weighting-service`, `matching-reasoning-service`, `matching-bge-shadow-service`,
`tenant-directory-service`) run in Compose and receive live dual-written data, but are not yet in
the Gateway's routing table - they're validated and ready, not yet cut over to real traffic (see
each service's own README for its specific reason).

## 5. Nginx

Config lives in `nginx/nginx.conf` (global settings: gzip, log format, rate-limit zone) and
`nginx/conf.d/tejoma.conf` (server blocks). It reverse-proxies to `api-gateway` (the
`tejoma_gateway` upstream) - no location block changed to make this happen, since the Gateway's
own strangler-fig fallback preserves the exact same "everything reaches something that responds"
behavior Nginx→`app` always had. No API routes are duplicated in Nginx itself.

Notable behavior:
- Port 80 redirects everything to HTTPS except `/.well-known/acme-challenge/` (needed for the
  real Let's Encrypt flow) and `/nginx-health` (used by Nginx's own Docker healthcheck).
- `/api/realtime/stream` (SSE) gets `proxy_buffering off` and an effectively unlimited read
  timeout - without this, the live in-app notifications silently stop working through the proxy.
- `/api/parse-resume`, `/api/jobs/parse-description`, `/api/ml/train`, `/api/chat` get a 300s
  timeout (they call Gemini or a Python microservice and can legitimately take longer).
- `/api/auth/` gets an additional Nginx-level rate limit (10 req/s, burst 20) in front of the
  app's own `express-rate-limit`, as defense-in-depth.
- Hashed Vite asset filenames (`*.js`, `*.css`, etc.) get a 1-year immutable `Cache-Control`.

## 6. HTTPS

**Today (no real domain yet):** `scripts/generate-dev-certs.sh` generates a self-signed cert into
`nginx/certs/` (gitignored, regenerate anytime). Browsers will show a certificate warning - that's
expected and fine for local/dev validation.

**Once you have a real domain pointed at this server:**
1. Uncomment the `certbot` service in `docker-compose.yml`.
2. Run a one-time issuance (adjust the domain/email):
   ```bash
   docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
     -d yourdomain.com --email you@yourdomain.com --agree-tos --no-eff-email
   ```
3. Edit `nginx/conf.d/tejoma.conf`: change `ssl_certificate`/`ssl_certificate_key` from
   `/etc/nginx/certs/cert.pem`/`key.pem` to
   `/etc/letsencrypt/live/yourdomain.com/fullchain.pem`/`privkey.pem`.
4. Mount `./nginx/certbot/conf:/etc/letsencrypt:ro` on the `nginx` service alongside the existing
   cert mount, and `docker compose restart nginx`.
5. The `certbot` service's own entrypoint handles automatic renewal every 12h.

No certificates are ever hardcoded or committed - both the self-signed and Let's Encrypt paths
are gitignored, regenerated locally or by certbot.

## 7. Health Checks

- `GET /api/health` (app): checks DB connectivity (hard `503` if down - the app can't function
  without it) and both Python services' own `/health` endpoints (soft - reports `degraded` but
  still `200` if a Python service is down, matching the app's existing graceful-degradation
  behavior for those services).
- Both Python services already had real `/health` endpoints (checking model-loaded state) before
  this phase - only the Docker `HEALTHCHECK` wiring is new.
- All three custom images have a Docker `HEALTHCHECK` directive; Nginx's healthcheck hits its own
  `/nginx-health` (doesn't depend on the app being reachable, so Nginx can report its own health
  independently).
- `depends_on: condition: service_healthy` chains startup ordering: `app` waits for both Python
  services to be healthy; each Tier 0 service that calls `app` directly (`MONOLITH_INTERNAL_URL`)
  waits for `app`; `api-gateway` waits for `app` and every service in its own routing table;
  `nginx` waits for `api-gateway` (see §4's "Updated by the full-migration cutover" note).

## 8. Restart & Recovery

Every service has `restart: unless-stopped` - a crashed container restarts automatically; a
`docker compose stop` stays stopped until you explicitly start it again. The `app` container also
handles `SIGTERM`/`SIGINT` gracefully now (drains in-flight requests, closes the DB pool) instead
of dropping connections mid-request on restart.

## 9. Environment Variables

Full reference: `.env.example` (local dev) and `.env.production.example` (Docker Compose, with
production-specific notes on which values Compose overrides automatically). Never commit real
values - both `.env.local` and the root `.env` copy are gitignored.

## 10. Logging

- App logs: structured JSON via pino to stdout (unchanged) - captured by Docker's `json-file` log
  driver, configured with `max-size: 10m, max-file: 5` per service so logs rotate automatically
  without a separate tool.
- Nginx access/error logs: written to `./logs/nginx/` (bind-mounted, gitignored). Suggested
  `logrotate` config (`/etc/logrotate.d/tejoma-nginx` on the host, if deploying to a real Linux
  server):
  ```
  /path/to/tejoma-rec/logs/nginx/*.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    sharedscripts
    postrotate
      docker compose exec nginx nginx -s reopen
    endpostrotate
  }
  ```
- To wire in an external log aggregator later (Loki, ELK, CloudWatch, etc.), point its Docker
  log-driver plugin or a Promtail/Filebeat sidecar at the same `json-file` logs - no app code
  changes needed, since logs are already structured JSON.

## 11. Monitoring

- Prometheus: `http://localhost:9090` (scrapes the app's `/api/metrics`, node-exporter, cAdvisor,
  postgres-exporter - check `/targets` to confirm all are `UP`).
- Grafana: `http://localhost:3000`, login `admin` / `GRAFANA_ADMIN_PASSWORD` (from `.env.local`,
  **change this on first login**). Prometheus is pre-wired as the default datasource, and a
  starter "Tejoma - Overview" dashboard (HTTP rate/latency, container CPU/memory, event loop lag,
  Postgres up) is provisioned automatically.
- The app's own metrics come from `src/utils/metrics.ts` (`prom-client`) - default Node process
  metrics plus `http_requests_total`/`http_request_duration_seconds` histograms, exposed
  unauthenticated at `/api/metrics` (Prometheus convention), reachable only inside the Docker
  network, not routed through Nginx.

## 12. Backup & Restore

- **Backup**: `bash scripts/backup-db.sh` - unchanged from before this phase, still runs against
  native Postgres via `.env.local`. Writes `backups/<db>_<timestamp>.sql.gz`, prunes anything
  older than 14 days.
- **Verify**: `bash scripts/verify-backup.sh backups/<file>.sql.gz` - fast gzip-integrity + "does
  it actually contain table data" check. For anything critical, the authoritative check is a real
  test restore (below) against a throwaway database.
- **Restore**: `bash scripts/restore-db.sh backups/<file>.sql.gz` - asks you to type the target
  database name to confirm before overwriting it (`--yes` to skip, e.g. in a scripted DR drill).
- **Scheduling**: `scripts/backup-db.sh`'s own header comments document both a cron line (Linux)
  and a Windows Task Scheduler setup (this machine, today) - point either at
  `scripts/backup-db.sh` on a daily schedule.

## 13. Rollback Procedure

1. `docker compose down` (stops all containers; add `-v` only if you intentionally want to wipe
   the trained-ML-model volume too - Postgres data is untouched either way since it's native).
2. Roll back the code: `git checkout <previous-good-commit-or-tag>`.
3. `docker compose build && docker compose up -d`.
4. If the issue was data corruption (not just a bad deploy), restore the last verified backup:
   `bash scripts/restore-db.sh backups/<last-good>.sql.gz`.
5. Confirm via `curl -k https://localhost/api/health` and a manual login before considering the
   rollback complete.

## 14. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `app` never becomes healthy | Can't reach Postgres | Confirm `DB_HOST=host.docker.internal` resolves (Docker Desktop does this automatically; on Linux confirm `extra_hosts: host-gateway` took effect), and that Postgres accepts connections from Docker's network range, not just `localhost` (check `pg_hba.conf`/`postgresql.conf` `listen_addresses`). |
| `jd-nlp-service`/`matching-ml-service` never healthy | Model download failed at build, or slow first boot | Check `docker compose logs jd-nlp-service` - a build-time `spacy download` failure needs a rebuild; a slow-but-eventually-healthy service just needs the `start_period` in its healthcheck to elapse (30s). |
| 502/504 through Nginx | `app` container down or still starting | `docker compose ps`, `docker compose logs app`. Nginx's own `depends_on: condition: service_healthy` should prevent routing to a not-yet-ready app, but a mid-session crash can still surface as a transient 502 until the restart policy kicks back in. |
| Browser cert warning | Using the self-signed dev cert | Expected until a real Let's Encrypt cert is issued (see ยง6) - not a bug. |
| Cookies not sticking / login loops | `FRONTEND_URL` mismatch, or `NODE_ENV` not `production` | Cookies are marked `Secure` only when `NODE_ENV=production` - confirm it's set, and that `FRONTEND_URL` exactly matches the origin you're accessing the app from (including scheme). |
| Prometheus target `DOWN` | Wrong internal DNS name or service not started | Compare `monitoring/prometheus.yml` target names against the actual service names in `docker-compose.yml` - they must match Compose's service names exactly. |
