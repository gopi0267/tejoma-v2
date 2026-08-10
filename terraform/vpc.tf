# Uses the community terraform-aws-modules/vpc/aws module rather than hand-rolled subnet/route-
# table/NAT resources - EKS and the AWS Load Balancer Controller both have specific subnet tagging
# requirements (kubernetes.io/role/elb, kubernetes.io/role/internal-elb,
# kubernetes.io/cluster/<name>) that are easy to get subtly wrong by hand and hard to catch without
# actually applying. This module is the de facto standard for exactly this use case.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs          = slice(data.aws_availability_zones.available.names, 0, var.availability_zone_count)
  cluster_name = "${var.project}-${var.environment}"
  name_prefix  = "${var.project}-${var.environment}"
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.13"

  name = "${local.name_prefix}-vpc"
  cidr = var.vpc_cidr

  azs             = local.azs
  private_subnets = [for i, az in local.azs : cidrsubnet(var.vpc_cidr, 4, i)]
  public_subnets  = [for i, az in local.azs : cidrsubnet(var.vpc_cidr, 4, i + 8)]

  enable_nat_gateway     = true
  single_nat_gateway     = var.single_nat_gateway
  one_nat_gateway_per_az = !var.single_nat_gateway

  enable_dns_hostnames = true
  enable_dns_support   = true

  # Required for the AWS Load Balancer Controller to auto-discover which subnets to place an ALB
  # into, and for EKS itself to know which subnets belong to this cluster.
  public_subnet_tags = {
    "kubernetes.io/role/elb"                      = "1"
    "kubernetes.io/cluster/${local.cluster_name}" = "shared"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb"             = "1"
    "kubernetes.io/cluster/${local.cluster_name}" = "shared"
  }
}
