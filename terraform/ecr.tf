locals {
  service_names = [
    "identity-service",
    "platform-governance-service",
    "tenant-directory-service",
    "api-gateway",
    "jd-parser-service",
    "candidate-service",
    "chat-service",
    "resume-service",
    "recruiting-service",
    "analytics-service",
    "matching-evaluation-service",
    "matching-reasoning-service",
    "matching-skill-discovery-service",
    "matching-bge-shadow-service",
    "role-intelligence-service",
    "career-intelligence-service",
    "dynamic-weighting-service",
    "job-service",
    "candidate-core-service",
    "matching-decision-service",
    "matching-scoring-service",
  ]
}

resource "aws_ecr_repository" "services" {
  for_each = toset(local.service_names)

  name                 = "${var.project}-${each.value}"
  image_tag_mutability = "IMMUTABLE" # a given tag (git SHA) always refers to the same image - never silently overwritten

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "services" {
  for_each   = aws_ecr_repository.services
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the last 20 images - enough history for a rollback without unbounded storage growth."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 20
        }
        action = { type = "expire" }
      }
    ]
  })
}
