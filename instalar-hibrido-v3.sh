#!/usr/bin/env bash
set -euo pipefail

BASE="/opt/analytics"
PACOTE="/tmp/analytics-hibrido-v3.0.tar.gz"
BACKUP="/root/analytics-backup-hibrido-$(date +%Y%m%d-%H%M%S)"

echo "=== Validando pacote ==="
test -f "$PACOTE"

tar -tzf "$PACOTE"

echo "=== Criando backup ==="
mkdir -p "$BACKUP/api" "$BACKUP/frontend-react/src"

cp -a "$BASE/api/main.py" "$BACKUP/api/"
cp -a "$BASE/frontend-react/src/App.jsx" "$BACKUP/frontend-react/src/"

echo "=== Instalando arquivos ==="

tar -xzf "$PACOTE" -C "$BASE" \
  api/main.py \
  api/hybrid_runner.py \
  frontend-react/src/App.jsx

echo "=== Validando Python ==="

python3 -m py_compile \
  "$BASE/api/main.py" \
  "$BASE/api/hybrid_runner.py"

echo "=== Verificando endpoints ==="

grep -nE \
  '/run/hybrid|def run_hybrid|def hybrid_status' \
  "$BASE/api/main.py"

echo "=== Verificando frontend ==="

grep -nE \
  'hybridPythonCode|hybridRCode|hybridMode|/run/hybrid' \
  "$BASE/frontend-react/src/App.jsx"

echo
echo "Arquivos instalados."
echo "Backup: $BACKUP"
echo "Nenhum Deployment Kubernetes foi alterado."
