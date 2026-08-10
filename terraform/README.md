# Tier 0 AWS Infrastructure (Terraform)

**This has been written and validated (`terraform validate` passes), but has never been applied.**
No `terraform plan` or `terraform apply` has been run against any real AWS account, and none will
be run without you explicitly doing it yourself - this provisions real, billable AWS resources.

## What this creates

- A VPC (`vpc.tf`) with public + private subnets across 2 AZs in `ap-south-1`, one NAT Gateway by
  default (cost-conscious - see `variables.tf`'s `single_nat_gateway` comment).
- An EKS cluster (`eks.tf`) with a managed node group (2x `t3.medium` by default).
- One shared RDS PostgreSQL instance (`rds.tf`) for the DB-owning Tier 0 services' databases -
  **not** one instance per service, and **not** the monolith's own database. See that file's
  header comment for the full reasoning and the cost/isolation trade-off being made explicitly,
  not silently.
- 14 ECR repositories (`ecr.tf`), one per Tier 0 service (including api-gateway, which owns no
  database but still needs its own image).
- A GitHub Actions OIDC IAM role (`github-oidc.tf`) - no long-lived AWS keys in GitHub secrets.
- The AWS Load Balancer Controller (`alb-controller.tf`), installed but inert until
  `helm/api-gateway`'s `ingress.enabled` is turned on (that's the actual traffic-cutover action -
  see `../MIGRATION_RUNBOOK.md`).

## Estimated monthly cost (ap-south-1, as of writing - verify against current AWS pricing before committing)

| Resource | Est. $/month |
|---|---|
| EKS control plane | ~$73 |
| 2x t3.medium nodes (on-demand) | ~$60 |
| 1x NAT Gateway | ~$32 + data transfer |
| RDS db.t3.micro, single-AZ, 20GB gp3 | ~$15 |
| ALB (once ingress is enabled) | ~$16 + data transfer |
| ECR storage | ~$1-5 depending on image count/size |
| **Total, before data transfer** | **~$195-200/month** |

This is a genuine, non-trivial recurring cost - not a Free Tier deployment. That's a deliberate
choice per the standing instruction to build for long-term production readiness, not optimize
only for Free Tier. Every cost-sensitive default (NAT Gateway count, RDS Multi-AZ, instance sizes)
is a `variables.tf` flag specifically so it can be tuned up or down without touching any other
file - see each variable's own comment for the trade-off it represents.

## Before your first real apply

1. **Move state off your local disk.** No backend is configured (`versions.tf`'s comment) - add an
   S3 bucket + DynamoDB table for remote state with locking before this manages anything real.
   Losing local state for infrastructure this size is a real operational incident, not just an
   inconvenience.
2. **Set `db_master_password` via `TF_VAR_db_master_password`**, never in a `.tfvars` file (the
   variable is marked `sensitive`, but sensitive-in-Terraform still means "don't accidentally
   print it," not "safe to commit").
3. **Set `github_repository`** in your own `terraform.tfvars` (copy from
   `terraform.tfvars.example`) if you want the CI/CD OIDC role created.
4. Have real AWS credentials configured (`aws configure` / an SSO profile) - this configuration
   has never been run with real credentials, so `terraform plan` against your actual account is
   itself the first real test of it beyond `validate`. Read the plan output carefully before
   typing `yes`.

## After apply (one-time, manual)

RDS only creates the first database (`tejoma_identity`) - `CREATE DATABASE` the other fifteen
yourself once, against the new endpoint (`terraform output rds_endpoint`):

```sql
CREATE DATABASE tejoma_tenant_directory;
CREATE DATABASE tejoma_platform_governance;
CREATE DATABASE tejoma_candidate;
CREATE DATABASE tejoma_chat;
CREATE DATABASE tejoma_recruiting_service;
CREATE DATABASE tejoma_matching_evaluation;
CREATE DATABASE tejoma_matching_reasoning;
CREATE DATABASE tejoma_matching_skill_discovery;
CREATE DATABASE tejoma_matching_bge_shadow;
CREATE DATABASE tejoma_role_intelligence;
CREATE DATABASE tejoma_career_intelligence;
CREATE DATABASE tejoma_dynamic_weighting;
CREATE DATABASE tejoma_job;
CREATE DATABASE tejoma_candidate_core;
CREATE DATABASE tejoma_matching_decision;
```

Then run each service's own migration script (`<service>/scripts/migrate.ts`, then
`validate-schema.ts`) against its database, per `../helm/README.md`.

## What this deliberately does NOT do

- Touch the monolith's existing EC2/Docker Compose/native-Postgres setup at all (`rds.tf`'s header
  comment) - that stays exactly as `../DEPLOYMENT.md` describes it, untouched by this
  configuration.
- Configure Route53/ACM/a real domain - `helm/api-gateway/values.yaml`'s `ingress.host` and the
  ALB certificate ARN annotation stay empty until you have a real domain to point here.
- Enable the actual traffic cutover - that's `helm/api-gateway`'s `ingress.enabled` flag, a
  separate, deliberate, human-reviewed action per `../MIGRATION_RUNBOOK.md` §3, not something
  provisioning this infrastructure does on its own.
