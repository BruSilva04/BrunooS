import json
import asyncio
import time
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from services.auth import verify_session_token
from services.casino import generate_crash_point, calculate_payout
from services.provably_fair import generate_server_seed, hash_seed
from db.database import adjust_user_balance, get_user_by_id, save_round, update_round

router = APIRouter()

MULTIPLIER_PER_SECOND = 0.085
CASHOUT_UNLOCK_MULT = 2.5
ALLOWED_BETS = {30.0, 50.0, 100.0, 200.0, 500.0}
MIN_GAME_BET = 30.0
READY_TIMEOUT_SECONDS = 18.0


def is_admin_demo(user: dict) -> bool:
    permissions = user.get("permissions") or {}
    return user.get("role") == "admin" or bool(permissions.get("admin"))


def wallet_reserve_error_message(exc: Exception) -> str:
    error_text = str(exc)
    if (
        "PGRST202" in error_text
        or "schema cache" in error_text
        or "adjust_wallet_balance" in error_text
        or "bonus_balance" in error_text
        or "rollover_required" in error_text
        or "rollover_progress" in error_text
    ):
        return "Supabase desatualizado. Rode backend/db/schema.sql no SQL Editor e aguarde o Render redeployar."
    return "Falha ao reservar saldo da rodada"


def current_multiplier(round_state: dict) -> float:
    if not round_state.get("started_at"):
        return 1.0
    elapsed = max(0.0, time.monotonic() - round_state["started_at"])
    return round(1.0 + elapsed * MULTIPLIER_PER_SECOND, 3)


async def refund_unstarted_round(round_state: dict, reason: str):
    if round_state.get("refunded"):
        return
    round_state["refunded"] = True
    round_state["status"] = "canceled"
    await update_round(round_state["round_id"], payout=0, status="canceled")
    if not round_state.get("bet_reserved"):
        return
    await adjust_user_balance(
        round_state["user_id"],
        round_state["bet"],
        transaction_type="bet_refund",
        reference_type="round",
        reference_id=round_state["round_id"],
        idempotency_key=f"bet_refund:{round_state['round_id']}",
        metadata={"reason": reason},
    )


async def schedule_ready_timeout(websocket: WebSocket, round_state: dict):
    try:
        await asyncio.sleep(READY_TIMEOUT_SECONDS)
        if round_state.get("status") != "ready":
            return
        await refund_unstarted_round(round_state, "begin_play_timeout")
        await websocket.send_json({
            "type": "round_canceled",
            "round_id": round_state["round_id"],
            "message": "Rodada cancelada por demora ao iniciar.",
        })
    except asyncio.CancelledError:
        raise
    except Exception:
        round_state["status"] = "canceled"


async def schedule_crash(websocket: WebSocket, round_state: dict):
    try:
        delay = max(0.0, (round_state["crash_point"] - 1.0) / MULTIPLIER_PER_SECOND)
        await asyncio.sleep(delay)
        if round_state.get("status") != "active":
            return

        round_state["status"] = "lost"
        await update_round(round_state["round_id"], payout=0, status="lost")
        await websocket.send_json({
            "type": "round_crashed",
            "round_id": round_state["round_id"],
            "multiplier": round_state["crash_point"],
            "crash_point": round_state["crash_point"],
            "server_seed": round_state["server_seed"]
        })
    except asyncio.CancelledError:
        raise
    except Exception:
        round_state["status"] = "lost"

