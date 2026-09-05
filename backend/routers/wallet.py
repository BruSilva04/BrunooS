import os

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from db.database import (
    confirm_payment_intent,
    create_operator_settlement,
    create_payment_intent,
    create_withdrawal_request,
    get_operator_finance_report,
    get_payment_intent,
    get_user_by_id,
    list_wallet_snapshot,
)
from services.auth import verify_session_token

router = APIRouter(prefix="/api/wallet", tags=["wallet"])


class DepositIntentRequest(BaseModel):
    amount: float = Field(ge=20, le=5000)


class WithdrawRequest(BaseModel):
    amount: float = Field(ge=20, le=5000)
    pix_key: str = Field(min_length=5, max_length=140)
    pix_key_type: str = Field(default="random", pattern=r"^(cpf|cnpj|email|phone|random)$")


class OperatorSettlementRequest(BaseModel):
    amount: float = Field(ge=20, le=1000000)


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        return None
    return authorization[len(prefix):]


async def current_user(authorization: str | None) -> dict:
    session = verify_session_token(bearer_token(authorization))
    if not session:
        raise HTTPException(status_code=401, detail="Sessao invalida")

    user = await get_user_by_id(session["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="Usuario nao encontrado")
    return user


def is_admin(user: dict) -> bool:
    permissions = user.get("permissions") or {}
    return user.get("role") == "admin" or bool(permissions.get("admin"))


@router.get("/me")
async def wallet_me(authorization: str | None = Header(default=None)):
    user = await current_user(authorization)
    snapshot = await list_wallet_snapshot(user["id"])
    if not snapshot:
        raise HTTPException(status_code=404, detail="Wallet nao encontrada")
    return snapshot


@router.post("/deposit-intents")
async def deposit_intent(
    payload: DepositIntentRequest,
    authorization: str | None = Header(default=None),
):
    user = await current_user(authorization)
    provider = os.getenv("PAYMENT_PROVIDER", "sandbox").strip() or "sandbox"
    if provider != "sandbox":
        raise HTTPException(status_code=501, detail=f"Provider {provider} ainda nao implementado")

    intent = await create_payment_intent(user["id"], payload.amount, provider)
    return {
        "intent": intent,
        "sandbox": provider == "sandbox",
        "message": "Pix sandbox criado. Em producao, o credito acontece somente por webhook do provedor.",
    }


@router.post("/deposit-intents/{intent_id}/sandbox-confirm")
async def sandbox_confirm_deposit(
    intent_id: str,
    authorization: str | None = Header(default=None),
):
    user = await current_user(authorization)
    intent = await get_payment_intent(intent_id)
    if not intent:
        raise HTTPException(status_code=404, detail="Deposito nao encontrado")
    if intent.get("provider") != "sandbox":
        raise HTTPException(status_code=400, detail="Confirmacao manual permitida apenas em sandbox")
    if intent.get("user_id") != user["id"] and not is_admin(user):
        raise HTTPException(status_code=403, detail="Sem permissao para confirmar este deposito")

    updated = await confirm_payment_intent(intent_id, user["id"])
    if not updated:
        raise HTTPException(status_code=409, detail="Nao foi possivel confirmar o deposito")
    return {"intent": updated}


@router.post("/withdrawals")
async def withdrawal_request(
    payload: WithdrawRequest,
    authorization: str | None = Header(default=None),
):
    user = await current_user(authorization)
    ok, result = await create_withdrawal_request(
        user["id"],
        payload.amount,
        payload.pix_key.strip(),
        payload.pix_key_type,
    )
    if not ok:
        raise HTTPException(status_code=409, detail=f"Saldo insuficiente. Saldo atual: R$ {float(result):.2f}")
    return {
        "withdrawal": result,
        "message": "Saque solicitado. Em producao, o pagamento Pix de saida deve passar por revisao/webhook.",
    }


@router.get("/admin/operator-report")
async def operator_report(authorization: str | None = Header(default=None)):
    user = await current_user(authorization)
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Acesso exclusivo para admin")
    return await get_operator_finance_report()


@router.post("/admin/operator-settlements")
async def operator_settlement(
    payload: OperatorSettlementRequest,
    authorization: str | None = Header(default=None),
):
    user = await current_user(authorization)
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Acesso exclusivo para admin")

    ok, result = await create_operator_settlement(user["id"], payload.amount)
    if not ok:
        raise HTTPException(
            status_code=409,
            detail=f"Valor acima do disponivel para settlement. Disponivel: R$ {float(result):.2f}",
        )
    return {
        "settlement": result,
        "message": "Settlement solicitado. Em producao, essa saida deve ser conciliada com a conta da empresa.",
    }
