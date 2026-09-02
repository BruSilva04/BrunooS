import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import anyio
from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

ROUNDS_TABLE = "rounds"
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