@router.websocket("/ws/game")
async def game_websocket(websocket: WebSocket):
    await websocket.accept()
    
    active_round = None  # Current round state
    crash_task = None
    ready_timeout_task = None
    
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            action = msg.get("action")
            
            if action == "start_round":
                if active_round and active_round["status"] in {"ready", "active"}:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Round already active"
                    })
                    continue

                session = verify_session_token(msg.get("token"))
                if not session:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Sessao invalida"
                    })
                    continue

                user = await get_user_by_id(session["sub"])
                if not user:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Usuario nao encontrado"
                    })
                    continue

                try:
                    bet = float(msg.get("bet", MIN_GAME_BET))
                except (TypeError, ValueError):
                    await websocket.send_json({
                        "type": "error",
                        "message": "Invalid bet"
                    })
                    continue

                if bet not in ALLOWED_BETS:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Invalid bet"
                    })
                    continue

                server_seed = generate_server_seed()
                round_id = str(uuid.uuid4())
                seed_hash = hash_seed(server_seed)
                crash_point = generate_crash_point(server_seed, round_id)

                active_round = {
                    "round_id": round_id,
                    "user_id": user["id"],
                    "bet": bet,
                    "server_seed": server_seed,
                    "server_seed_hash": seed_hash,
                    "crash_point": crash_point,
                    "started_at": None,
                    "status": "ready",
                    "refunded": False,
                    "bet_reserved": False,
                }

                await save_round({
                    "round_id": round_id,
                    "user_id": user["id"],
                    "bet": bet,
                    "crash_point": crash_point,
                    "server_seed": server_seed,
                    "server_seed_hash": seed_hash,
                    "status": "ready",
                })

                await websocket.send_json({
                    "type": "round_started",
                    "round_id": round_id,
                    "server_seed_hash": seed_hash,
                    "balance": float(user.get("balance", 0) or 0),
                    "bet_reserved": False,
                    "demo_mode": is_admin_demo(user),
                })

                if crash_task:
                    crash_task.cancel()
                    crash_task = None
                if ready_timeout_task:
                    ready_timeout_task.cancel()
                ready_timeout_task = asyncio.create_task(schedule_ready_timeout(websocket, active_round))

            elif action == "begin_play":
                if not active_round or active_round["status"] != "ready":
                    await websocket.send_json({"type": "error", "message": "No round ready"})
                    continue
                if msg.get("round_id") != active_round["round_id"]:
                    await websocket.send_json({"type": "error", "message": "Invalid round"})
                    continue

                if ready_timeout_task:
                    ready_timeout_task.cancel()
                    ready_timeout_task = None

                try:
                    charged, balance = await adjust_user_balance(
                        active_round["user_id"],
                        -active_round["bet"],
                        transaction_type="bet",
                        reference_type="round",
                        reference_id=active_round["round_id"],
                        idempotency_key=f"bet:{active_round['round_id']}",
                    )
                except Exception as exc:
                    active_round["status"] = "canceled"
                    await update_round(active_round["round_id"], payout=0, status="canceled")
                    if ready_timeout_task:
                        ready_timeout_task.cancel()
                        ready_timeout_task = None
                    await websocket.send_json({
                        "type": "error",
                        "message": wallet_reserve_error_message(exc)
                    })
                    active_round = None
                    continue
                if not charged:
                    active_round["status"] = "canceled"
                    await update_round(active_round["round_id"], payout=0, status="canceled")
                    if ready_timeout_task:
                        ready_timeout_task.cancel()
                        ready_timeout_task = None
                    await websocket.send_json({
                        "type": "error",
                        "message": "Saldo insuficiente"
                    })
                    active_round = None
                    continue

                active_round["bet_reserved"] = True
                active_round["started_at"] = time.monotonic()
                active_round["status"] = "active"
                await update_round(active_round["round_id"], status="active")

                if crash_task:
                    crash_task.cancel()
                crash_task = asyncio.create_task(schedule_crash(websocket, active_round))

                await websocket.send_json({
                    "type": "play_started",
                    "round_id": active_round["round_id"],
                    "balance": balance,
                    "server_time": time.time(),
                })
            
            elif action == "cash_out":
                if not active_round or active_round["status"] != "active":
                    await websocket.send_json({"type": "error", "message": "No active round"})
                    continue
                if msg.get("round_id") != active_round["round_id"]:
                    await websocket.send_json({"type": "error", "message": "Invalid round"})
                    continue
                
                client_mult = msg.get("client_mult", 1.0)
                server_mult = current_multiplier(active_round)
                crash_point = active_round["crash_point"]
                bet = active_round["bet"]

                if server_mult < CASHOUT_UNLOCK_MULT:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Cash Out disponivel apenas a partir de {CASHOUT_UNLOCK_MULT:.2f}x"
                    })
                    continue
                
                success, payout = calculate_payout(bet, server_mult, crash_point)
                
                if success:
                    active_round["status"] = "won"
                    _, balance = await adjust_user_balance(
                        active_round["user_id"],
                        payout,
                        transaction_type="payout",
                        reference_type="round",
                        reference_id=active_round["round_id"],
                        idempotency_key=f"payout:{active_round['round_id']}",
                        metadata={"cash_out_at": server_mult},
                    )
                    await update_round(active_round["round_id"],
                        cash_out_at=server_mult, payout=payout, status="won")
                    
                    await websocket.send_json({
                        "type": "cash_out_result",
                        "success": True,
                        "payout": payout,
                        "balance": balance,
                        "multiplier": server_mult,
                        "client_multiplier": client_mult,
                        "crash_point": crash_point,
                        "server_seed": active_round["server_seed"]
                    })
                else:
                    active_round["status"] = "lost"
                    await update_round(active_round["round_id"],
                        cash_out_at=server_mult, payout=0, status="lost")
                    
                    await websocket.send_json({
                        "type": "cash_out_result",
                        "success": False,
                        "multiplier": server_mult,
                        "client_multiplier": client_mult,
                        "crash_point": crash_point,
                        "server_seed": active_round["server_seed"]
                    })
                
                active_round = None
                if crash_task:
                    crash_task.cancel()
                    crash_task = None
                if ready_timeout_task:
                    ready_timeout_task.cancel()
                    ready_timeout_task = None
            
            elif action == "death":
                if not active_round or active_round["status"] != "active":
                    await websocket.send_json({"type": "error", "message": "No active round"})
                    continue
                if msg.get("round_id") != active_round["round_id"]:
                    await websocket.send_json({"type": "error", "message": "Invalid round"})
                    continue
                
                active_round["status"] = "lost"
                await update_round(active_round["round_id"],
                    cash_out_at=current_multiplier(active_round), payout=0, status="lost")
                
                await websocket.send_json({
                    "type": "death_registered",
                    "crash_point": active_round["crash_point"],
                    "server_seed": active_round["server_seed"]
                })
                
                active_round = None
                if crash_task:
                    crash_task.cancel()
                    crash_task = None
                if ready_timeout_task:
                    ready_timeout_task.cancel()
                    ready_timeout_task = None
            
            elif action == "ping":
                await websocket.send_json({"type": "pong"})
    
    except WebSocketDisconnect:
        if active_round and active_round["status"] == "ready":
            await refund_unstarted_round(active_round, "disconnect_before_begin")
        elif active_round and active_round["status"] == "active":
            await update_round(active_round["round_id"],
                payout=0, status="lost")
        if crash_task:
            crash_task.cancel()
        if ready_timeout_task:
            ready_timeout_task.cancel()
