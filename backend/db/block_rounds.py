"""Atomic block-round persistence. Never fall back to non-transactional wallet writes."""
import anyio
from db.database import get_supabase_client


async def find_round(user_id, round_id=None):
    def query():
        request = get_supabase_client().table("rounds").select("*").eq("user_id", str(user_id)).eq("game_type", "block")
        request = request.eq("round_id", round_id) if round_id else request.eq("status", "active")
        return request.limit(1).execute()
    response = await anyio.to_thread.run_sync(query)
    return response.data[0] if response.data else None


async def call_round_rpc(name, params):
    response = await anyio.to_thread.run_sync(lambda: get_supabase_client().rpc(name, params).execute())
    result = response.data
    if isinstance(result, list):
        result = result[0] if result else None
    if not isinstance(result, dict):
        raise RuntimeError("Empty block round transaction result")
    return result
