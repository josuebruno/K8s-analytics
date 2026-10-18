#!/usr/bin/env bash
set -euo pipefail

BASE="/opt/analytics"
PACOTE="/tmp/analytics-async-individual-v2.5.tar.gz"
BACKUP="/root/analytics-async-v25-backup-$(date +%Y%m%d-%H%M%S)"

echo "========================================="
echo " ANALYTICS API 2.5 - EXECUCAO ASSINCRONA"
echo "========================================="

echo "[1/6] Verificando pacote"

test -f "$PACOTE"
tar -tzf "$PACOTE"

echo "[2/6] Criando backup"

mkdir -p "$BACKUP/api" "$BACKUP/frontend-react/src"

cp -a "$BASE/api/main.py" \
  "$BACKUP/api/main.py"

cp -a "$BASE/api/run-python-job-v2.sh" \
  "$BACKUP/api/run-python-job-v2.sh"

cp -a "$BASE/api/run-r-job-v1.sh" \
  "$BACKUP/api/run-r-job-v1.sh"

cp -a "$BASE/frontend-react/src/App.jsx" \
  "$BACKUP/frontend-react/src/App.jsx"

echo "Backup: $BACKUP"

echo "[3/6] Instalando arquivos"

tar -xzf "$PACOTE" -C "$BASE" \
  api/main.py \
  api/run-python-job-v2.sh \
  api/run-r-job-v1.sh \
  frontend-react/src/App.jsx

chmod +x \
  "$BASE/api/run-python-job-v2.sh" \
  "$BASE/api/run-r-job-v1.sh"

echo "[4/6] Validando Python"

python3 -m py_compile "$BASE/api/main.py"

echo "[5/6] Validando Shell"

bash -n "$BASE/api/run-python-job-v2.sh"
bash -n "$BASE/api/run-r-job-v1.sh"

echo "[6/6] Conferindo endpoints"

grep -nE \
  '/run/python/async|/run/r/async|/job-runs/\{run_id\}/status' \
  "$BASE/api/main.py"

echo
echo "========================================="
echo " INSTALACAO CONCLUIDA"
echo "========================================="
echo "Backup: $BACKUP"
echo
echo "Nenhum Deployment Kubernetes foi alterado."
echo "Nenhuma imagem foi publicada."
