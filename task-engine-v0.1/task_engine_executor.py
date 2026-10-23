"""
Analytics Task Engine v0.1
Dispatcher Kubernetes - gerador de manifests.

Modo atual:
- Gera Kubernetes Job para Python ou R
- Valida nomes, recursos e caminhos
- Usa nomes determinísticos
- Define execução não privilegiada dos Workers
- Não acessa PostgreSQL
- Não submete Jobs
- Não altera Deployments
"""

import json
import re
import sys
import uuid
from pathlib import PurePosixPath


NAMESPACE = "analytics-jobs"
PVC_NAME = "analytics-shared-pvc"
IMAGE_PULL_SECRET = "harbor-analytics"

WORKER_UID = 10001
WORKER_GID = 10001

IMAGES = {
    "python": (
        "harbor.ipea.gov.br/desenvolvimento/"
        "analytics-worker-python:2.1"
    ),
    "r": (
        "harbor.ipea.gov.br/desenvolvimento/"
        "analytics-worker-r:2.1"
    ),
}

TASK_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,47}$")


def normalize_uuid(value):
    return uuid.UUID(str(value))


def deterministic_job_name(task_id, attempt):
    task_id = normalize_uuid(task_id)

    if type(attempt) is not int or not 0 <= attempt <= 999999:
        raise ValueError("Attempt invalido")

    name = "te-" + task_id.hex + "-a" + str(attempt)

    if len(name) > 63:
        raise ValueError("Nome do Job muito longo")

    return name


def build_job_manifest(
    workflow_run_id,
    task_id,
    task_key,
    language,
    attempt=0,
    cpus=1,
    memory_gb=2,
    ephemeral_storage_gb=2,
):
    workflow_run_id = normalize_uuid(workflow_run_id)
    task_id = normalize_uuid(task_id)

    if not TASK_KEY_PATTERN.fullmatch(task_key):
        raise ValueError("task_key invalida")

    if language not in IMAGES:
        raise ValueError("Linguagem nao suportada")

    if type(attempt) is not int or not 0 <= attempt <= 999999:
        raise ValueError("Attempt invalido")

    for name, value in (
        ("cpus", cpus),
        ("memory_gb", memory_gb),
        ("ephemeral_storage_gb", ephemeral_storage_gb),
    ):
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not 0 < value <= 32
        ):
            raise ValueError("Recurso invalido: " + name)

    job_name = deterministic_job_name(task_id, attempt)

    folder = (
        PurePosixPath("/shared/task-runs")
        / str(workflow_run_id)
        / task_key
        / ("attempt-" + str(attempt))
    )

    code_file = folder / (
        "main.py" if language == "python" else "main.R"
    )

    output = folder / "output"

    cpu_value = str(cpus)
    memory_value = str(memory_gb) + "Gi"
    ephemeral_value = str(ephemeral_storage_gb) + "Gi"

    resources = {
        "requests": {
            "cpu": cpu_value,
            "memory": memory_value,
            "ephemeral-storage": ephemeral_value,
        },
        "limits": {
            "cpu": cpu_value,
            "memory": memory_value,
            "ephemeral-storage": ephemeral_value,
        },
    }

    return {
        "apiVersion": "batch/v1",
        "kind": "Job",
        "metadata": {
            "name": job_name,
            "namespace": NAMESPACE,
            "labels": {
                "app": "analytics-worker",
                "language": language,
                "run-type": "task-engine",
                "workflow-run-id": str(workflow_run_id),
                "task-key": task_key,
            },
        },
        "spec": {
            "backoffLimit": 0,
            "ttlSecondsAfterFinished": 86400,
            "template": {
                "metadata": {
                    "labels": {
                        "app": "analytics-worker",
                        "language": language,
                        "run-type": "task-engine",
                    },
                },
                "spec": {
                    "restartPolicy": "Never",
                    "automountServiceAccountToken": False,

                    "securityContext": {
                        "runAsNonRoot": True,
                        "runAsUser": WORKER_UID,
                        "runAsGroup": WORKER_GID,
                        "seccompProfile": {
                            "type": "RuntimeDefault",
                        },
                    },

                    "imagePullSecrets": [
                        {"name": IMAGE_PULL_SECRET}
                    ],
                    "nodeSelector": {
                        "analytics-worker": "true"
                    },
                    "containers": [
                        {
                            "name": "worker",
                            "image": IMAGES[language],
                            "imagePullPolicy": "IfNotPresent",

                            "securityContext": {
                                "allowPrivilegeEscalation": False,
                                "capabilities": {
                                    "drop": ["ALL"],
                                },
                            },

                            "env": [
                                {
                                    "name": "NODE_NAME",
                                    "valueFrom": {
                                        "fieldRef": {
                                            "fieldPath": "spec.nodeName"
                                        }
                                    },
                                },
                                {
                                    "name": "POD_NAME",
                                    "valueFrom": {
                                        "fieldRef": {
                                            "fieldPath": "metadata.name"
                                        }
                                    },
                                },
                                {
                                    "name": "POD_NAMESPACE",
                                    "valueFrom": {
                                        "fieldRef": {
                                            "fieldPath": "metadata.namespace"
                                        }
                                    },
                                },
                                {
                                    "name": "RUN_ID",
                                    "value": str(task_id),
                                },
                            ],
                            "args": [
                                "--code-file",
                                str(code_file),
                                "--ram-limit-gb",
                                str(memory_gb),
                                "--cpus",
                                str(cpus),
                                "--output-dir",
                                str(output),
                            ],
                            "resources": resources,
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
                                "claimName": PVC_NAME
                            },
                        }
                    ],
                },
            },
        },
    }


