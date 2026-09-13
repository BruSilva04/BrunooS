from contextlib import asynccontextmanager
import os

import anyio
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from routers import auth
from routers import game
from routers import block
from routers import tracking
from routers import wallet
from db.database import USERS_TABLE
from db.database import get_supabase_client
from db.database import init_db


def cors_regex() -> str:
    local_network = r"https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):(3000|3001|5173)"
    if os.getenv("ALLOW_VERCEL_PREVIEWS", "true").lower() == "true":
        return rf"^(https://[a-z0-9-]+\.vercel\.app|{local_network})$"
    return rf"^({local_network})$"


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await init_db()
    except Exception as e:
        print(f"DB init notice: {e}")
    yield

app = FastAPI(
    title="Block Rush - Backend",
    version="0.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        *[origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "").split(",") if origin.strip()],
    ],
    allow_origin_regex=cors_regex(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(game.router)
app.include_router(block.router)
app.include_router(auth.router)
app.include_router(wallet.router)
app.include_router(tracking.router)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.url.path.startswith(("/api/auth", "/api/wallet")):
        response.headers.setdefault("Cache-Control", "no-store")
    return response

@app.get("/health")
async def health():
    return {"status": "ok", "game": "Block Rush"}


@app.get("/health/db")
async def health_db():
    def check_supabase():
        client = get_supabase_client()
        users_check = (
            client
            .table(USERS_TABLE)
            .select("id,balance,bonus_balance,rollover_required,rollover_progress")
            .limit(1)
            .execute()
        )
        wallet_rpc_check = client.rpc("adjust_wallet_balance", {
            "p_user_id": "healthcheck",
            "p_delta": 0,
            "p_transaction_type": None,
            "p_reference_type": None,
            "p_reference_id": None,
            "p_idempotency_key": None,
            "p_metadata": {"diagnostic": "health_db"},
            "p_rollover_required_delta": 0,
            "p_bonus_delta": 0,
        }).execute()
        return users_check, wallet_rpc_check

    try:
        await anyio.to_thread.run_sync(check_supabase)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail="Supabase nao configurado no Render. Cadastre SUPABASE_URL e SUPABASE_SECRET_KEY.",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Supabase configurado, mas schema de carteira falhou. Rode backend/db/schema.sql no SQL Editor e confira a chave service_role/RLS.",
        ) from exc

    return {"status": "ok", "database": "supabase"}
