import json
import os
import socket
import urllib.request
import urllib.error

import psycopg
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from secrets_crypto import encrypt_json_text, decrypt_json_text

router = APIRouter(tags=["data-sources-v2"])


class DataSourceV2Upsert(BaseModel):
    name: str
    source_type: str
    data_format: str = "csv"
    description: str | None = None
    connection_json: dict | None = None
    secrets_json: dict | None = None
    icon: str | None = None
    instructions: str | None = None
    is_enabled: bool = True


def get_db_connection():
    return psycopg.connect(
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
    )


def get_current_user_or_401(request: Request):
    current_user = getattr(request.state, "user", None)
    if not current_user:
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada")
    return current_user


def is_admin(user: dict) -> bool:
    return bool(user.get("is_admin"))


def can_access_owned_resource(user: dict, owner_id: int | None) -> bool:
    if is_admin(user):
        return True
    return owner_id is None or owner_id == user["id"]


def normalize_source_type(source_type: str) -> str:
    source_type = (source_type or "").strip().lower()
    aliases = {
        "sql_server": "sqlserver",
        "mssql": "sqlserver",
        "postgresql": "postgres",
        "curl": "api",
        "http": "api",
    }
    return aliases.get(source_type, source_type)


def json_or_empty(value):
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return {}
    return {}


def serialize_row(row):
    connection_json = json_or_empty(row[9])
    secrets_json = {}
    if row[14]:
        try:
            secrets_json = json.loads(decrypt_json_text(row[14]) or "{}")
        except Exception:
            secrets_json = {}

    return {
        "id": row[0],
        "user_id": row[1],
        "name": row[2],
        "source_type": row[3],
        "data_format": row[4],
        "description": row[5],
        "connection_value": row[6],
        "icon": row[7],
        "instructions": row[8],
        "connection_json": connection_json,
        "is_enabled": bool(row[12]),
        "deleted_at": str(row[13]) if row[13] else None,
        "secrets_json": secrets_json,
        "owner_scope": "global" if row[1] is None else "user",
    }