def selftest():
    run_id = uuid.UUID(
        "11111111-1111-4111-8111-111111111111"
    )
    task_id = uuid.UUID(
        "22222222-2222-4222-8222-222222222222"
    )

    for language in ("python", "r"):
        first = build_job_manifest(
            run_id,
            task_id,
            "task_a",
            language,
        )
        second = build_job_manifest(
            run_id,
            task_id,
            "task_a",
            language,
        )

        assert first == second
        assert first["metadata"]["namespace"] == NAMESPACE
        assert first["spec"]["backoffLimit"] == 0

        pod = first["spec"]["template"]["spec"]
        container = pod["containers"][0]

        assert container["image"] == IMAGES[language]
        assert container["args"][0] == "--code-file"
        assert container["args"][4] == "--cpus"

        assert pod["automountServiceAccountToken"] is False

        pod_security = pod["securityContext"]

        assert pod_security["runAsNonRoot"] is True
        assert pod_security["runAsUser"] == WORKER_UID
        assert pod_security["runAsGroup"] == WORKER_GID
        assert (
            pod_security["seccompProfile"]["type"]
            == "RuntimeDefault"
        )

        container_security = container["securityContext"]

        assert (
            container_security["allowPrivilegeEscalation"]
            is False
        )
        assert container_security["capabilities"]["drop"] == [
            "ALL"
        ]

        assert pod["volumes"][0]["persistentVolumeClaim"][
            "claimName"
        ] == PVC_NAME

        print(
            "[OK] Manifest",
            language,
            first["metadata"]["name"],
        )
        print(
            "[OK] Worker",
            language,
            "UID/GID",
            WORKER_UID,
            WORKER_GID,
        )
        print(
            "[OK] SecurityContext",
            language,
        )

    print("[OK] Idempotencia de nomes validada")
    print("[OK] SELFTEST DO DISPATCHER APROVADO")


def print_demo_manifest():
    manifest = build_job_manifest(
        workflow_run_id=(
            "11111111-1111-4111-8111-111111111111"
        ),
        task_id=(
            "22222222-2222-4222-8222-222222222222"
        ),
        task_key="task_a",
        language="python",
        attempt=0,
        cpus=1,
        memory_gb=2,
        ephemeral_storage_gb=2,
    )
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(
            "Uso: python task_engine_executor.py "
            "selftest|manifest"
        )

    if sys.argv[1] == "selftest":
        selftest()
    elif sys.argv[1] == "manifest":
        print_demo_manifest()
    else:
        raise SystemExit("Modo invalido")
