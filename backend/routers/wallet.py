import os
import hashlib
import hmac

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from db.database import (
    adjust_user_balance,
    confirm_payment_intent,
    create_operator_settlement,
    create_payment_intent,
    create_withdrawal_request,
    get_operator_finance_report,
    get_operator_settlement_by_provider_transfer_id,
    get_payment_intent,
    get_payment_intent_by_provider_id,
    get_user_by_id,
    get_withdrawal_request,
    get_withdrawal_by_provider_transfer_id,
    list_wallet_snapshot,
    update_user_profile,
    update_operator_settlement,
    update_payment_intent,
    update_withdrawal_request,
)
from services import amplopay
from services.auth import verify_session_token

router = APIRouter(prefix="/api/wallet", tags=["wallet"])

PAYMENT_TERMINAL_EVENTS = {
    "TRANSACTION_CANCELED",
    "TRANSACTION_REFUNDED",
    "TRANSACTION_CHARGED_BACK",
}


class DepositIntentRequest(BaseModel):
    amount: float = Field(ge=20, le=5000)
    customer_name: str | None = Field(default=None, min_length=3, max_length=120)
    customer_document: str | None = Field(default=None, min_length=11, max_length=18)
    customer_document_type: str | None = Field(default="cpf", pattern=r"^(cpf|cnpj)$")


class WithdrawRequest(BaseModel):
    amount: float = Field(ge=20, le=5000)
    pix_key: str = Field(min_length=5, max_length=140)
    pix_key_type: str = Field(default="random", pattern=r"^(cpf|cnpj|email|phone|random)$")
    owner_name: str | None = Field(default=None, min_length=3, max_length=120)
    owner_document: str | None = Field(default=None, min_length=11, max_length=18)
    owner_document_type: str | None = Field(default="cpf", pattern=r"^(cpf|cnpj)$")


class OperatorSettlementRequest(BaseModel):
    amount: float = Field(ge=20, le=1000000)
    pix_key: str | None = Field(default=None, min_length=5, max_length=140)
    pix_key_type: str | None = Field(default="random", pattern=r"^(cpf|cnpj|email|phone|random)$")
    owner_name: str | None = Field(default=None, min_length=3, max_length=120)
    owner_document: str | None = Field(default=None, min_length=11, max_length=18)
    owner_document_type: str | None = Field(default="cpf", pattern=r"^(cpf|cnpj)$")


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


def payment_provider() -> str:
    return os.getenv("PAYMENT_PROVIDER", "sandbox").strip().lower() or "sandbox"


def require_amplopay_webhook_token() -> bool:
    return os.getenv("AMPLOPAY_REQUIRE_WEBHOOK_TOKEN", "true").lower() != "false"


def wallet_schema_unavailable(exc: Exception) -> HTTPException:
    error_text = str(exc)
    if "campaign_id" in error_text or "affiliates" in error_text or "campaigns" in error_text:
        detail = "Schema de aquisicao desatualizado. Rode backend/db/schema.sql no SQL Editor do Supabase."
    else:
        detail = "Falha ao acessar carteira no Supabase."
    return HTTPException(status_code=503, detail=detail)


def callback_url(path: str) -> str:
    base_url = (
        os.getenv("BACKEND_PUBLIC_URL")
        or os.getenv("RENDER_EXTERNAL_URL")
        or ""
    ).strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=503, detail="Configure BACKEND_PUBLIC_URL para webhooks Amplopay")
    return f"{base_url}{path}"


def only_digits(value: str | None) -> str:
    return "".join(char for char in str(value or "") if char.isdigit())


def redacted_payload(value):
    sensitive_keys = {
        "document",
        "cpf",
        "cnpj",
        "taxid",
        "tax_id",
        "secret",
        "secretkey",
        "secret_key",
        "token",
        "webhooktoken",
        "webhook_token",
        "x-secret-key",
    }
    if isinstance(value, dict):
        clean = {}
        for key, item in value.items():
            normalized = "".join(char for char in str(key).lower() if char.isalnum() or char == "_")
            if normalized in sensitive_keys:
                clean[key] = "***redacted***"
            else:
                clean[key] = redacted_payload(item)
        return clean
    if isinstance(value, list):
        return [redacted_payload(item) for item in value]
    return value


