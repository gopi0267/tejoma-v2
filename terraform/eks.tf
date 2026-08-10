# Uses the community terraform-aws-modules/eks/aws module - same reasoning as vpc.tf: this module
# correctly wires the aws-auth ConfigMap, the OIDC provider (required for IRSA - see
# alb-controller.tf and github-oidc.tf), managed node group launch templates, and the cluster
# security group rules for control-plane-to-node communication (port 443/10250), all of which are
# easy to get subtly wrong by hand and hard to catch without actually applying.

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.24"

  cluster_name    = local.cluster_name
  cluster_version = var.kubernetes_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # The control plane API endpoint stays reachable from the public internet (kubectl from a
  # laptop) - this is a common, reasonable default for a system this size. Tightening to a
  # VPN/bastion-only private endpoint is a later hardening step that doesn't require touching
  # anything else here.
  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true

  enable_irsa = true

  # Modern EKS access-entry API (replacing the older aws-auth ConfigMap patching) - grants the
  # GitHub Actions OIDC role (github-oidc.tf) enough Kubernetes-level access to run `helm upgrade`
  # against this cluster's workloads. Empty when github_repository is unset (no role to grant).
  access_entries = var.github_repository == "" ? {} : {
    github_actions = {
      principal_arn = aws_iam_role.github_actions[0].arn
      policy_associations = {
        deploy = {
          policy_arn = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSEditPolicy"
          access_scope = {
            type = "cluster"
          }
        }
      }
    }
  }

  cluster_addons = {
    coredns            = { most_recent = true }
    kube-proxy         = { most_recent = true }
    vpc-cni            = { most_recent = true }
    aws-ebs-csi-driver = { most_recent = true }
  }

  eks_managed_node_groups = {
    default = {
      instance_types = var.node_instance_types
      min_size       = var.node_group_min_size
      max_size       = var.node_group_max_size
      desired_size   = var.node_group_desired_size

      # gp3 is cheaper and faster than the gp2 default for the same capacity.
      block_device_mappings = {
        xvda = {
          device_name = "/dev/xvda"
          ebs = {
            volume_size = 30
            volume_type = "gp3"
          }
        }
      }
    }
  }

  tags = {
    "kubernetes.io/cluster/${local.cluster_name}" = "owned"
  }
}
