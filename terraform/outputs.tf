output "cluster_name" {
  value = module.eks.cluster_name
}

output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "configure_kubectl" {
  description = "Run this after apply to point kubectl at the new cluster."
  value       = "aws eks update-kubeconfig --region ${var.aws_region} --name ${module.eks.cluster_name}"
}

output "ecr_repository_urls" {
  value = { for name, repo in aws_ecr_repository.services : name => repo.repository_url }
}

output "rds_endpoint" {
  description = "Connect and CREATE the two remaining logical databases (tejoma_tenant_directory, tejoma_platform_governance) - see README.md's post-apply steps."
  value       = aws_db_instance.tier0.address
  sensitive   = false
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "github_actions_role_arn" {
  description = "Set as AWS_ROLE_ARN in the GitHub Actions workflow (or a repo variable) - empty if github_repository was not set."
  value       = var.github_repository == "" ? null : aws_iam_role.github_actions[0].arn
}
