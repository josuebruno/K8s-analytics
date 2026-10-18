#!/usr/bin/env bash
set -euo pipefail

BASE="/opt/analytics"
PACOTE="/tmp/analytics-frontend-recovery-v3.1.tar.gz"
DESTINO="$BASE/frontend-react/src/App.jsx"
BACKUP="/root/analytics-frontend-recovery-$(date +%Y%m%d-%H%M%S)"

HASH_ESPERADO="99b7c3d965ba2746e27b1bab7a9dddf63b517be217f92247ddc480cf62389201"

echo "=== Validando pacote ==="
test -f "$PACOTE"
tar -tzf "$PACOTE"

echo "=== Verificando versão original ==="
HASH_ATUAL="$(sha256sum "$DESTINO" | awk '{print $1}')"

if [ "$HASH_ATUAL" != "$HASH_ESPERADO" ]; then
    echo "ATENCAO: App.jsx diferente da versão 3.0 analisada."
    echo "Instalação interrompida para preservar alterações locais."
    exit 1
fi

echo "=== Criando backup ==="
mkdir -p "$BACKUP"
cp -a "$DESTINO" "$BACKUP/App.jsx"

echo "=== Instalando App.jsx ==="
tar -xzf "$PACOTE" \
    -C "$BASE" \
    frontend-react/src/App.jsx

echo "=== Verificando implementação ==="
grep -nE \
'restoreRunningJob|followJobRun|option value="running"' \
"$DESTINO"

echo "=== Compilando frontend ==="
cd "$BASE/frontend-react"
npm run build

echo
echo "Instalação concluída."
echo "Backup: $BACKUP"
echo "Nenhum Deployment foi alterado."