def first_number(*values) -> float | None:
    for value in values:
        try:
            if value is None or value == "":
                continue
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def webhook_token_hash(token: str | None) -> str | None:
    if not token:
        return None
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def validate_webhook_token(metadata: dict, received_token: str | None) -> None:
    expected_hash = metadata.get("webhook_token_hash")
    if expected_hash and received_token:
        if not hmac.compare_digest(webhook_token_hash(received_token) or "", expected_hash):
            raise HTTPException(status_code=401, detail="Token de webhook invalido")
        return

    expected_token = metadata.get("webhook_token")
    if expected_token:
        if received_token != expected_token:
            raise HTTPException(status_code=401, detail="Token de webhook invalido")
        return
    if require_amplopay_webhook_token():
        raise HTTPException(status_code=401, detail="Webhook sem token esperado salvo")


def validate_payment_amount(intent: dict, transaction: dict, payload: dict) -> None:
    amount = first_number(
        transaction.get("amount"),
        transaction.get("value"),
        transaction.get("total"),
        transaction.get("totalAmount"),
        payload.get("amount"),
    )
    if amount is None:
        return
    expected = round(float(intent.get("amount", 0) or 0), 2)
    if abs(round(amount, 2) - expected) > 0.01:
        raise HTTPException(status_code=409, detail="Valor do webhook nao confere com o deposito")


def validate_transfer_amount(record: dict, withdraw: dict, payload: dict) -> None:
    amount = first_number(
        withdraw.get("amount"),
        withdraw.get("value"),
        withdraw.get("total"),
        payload.get("amount"),
    )
    if amount is None:
        return
    expected = round(float(record.get("amount", 0) or 0), 2)
    if abs(round(amount, 2) - expected) > 0.01:
        raise HTTPException(status_code=409, detail="Valor do webhook nao confere com a transferencia")


async def deposit_customer(user: dict, payload: DepositIntentRequest) -> dict:
    legal_name = (user.get("legal_name") or payload.customer_name or "").strip()
    document = only_digits(user.get("document") or payload.customer_document)
    document_type = (user.get("document_type") or payload.customer_document_type or "cpf").strip().lower()

    if len(legal_name) < 3 or len(document) < 11:
        raise HTTPException(
            status_code=422,
            detail="Informe nome completo e CPF/CNPJ para gerar Pix real.",
        )
    if document_type == "cpf" and len(document) != 11:
        raise HTTPException(status_code=422, detail="CPF precisa ter 11 digitos")
    if document_type == "cnpj" and len(document) != 14:
        raise HTTPException(status_code=422, detail="CNPJ precisa ter 14 digitos")

    if not user.get("legal_name") or not user.get("document"):
        user = await update_user_profile(
            user["id"],
            legal_name=legal_name,
            document=document,
            document_type=document_type,
        ) or user

    return {
        "name": legal_name,
        "email": user["email"],
        "phone": user.get("phone", ""),
        "document": document,
        "document_type": document_type,
    }


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
    provider = payment_provider()
    if provider not in {"sandbox", "amplopay"}:
        raise HTTPException(status_code=501, detail=f"Provider {provider} nao suportado")

    customer = None
    if provider == "amplopay":
        customer = await deposit_customer(user, payload)

    try:
        intent = await create_payment_intent(
            user["id"],
            payload.amount,
            provider,
            campaign_id=user.get("acquisition_campaign_id"),
        )
    except Exception as exc:
        raise wallet_schema_unavailable(exc) from exc

    if provider == "amplopay":
        try:
            gateway_response = await amplopay.create_pix_receive(
                amount=payload.amount,
                identifier=intent["id"],
                customer=customer,
                callback_url=callback_url("/api/wallet/webhooks/amplopay/payment"),
            )
        except amplopay.AmploPayError as exc:
            await update_payment_intent(intent["id"], status="failed", metadata={"error": str(exc)})
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        pix = gateway_response.get("pix") or {}
        intent = await update_payment_intent(
            intent["id"],
            provider_payment_id=gateway_response.get("transactionId"),
            status="pending",
            pix_qr_code=pix.get("image"),
            pix_copy_paste=pix.get("code"),
            metadata={
                "mode": "amplopay",
                "webhook_token_hash": webhook_token_hash(gateway_response.get("webhookToken")),
                "gateway_status": gateway_response.get("status"),
                "customer": {
                    "name": customer["name"],
                    "email": customer["email"],
                    "phone": customer["phone"],
                    "document_last4": customer["document"][-4:],
                    "document_type": customer["document_type"],
                },
                "gateway_response": redacted_payload(gateway_response),
            },
        ) or intent

    return {
        "intent": intent,
        "sandbox": provider == "sandbox",
        "message": "Pix criado. O credito acontece somente apos confirmacao do provedor.",
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
    request: Request,
    payload: WithdrawRequest,
    authorization: str | None = Header(default=None),
):
    user = await current_user(authorization)
    provider = payment_provider()
    if provider not in {"sandbox", "amplopay"}:
        raise HTTPException(status_code=501, detail=f"Provider {provider} nao suportado")

    if provider == "amplopay":
        if not payload.owner_name or not payload.owner_document:
            raise HTTPException(status_code=422, detail="Nome e documento do titular sao obrigatorios para saque Amplopay")

    ok, result = await create_withdrawal_request(
        user["id"],
        payload.amount,
        payload.pix_key.strip(),
        payload.pix_key_type,
        owner_name=payload.owner_name,
        owner_document=payload.owner_document,
        owner_document_type=payload.owner_document_type,
    )
    if not ok:
        if isinstance(result, dict) and result.get("reason") == "rollover":
            remaining = float((result.get("rollover") or {}).get("remaining", 0) or 0)
            raise HTTPException(
                status_code=409,
                detail=f"Rollover pendente. Movimente mais R$ {remaining:.2f} antes de sacar.",
            )
        raise HTTPException(status_code=409, detail=f"Saldo insuficiente. Saldo atual: R$ {float(result):.2f}")

    if provider == "amplopay":
        request_ip = request.client.host if request.client else "127.0.0.1"
        try:
            gateway_response = await amplopay.create_pix_transfer(
                amount=payload.amount,
                identifier=result["id"],
                pix_key=payload.pix_key.strip(),
                pix_key_type=payload.pix_key_type,
                owner_name=payload.owner_name or user["username"],
                owner_document=payload.owner_document or "",
                owner_document_type=payload.owner_document_type or "cpf",
                ip=request_ip,
                callback_url=callback_url("/api/wallet/webhooks/amplopay/transfer"),
            )
        except amplopay.AmploPayError as exc:
            await adjust_user_balance(
                user["id"],
                payload.amount,
                transaction_type="withdrawal_refund",
                reference_type="withdrawal_request",
                reference_id=result["id"],
                idempotency_key=f"withdrawal_refund:{result['id']}",
                metadata={"reason": str(exc)},
            )
            await update_withdrawal_request(result["id"], status="failed", metadata={"error": str(exc)})
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        withdraw = gateway_response.get("withdraw") or {}
        result = await update_withdrawal_request(
            result["id"],
            status=str(withdraw.get("status") or "processing").lower(),
            provider_transfer_id=withdraw.get("id"),
            metadata={
                **(result.get("metadata") or {}),
                "mode": "amplopay",
                "webhook_token_hash": webhook_token_hash(gateway_response.get("webhookToken")),
                "gateway_response": redacted_payload(gateway_response),
            },
        ) or result

    return {
        "withdrawal": result,
        "message": "Saque solicitado. Em producao, o pagamento Pix de saida deve passar por revisao/webhook.",
    }


