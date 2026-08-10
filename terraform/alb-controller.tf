# The AWS Load Balancer Controller watches Ingress resources (api-gateway's, once
# helm/api-gateway/values.yaml's ingress.enabled is set - see MIGRATION_RUNBOOK.md §3) and
# provisions/manages the actual ALB. Two pieces: an IRSA role with the controller's IAM
# permissions, and the controller itself installed via Helm.
#
# Uses the community terraform-aws-modules/iam//modules/iam-role-for-service-accounts-eks module's
# built-in `load_balancer_controller` attachment for the IAM policy specifically, rather than
# hand-transcribing AWS's own ~1000-line published policy JSON for this controller - that policy
# is precise and easy to get subtly wrong (and silently break in ways that only surface when a
# real Ingress needs a permission the hand-copied version is missing) by hand-copying from memory.

module "alb_controller_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.44"

  role_name = "${local.name_prefix}-alb-controller"

  attach_load_balancer_controller_policy = true

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:aws-load-balancer-controller"]
    }
  }
}

resource "kubernetes_service_account" "alb_controller" {
  metadata {
    name      = "aws-load-balancer-controller"
    namespace = "kube-system"
    annotations = {
      "eks.amazonaws.com/role-arn" = module.alb_controller_irsa.iam_role_arn
    }
    labels = {
      "app.kubernetes.io/name"      = "aws-load-balancer-controller"
      "app.kubernetes.io/component" = "controller"
    }
  }

  depends_on = [module.eks]
}

resource "helm_release" "alb_controller" {
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  namespace  = "kube-system"
  version    = "1.8.1"

  set {
    name  = "clusterName"
    value = module.eks.cluster_name
  }
  set {
    name  = "serviceAccount.create"
    value = "false"
  }
  set {
    name  = "serviceAccount.name"
    value = kubernetes_service_account.alb_controller.metadata[0].name
  }
  set {
    name  = "region"
    value = var.aws_region
  }
  set {
    name  = "vpcId"
    value = module.vpc.vpc_id
  }

  depends_on = [kubernetes_service_account.alb_controller]
}
