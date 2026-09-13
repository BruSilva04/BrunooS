from decimal import Decimal
import logging
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from db.block_rounds import call_round_rpc, find_round
from db.database import get_user_by_id
from routers.auth import bearer_token
from services.account_mode import is_demo_user
from services.auth import verify_session_token
from services.block_puzzle import (
    ALLOWED_BETS_CENTS, CASHOUT_CLEARS, apply_move, multiplier_hundredths, new_state, payout_cents,
)
from services.provably_fair import generate_server_seed, hash_seed

router = APIRouter(prefix="/api/block", tags=["block"])
logger = logging.getLogger(__name__)


class StartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    bet: Decimal = Field(gt=0, le=500, decimal_places=2)


class RoundAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action_id: UUID
    version: int = Field(ge=0, strict=True)


class MoveRequest(RoundAction):
    piece_id: str = Field(min_length=1, max_length=64)
    row: int = Field(ge=0, lt=8, strict=True)
    col: int = Field(ge=0, lt=8, strict=True)


async def current_player(authorization):
    session = verify_session_token(bearer_token(authorization))
    if not session:
        raise HTTPException(401, "Sua sessão expirou. Entre novamente.")
    user = await get_user_by_id(session["sub"])
    if not user:
        raise HTTPException(401, "Conta não encontrada.")
    if (user.get("permissions") or {}).get("play") is False:
        raise HTTPException(403, "Esta conta não tem permissão para jogar.")
    return user


def snapshot(round_data, balance):
    state = round_data["game_state"]
    bet_cents = int(Decimal(str(round_data["bet"])) * 100)
    return {
        "demo_mode": False, "round_id": round_data["round_id"], "bet": bet_cents / 100,
        "balance": float(balance), "status": round_data["status"],
        "version": round_data["version"], "last_action_id": round_data.get("last_action_id"),
        "board": state["board"], "pieces": state["pieces"], "moves": state["moves"],
        "total_clears": state["total_clears"], "best_combo": state["best_combo"],
        "difficulty_tier": state["difficulty_tier"],
        "cashout_unlocked": state["total_clears"] >= CASHOUT_CLEARS,
        "multiplier": multiplier_hundredths(state) / 100,
        "value": payout_cents(bet_cents, state) / 100,
        "payout": float(round_data.get("payout", 0)),
    }


def rpc_snapshot(result):
    if not result.get("ok"):
        errors = {"insufficient_balance": (409, "Saldo insuficiente para esta aposta."),
                  "conflict": (409, "A rodada foi atualizada. Sincronize para continuar."),
                  "not_found": (404, "Rodada não encontrada."),
                  "invalid": (422, "Operação inválida para esta rodada.")}
        status, message = errors.get(result.get("reason"), (409, "Não foi possível concluir a rodada."))
        raise HTTPException(status, message)
    return snapshot(result["round"], result["balance"])


def unavailable(exc):
    logger.exception("Block round persistence failed", exc_info=exc)
    return HTTPException(503, "O jogo está temporariamente indisponível. Sua rodada pode ser retomada.")


@router.post("/rounds")
async def start_round(payload: StartRequest, authorization: str | None = Header(default=None)):
    user = await current_player(authorization)
    bet_cents = int(payload.bet * 100)
    if bet_cents not in ALLOWED_BETS_CENTS:
        raise HTTPException(422, "Valor de aposta inválido.")
    if is_demo_user(user):
        return {"demo_mode": True, "bet": bet_cents / 100, "balance": float(user.get("balance", 0))}
    seed = generate_server_seed()
    try:
        result = await call_round_rpc("start_block_round", {
            "p_user_id": str(user["id"]), "p_round_id": str(payload.request_id),
            "p_bet": float(payload.bet), "p_state": new_state(),
            "p_server_seed": seed, "p_seed_hash": hash_seed(seed),
        })
        return rpc_snapshot(result)
    except HTTPException:
        raise
    except Exception as exc:
        raise unavailable(exc) from exc


async def owned_round(user, round_id):
    if is_demo_user(user):
        raise HTTPException(403, "A conta demo não liquida rodadas com saldo real.")
    result = await find_round(user["id"], str(round_id))
    if not result:
        raise HTTPException(404, "Rodada não encontrada.")
    return result


@router.get("/rounds/{round_id}")
async def read_round(round_id: UUID, authorization: str | None = Header(default=None)):
    user = await current_player(authorization)
    if is_demo_user(user):
        raise HTTPException(403, "A conta demo não liquida rodadas com saldo real.")
    try:
        return rpc_snapshot(await call_round_rpc("read_block_round", {
            "p_user_id": str(user["id"]), "p_round_id": str(round_id),
        }))
    except HTTPException:
        raise
    except Exception as exc:
        raise unavailable(exc) from exc


async def perform_action(user, round_id, payload, move=False):
    try:
        current = await owned_round(user, round_id)
        if current.get("last_action_id") == str(payload.action_id):
            return rpc_snapshot(await call_round_rpc("read_block_round", {
                "p_user_id": str(user["id"]), "p_round_id": str(round_id),
            }))
        if current["status"] != "active" or current["version"] != payload.version:
            raise HTTPException(409, "A rodada foi atualizada. Sincronize para continuar.")
        state = current["game_state"]
        if move:
            try:
                state, status = apply_move(state, payload.piece_id, payload.row, payload.col)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            payout = 0
        else:
            if state["total_clears"] < CASHOUT_CLEARS:
                raise HTTPException(409, "Complete três linhas ou colunas para liberar o resgate.")
            status = "won"
            payout = payout_cents(int(Decimal(str(current["bet"])) * 100), state)
        return rpc_snapshot(await call_round_rpc("commit_block_round", {
            "p_user_id": str(user["id"]), "p_round_id": str(round_id),
            "p_action_id": str(payload.action_id), "p_version": payload.version,
            "p_state": state, "p_status": status, "p_payout_cents": payout,
        }))
    except HTTPException:
        raise
    except Exception as exc:
        raise unavailable(exc) from exc


@router.post("/rounds/{round_id}/moves")
async def move_piece(round_id: UUID, payload: MoveRequest, authorization: str | None = Header(default=None)):
    return await perform_action(await current_player(authorization), round_id, payload, move=True)


@router.post("/rounds/{round_id}/cashout")
async def cashout(round_id: UUID, payload: RoundAction, authorization: str | None = Header(default=None)):
    return await perform_action(await current_player(authorization), round_id, payload)
