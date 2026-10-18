#!/usr/bin/env bash
set -euo pipefail
BASE=/opt/analytics
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP="/root/analytics-admin-backup-$(date +%Y%m%d-%H%M%S)"
API_BASE_SHA=644d49eb5d419baf880b05cc1e2ad63fd928d459160ac9228e62c27b6f4c99df
FRONT_BASE_SHA=ff0869fc763b91b457c60349097848605cfd0af95440ab7cf640da9ff6d0705c
for path in "$BASE/api/main.py" "$BASE/frontend-react/src/App.jsx"; do
  test -f "$path" || { echo "Arquivo ausente: $path"; exit 1; }
done
if [[ $(sha256sum "$BASE/api/main.py" | awk '{print $1}') != "$API_BASE_SHA" ]]; then
  echo "ABORTADO: api/main.py diverge da API 2.5 analisada. Nenhum arquivo alterado."; exit 1
fi
if [[ $(sha256sum "$BASE/frontend-react/src/App.jsx" | awk '{print $1}') != "$FRONT_BASE_SHA" ]]; then
  echo "ABORTADO: App.jsx diverge do frontend 3.1 analisado. Nenhum arquivo alterado."; exit 1
fi
for path in "$BASE/api/admin_routes.py" "$BASE/frontend-react/src/AdminDashboard.jsx" "$BASE/frontend-react/src/AdminDashboard.css"; do
  if [[ -e $path ]]; then echo "ABORTADO: arquivo já existente: $path"; exit 1; fi
done
mkdir -p "$BACKUP/api" "$BACKUP/frontend-react/src"
cp -a "$BASE/api/main.py" "$BACKUP/api/"
cp -a "$BASE/frontend-react/src/App.jsx" "$BACKUP/frontend-react/src/"
restore() {
  echo 'Erro na instalação. Restaurando arquivos existentes.'
  cp -a "$BACKUP/api/main.py" "$BASE/api/main.py"
  cp -a "$BACKUP/frontend-react/src/App.jsx" "$BASE/frontend-react/src/App.jsx"
  rm -f "$BASE/api/admin_routes.py" "$BASE/frontend-react/src/AdminDashboard.jsx" "$BASE/frontend-react/src/AdminDashboard.css"
}
trap restore ERR
cp "$HERE/api/main.py" "$BASE/api/main.py"
cp "$HERE/api/admin_routes.py" "$BASE/api/admin_routes.py"
cp "$HERE/frontend-react/src/"*.jsx "$BASE/frontend-react/src/"
cp "$HERE/frontend-react/src/AdminDashboard.css" "$BASE/frontend-react/src/"
python3 -m py_compile "$BASE/api/main.py" "$BASE/api/admin_routes.py"
(cd "$BASE/frontend-react" && npm run build)
trap - ERR
echo 'Instalação e build OK. Não houve alterações em Deployments nem push de imagens.'
echo "Backup: $BACKUP"
