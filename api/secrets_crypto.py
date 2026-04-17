import base64
import hashlib
import os
from cryptography.fernet import Fernet


def _build_fernet_key() -> bytes:
    raw = os.getenv("APP_SECRET_KEY")
    if raw:
        try:
            Fernet(raw.encode("utf-8"))
            return raw.encode("utf-8")
        except Exception:
            pass

    seed = os.getenv("DB_PASSWORD", "analytics-default-secret").encode("utf-8")
    digest = hashlib.sha256(seed).digest()
    return base64.urlsafe_b64encode(digest)


def get_fernet() -> Fernet:
    return Fernet(_build_fernet_key())


def encrypt_json_text(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    return get_fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_json_text(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    return get_fernet().decrypt(value.encode("utf-8")).decode("utf-8")