@router.post("/webhooks/amplopay/payment")
async def amplopay_payment_webhook(request: Request):
    payload = await request.json()
    event = payload.get("event")
    token = payload.get("token")
    transaction = payload.get("transaction") or payload.get("payment") or payload
    provider_id = transaction.get("id") or transaction.get("transactionId")
    identifier = transaction.get("identifier") or transaction.get("clientIdentifier") or payload.get("identifier")
    intent = await get_payment_intent_by_provider_id("amplopay", provider_id) if provider_id else None
    if not intent and identifier:
        intent = await get_payment_intent(identifier)
    if not intent:
        raise HTTPException(status_code=404, detail="Deposito nao encontrado")

    metadata = intent.get("metadata") or {}
    validate_webhook_token(metadata, token)

    if event == "TRANSACTION_PAID":
        validate_payment_amount(intent, transaction, payload)
        updated = await confirm_payment_intent(intent["id"], "amplopay_webhook")
    elif event in PAYMENT_TERMINAL_EVENTS:
        status = event.replace("TRANSACTION_", "").lower()
        updated = await update_payment_intent(
            intent["id"],
            status=status,
            metadata={**metadata, "last_webhook": redacted_payload(payload)},
        )
    else:
        updated = await update_payment_intent(
            intent["id"],
            metadata={**metadata, "last_webhook": redacted_payload(payload)},
        )

    return {"ok": True, "intent": updated}


