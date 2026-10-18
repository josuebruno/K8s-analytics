#!/usr/bin/env bash
set -euo pipefail

ARQUIVO="/opt/analytics/k8s/individual-reconciler-cronjob.yaml"
BACKUP="${ARQUIVO}.bak.$(date +%Y%m%d-%H%M%S)"

echo "=== Backup do manifesto ==="
cp -a "$ARQUIVO" "$BACKUP"

echo "=== Obtendo configurações da API ==="

kubectl get deployment analytics-api \
  -n analytics-system \
  -o json > /tmp/analytics-api-deployment.json

echo "=== Atualizando manifesto completo ==="

python3 - <<'PY'
import json
from pathlib import Path

deployment = json.loads(
    Path("/tmp/analytics-api-deployment.json").read_text()
)

containers = deployment["spec"]["template"]["spec"]["containers"]

api = next(
    (c for c in containers if c["name"] == "api"),
    containers[0]
)

env = api.get("env", [])
env_from = api.get("envFrom", [])

manifest = {
    "apiVersion": "batch/v1",
    "kind": "CronJob",
    "metadata": {
        "name": "analytics-individual-reconciler",
        "namespace": "analytics-system",
        "labels": {
            "app": "analytics-individual-reconciler",
            "component": "job-monitoring",
        },
    },
    "spec": {
        "schedule": "* * * * *",
        "suspend": True,
        "concurrencyPolicy": "Forbid",
        "startingDeadlineSeconds": 50,
        "successfulJobsHistoryLimit": 3,
        "failedJobsHistoryLimit": 3,
        "jobTemplate": {
            "spec": {
                "backoffLimit": 0,
                "activeDeadlineSeconds": 240,
                "ttlSecondsAfterFinished": 600,
                "template": {
                    "metadata": {
                        "labels": {
                            "app": "analytics-individual-reconciler"
                        }
                    },
                    "spec": {
                        "serviceAccountName": "analytics-api",
                        "restartPolicy": "Never",
                        "nodeSelector": {
                            "analytics-worker": "true"
                        },
                        "imagePullSecrets": [
                            {"name": "harbor-analytics"}
                        ],
                        "containers": [
                            {
                                "name": "reconciler",
                                "image": (
                                    "harbor.ipea.gov.br/"
                                    "desenvolvimento/analytics-api:2.6"
                                ),
                                "imagePullPolicy": "IfNotPresent",
                                "command": ["/bin/sh", "-ec"],
                                "args": [
                                    """mkdir -p /root/.kube

cat > /root/.kube/config <<KCFG
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
    server: https://${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT_HTTPS}
  name: in-cluster
contexts:
- context:
    cluster: in-cluster
    namespace: analytics-jobs
    user: serviceaccount
  name: in-cluster
current-context: in-cluster
users:
- name: serviceaccount
  user:
    tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token
KCFG

exec python /app/individual_reconciler.py --max-runs 100
"""
                                ],
                                "env": env,
                                "envFrom": env_from,
                                "resources": {
                                    "requests": {
                                        "cpu": "100m",
                                        "memory": "128Mi",
                                    },
                                    "limits": {
                                        "cpu": "500m",
                                        "memory": "512Mi",
                                    },
                                },
                                "volumeMounts": [
                                    {
                                        "name": "shared-data",
                                        "mountPath": "/shared",
                                    }
                                ],
                            }
                        ],
                        "volumes": [
                            {
                                "name": "shared-data",
                                "persistentVolumeClaim": {
                                    "claimName": "analytics-shared-pvc"
                                },
                            }
                        ],
                    },
                },
            },
        },
    },
}

Path(
    "/opt/analytics/k8s/individual-reconciler-cronjob.yaml"
).write_text(
    json.dumps(manifest, indent=2) + "\n"
)

print("Manifesto completo atualizado.")
print("Variáveis diretas reaproveitadas:", len(env))
print("Referências envFrom reaproveitadas:", len(env_from))
PY

rm -f /tmp/analytics-api-deployment.json

echo "=== Validação Kubernetes ==="

kubectl apply --dry-run=client \
  -f "$ARQUIVO"

echo "=== Aplicando configuração ==="

kubectl apply -f "$ARQUIVO"

echo "=== Estado do CronJob ==="

kubectl get cronjob analytics-individual-reconciler \
  -n analytics-system

echo
echo "Correção aplicada."
echo "Backup: $BACKUP"
echo "CronJob permanece suspenso para validação."
