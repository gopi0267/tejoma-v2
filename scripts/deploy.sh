#!/bin/bash
# Tejoma Kubernetes Deployment Script
# Deploys microservices stack with cutover flag management

set -euo pipefail

# Configuration
NAMESPACE="tejoma"
REGISTRY="${REGISTRY:-tejoma}"
ENVIRONMENT="${ENVIRONMENT:-production}"
CUTOVER_PHASE="${CUTOVER_PHASE:-1}"  # 1=canary, 2=25%, 3=50%, 4=100%

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Logging functions
log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
  log_info "Checking prerequisites..."

  if ! command -v kubectl &> /dev/null; then
    log_error "kubectl not found. Install kubectl and try again."
    exit 1
  fi

  if ! command -v kustomize &> /dev/null; then
    log_error "kustomize not found. Install kustomize and try again."
    exit 1
  fi

  if ! kubectl cluster-info &> /dev/null; then
    log_error "Cannot connect to Kubernetes cluster."
    exit 1
  fi

  log_info "✅ Prerequisites OK"
}

# Create namespace
create_namespace() {
  log_info "Creating/verifying namespace: $NAMESPACE"
  kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -
}

# Create secrets
create_secrets() {
  log_info "Creating secrets..."

  # These should come from secure sources (Vault, AWS Secrets, etc.)
  # This is a template - replace with actual secret values

  kubectl create secret generic tejoma-secrets \
    --from-literal=db-password="${DB_PASSWORD:-changeme}" \
    --from-literal=jwt-secret="${JWT_SECRET:-dev-secret}" \
    --from-literal=gemini-api-key="${GEMINI_API_KEY:-}" \
    --namespace=$NAMESPACE \
    --dry-run=client -o yaml | kubectl apply -f -
}

# Set cutover flags based on phase
set_cutover_flags() {
  log_info "Setting cutover flags for phase: $CUTOVER_PHASE"

  case $CUTOVER_PHASE in
    1)
      # Canary: All flags disabled (monolith fallback)
      CAREER_TRAJ_CUTOVER="false"
      REASONING_CUTOVER="false"
      RAG_CUTOVER="false"
      log_info "Phase 1 (Canary): All cutover flags DISABLED"
      ;;
    2)
      # 25% traffic: Enable career trajectories
      CAREER_TRAJ_CUTOVER="true"
      REASONING_CUTOVER="false"
      RAG_CUTOVER="false"
      log_info "Phase 2 (25%): Career trajectories cutover ENABLED"
      ;;
    3)
      # 50% traffic: Enable reasoning
      CAREER_TRAJ_CUTOVER="true"
      REASONING_CUTOVER="true"
      RAG_CUTOVER="false"
      log_info "Phase 3 (50%): Reasoning cutover ENABLED"
      ;;
    4)
      # 100% traffic: Enable RAG
      CAREER_TRAJ_CUTOVER="true"
      REASONING_CUTOVER="true"
      RAG_CUTOVER="true"
      log_info "Phase 4 (100%): RAG cutover ENABLED"
      ;;
    *)
      log_error "Invalid cutover phase: $CUTOVER_PHASE"
      exit 1
      ;;
  esac
}

# Update configmap with current flags
update_configmap() {
  log_info "Updating ConfigMap with cutover flags..."

  kubectl patch configmap tejoma-config \
    -n $NAMESPACE \
    -p "{\"data\": {
      \"CAREER_TRAJECTORIES_CUTOVER_ENABLED\": \"${CAREER_TRAJ_CUTOVER}\",
      \"REASONING_CONCLUSIONS_CUTOVER_ENABLED\": \"${REASONING_CUTOVER}\",
      \"RAG_INDEXING_CUTOVER_ENABLED\": \"${RAG_CUTOVER}\"
    }}" || log_warn "ConfigMap update failed - may not exist yet"
}

# Deploy services
deploy_services() {
  log_info "Deploying services..."

  # Use kustomize to deploy
  kustomize build k8s | kubectl apply -f -

  log_info "Services deployed"
}

# Wait for services to be ready
wait_for_readiness() {
  log_info "Waiting for services to be ready..."

  kubectl wait --for=condition=available --timeout=5m \
    deployment --all -n $NAMESPACE || {
    log_warn "Some deployments not ready yet - checking status..."
    kubectl get deployments -n $NAMESPACE
  }
}

# Verify deployment
verify_deployment() {
  log_info "Verifying deployment..."

  log_info "Pods:"
  kubectl get pods -n $NAMESPACE --no-headers | wc -l

  log_info "Services:"
  kubectl get services -n $NAMESPACE --no-headers | wc -l

  log_info "Checking endpoint health..."
  kubectl get endpoints -n $NAMESPACE

  log_info "✅ Deployment verified"
}

# Show deployment status
show_status() {
  log_info "Deployment status:"
  echo ""
  kubectl get deployments -n $NAMESPACE -o wide
  echo ""
  kubectl get services -n $NAMESPACE -o wide
  echo ""
  kubectl get pods -n $NAMESPACE -o wide
}

# Main deployment flow
main() {
  log_info "Starting Tejoma deployment (Phase: $CUTOVER_PHASE, Environment: $ENVIRONMENT)"

  check_prerequisites
  create_namespace
  create_secrets
  set_cutover_flags
  update_configmap
  deploy_services
  wait_for_readiness
  verify_deployment
  show_status

  log_info "✅ Deployment complete!"
  log_info "Monitor with: kubectl logs -f deployment/SERVICE_NAME -n $NAMESPACE"
}

# Run main
main "$@"
