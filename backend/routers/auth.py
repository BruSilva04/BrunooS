from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from db.database import (
    create_user,
    get_lobby_snapshot,
    get_user_by_email,
    get_user_by_id,
    get_user_by_username,
)
from services.auth import create_session_token, hash_password, verify_password, verify_session_token

router = APIRouter(prefix="/api", tags=["auth"])


class RegisterRequest(BaseModel):
    phone: str = Field(min_length=8, max_length=24)
    email: str = Field(min_length=5, max_length=120, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    username: str = Field(min_length=3, max_length=24, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=1, max_length=128)


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        return None
    return authorization[len(prefix):]


def public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "phone": user.get("phone", ""),
        "role": user.get("role", "player"),
        "permissions": user.get("permissions", {}),
        "balance": float(user.get("balance", 0) or 0),
    }


def db_unavailable(exc: Exception) -> HTTPException:
    error_text = str(exc)
    if "public.users" in error_text or "PGRST205" in error_text:
        detail = "Tabela public.users nao existe no Supabase. Aplique backend/db/schema.sql no SQL Editor."
    else:
        detail = "Banco Supabase indisponivel. Verifique SUPABASE_URL, SUPABASE_SECRET_KEY e permissoes do projeto."

    return HTTPException(
        status_code=503,
        detail=detail,
    )


@router.post("/auth/register")
async def register(payload: RegisterRequest):
    username = payload.username.strip()
    email = payload.email.lower().strip()

    try:
        if await get_user_by_username(username):
            raise HTTPException(status_code=409, detail="Usuario ja existe")
        if await get_user_by_email(email):
            raise HTTPException(status_code=409, detail="Email ja cadastrado")

        user = await create_user({
            "phone": payload.phone.strip(),
            "email": email,
            "username": username,
            "password_hash": hash_password(payload.password),
            "role": "player",
            "permissions": {"play": True, "admin": False},
            "balance": 250.0,
        })
    except HTTPException:
        raise
    except Exception as exc:
        raise db_unavailable(exc) from exc

    return {"token": create_session_token(user), "user": public_user(user)}


@router.post("/auth/login")
async def login(payload: LoginRequest):
    try:
        user = await get_user_by_username(payload.username.strip())
    except Exception as exc:
        raise db_unavailable(exc) from exc

    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Usuario ou senha invalido")

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
