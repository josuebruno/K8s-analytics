Analytics Admin UI v3.3
========================
O pacote substitui SOMENTE frontend-react/src/App.jsx, AdminDashboard.jsx e AdminDashboard.css.
A API e o Workspace permanecem funcionalmente preservados.

Instalação na masterlab01:
  mkdir -p /opt/analytics/admin-ui-v33
  tar -xzf /tmp/analytics-admin-ui-v33.tar.gz -C /opt/analytics/admin-ui-v33
  /opt/analytics/admin-ui-v33/install-admin-ui-v33.sh

O instalador valida SHA256 dos arquivos previamente compartilhados, faz backup em /root,
executa npm run build e restaura backup caso a compilação falhe.

Publicação APÓS build:
  cd /opt/analytics
  podman build -t harbor.ipea.gov.br/desenvolvimento/analytics-frontend-modern:3.3 -f frontend-react/Dockerfile frontend-react
  podman push harbor.ipea.gov.br/desenvolvimento/analytics-frontend-modern:3.3
  kubectl set image deployment/analytics-frontend-modern frontend=harbor.ipea.gov.br/desenvolvimento/analytics-frontend-modern:3.3 -n analytics-system
  kubectl rollout status deployment/analytics-frontend-modern -n analytics-system --timeout=180s

Rollback da imagem anterior:
  kubectl rollout undo deployment/analytics-frontend-modern -n analytics-system

Métricas CPU/RAM reais exigem Metrics API. As abas futuras estão intencionalmente desabilitadas.
