#!/usr/bin/env bash
set -euo pipefail

JOB_BASE_NAME="${1:-analytics-r}"
DATA_FORMAT="${2:-}"
DATA_PATH="${3:-}"
OUTPUT_SUBDIR_BASE="${4:-manual-run-r}"
RAM_LIMIT_GB="${5:-2}"
CPUS="${6:-1}"
EPHEMERAL_STORAGE_GB="${7:-2}"
CODE_HOST_DIR="${8:-}"
CODE_ENTRY_FILE="${9:-main.R}"

SHARED_ROOT="${SHARED_ROOT:-/shared}"
CODE_ENTRY_FILE="${CODE_ENTRY_FILE#/}"

TS="$(date +%Y%m%d-%H%M%S)"
JOB_NAME="${JOB_BASE_NAME}-${TS}"
OUTPUT_SUBDIR="${OUTPUT_SUBDIR_BASE}-${TS}"

MANIFEST_DIR="/tmp/generated-jobs"
mkdir -p "${MANIFEST_DIR}"
mkdir -p "${SHARED_ROOT}/jobs/${OUTPUT_SUBDIR}"

MANIFEST_FILE="${MANIFEST_DIR}/${JOB_NAME}.yaml"

if [[ -n "${DATA_PATH}" ]]; then
  DATA_ARGS=$(cat <<ARGS
            - "--data-format"
            - "${DATA_FORMAT}"
            - "--data-path"
            - "${DATA_PATH}"
ARGS
)
  DATA_VOLUME_MOUNT=$(cat <<VOLM
            - name: shared-data
              mountPath: /data
              subPath: testdata
VOLM
)
else
  DATA_ARGS=""
  DATA_VOLUME_MOUNT=""
fi

if [[ -n "${CODE_HOST_DIR}" ]]; then
  CODE_ARGS=$(cat <<ARGS
            - "--code-file"
            - "${CODE_HOST_DIR}/${CODE_ENTRY_FILE}"
ARGS
)
else
  CODE_ARGS=""
fi

cat > "${MANIFEST_FILE}" <<YAML
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
  namespace: analytics-jobs
  labels:
    app: analytics-worker
    language: r
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 300
  template:
    metadata:
      labels:
        app: analytics-worker
        language: r
    spec:
      serviceAccountName: default
      restartPolicy: Never
      nodeSelector:
        analytics-worker: "true"
      containers:
        - name: worker
          image: localhost/analytics-worker-r:1.0
          imagePullPolicy: Never
          args:
${DATA_ARGS}
${CODE_ARGS}
            - "--ram-limit-gb"
            - "${RAM_LIMIT_GB}"
            - "--cpus"
            - "${CPUS}"
            - "--output-dir"
            - "${SHARED_ROOT}/jobs/${OUTPUT_SUBDIR}"
          resources:
            requests:
              cpu: "${CPUS}"
              memory: "${RAM_LIMIT_GB}Gi"
              ephemeral-storage: "${EPHEMERAL_STORAGE_GB}Gi"
            limits:
              cpu: "${CPUS}"
              memory: "${RAM_LIMIT_GB}Gi"
              ephemeral-storage: "${EPHEMERAL_STORAGE_GB}Gi"
          volumeMounts:
            - name: shared-data
              mountPath: ${SHARED_ROOT}
${DATA_VOLUME_MOUNT}
      volumes:
        - name: shared-data
          persistentVolumeClaim:
            claimName: analytics-shared-pvc
YAML

echo "Manifesto gerado em: ${MANIFEST_FILE}"
kubectl apply -f "${MANIFEST_FILE}"
echo "Job criado: ${JOB_NAME}"

kubectl wait --for=condition=complete --timeout=300s job/${JOB_NAME} -n analytics-jobs || true

echo
echo "Logs do job:"
kubectl logs -n analytics-jobs -l job-name=${JOB_NAME} || true

echo
echo "Resultado esperado em:"
echo "${SHARED_ROOT}/jobs/${OUTPUT_SUBDIR}/result.json"
