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

MULTIPLIER_PER_SECOND = 0.12
ALLOWED_BETS = {2.0, 5.0, 10.0, 20.0, 50.0}


def current_multiplier(round_state: dict) -> float:
    elapsed = max(0.0, time.monotonic() - round_state["started_at"])
    return round(1.0 + elapsed * MULTIPLIER_PER_SECOND, 3)


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
    
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            action = msg.get("action")
            
            if action == "start_round":
                if active_round and active_round["status"] == "active":
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
                    bet = float(msg.get("bet", 5))
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

                charged, balance = await adjust_user_balance(user["id"], -bet)
                if not charged:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Saldo insuficiente"
                    })
                    continue

                round_id = str(uuid.uuid4())
                server_seed = generate_server_seed()
                seed_hash = hash_seed(server_seed)
                crash_point = generate_crash_point(server_seed, round_id)
                
                active_round = {
                    "round_id": round_id,
                    "user_id": user["id"],
                    "bet": bet,
                    "server_seed": server_seed,
                    "server_seed_hash": seed_hash,
                    "crash_point": crash_point,
                    "started_at": time.monotonic(),
                    "status": "active"
                }
                
                # Save to DB
                await save_round({
                    "round_id": round_id,
                    "user_id": user["id"],
                    "bet": bet,
                    "crash_point": crash_point,
                    "server_seed": server_seed,
                    "server_seed_hash": seed_hash
                })
                
                await websocket.send_json({
                    "type": "round_started",
                    "round_id": round_id,
                    "server_seed_hash": seed_hash,
                    "balance": balance
                })

                if crash_task:
                    crash_task.cancel()
                crash_task = asyncio.create_task(schedule_crash(websocket, active_round))
            
            elif action == "cash_out":
                if not active_round or active_round["status"] != "active":
                    await websocket.send_json({"type": "error", "message": "No active round"})
                    continue
                
                client_mult = msg.get("client_mult", 1.0)
                server_mult = current_multiplier(active_round)
                crash_point = active_round["crash_point"]
                bet = active_round["bet"]
                
                success, payout = calculate_payout(bet, server_mult, crash_point)
                
                if success:
                    active_round["status"] = "won"
                    _, balance = await adjust_user_balance(active_round["user_id"], payout)
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
            
            elif action == "death":
                if not active_round or active_round["status"] != "active":
                    await websocket.send_json({"type": "error", "message": "No active round"})
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
            
            elif action == "ping":
                await websocket.send_json({"type": "pong"})
    
    except WebSocketDisconnect:
        # If player disconnects mid-round, mark as lost
        if active_round and active_round["status"] == "active":
            await update_round(active_round["round_id"],
                payout=0, status="lost")
        if crash_task:
            crash_task.cancel()
