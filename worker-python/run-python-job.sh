#!/usr/bin/env bash
set -euo pipefail

JOB_NAME="${1:-analytics-python-manual}"
DATA_FORMAT="${2:-csv}"
DATA_PATH="${3:-/data/clientes.csv}"
OUTPUT_SUBDIR="${4:-manual-run}"
RAM_LIMIT_GB="${5:-2}"
CPUS="${6:-1}"

MANIFEST_DIR="/opt/analytics/generated-jobs"
HOST_OUTPUT_BASE="/opt/analytics/k8s-output/jobs"
HOST_INPUT_BASE="/opt/analytics/testdata"

mkdir -p "${MANIFEST_DIR}"
mkdir -p "${HOST_OUTPUT_BASE}/${OUTPUT_SUBDIR}"

MANIFEST_FILE="${MANIFEST_DIR}/${JOB_NAME}.yaml"

cat > "${MANIFEST_FILE}" <<YAML
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
  namespace: analytics-jobs
  labels:
    app: analytics-worker
    language: python
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 300
  template:
    metadata:
      labels:
        app: analytics-worker
        language: python
    spec:
      serviceAccountName: default
      restartPolicy: Never
      nodeSelector:
        kubernetes.io/hostname: masterlab01
      tolerations:
        - key: "node-role.kubernetes.io/control-plane"
          operator: "Exists"
          effect: "NoSchedule"
        - key: "node-role.kubernetes.io/master"
          operator: "Exists"
          effect: "NoSchedule"
      containers:
        - name: worker
          image: localhost/analytics-worker-python:1.0
          imagePullPolicy: Never
          args:
            - "--data-format"
            - "${DATA_FORMAT}"
            - "--data-path"
            - "${DATA_PATH}"
            - "--ram-limit-gb"
            - "${RAM_LIMIT_GB}"
            - "--cpus"
            - "${CPUS}"
            - "--output-dir"
            - "/output"
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2"
              memory: "4Gi"
          volumeMounts:
            - name: input-data
              mountPath: /data
            - name: output-data
              mountPath: /output
      volumes:
        - name: input-data
          hostPath:
            path: ${HOST_INPUT_BASE}
            type: Directory
        - name: output-data
          hostPath:
            path: ${HOST_OUTPUT_BASE}/${OUTPUT_SUBDIR}
            type: DirectoryOrCreate
YAML

echo "Manifesto gerado em: ${MANIFEST_FILE}"
kubectl apply -f "${MANIFEST_FILE}"
echo "Job criado: ${JOB_NAME}"
