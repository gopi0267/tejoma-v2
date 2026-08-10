# One shared RDS PostgreSQL instance hosting seventeen logically-separate databases
# (tejoma_identity, tejoma_tenant_directory, tejoma_platform_governance, tejoma_candidate,
# tejoma_chat, tejoma_recruiting_service, tejoma_matching_evaluation, tejoma_matching_reasoning,
# tejoma_matching_skill_discovery, tejoma_matching_bge_shadow, tejoma_role_intelligence,
# tejoma_career_intelligence, tejoma_dynamic_weighting, tejoma_job, tejoma_candidate_core,
# tejoma_matching_decision, tejoma_matching_scoring) - NOT one RDS instance per service.
# tejoma_candidate was added by Batch 16 (Candidate Service), tejoma_chat by Batch 17 (Chat
# Service), tejoma_recruiting_service by Batch 19 (Recruiting Service, deliberately NOT named
# tejoma_recruiting - that name already belongs to the monolith's own database, see rds.tf's
# "monolith's own database" note below), tejoma_matching_evaluation by Batch 24 (Matching
# Evaluation Service), tejoma_matching_reasoning by Batch 26 (Matching Reasoning Service),
# tejoma_matching_skill_discovery by Batch 27 (Matching Skill Discovery Service),
# tejoma_matching_bge_shadow by Batch 28 (Matching BGE Shadow Service), tejoma_role_intelligence by
# Batch 29 (Role Intelligence Service), tejoma_career_intelligence by Batch 30 (Career Intelligence
# Service), tejoma_dynamic_weighting by Batch 33 (Dynamic Weighting / Explainable Matching
# Service), tejoma_job, tejoma_candidate_core, and tejoma_matching_decision by the full-migration
# batch (Job Service, Candidate Core Service, Matching Decision Service), and tejoma_matching_scoring
# by the live-scoring-engine extraction batch (Matching Scoring Service, shadow-validation only -
# see that service's own README for why it doesn't yet serve real traffic) - same shared-instance/
# isolated-database trade-off as the original three, extended without changing the decision
# itself. Resume Service (Batch 18) and Analytics Service (Batch 22) have no database of their
# own, so neither ever appears in this list.
#
# This is a deliberate cost/architecture trade-off, flagged explicitly rather than silently
# decided: the migration's actual architectural requirement (Phase 3(database) section 4) is
# database-per-service ISOLATION - no service's code ever queries another's database, which is
# already 100% enforced at the application layer (every Tier 0 service's own db.ts only ever
# connects to its own DB_NAME; cross-service data access only ever happens via each other's
# internal HTTP APIs, verified throughout this whole series). A separate RDS INSTANCE per service
# would add genuine blast-radius isolation (one service's noisy-neighbor query load can't affect
# another's) on top of that, at roughly 3x-4x the RDS cost for a system that doesn't have that
# traffic problem yet. Splitting into separate instances later requires zero application code
# changes - just three new RDS instances and updating DB_HOST per service (the same "upgrade
# later without changing the architecture" principle applied elsewhere in this configuration -
# see variables.tf's db_multi_az/single_nat_gateway comments for the same shape of trade-off).
#
# The monolith's own database (tejoma_recruiting) is NOT part of this instance and is NOT
# migrated to RDS by this configuration - it stays on the existing EC2 host's native Postgres
# (DEPLOYMENT.md: "PostgreSQL stays native - not containerized"), untouched. That's a separate,
# larger, and far riskier undertaking explicitly out of scope here - this configuration only
# provisions NET NEW infrastructure for NET NEW data (the three Tier 0 databases), never touching
# the monolith's existing, working database.

resource "aws_db_subnet_group" "tier0" {
  name       = "${local.name_prefix}-tier0-db"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "tier0_db" {
  name        = "${local.name_prefix}-tier0-db"
  description = "Allows Postgres access from EKS nodes only"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Postgres from EKS worker nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "tier0" {
  identifier     = "${local.name_prefix}-tier0"
  engine         = "postgres"
  engine_version = var.db_engine_version

  instance_class    = var.db_instance_class
  allocated_storage = var.db_allocated_storage_gb
  storage_type      = "gp3"
  storage_encrypted = true

  db_subnet_group_name   = aws_db_subnet_group.tier0.name
  vpc_security_group_ids = [aws_security_group.tier0_db.id]
  multi_az               = var.db_multi_az
  publicly_accessible    = false

  # A real starting database is still required (RDS won't create zero databases) - this becomes
  # tejoma_identity; the other four (tejoma_tenant_directory, tejoma_platform_governance,
  # tejoma_candidate, tejoma_chat) are created by a one-time `CREATE DATABASE` against this
  # instance after it exists (see terraform/README.md's post-apply steps) - Terraform provisions
  # the server, not each logical database's schema, matching the same division of responsibility
  # as scripts/backfill-*.ts (Terraform/infra vs. application-level migration scripts, never
  # blurred).
  db_name  = "tejoma_identity"
  username = "tejoma_admin"
  password = var.db_master_password
  port     = 5432

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "17:00-18:00" # 22:30-23:30 IST, low-traffic window
  maintenance_window      = "sun:18:00-sun:19:00"

  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name_prefix}-tier0-final"
  deletion_protection       = true

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
}
