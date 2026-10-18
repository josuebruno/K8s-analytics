#!/usr/bin/env python3
"""
Analytics Individual Job Reconciler v1.0

Reconcilia execuções individuais Python/R armazenadas em job_runs.

Regras:
- Não depende de navegador ou sessão autenticada.
- Processa somente registros ainda marcados como running.
- Consulta o estado do Kubernetes.
- Confirma o resultado persistido no NFS.
- Não considera Job ausente como falha automaticamente.
- Não altera execuções já finalizadas.
- Não interfere com a execução híbrida.
"""

import argparse
import json
import logging
import subprocess
import sys

from main import (
    get_db_connection,
    inspect_job_runtime,
    _read_single_result,
)


LOG = logging.getLogger("individual-reconciler")
NAMESPACE = "analytics-jobs"


def kubernetes_job_status(job_name):
    """Consulta o Job no Kubernetes sem modificar recursos."""

    try:
        proc = subprocess.run(
            [
                "kubectl", "get", "job",
                job_name,
                "-n", NAMESPACE,
                "-o", "json",
            ],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return "unknown", "timeout ao consultar Kubernetes"
    except OSError as exc:
        return "unknown", str(exc)

    if proc.returncode != 0:
        return "missing", (proc.stderr or "").strip()

    try:
        job = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return "unknown", "resposta JSON inválida do Kubernetes"

    status = job.get("status") or {}

    conditions = status.get("conditions") or []

    if status.get("succeeded", 0) > 0 or any(
        condition.get("type") == "Complete"
        and condition.get("status") == "True"
        for condition in conditions
    ):
        return "complete", "Job concluído"

    if any(
        condition.get("type") == "Failed"
        and condition.get("status") == "True"
        for condition in conditions
    ):
        return "failed", "Job falhou"

    return "running", "Job ainda em processamento"


def result_status(result_path):
    """Lê o resultado persistido no NFS."""

    try:
        result = _read_single_result(result_path)
    except Exception as exc:
        LOG.warning(
            "Não foi possível ler o resultado %s: %s",
            result_path,
            exc,
        )
        return None

    if result is None:
        return None

    if not isinstance(result, dict):
        LOG.warning("Formato inesperado do resultado: %s", result_path)
        return None

    if result.get("status") == "success" and result.get("returncode", 0) == 0:
        return "completed"

    # Só interpretar como falha se o arquivo apresentar estado terminal.
    if (
        result.get("status") in ("failed", "error", "failure")
        or (
            result.get("returncode") is not None
            and result.get("returncode") != 0
        )
    ):
        return "failed"

    LOG.warning(
        "Resultado ainda sem estado terminal reconhecido: %s",
        result_path,
    )
    return None


def reconcile_one(run):
    run_id, job_name, language, result_path = run

    k8s_state, detail = kubernetes_job_status(job_name)

    # Evita interpretar um resultado parcial como conclusão
    # enquanto o Job ainda está executando.
    if k8s_state == "running":
        LOG.info(
            "run_id=%s job=%s language=%s status=running",
            run_id, job_name, language,
        )
        return "running"

    persisted_state = result_status(result_path)

    if k8s_state == "complete":
        if persisted_state is None:
            LOG.warning(
                "run_id=%s Job concluído, mas resultado ainda não disponível",
                run_id,
            )
            return "waiting_result"

        final_state = persisted_state

    elif k8s_state == "failed":
        final_state = "failed"

    elif k8s_state == "missing":
        if persisted_state is None:
            LOG.warning(
                "run_id=%s Job ausente no Kubernetes; "
                "nenhum resultado terminal disponível: %s",
                run_id, detail,
            )
            return "unknown"

        final_state = persisted_state

    else:
        LOG.warning(
            "run_id=%s Não foi possível determinar o estado: %s",
            run_id, detail,
        )
        return "unknown"

    runtime = {}

    if k8s_state != "missing":
        try:
            runtime = inspect_job_runtime(job_name) or {}
        except Exception as exc:
            LOG.warning(
                "run_id=%s Não foi possível consultar runtime: %s",
                run_id, exc,
            )

    node_name = runtime.get("node_name")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE job_runs
                   SET status = %s,
                       finished_at = COALESCE(finished_at, NOW()),
                       node_name = COALESCE(%s, node_name),
                       runtime_details = %s
                 WHERE id = %s
                   AND status = 'running'
                   AND deleted_at IS NULL
                """,
                (
                    final_state,
                    node_name,
                    json.dumps(runtime),
                    run_id,
                ),
            )

            updated = cur.rowcount

        conn.commit()

    if updated:
        LOG.info(
            "run_id=%s job=%s reconciliado: %s",
            run_id,
            job_name,
            final_state,
        )
        return final_state

    LOG.info(
        "run_id=%s não atualizado: registro já alterado",
        run_id,
    )
    return "already_updated"


def reconcile_all(limit):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, job_name, language, result_path
                  FROM job_runs
                 WHERE status = 'running'
                   AND deleted_at IS NULL
                   AND language IN ('python', 'r')
                   AND job_name IS NOT NULL
                 ORDER BY id DESC
                 LIMIT %s
                """,
                (limit,),
            )

            runs = cur.fetchall()

    summary = {
        "checked": 0,
        "completed": 0,
        "failed": 0,
        "running": 0,
        "waiting_result": 0,
        "unknown": 0,
        "already_updated": 0,
        "errors": [],
    }

    for run in runs:
        try:
            state = reconcile_one(run)
            summary["checked"] += 1

            if state in summary:
                summary[state] += 1

        except Exception as exc:
            LOG.exception(
                "Falha ao reconciliar run_id=%s",
                run[0],
            )
            summary["errors"].append({
                "run_id": run[0],
                "error": str(exc),
            })

    print(json.dumps(summary, ensure_ascii=False))

    return 1 if summary["errors"] else 0


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--max-runs",
        type=int,
        default=100,
    )

    args = parser.parse_args()

    if args.max_runs < 1:
        parser.error("--max-runs deve ser maior que zero")

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    return reconcile_all(args.max_runs)


if __name__ == "__main__":
    sys.exit(main())
