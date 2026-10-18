"""
Analytics API - Kubernetes Metrics Server
Versao: 2.8

Endpoints administrativos:
    GET /metrics/nodes
    GET /metrics/pods
    GET /metrics/pods?namespace=analytics-jobs
    GET /metrics/summary

Autenticacao:
    Sessao existente via request.state.user
    Acesso restrito a administradores

Kubernetes:
    Autenticacao via ServiceAccount
    RBAC somente leitura
    Validacao TLS habilitada
"""

from __future__ import annotations

import json
import os
import re
import ssl

from datetime import datetime, timezone
from pathlib import Path

from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request as URLRequest, urlopen

from fastapi import APIRouter, HTTPException, Request


router = APIRouter(
    prefix="/metrics",
    tags=["metrics"]
)

SA_DIR = Path(
    "/var/run/secrets/kubernetes.io/serviceaccount"
)

API_HOST = os.environ.get(
    "KUBERNETES_SERVICE_HOST",
    "kubernetes.default.svc"
)

API_PORT = os.environ.get(
    "KUBERNETES_SERVICE_PORT_HTTPS",
    "443"
)

API_URL = f"https://{API_HOST}:{API_PORT}"

TIMEOUT_SECONDS = 5


_QUANTITY = re.compile(
    r"^([+-]?(?:\d+(?:\.\d*)?|\.\d+)"
    r"(?:[eE][+-]?\d+)?)"
    r"(n|u|m|k|M|G|T|P|E|Ki|Mi|Gi|Ti|Pi|Ei)?$"
)

_MULTIPLIER = {
    "n": 1e-9,
    "u": 1e-6,
    "m": 1e-3,
    "": 1.0,
    "k": 1e3,
    "M": 1e6,
    "G": 1e9,
    "T": 1e12,
    "P": 1e15,
    "E": 1e18,
    "Ki": 1024,
    "Mi": 1024**2,
    "Gi": 1024**3,
    "Ti": 1024**4,
    "Pi": 1024**5,
    "Ei": 1024**6,
}


def _quantity(value: str) -> float:
    """Converte quantidades Kubernetes para valores numericos."""

    match = _QUANTITY.fullmatch(str(value))

    if not match:
        raise ValueError(
            "Quantidade Kubernetes invalida"
        )

    return (
        float(match.group(1))
        * _MULTIPLIER[match.group(2) or ""]
    )


def _require_admin(request: Request) -> None:
    """Exige sessao autenticada e perfil administrativo."""

    user = getattr(
        request.state,
        "user",
        None
    )

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Sessao invalida ou expirada"
        )

    if not user.get("is_admin"):
        raise HTTPException(
            status_code=403,
            detail="Acesso restrito a administradores"
        )


def _fetch_metrics(path: str) -> dict:
    """Consulta a Metrics API usando a ServiceAccount do Pod."""

    try:
        token = (
            SA_DIR / "token"
        ).read_text(
            encoding="utf-8"
        ).strip()

        ca_path = SA_DIR / "ca.crt"

        context = ssl.create_default_context(
            cafile=str(ca_path)
        )

        req = URLRequest(
            f"{API_URL}{path}",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
            method="GET"
        )

        with urlopen(
            req,
            timeout=TIMEOUT_SECONDS,
            context=context
        ) as response:
            result = json.load(response)

        if not isinstance(result, dict):
            raise ValueError(
                "Resposta inesperada da Metrics API"
            )

        return result

    except HTTPError as exc:

        if exc.code in (401, 403):
            raise HTTPException(
                status_code=503,
                detail="ServiceAccount sem acesso a Metrics API"
            ) from exc

        raise HTTPException(
            status_code=502,
            detail=f"Metrics API respondeu HTTP {exc.code}"
        ) from exc

    except (
        OSError,
        URLError,
        TimeoutError,
        ValueError,
        ssl.SSLError
    ) as exc:

        raise HTTPException(
            status_code=503,
            detail="Metrics API temporariamente indisponivel"
        ) from exc