def fetch_data_source_or_404(cur, data_source_id: int):
    cur.execute(
        """
        SELECT id, user_id, name, source_type, data_format, description,
               connection_value, icon, instructions, connection_json,
               created_at, updated_at, is_enabled, deleted_at, secret_encrypted
        FROM data_sources
        WHERE id = %s
        """,
        (data_source_id,),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Base não encontrada")
    return row


def ensure_required(payload: DataSourceV2Upsert):
    source_type = normalize_source_type(payload.source_type)
    cj = payload.connection_json or {}
    sj = payload.secrets_json or {}

    if source_type == "file":
        if not cj.get("path"):
            raise HTTPException(status_code=400, detail="FILE exige connection_json.path")

    elif source_type == "nfs":
        if not cj.get("server"):
            raise HTTPException(status_code=400, detail="NFS exige connection_json.server")
        if not cj.get("export_path"):
            raise HTTPException(status_code=400, detail="NFS exige connection_json.export_path")

        mount_mode = cj.get("mount_mode", "input_file")
        if mount_mode in ("input_file", "mount_input"):
            if not cj.get("path"):
                raise HTTPException(status_code=400, detail="NFS input exige connection_json.path")
        elif mount_mode in ("output_dir", "mount_output"):
            if not cj.get("subpath"):
                raise HTTPException(status_code=400, detail="NFS output exige connection_json.subpath")
        else:
            raise HTTPException(status_code=400, detail="NFS exige mount_mode válido")

    elif source_type == "smb":
        if not cj.get("server"):
            raise HTTPException(status_code=400, detail="SMB exige connection_json.server")
        if not cj.get("share"):
            raise HTTPException(status_code=400, detail="SMB exige connection_json.share")
        if not cj.get("path"):
            raise HTTPException(status_code=400, detail="SMB exige connection_json.path")

    elif source_type in ("api", "sqlserver", "postgres", "mysql", "oracle", "sql"):
        # deixa cadastro passar; runner vem depois
        pass

    else:
        raise HTTPException(status_code=400, detail=f"Tipo de base não suportado: {source_type}")

    return source_type, cj, sj


def record_change(cur, data_source_id: int, changed_by_user_id: int | None, change_type: str, before_json=None, after_json=None):
    cur.execute(
        """
        INSERT INTO data_source_changes (
            data_source_id, changed_by_user_id, change_type, before_json, after_json
        )
        VALUES (%s, %s, %s, %s::jsonb, %s::jsonb)
        """,
        (
            data_source_id,
            changed_by_user_id,
            change_type,
            json.dumps(before_json) if before_json is not None else None,
            json.dumps(after_json) if after_json is not None else None,
        ),
    )


def simple_connectivity_test(source_type: str, connection_json: dict, secrets_json: dict):
    source_type = normalize_source_type(source_type)

    if source_type == "file":
        p = connection_json.get("path")
        if not p:
            return False, "FILE sem path"
        return (os.path.exists(p), f"Caminho {'encontrado' if os.path.exists(p) else 'não encontrado'}: {p}")

    if source_type == "nfs":
        host = connection_json.get("server")
        with socket.create_connection((host, 2049), timeout=4):
            return True, f"NFS acessível em {host}:2049"

    if source_type == "smb":
        host = connection_json.get("server")
        with socket.create_connection((host, 445), timeout=4):
            return True, f"SMB acessível em {host}:445"

    if source_type == "api":
        url = connection_json.get("url")
        if not url:
            return False, "API sem URL"
        headers = connection_json.get("headers", {}) or {}
        token = secrets_json.get("token")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(url=url, method=(connection_json.get("method") or "GET").upper(), headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return True, f"API respondeu HTTP {resp.status}"
        except urllib.error.HTTPError as e:
            return True, f"API respondeu HTTP {e.code}"

    return True, "Cadastro salvo. Teste específico ainda não implementado para este tipo."


@router.get("/data-sources-v2")
def list_data_sources_v2(
    request: Request,
    q: str | None = Query(default=None),
    source_type: str | None = Query(default=None),
    include_disabled: bool = Query(default=True),
):
    current_user = get_current_user_or_401(request)

    where = ["deleted_at IS NULL"]
    params = []

    if not is_admin(current_user):
        where.append("(user_id = %s OR user_id IS NULL)")
        params.append(current_user["id"])

    if q:
        q_like = f"%{q}%"
        where.append("(name ILIKE %s OR description ILIKE %s)")
        params.extend([q_like, q_like])

    if source_type:
        where.append("source_type = %s")
        params.append(normalize_source_type(source_type))

    if not include_disabled:
        where.append("is_enabled = TRUE")

    where_sql = " WHERE " + " AND ".join(where)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT id, user_id, name, source_type, data_format, description,
                       connection_value, icon, instructions, connection_json,
                       created_at, updated_at, is_enabled, deleted_at, secret_encrypted
                FROM data_sources
                {where_sql}
                ORDER BY id DESC
                """,
                params,
            )
            rows = cur.fetchall()

    return {"success": True, "items": [serialize_row(r) for r in rows]}


@router.post("/data-sources-v2")
def create_data_source_v2(payload: DataSourceV2Upsert, request: Request):
    current_user = get_current_user_or_401(request)
    source_type, cj, sj = ensure_required(payload)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO data_sources (
                    user_id, name, source_type, data_format, description,
                    connection_value, icon, instructions, connection_json,
                    secret_encrypted, is_enabled, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, NOW())
                RETURNING id
                """,
                (
                    current_user["id"],
                    payload.name,
                    source_type,
                    payload.data_format,
                    payload.description,
                    cj.get("path") or cj.get("subpath") or "",
                    payload.icon or source_type,
                    payload.instructions,
                    json.dumps(cj),
                    encrypt_json_text(json.dumps(sj)),
                    payload.is_enabled,
                ),
            )
            new_id = cur.fetchone()[0]

            record_change(
                cur,
                data_source_id=new_id,
                changed_by_user_id=current_user["id"],
                change_type="create",
                before_json=None,
                after_json={
                    "name": payload.name,
                    "source_type": source_type,
                    "data_format": payload.data_format,
                    "description": payload.description,
                    "connection_json": cj,
                    "is_enabled": payload.is_enabled,
                },
            )
        conn.commit()

    return {"success": True, "id": new_id}


@router.put("/data-sources-v2/{data_source_id}")
def update_data_source_v2(data_source_id: int, payload: DataSourceV2Upsert, request: Request):
    current_user = get_current_user_or_401(request)
    source_type, cj, sj = ensure_required(payload)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            row = fetch_data_source_or_404(cur, data_source_id)
            if not can_access_owned_resource(current_user, row[1]):
                raise HTTPException(status_code=403, detail="Sem permissão para editar esta base")

            before_json = serialize_row(row)

            cur.execute(
                """
                UPDATE data_sources
                SET name = %s,
                    source_type = %s,
                    data_format = %s,
                    description = %s,
                    connection_value = %s,
                    icon = %s,
                    instructions = %s,
                    connection_json = %s::jsonb,
                    secret_encrypted = %s,
                    is_enabled = %s,
                    updated_at = NOW()
                WHERE id = %s
                """,
                (
                    payload.name,
                    source_type,
                    payload.data_format,
                    payload.description,
                    cj.get("path") or cj.get("subpath") or "",
                    payload.icon or source_type,
                    payload.instructions,
                    json.dumps(cj),
                    encrypt_json_text(json.dumps(sj)),
                    payload.is_enabled,
                    data_source_id,
                ),
            )

            record_change(
                cur,
                data_source_id=data_source_id,
                changed_by_user_id=current_user["id"],
                change_type="update",
                before_json=before_json,
                after_json={
                    "name": payload.name,
                    "source_type": source_type,
                    "data_format": payload.data_format,
                    "description": payload.description,
                    "connection_json": cj,
                    "is_enabled": payload.is_enabled,
                },
            )
        conn.commit()

    return {"success": True}


@router.delete("/data-sources-v2/{data_source_id}")
def delete_data_source_v2(data_source_id: int, request: Request):
    current_user = get_current_user_or_401(request)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            row = fetch_data_source_or_404(cur, data_source_id)
            if not can_access_owned_resource(current_user, row[1]):
                raise HTTPException(status_code=403, detail="Sem permissão para deletar esta base")

            before_json = serialize_row(row)

            cur.execute(
                """
                UPDATE data_sources
                SET deleted_at = NOW(), updated_at = NOW()
                WHERE id = %s
                """,
                (data_source_id,),
            )

            record_change(
                cur,
                data_source_id=data_source_id,
                changed_by_user_id=current_user["id"],
                change_type="delete",
                before_json=before_json,
                after_json=None,
            )
        conn.commit()

    return {"success": True}


@router.post("/data-sources-v2/{data_source_id}/test")
def test_data_source_v2(data_source_id: int, request: Request):
    current_user = get_current_user_or_401(request)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            row = fetch_data_source_or_404(cur, data_source_id)
            if not can_access_owned_resource(current_user, row[1]):
                raise HTTPException(status_code=403, detail="Sem permissão para testar esta base")

            ds = serialize_row(row)
            ok, message = simple_connectivity_test(ds["source_type"], ds["connection_json"], ds["secrets_json"])

    return {"success": ok, "message": message}


def register_data_source_routes_v2(app):
    app.include_router(router)
