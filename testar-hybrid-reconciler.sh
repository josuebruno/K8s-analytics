#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="analytics-system"
JOB="analytics-hybrid-audit-$(date +%s)"

echo "=== Criando teste: $JOB ==="

kubectl create job \
  --from=cronjob/analytics-hybrid-reconciler \
  "$JOB" \
  -n "$NAMESPACE"

echo "=== Desabilitando TTL somente neste teste ==="

kubectl patch job "$JOB" \
  -n "$NAMESPACE" \
  --type=json \
  -p='[{"op":"remove","path":"/spec/ttlSecondsAfterFinished"}]'

echo "=== Aguardando conclusão ==="

if ! kubectl wait \
  --for=condition=complete \
  "job/$JOB" \
  -n "$NAMESPACE" \
  --timeout=180s
then
  echo "=== Diagnóstico do Job ==="

  kubectl describe job "$JOB" -n "$NAMESPACE"

  echo "=== Logs disponíveis ==="

  kubectl logs "job/$JOB" \
    -n "$NAMESPACE" \
    --all-containers=true \
    --tail=100 || true

  exit 1
fi

echo "=== Logs do reconciliador ==="

kubectl logs \
  "job/$JOB" \
  -n "$NAMESPACE" \
  --all-containers=true \
  --tail=100

echo "=== Resultado Kubernetes ==="

kubectl get job "$JOB" -n "$NAMESPACE"

echo
echo "Job de auditoria preservado: $JOB"
