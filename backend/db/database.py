import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import anyio
from dotenv import load_dotenv
from supabase import Client, create_client
from services.auth import hash_password

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

ROUNDS_TABLE = "rounds"
USERS_TABLE = "users"
ROUND_COLUMNS = {
    "round_id",
    "user_id",
    "bet",
    "crash_point",
    "cash_out_at",
    "payout",
    "server_seed",
    "server_seed_hash",
    "status",
}
USER_COLUMNS = {
    "id",
    "phone",
    "email",
    "username",
    "password_hash",
    "role",
    "permissions",
    "balance",
}


@lru_cache
def get_supabase_client() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = (
        os.getenv("SUPABASE_SECRET_KEY")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_KEY")
    )

    if not url or not key:
        raise RuntimeError(
            "Configure SUPABASE_URL and SUPABASE_SECRET_KEY in the backend environment."
        )

    return create_client(url, key)


async def init_db():
    await anyio.to_thread.run_sync(get_supabase_client)
    await ensure_admin_user()


async def ensure_admin_user():
    username = os.getenv("ADMIN_USERNAME", "admin")
    password = os.getenv("ADMIN_PASSWORD", "@dm1n_")
    payload = {
        "username": username,
        "email": os.getenv("ADMIN_EMAIL", "admin@sereiadotesouro.local"),
        "phone": os.getenv("ADMIN_PHONE", "+5500000000000"),
        "password_hash": hash_password(password),
        "role": "admin",
        "permissions": {"admin": True, "play": True, "wallet": True, "users": True},
        "balance": 100000.0,
    }

    existing = await get_user_by_username(username)

    def upsert_admin():
        client = get_supabase_client()
        if existing:
            return (
                client.table(USERS_TABLE)
                .update(payload)
                .eq("id", existing["id"])
                .execute()
            )
        return client.table(USERS_TABLE).insert(payload).execute()

    await anyio.to_thread.run_sync(upsert_admin)


def _round_payload(round_data: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "round_id": round_data.get("round_id"),
        "user_id": round_data.get("user_id", "anonymous"),
        "bet": round_data.get("bet"),
        "crash_point": round_data.get("crash_point"),
        "cash_out_at": round_data.get("cash_out_at"),
        "payout": round_data.get("payout", 0),
        "server_seed": round_data.get("server_seed"),
        "server_seed_hash": round_data.get("server_seed_hash"),
        "status": round_data.get("status", "active"),
    }
    return {key: value for key, value in payload.items() if value is not None}


async def save_round(round_data: dict[str, Any]):
    payload = _round_payload(round_data)

    def insert_round():
        return get_supabase_client().table(ROUNDS_TABLE).insert(payload).execute()

    await anyio.to_thread.run_sync(insert_round)


def _user_payload(user_data: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in user_data.items()
        if key in USER_COLUMNS and key != "id" and value is not None
    }


async def create_user(user_data: dict[str, Any]) -> dict[str, Any]:
    payload = _user_payload(user_data)

    def insert_user():
        return get_supabase_client().table(USERS_TABLE).insert(payload).execute()

    response = await anyio.to_thread.run_sync(insert_user)
    return response.data[0]


async def get_user_by_username(username: str) -> dict[str, Any] | None:
    def fetch_user():
        return (
            get_supabase_client()
            .table(USERS_TABLE)
            .select("*")
            .eq("username", username)
            .limit(1)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_user)
    return response.data[0] if response.data else None


async def get_user_by_email(email: str) -> dict[str, Any] | None:
    def fetch_user():
        return (
            get_supabase_client()
            .table(USERS_TABLE)
            .select("*")
            .eq("email", email)
            .limit(1)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_user)
    return response.data[0] if response.data else None


async def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    def fetch_user():
        return (
            get_supabase_client()
            .table(USERS_TABLE)
            .select("*")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_user)
    return response.data[0] if response.data else None


async def adjust_user_balance(user_id: str, delta: float) -> tuple[bool, float]:
    user = await get_user_by_id(user_id)
    if not user:
        return False, 0.0

    current_balance = float(user.get("balance", 0) or 0)
    new_balance = round(current_balance + delta, 2)
    if new_balance < 0:
        return False, current_balance

    def update_balance():
        return (
            get_supabase_client()
            .table(USERS_TABLE)
            .update({"balance": new_balance})
            .eq("id", user_id)
            .execute()
        )

    await anyio.to_thread.run_sync(update_balance)
    return True, new_balance


def _round_multiplier(round_data: dict[str, Any]) -> float:
    if round_data.get("cash_out_at") is not None:
        return float(round_data["cash_out_at"])
    return float(round_data.get("crash_point", 1.0) or 1.0)


async def get_lobby_snapshot(user_id: str) -> dict[str, Any] | None:
    user = await get_user_by_id(user_id)
    if not user:
        return None

    def fetch_rounds():
        return (
            get_supabase_client()
            .table(ROUNDS_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_rounds)
    rounds = response.data or []
    won_rounds = [round_data for round_data in rounds if round_data.get("status") == "won"]
    max_mult = max([_round_multiplier(round_data) for round_data in rounds], default=1.0)
    win_rate = round((len(won_rounds) / len(rounds)) * 100) if rounds else 0

    history = []
    for round_data in rounds[:6]:
        won = round_data.get("status") == "won"
        bet = float(round_data.get("bet", 0) or 0)
        payout = float(round_data.get("payout", 0) or 0)
        history.append({
            "round_id": round_data.get("round_id"),
            "mult": _round_multiplier(round_data),
            "won": won,
            "bet": bet,
            "payout": round(payout - bet, 2) if won else -bet,
        })

    return {
        "user": {
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
            "phone": user.get("phone", ""),
            "role": user.get("role", "player"),
            "permissions": user.get("permissions", {}),
        },
        "balance": float(user.get("balance", 0) or 0),
        "stats": {
            "rounds": len(rounds),
            "maxMult": round(max_mult, 2),
            "winRate": win_rate,
        },
        "history": history,
    }


async def update_round(round_id: str, **kwargs: Any):
    updates = {
        key: value
        for key, value in kwargs.items()
        if key in ROUND_COLUMNS and key != "round_id"
    }
    if not updates:
        return

    def update_existing_round():
        return (
            get_supabase_client()
            .table(ROUNDS_TABLE)
            .update(updates)
            .eq("round_id", round_id)
            .execute()
        )

    await anyio.to_thread.run_sync(update_existing_round)


async def get_round(round_id: str) -> dict[str, Any] | None:
    def fetch_round():
        return (
            get_supabase_client()
            .table(ROUNDS_TABLE)
            .select("*")
            .eq("round_id", round_id)
            .limit(1)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_round)
    return response.data[0] if response.data else None
