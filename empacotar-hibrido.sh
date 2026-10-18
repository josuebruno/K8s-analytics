#!/usr/bin/env bash
set -euo pipefail

cd /opt/analytics

PACOTE="/tmp/analytics-codigo-hibrido.tar.gz"

tar -czf "$PACOTE" \
  frontend-react/src/App.jsx \
  frontend-react/src/index.css \
  frontend-react/package.json \
  frontend-react/Dockerfile \
  api/main.py \
  api/requirements.txt \
  api/Dockerfile \
  api/run-python-job-v2.sh \
  api/run-r-job-v1.sh

echo "Pacote criado:"
ls -lh "$PACOTE"

echo
echo "Arquivos incluídos:"
tar -tzf "$PACOTE"

echo
echo "Nenhum arquivo .env ou Secret Kubernetes foi incluído."
echo "Revise o pacote antes de compartilhá-lo."
