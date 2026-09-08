import time

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from db.database import (
    create_user,
    get_lobby_snapshot,
    get_user_by_document,
    get_user_by_email,
    get_user_by_id,
    get_user_by_username,
)
from services.auth import create_session_token, hash_password, verify_password, verify_session_token

router = APIRouter(prefix="/api", tags=["auth"])
RATE_LIMIT_BUCKETS: dict[str, list[float]] = {}


class RegisterRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=24)
    email: str = Field(min_length=5, max_length=120, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    username: str = Field(min_length=3, max_length=24, pattern=r"^[a-zA-Z0-9_.-]+$")
    legal_name: str = Field(min_length=3, max_length=120)
    document: str = Field(min_length=11, max_length=18)
    document_type: str = Field(default="cpf", pattern=r"^(cpf|cnpj)$")
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=1, max_length=128)


def client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def check_rate_limit(key: str, limit: int, window_seconds: int) -> None:
    now = time.time()
    bucket = [seen_at for seen_at in RATE_LIMIT_BUCKETS.get(key, []) if now - seen_at < window_seconds]
    RATE_LIMIT_BUCKETS[key] = bucket
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="Muitas tentativas. Aguarde alguns minutos e tente novamente.")


def record_rate_limit_hit(key: str) -> None:
    RATE_LIMIT_BUCKETS.setdefault(key, []).append(time.time())


def clear_rate_limit(key: str) -> None:
    RATE_LIMIT_BUCKETS.pop(key, None)


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        return None
    return authorization[len(prefix):]


def public_user(user: dict) -> dict:
    document = "".join(char for char in str(user.get("document") or "") if char.isdigit())
    document_masked = ""
    if len(document) == 11:
        document_masked = f"{document[:3]}.***.***-{document[-2:]}"
    elif len(document) == 14:
        document_masked = f"{document[:2]}.***.***/****-{document[-2:]}"

    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "phone": user.get("phone", ""),
        "legal_name": user.get("legal_name") or "",
        "document_masked": document_masked,
        "document_type": user.get("document_type") or "cpf",
        "has_kyc": bool(user.get("legal_name") and user.get("document")),
        "role": user.get("role", "player"),
        "permissions": user.get("permissions", {}),
        "balance": float(user.get("balance", 0) or 0),
    }


def db_unavailable(exc: Exception) -> HTTPException:
    error_text = str(exc)
    if "Configure SUPABASE_URL" in error_text:
        detail = "Supabase nao configurado no Render. Cadastre SUPABASE_URL e SUPABASE_SECRET_KEY nas Environment Variables do backend."
    elif "public.users" in error_text or "PGRST205" in error_text:
        detail = "Tabela public.users nao existe no Supabase. Aplique backend/db/schema.sql no SQL Editor."
    elif "legal_name" in error_text or "document" in error_text:
        detail = "Schema de usuarios desatualizado. Rode novamente backend/db/schema.sql no SQL Editor do Supabase."
    else:
        detail = "Banco Supabase indisponivel. Verifique SUPABASE_URL, SUPABASE_SECRET_KEY e permissoes do projeto."

    return HTTPException(
        status_code=503,
        detail=detail,
    )


@router.post("/auth/register")
async def register(payload: RegisterRequest, request: Request):
    register_key = f"register:{client_ip(request)}"
    check_rate_limit(register_key, limit=5, window_seconds=10 * 60)
    record_rate_limit_hit(register_key)

    username = payload.username.strip()
    email = payload.email.lower().strip()
    legal_name = payload.legal_name.strip()
    document = "".join(char for char in payload.document if char.isdigit())
    if payload.document_type == "cpf" and len(document) != 11:
        raise HTTPException(status_code=422, detail="CPF precisa ter 11 digitos")
    if payload.document_type == "cnpj" and len(document) != 14:
        raise HTTPException(status_code=422, detail="CNPJ precisa ter 14 digitos")

    try:
        if await get_user_by_username(username):
            raise HTTPException(status_code=409, detail="Usuario ja existe")
        if await get_user_by_email(email):
            raise HTTPException(status_code=409, detail="Email ja cadastrado")
        if await get_user_by_document(document):
            raise HTTPException(status_code=409, detail="Documento ja cadastrado")

        user = await create_user({
            "phone": payload.phone.strip(),
            "email": email,
            "username": username,
            "legal_name": legal_name,
            "document": document,
            "document_type": payload.document_type,
            "password_hash": hash_password(payload.password),
            "role": "player",
            "permissions": {"play": True, "admin": False},
            "balance": 0.0,
        })
    except HTTPException:
        raise
    except Exception as exc:
        raise db_unavailable(exc) from exc

    return {"token": create_session_token(user), "user": public_user(user)}


@router.post("/auth/login")
async def login(payload: LoginRequest, request: Request):
    username = payload.username.strip()
    login_key = f"login:{client_ip(request)}:{username.lower()}"
    check_rate_limit(login_key, limit=8, window_seconds=10 * 60)

    try:
        user = await get_user_by_username(username)
    except Exception as exc:
        raise db_unavailable(exc) from exc

    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        record_rate_limit_hit(login_key)
        raise HTTPException(status_code=401, detail="Usuario ou senha invalido")

    clear_rate_limit(login_key)
    return {"token": create_session_token(user), "user": public_user(user)}


@router.get("/auth/me")
async def me(authorization: str | None = Header(default=None)):
    session = verify_session_token(bearer_token(authorization))
    if not session:
        raise HTTPException(status_code=401, detail="Sessao invalida")

    try:
        user = await get_user_by_id(session["sub"])
    except Exception as exc:
        raise db_unavailable(exc) from exc

    if not user:
        raise HTTPException(status_code=401, detail="Usuario nao encontrado")
    return {"user": public_user(user)}


@router.get("/lobby/me")
async def lobby_me(authorization: str | None = Header(default=None)):
    session = verify_session_token(bearer_token(authorization))
    if not session:
        raise HTTPException(status_code=401, detail="Sessao invalida")

    try:
        snapshot = await get_lobby_snapshot(session["sub"])
    except Exception as exc:
        raise db_unavailable(exc) from exc

    if not snapshot:
        raise HTTPException(status_code=401, detail="Usuario nao encontrado")
    return snapshot
