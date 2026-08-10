terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.31"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.14"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # Remote state is deliberately NOT configured here (no backend block = local state by default).
  # Before this is ever applied for real, configure an S3 backend with DynamoDB locking - local
  # state for infrastructure that costs real money and that a team depends on is itself a real
  # operational risk (lost laptop = lost state = Terraform no longer knows what it manages).
  # See README.md's "Before your first real apply" section.
}
