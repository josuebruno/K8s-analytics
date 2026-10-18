#!/usr/bin/env bash
set -euo pipefail
BASE=/opt/analytics
SOURCE="$(cd "$(dirname "$0")" && pwd)"
DEST="$BASE/frontend-react/src"
BACKUP="/root/analytics-admin-ui-backup-$(date +%Y%m%d-%H%M%S)"
for f in App.jsx AdminDashboard.jsx AdminDashboard.css; do
  test -f "$SOURCE/frontend-react/src/$f" || { echo "Pacote incompleto: $f"; exit 1; }
  test -f "$DEST/$f" || { echo "Arquivo local ausente: $f"; exit 1; }
done
python3 - "$DEST" <<'PY'
import hashlib,sys
from pathlib import Path
p=Path(sys.argv[1]); expected={
 'App.jsx':'2c53ea11092b1e7ab86f003900e0ec698aa798c214bba31c263aa85dc7dc815a',
 'AdminDashboard.jsx':'5698338ee3d384a8c5ff6446db301576816d9858452b9b46cc53fd63a364be75',
 'AdminDashboard.css':'c04929d45a847677061bb3d0f4898b4d33db83364139e8c72f9c92c5d0adc1d0',
}
for name,hashvalue in expected.items():
 actual=hashlib.sha256((p/name).read_bytes()).hexdigest()
 if actual!=hashvalue:
  sys.exit(f'PARADA DE SEGURANCA: {name} foi modificado. Esperado={hashvalue} Encontrado={actual}')
print('Arquivos atuais verificados.')
PY
mkdir -p "$BACKUP"
for f in App.jsx AdminDashboard.jsx AdminDashboard.css; do cp -a "$DEST/$f" "$BACKUP/$f"; done
restore(){ echo 'Restaurando backup após erro...'; for f in App.jsx AdminDashboard.jsx AdminDashboard.css; do cp -a "$BACKUP/$f" "$DEST/$f"; done; }
trap restore ERR
for f in App.jsx AdminDashboard.jsx AdminDashboard.css; do cp "$SOURCE/frontend-react/src/$f" "$DEST/$f"; done
cd "$BASE/frontend-react"
npm run build
trap - ERR
echo "SUCESSO. Backup: $BACKUP"
echo 'Nenhum Deployment ou imagem foi alterado.'
