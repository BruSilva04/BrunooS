import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

PBKDF2_ITERATIONS = 210_000
TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def auth_secret() -> bytes:
    secret = (
        os.getenv("AUTH_SECRET")
        or os.getenv("SUPABASE_SECRET_KEY")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_KEY")
        or "dev-auth-secret-change-me"
    )
    return secret.encode("utf-8")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("ascii"),
        PBKDF2_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        scheme, iterations, salt, digest = stored_hash.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("ascii"),
            int(iterations),
        ).hex()
        return hmac.compare_digest(candidate, digest)
    except (AttributeError, TypeError, ValueError):
        return False


def create_session_token(user: dict[str, Any]) -> str:
    now = int(time.time())
    payload = {
        "sub": user["id"],
        "username": user["username"],
        "role": user.get("role", "player"),
        "iat": now,
        "exp": now + TOKEN_TTL_SECONDS,
    }
    payload_raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_part = _b64url_encode(payload_raw)
    signature = hmac.new(auth_secret(), payload_part.encode("ascii"), hashlib.sha256).digest()
    return f"{payload_part}.{_b64url_encode(signature)}"


def verify_session_token(token: str | None) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None

    try:
        payload_part, signature_part = token.split(".", 1)
        expected = hmac.new(auth_secret(), payload_part.encode("ascii"), hashlib.sha256).digest()
        actual = _b64url_decode(signature_part)
        if not hmac.compare_digest(expected, actual):
            return None

        payload = json.loads(_b64url_decode(payload_part))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except (ValueError, json.JSONDecodeError):
        return None
