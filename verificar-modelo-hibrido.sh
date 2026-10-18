#!/usr/bin/env bash
set -euo pipefail

cd /opt/analytics

echo "===== MODELOS E ESTRUTURAS ====="

grep -nE \
'^class |^def |^async def |BaseModel|CREATE TABLE|job_runs|run_id|source_mode' \
api/main.py | head -120

echo
echo "===== ROTAS DE EXECUCAO ====="

grep -nE \
'@app.post|@app.get|run/python|run/r|rerun' \
api/main.py | tail -80

echo
echo "===== COMPONENTES FRONTEND ====="

grep -nE \
'function onLanguageChange|function .*Run|const .*Run|python\+r|setInlineCode|setStatusMessage' \
frontend-react/src/App.jsx

echo
echo "===== IMAGENS PUBLICADAS ====="

kubectl get deployment analytics-api \
  -n analytics-system \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'

kubectl get deployment analytics-frontend-modern \
  -n analytics-system \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