def _containers(item: dict) -> list[dict]:
    """Converte metricas de containers."""

    return [
        {
            "name": c.get("name", ""),
            "cpu_millicores": round(
                _quantity(
                    c.get("usage", {}).get("cpu", "0")
                ) * 1000,
                2
            ),
            "memory_mib": round(
                _quantity(
                    c.get("usage", {}).get("memory", "0")
                ) / 1024**2,
                2
            ),
        }
        for c in item.get("containers", [])
    ]


def _node(item: dict) -> dict:
    """Normaliza as metricas de um no Kubernetes."""

    usage = item.get("usage", {})

    return {
        "name": item.get(
            "metadata", {}
        ).get("name", ""),
        "timestamp": item.get("timestamp"),
        "window": item.get("window"),
        "cpu_millicores": round(
            _quantity(
                usage.get("cpu", "0")
            ) * 1000,
            2
        ),
        "memory_mib": round(
            _quantity(
                usage.get("memory", "0")
            ) / 1024**2,
            2
        ),
    }


def _pod(item: dict) -> dict:
    """Normaliza as metricas de um Pod Kubernetes."""

    containers = _containers(item)

    metadata = item.get(
        "metadata",
        {}
    )

    return {
        "name": metadata.get("name", ""),
        "namespace": metadata.get(
            "namespace",
            ""
        ),
        "timestamp": item.get("timestamp"),
        "window": item.get("window"),
        "cpu_millicores": round(
            sum(
                c["cpu_millicores"]
                for c in containers
            ),
            2
        ),
        "memory_mib": round(
            sum(
                c["memory_mib"]
                for c in containers
            ),
            2
        ),
        "containers": containers,
    }


def _nodes() -> list[dict]:
    """Lista metricas de todos os nos."""

    data = _fetch_metrics(
        "/apis/metrics.k8s.io/v1beta1/nodes"
    )

    return sorted(
        (
            _node(item)
            for item in data.get("items", [])
        ),
        key=lambda x: x["name"]
    )


def _pods(namespace: str | None = None) -> list[dict]:
    """Lista metricas de Pods ativos."""

    if namespace:
        path = (
            "/apis/metrics.k8s.io/v1beta1/"
            f"namespaces/{quote(namespace, safe='')}/pods"
        )
    else:
        path = (
            "/apis/metrics.k8s.io/v1beta1/pods"
        )

    data = _fetch_metrics(path)

    return sorted(
        (
            _pod(item)
            for item in data.get("items", [])
        ),
        key=lambda x: (
            x["namespace"],
            x["name"]
        )
    )


@router.get("/nodes")
def get_node_metrics(request: Request):
    """Retorna consumo de CPU e memoria dos nos."""

    _require_admin(request)

    items = _nodes()

    return {
        "items": items,
        "total": len(items)
    }


@router.get("/pods")
def get_pod_metrics(
    request: Request,
    namespace: str | None = None
):
    """Retorna consumo de CPU e memoria dos Pods."""

    _require_admin(request)

    if (
        namespace is not None
        and not re.fullmatch(
            r"[a-z0-9]([-a-z0-9]*[a-z0-9])?",
            namespace
        )
    ):
        raise HTTPException(
            status_code=422,
            detail="Namespace invalido"
        )

    items = _pods(namespace)

    return {
        "items": items,
        "total": len(items),
        "namespace": namespace
    }


@router.get("/summary")
def get_metrics_summary(request: Request):
    """Resumo consolidado de metricas do cluster."""

    _require_admin(request)

    nodes = _nodes()
    pods = _pods()

    return {
        "collected_at": datetime.now(
            timezone.utc
        ).isoformat(),

        "nodes_count": len(nodes),

        "pods_count": len(pods),

        "cpu_millicores": round(
            sum(
                x["cpu_millicores"]
                for x in nodes
            ),
            2
        ),

        "memory_mib": round(
            sum(
                x["memory_mib"]
                for x in nodes
            ),
            2
        ),

        "nodes": nodes,

        "pods_by_namespace": {
            ns: sum(
                1
                for p in pods
                if p["namespace"] == ns
            )
            for ns in sorted({
                p["namespace"]
                for p in pods
            })
        },
    }


def register_metrics_routes(app) -> None:
    """Registra as rotas de metricas no FastAPI."""

    app.include_router(router)
