import base64
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from datetime import datetime, timezone


def slugify(value: str) -> str:
    value = (value or "").strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "item"


def kubectl_apply_json(manifest: dict) -> None:
    result = subprocess.run(
        ["kubectl", "apply", "-f", "-"],
        input=json.dumps(manifest),
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Falha ao aplicar recurso no Kubernetes")


def kubectl_delete(kind: str, name: str, namespace: str) -> None:
    subprocess.run(
        ["kubectl", "delete", kind, name, "-n", namespace, "--ignore-not-found=true"],
        capture_output=True,
        text=True,
        check=False,
    )


def create_git_secret(
    *,
    namespace: str,
    secret_name: str,
    auth_type: str,
    provider: str,
    git_username: str | None,
    token: str | None,
    private_key: str | None,
    known_hosts: str | None,
) -> None:
    manifest = {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {
            "name": secret_name,
            "namespace": namespace,
        },
        "type": "Opaque",
        "stringData": {
            "auth_type": auth_type,
            "provider": provider,
            "git_username": git_username or "",
            "token": token or "",
            "private_key": private_key or "",
            "known_hosts": known_hosts or "",
        },
    }
    kubectl_apply_json(manifest)


def get_git_secret(secret_name: str, namespace: str = "analytics-system") -> dict:
    result = subprocess.run(
        ["kubectl", "get", "secret", secret_name, "-n", namespace, "-o", "json"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Falha ao ler secret do Git")

    payload = json.loads(result.stdout)
    data = payload.get("data") or {}

    def decode(key: str) -> str:
        raw = data.get(key)
        if not raw:
            return ""
        return base64.b64decode(raw).decode("utf-8")

    return {
        "auth_type": decode("auth_type"),
        "provider": decode("provider"),
        "git_username": decode("git_username"),
        "token": decode("token"),
        "private_key": decode("private_key"),
        "known_hosts": decode("known_hosts"),
    }


def build_authenticated_https_url(git_url: str, provider: str, git_username: str | None, token: str) -> str:
    if not git_url.startswith("https://"):
        raise RuntimeError("Para autenticação por token, a URL do repositório deve usar HTTPS")

    provider = (provider or "").lower()
    if provider == "github":
        username = git_username or "x-access-token"
    elif provider == "gitlab":
        username = git_username or "oauth2"
    else:
        username = git_username or "git"

    prefix = "https://"
    return git_url.replace(prefix, f"{prefix}{username}:{token}@", 1)


def prepare_git_run_dir(shared_root: str, job_base_name: str) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    base_dir = Path(shared_root) / "git-runs" / f"{slugify(job_base_name)}-{ts}"
    if base_dir.exists():
        shutil.rmtree(base_dir)
    base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir


def clone_git_repo(
    *,
    shared_root: str,
    job_base_name: str,
    git_url: str,
    git_branch: str | None,
    entry_file: str,
    credential: dict | None,
) -> tuple[str, str]:
    base_dir = prepare_git_run_dir(shared_root, job_base_name)
    repo_dir = base_dir / "repo"

    env = os.environ.copy()
    effective_url = git_url

    if credential:
        auth_type = credential.get("auth_type")
        if auth_type == "token":
            token = credential.get("token")
            if not token:
                raise RuntimeError("Credencial Git do tipo token sem token salvo")
            effective_url = build_authenticated_https_url(
                git_url=git_url,
                provider=credential.get("provider", ""),
                git_username=credential.get("git_username"),
                token=token,
            )
        elif auth_type == "ssh_key":
            ssh_dir = base_dir / ".ssh"
            ssh_dir.mkdir(parents=True, exist_ok=True)

            key_file = ssh_dir / "id_key"
            key_file.write_text(credential.get("private_key", ""), encoding="utf-8")
            os.chmod(key_file, 0o600)

            known_hosts_file = ssh_dir / "known_hosts"
            known_hosts_file.write_text(credential.get("known_hosts", ""), encoding="utf-8")
            os.chmod(known_hosts_file, 0o644)

            env["GIT_SSH_COMMAND"] = (
                f"ssh -i {key_file} "
                f"-o UserKnownHostsFile={known_hosts_file} "
                f"-o StrictHostKeyChecking=yes"
            )
        else:
            raise RuntimeError("Tipo de credencial Git não suportado")

    cmd = ["git", "clone", "--depth", "1"]
    if git_branch:
        cmd += ["--branch", git_branch, "--single-branch"]
    cmd += [effective_url, str(repo_dir)]

    result = subprocess.run(cmd, capture_output=True, text=True, env=env, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Falha ao clonar repositório")

    entry_file = (entry_file or "").lstrip("/")
    entry_path = repo_dir / entry_file
    if not entry_path.exists():
        raise RuntimeError(f"Arquivo principal não encontrado no repositório: {entry_file}")

    return str(repo_dir), entry_file
