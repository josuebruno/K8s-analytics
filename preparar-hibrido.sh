#!/usr/bin/env bash
set -euo pipefail

BASE="/opt/analytics"
DATA="$(date +%Y%m%d-%H%M%S)"
BACKUP="/root/analytics-hibrido-backup-${DATA}"
RELATORIO="/tmp/analytics-hibrido-auditoria.txt"

echo "============================================"
echo " ANALYTICS - PREPARACAO PYTHON + R"
echo "============================================"

mkdir -p "$BACKUP"

echo "[1/5] Salvando backups..."

cp -a "$BASE/frontend-react/src/App.jsx" "$BACKUP/"
cp -a "$BASE/api/main.py" "$BACKUP/"
cp -a "$BASE/api/run-python-job-v2.sh" "$BACKUP/"
cp -a "$BASE/api/run-r-job-v1.sh" "$BACKUP/"

echo "Backup: $BACKUP"

echo "[2/5] Validando arquivos..."

for file in \
    "$BASE/frontend-react/src/App.jsx" \
    "$BASE/api/main.py" \
    "$BASE/api/run-python-job-v2.sh" \
    "$BASE/api/run-r-job-v1.sh"; do

    test -f "$file" || {
        echo "ERRO: arquivo ausente: $file"
        exit 1
    }

    echo "OK: $file"
done

echo "[3/5] Validando sintaxe dos scripts..."

bash -n "$BASE/api/run-python-job-v2.sh"
bash -n "$BASE/api/run-r-job-v1.sh"

python3 -m py_compile "$BASE/api/main.py"

echo "[4/5] Coletando pontos de integracao..."

{
    echo "============================================"
    echo " REACT - ESTADO E SELECAO DE LINGUAGEM"
    echo "============================================"

    sed -n '190,220p' "$BASE/frontend-react/src/App.jsx"
    sed -n '310,335p' "$BASE/frontend-react/src/App.jsx"
    sed -n '490,530p' "$BASE/frontend-react/src/App.jsx"

    echo
    echo "============================================"
    echo " REACT - EXECUCAO"
    echo "============================================"

    sed -n '800,970p' "$BASE/frontend-react/src/App.jsx"

    echo
    echo "============================================"
    echo " REACT - EDITOR"
    echo "============================================"

    sed -n '1390,1470p' "$BASE/frontend-react/src/App.jsx"

    echo
    echo "============================================"
    echo " API - CRIACAO DOS JOBS"
    echo "============================================"

    sed -n '560,710p' "$BASE/api/main.py"

    echo
    echo "============================================"
    echo " API - ENDPOINTS"
    echo "============================================"

    sed -n '1190,1280p' "$BASE/api/main.py"

    echo
    echo "============================================"
    echo " WORKERS - PARAMETROS"
    echo "============================================"

    grep -nE \
      'WORKER_|SHARED_|JOB_|NAMESPACE|OUTPUT|CODE_FILE|imagePullSecrets|nodeSelector|volumeMounts|persistentVolumeClaim' \
      "$BASE/api/run-python-job-v2.sh" \
      "$BASE/api/run-r-job-v1.sh" || true

} > "$RELATORIO"

chmod 600 "$RELATORIO"

echo "[5/5] Preparacao concluida."
echo
echo "Relatorio: $RELATORIO"
echo "Backup:    $BACKUP"
echo
echo "ATENCAO:"
echo "- Nenhum Deployment foi modificado."
echo "- Nenhuma imagem foi reconstruida."
echo "- Nenhum Job foi criado."
echo "- Revise o relatorio antes de compartilha-lo."