@router.post("/webhooks/amplopay/transfer")
async def amplopay_transfer_webhook(request: Request):
    payload = await request.json()
    event = payload.get("event")
    token = payload.get("token")
    withdraw = payload.get("withdraw") or {}
    provider_id = withdraw.get("id")
    identifier = withdraw.get("clientIdentifier") or withdraw.get("identifier") or payload.get("identifier")
    withdrawal = await get_withdrawal_by_provider_transfer_id(provider_id) if provider_id else None
    if not withdrawal and identifier:
        withdrawal = await get_withdrawal_request(identifier)
    operator_settlement = None
    if not withdrawal and provider_id:
        operator_settlement = await get_operator_settlement_by_provider_transfer_id(provider_id)
    if not withdrawal and not operator_settlement:
        raise HTTPException(status_code=404, detail="Transferencia nao encontrada")

    record = withdrawal or operator_settlement
    metadata = record.get("metadata") or {}
    validate_webhook_token(metadata, token)
    validate_transfer_amount(record, withdraw, payload)

    if event == "TRANSFER_COMPLETED":
        status = "paid"
    elif event == "TRANSFER_FAILED":
        status = "failed"
        if withdrawal:
            await adjust_user_balance(
                withdrawal["user_id"],
                float(withdrawal.get("amount", 0) or 0),
                transaction_type="withdrawal_refund",
                reference_type="withdrawal_request",
                reference_id=withdrawal["id"],
                idempotency_key=f"withdrawal_refund:{withdrawal['id']}",
                metadata={"webhook": redacted_payload(payload)},
            )
    else:
        status = str(withdraw.get("status") or "processing").lower()

    if withdrawal:
        updated = await update_withdrawal_request(
            withdrawal["id"],
            status=status,
            metadata={**metadata, "last_webhook": redacted_payload(payload)},
        )
        return {"ok": True, "withdrawal": updated}

    updated = await update_operator_settlement(
        operator_settlement["id"],
        status=status,
        metadata={**metadata, "last_webhook": redacted_payload(payload)},
    )
    return {"ok": True, "settlement": updated}


@router.get("/admin/operator-report")
async def operator_report(authorization: str | None = Header(default=None)):
    user = await current_user(authorization)
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Acesso exclusivo para admin")
    report = await get_operator_finance_report()
    if payment_provider() == "amplopay":
        try:
            report["payment_provider_balance"] = redacted_payload(await amplopay.get_producer_balance())
        except amplopay.AmploPayError as exc:
            report["payment_provider_balance_error"] = str(exc)
    return report


@router.post("/admin/operator-settlements")
async def operator_settlement(
    request: Request,
    payload: OperatorSettlementRequest,
    authorization: str | None = Header(default=None),
):
    user = await current_user(authorization)
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Acesso exclusivo para admin")

    provider = payment_provider()
    if provider not in {"sandbox", "amplopay"}:
        raise HTTPException(status_code=501, detail=f"Provider {provider} nao suportado")
    if provider == "amplopay":
        if not payload.pix_key or not payload.owner_name or not payload.owner_document:
            raise HTTPException(status_code=422, detail="Pix, titular e documento sao obrigatorios para settlement Amplopay")

    ok, result = await create_operator_settlement(
        user["id"],
        payload.amount,
        pix_key=payload.pix_key,
        pix_key_type=payload.pix_key_type,
        owner_name=payload.owner_name,
        owner_document=payload.owner_document,
        owner_document_type=payload.owner_document_type,
    )
    if not ok:
        raise HTTPException(
            status_code=409,
            detail=f"Valor acima do disponivel para settlement. Disponivel: R$ {float(result):.2f}",
        )

    if provider == "amplopay":
        try:
            gateway_response = await amplopay.create_pix_transfer(
                amount=payload.amount,
                identifier=result["id"],
                pix_key=payload.pix_key or "",
                pix_key_type=payload.pix_key_type or "random",
                owner_name=payload.owner_name or "",
                owner_document=payload.owner_document or "",
                owner_document_type=payload.owner_document_type or "cpf",
                ip=request.client.host if request.client else "127.0.0.1",
                callback_url=callback_url("/api/wallet/webhooks/amplopay/transfer"),
            )
        except amplopay.AmploPayError as exc:
            await update_operator_settlement(result["id"], status="failed", metadata={"error": str(exc)})
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        withdraw = gateway_response.get("withdraw") or {}
        result = await update_operator_settlement(
            result["id"],
            status=str(withdraw.get("status") or "processing").lower(),
            provider_transfer_id=withdraw.get("id"),
            metadata={
                **(result.get("metadata") or {}),
                "mode": "amplopay",
                "webhook_token_hash": webhook_token_hash(gateway_response.get("webhookToken")),
                "gateway_response": redacted_payload(gateway_response),
            },
        ) or result

    return {
        "settlement": result,
        "message": "Settlement solicitado. Em producao, essa saida deve ser conciliada com a conta da empresa.",
    }
