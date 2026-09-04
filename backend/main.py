from contextlib import asynccontextmanager
import os

import anyio
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from routers import auth
from routers import game
from db.database import USERS_TABLE
from db.database import get_supabase_client
from db.database import init_db

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await init_db()
    except Exception as e:
        print(f"DB init notice: {e}")
    yield

app = FastAPI(
    title="Sereia do Tesouro - Backend",
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
    allow_origin_regex=r"^(https://[a-z0-9-]+\.vercel\.app|https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):(3000|3001|5173))$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(game.router)
app.include_router(auth.router)

@app.get("/health")
async def health():
    return {"status": "ok", "game": "Sereia do Tesouro"}


@app.get("/health/db")
async def health_db():
    def check_supabase():
        return (
            get_supabase_client()
            .table(USERS_TABLE)
            .select("id")
            .limit(1)
            .execute()
        )

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
            detail="Supabase configurado, mas consulta falhou. Confira a chave service_role, RLS/permissoes e se backend/db/schema.sql foi aplicado.",
        ) from exc

    return {"status": "ok", "database": "supabase"}
