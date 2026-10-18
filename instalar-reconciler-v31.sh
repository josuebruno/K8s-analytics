#!/usr/bin/env bash
set -euo pipefail

BASE="/opt/analytics"
PACOTE="/tmp/analytics-hybrid-reconciler-v3.1.tar.gz"
BACKUP="/root/analytics-reconciler-backup-$(date +%Y%m%d-%H%M%S)"

echo "=== Validando pacote ==="
test -f "$PACOTE"
tar -tzf "$PACOTE"

echo "=== Criando backup ==="
mkdir -p "$BACKUP" "$BASE/k8s"

cp -a "$BASE/api/hybrid_runner.py" "$BACKUP/"

echo "=== Instalando ==="
tar -xzf "$PACOTE" -C "$BASE" \
  api/hybrid_runner.py \
  k8s/hybrid-reconciler-cronjob.yaml

echo "=== Validando Python ==="
python3 -m py_compile "$BASE/api/hybrid_runner.py"

echo "=== Validando Kubernetes ==="
kubectl apply --dry-run=client \
  -f "$BASE/k8s/hybrid-reconciler-cronjob.yaml"

echo
echo "Instalacao dos arquivos concluida."
echo "Backup: $BACKUP"
echo "Nenhum recurso Kubernetes foi alterado."
