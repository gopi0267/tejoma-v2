variable "aws_region" {
  description = "AWS region. ap-south-1 (Mumbai) per the user's existing infrastructure."
  type        = string
  default     = "ap-south-1"
}

variable "project" {
  description = "Short name used as a prefix on every resource this configuration creates."
  type        = string
  default     = "tejoma"
}

variable "environment" {
  description = "Environment name (e.g. production, staging) - included in resource names/tags."
  type        = string
  default     = "production"
}

# ==================== VPC ====================

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zone_count" {
  description = "Number of AZs to spread subnets across. 2 is the minimum for a genuinely HA EKS control plane and RDS Multi-AZ; ap-south-1 has 3 AZs available."
  type        = number
  default     = 2
}

variable "single_nat_gateway" {
  description = <<-EOT
    true (default): one NAT Gateway total, shared by every private subnet - the single largest
    recurring cost line in a typical VPC (~$32/month per NAT Gateway in ap-south-1, before data
    transfer), so this defaults to the cost-conscious option while remaining genuinely usable in
    production (all outbound traffic just funnels through one AZ's NAT - a real but limited
    availability trade-off, not a correctness issue).
    false: one NAT Gateway per AZ (full HA - a NAT Gateway failure in one AZ doesn't affect
    others). Flip this later without changing anything else - see README.md.
  EOT
  type        = bool
  default     = true
}

# ==================== EKS ====================

variable "kubernetes_version" {
  description = "EKS Kubernetes version."
  type        = string
  default     = "1.30"
}

variable "node_instance_types" {
  description = "EC2 instance type(s) for the EKS managed node group."
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_group_min_size" {
  type    = number
  default = 2
}

variable "node_group_max_size" {
  type    = number
  default = 4
}

variable "node_group_desired_size" {
  type    = number
  default = 2
}

# ==================== RDS ====================

variable "db_instance_class" {
  description = "Instance class for the Tier 0 services' shared RDS PostgreSQL instance."
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "db_engine_version" {
  description = "PostgreSQL major.minor version - match whatever the monolith's own native Postgres runs (see DEPLOYMENT.md) so behavior is identical."
  type        = string
  default     = "16.4"
}

variable "db_multi_az" {
  description = <<-EOT
    false (default): single-AZ RDS - roughly half the cost of Multi-AZ, appropriate while this is
    still a small system with a documented, tested rollback procedure (MIGRATION_RUNBOOK.md §4)
    for exactly the "primary went down" scenario. true: Multi-AZ automatic failover - flip this
    later with zero application changes once real traffic volume justifies the added cost.
  EOT
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  type    = number
  default = 7
}

# This IS meant to be supplied via -var or TF_VAR_db_master_password at apply time (or better, a
# Terraform Cloud/CI secret), never committed to a .tfvars file in this repository.
variable "db_master_password" {
  description = "Master password for the RDS instance. Supply via TF_VAR_db_master_password, never in a committed file."
  type        = string
  sensitive   = true
}

# ==================== GitHub OIDC (for CI/CD - see terraform/github-oidc.tf and ../.github/workflows/) ====================

variable "github_repository" {
  description = "GitHub repo in \"owner/name\" form, for the OIDC trust policy that lets GitHub Actions assume an AWS role without long-lived access keys."
  type        = string
  default     = ""
}
