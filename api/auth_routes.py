from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
import hashlib
import os
import secrets
import psycopg

from auth_ldap import authenticate_ad_user


router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "analytics_session")
SESSION_TTL_HOURS = int(os.getenv("SESSION_TTL_HOURS", "12"))

PUBLIC_PATHS = {
    "/health",
    "/auth/login",
    "/openapi.json",
    "/docs",
    "/docs/oauth2-redirect",
    "/redoc",
}


def get_db_connection():
    return psycopg.connect(
        host=os.environ["DB_HOST"],
        port=os.environ["DB_PORT"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
    )


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_request_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def upsert_local_user(ad_user: dict) -> dict:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (
                    username, display_name, email, dn, ad_group,
                    is_active, last_login_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, TRUE, NOW(), NOW())
                ON CONFLICT (username)
                DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    email = EXCLUDED.email,
                    dn = EXCLUDED.dn,
                    ad_group = EXCLUDED.ad_group,
                    is_active = TRUE,
                    last_login_at = NOW(),
                    updated_at = NOW()
                RETURNING id, username, display_name, email, dn, ad_group, is_admin, is_active
                """,
                (
                    ad_user["username"],
                    ad_user["display_name"],
                    ad_user["email"],
                    ad_user["dn"],
                    ad_user["ad_group"],
                ),
            )
            row = cur.fetchone()
        conn.commit()

    return {
        "id": row[0],
        "username": row[1],
        "display_name": row[2],
        "email": row[3],
        "dn": row[4],
        "ad_group": row[5],
        "is_admin": row[6],
        "is_active": row[7],
    }


def create_session(user_id: int, request: Request, response: Response) -> None:
    raw_token = secrets.token_urlsafe(48)
    token_hash = hash_session_token(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=SESSION_TTL_HOURS)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO auth_sessions (
                    user_id, session_token_hash, client_ip, user_agent, expires_at
                )
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    user_id,
                    token_hash,
                    get_request_ip(request),
                    request.headers.get("user-agent"),
                    expires_at,
                ),
            )
        conn.commit()

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=raw_token,
        max_age=SESSION_TTL_HOURS * 3600,
        expires=SESSION_TTL_HOURS * 3600,
        httponly=True,
        secure=False,
        samesite="lax",
        path="/",
    )


def get_current_user_from_request(request: Request):
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not raw_token:
        return None

    token_hash = hash_session_token(raw_token)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    u.id, u.username, u.display_name, u.email,
                    u.dn, u.ad_group, u.is_admin, u.is_active
                FROM auth_sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.session_token_hash = %s
                  AND s.expires_at > NOW()
                  AND u.is_active = TRUE
                """,
                (token_hash,),
            )
            row = cur.fetchone()

            if not row:
                return None

            cur.execute(
                """
                UPDATE auth_sessions
                SET last_seen_at = NOW()
                WHERE session_token_hash = %s
                """,
                (token_hash,),
            )
        conn.commit()

    return {
        "id": row[0],
        "username": row[1],
        "display_name": row[2],
        "email": row[3],
        "dn": row[4],
        "ad_group": row[5],
        "is_admin": row[6],
        "is_active": row[7],
    }


@router.post("/auth/login")
def login(req: LoginRequest, request: Request, response: Response):
    try:
        ad_user = authenticate_ad_user(req.username, req.password)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception:
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")

    user = upsert_local_user(ad_user)
    create_session(user["id"], request, response)

    return {
        "success": True,
        "user": user,
    }


@router.get("/auth/me")
def auth_me(request: Request):
    user = get_current_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada")
    return {"success": True, "user": user}


@router.post("/auth/logout")
def logout(request: Request, response: Response):
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if raw_token:
        token_hash = hash_session_token(raw_token)
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM auth_sessions WHERE session_token_hash = %s",
                    (token_hash,),
                )
            conn.commit()

    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
    )

    return {"success": True}


def register_auth_routes(app):
    app.include_router(router)

    if getattr(app.state, "auth_middleware_installed", False):
        return

    @app.middleware("http")
    async def auth_session_middleware(request: Request, call_next):
        user = get_current_user_from_request(request)
        request.state.user = user

        path = request.url.path

        is_public = (
            path in PUBLIC_PATHS
            or path.startswith("/docs")
            or path.startswith("/redoc")
        )

        if not is_public and user is None:
            return JSONResponse(
                status_code=401,
                content={"detail": "Sessão inválida ou expirada"},
            )

        return await call_next(request)

    app.state.auth_middleware_installed = True
