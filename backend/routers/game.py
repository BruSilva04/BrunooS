import json
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..services.casino import generate_crash_point, calculate_payout
from ..services.provably_fair import generate_server_seed, hash_seed
from ..db.database import save_round, update_round

router = APIRouter()

@router.websocket("/ws/game")
async def game_websocket(websocket: WebSocket):
    await websocket.accept()
    
    active_round = None  # Current round state
    
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            action = msg.get("action")
            
            if action == "start_round":
                bet = msg.get("bet", 5)
                round_id = str(uuid.uuid4())
                server_seed = generate_server_seed()
                seed_hash = hash_seed(server_seed)
                crash_point = generate_crash_point(server_seed, round_id)
                
                active_round = {
                    "round_id": round_id,
                    "bet": bet,
                    "server_seed": server_seed,
                    "server_seed_hash": seed_hash,
                    "crash_point": crash_point,
                    "status": "active"
                }
                
                # Save to DB
                await save_round({
                    "round_id": round_id,
                    "bet": bet,
                    "crash_point": crash_point,
                    "server_seed": server_seed,
                    "server_seed_hash": seed_hash
                })
                
                await websocket.send_json({
                    "type": "round_started",
                    "round_id": round_id,
                    "server_seed_hash": seed_hash,
                    "crash_point": crash_point  # SEND crash_point so client can trigger forced death
                })
            
            elif action == "cash_out":
                if not active_round or active_round["status"] != "active":
                    await websocket.send_json({"type": "error", "message": "No active round"})
                    continue
                
                client_mult = msg.get("client_mult", 1.0)
                crash_point = active_round["crash_point"]
                bet = active_round["bet"]
                
                success, payout = calculate_payout(bet, client_mult, crash_point)
                
                if success:
                    active_round["status"] = "won"
                    await update_round(active_round["round_id"],
                        cash_out_at=client_mult, payout=payout, status="won")
                    
                    await websocket.send_json({
                        "type": "cash_out_result",
                        "success": True,
                        "payout": payout,
                        "crash_point": crash_point,
                        "server_seed": active_round["server_seed"]
                    })
                else:
                    active_round["status"] = "lost"
                    await update_round(active_round["round_id"],
                        cash_out_at=client_mult, payout=0, status="lost")
                    
                    await websocket.send_json({
                        "type": "cash_out_result",
                        "success": False,
                        "crash_point": crash_point,
                        "server_seed": active_round["server_seed"]
                    })
                
                active_round = None
            
            elif action == "death":
                if not active_round or active_round["status"] != "active":
                    await websocket.send_json({"type": "error", "message": "No active round"})
                    continue
                
                active_round["status"] = "lost"
                await update_round(active_round["round_id"],
                    payout=0, status="lost")
                
                await websocket.send_json({
                    "type": "death_registered",
                    "crash_point": active_round["crash_point"],
                    "server_seed": active_round["server_seed"]
                })
                
                active_round = None
            
            elif action == "ping":
                await websocket.send_json({"type": "pong"})
    
    except WebSocketDisconnect:
        # If player disconnects mid-round, mark as lost
        if active_round and active_round["status"] == "active":
            await update_round(active_round["round_id"],
                payout=0, status="lost")
