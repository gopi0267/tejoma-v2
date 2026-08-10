# Tier 0 Helm Charts

Four independent charts, one per Tier 0 service, matching the "each service is independently
deployable" principle this whole migration series has followed. There is deliberately no shared
library chart - see each chart's own comments and `identity-service/README.md`'s "monorepo
strategy" reasoning (Phase 9(domain analysis) section 4) for why duplication across four small
charts is the deliberate choice here, not an oversight.

| Chart | Owns a database | Public ingress |
|---|---|---|
| `identity-service` | yes (`tejoma_identity`) | no - internal only |
| `platform-governance-service` | yes (`tejoma_platform_governance`) | no - internal only |
| `tenant-directory-service` | yes (`tejoma_tenant_directory`) | no - internal only |
| `api-gateway` | no | yes (disabled by default - see below) |

## Namespace convention

All four charts assume a `tejoma` namespace and reference each other via
`<service>.tejoma.svc.cluster.local` in their default `values.yaml`. Create the namespace first:

```bash
kubectl create namespace tejoma
```

## Install order

Database-owning services first (so they're ready before anything calls them), API Gateway last:

```bash
helm install identity-service helm/identity-service -n tejoma -f <your-secrets-values>.yaml
helm install tenant-directory-service helm/tenant-directory-service -n tejoma -f <your-secrets-values>.yaml
helm install platform-governance-service helm/platform-governance-service -n tejoma -f <your-secrets-values>.yaml
helm install api-gateway helm/api-gateway -n tejoma
```

Before the *first* install of a database-owning chart against a fresh database, run that
service's own migration script out-of-band (`<service>/scripts/migrate.ts` then
`validate-schema.ts`) - these charts intentionally do not run migrations as part of `helm
install`/`upgrade` (running schema changes as a side effect of a rolling deployment, with no
separate approval step, is exactly the kind of implicit, unreviewed production action this whole
project has avoided throughout).

## Secrets

Every chart with a database follows the same pattern (see `identity-service/values.yaml`'s header
comment for the full explanation): either pass `secrets.*` values directly at install time, or
pre-populate a Kubernetes Secret out-of-band (ideally via the External Secrets Operator pulling
from AWS Secrets Manager, per Phase 5(infrastructure) sections 7/15's already-decided approach)
and point `existingSecret` at it. **Never commit real secret values into any values file in this
repository.**

## Going live (api-gateway's ingress)

`api-gateway`'s `ingress.enabled` defaults to `false`. Turning it on is the actual traffic-cutover
action described in `MIGRATION_RUNBOOK.md` §3 - do not set it to `true` until that runbook's §1
pre-cutover checklist has actually passed. The template refuses to render at all if
`ingress.enabled=true` with no `ingress.host` set, as a guard against enabling it accidentally
with an incomplete configuration.

## What these charts do NOT do

- Provision the underlying EKS cluster, RDS instances, ECR repositories, VPC, or IAM roles - see
  `terraform/` for that (written, not applied - see its own README for why).
- Run database migrations (see above).
- Configure DNS/ACM - `ingress.host` and the ALB certificate ARN annotation are left empty until a
  real domain exists.
