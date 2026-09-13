import asyncio
import os
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode

import anyio
from dotenv import load_dotenv
from supabase import Client, create_client
from services.auth import hash_password
from services.account_mode import is_demo_user
from services.tracking import (
    date_in_range,
    normalize_referral_code,
    parse_datetime_bound,
    parse_row_datetime,
    require_referral_code,
    safe_div,
    safe_percent,
    verify_tracking_token,
)

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

ROUNDS_TABLE = "rounds"
USERS_TABLE = "users"
AFFILIATES_TABLE = "affiliates"
CAMPAIGNS_TABLE = "campaigns"
ACQUISITION_CLICKS_TABLE = "acquisition_clicks"
WALLET_TRANSACTIONS_TABLE = "wallet_transactions"
PAYMENT_INTENTS_TABLE = "payment_intents"
WITHDRAWAL_REQUESTS_TABLE = "withdrawal_requests"
OPERATOR_SETTLEMENTS_TABLE = "operator_settlements"
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
    "legal_name",
    "document",
    "document_type",
    "password_hash",
    "role",
    "permissions",
    "balance",
    "bonus_balance",
    "rollover_required",
    "rollover_progress",
    "acquisition_campaign_id",
    "acquisition_click_id",
    "referral_code",
    "attributed_at",
}

BONUS_MIN_DEPOSIT = 100.0
BONUS_RATE = 1.0
ROLLOVER_MULTIPLIER = 2.0
OPEN_WITHDRAWAL_STATUSES = [
    "requested",
    "approved",
    "pending",
    "processing",
    "transferring",
    "paid",
]
OPEN_SETTLEMENT_STATUSES = [
    "requested",
    "pending",
    "processing",
    "transferring",
    "paid",
]


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
    password = os.getenv("ADMIN_PASSWORD")
    create_payload = {
        "username": username,
        "email": os.getenv("ADMIN_EMAIL", "admin@sereiadotesouro.local"),
        "phone": os.getenv("ADMIN_PHONE", "+5500000000000"),
        "role": "admin",
        "permissions": {"admin": True, "play": True, "wallet": True, "users": True},
        "balance": 100000.0,
        "bonus_balance": 0.0,
        "rollover_required": 0.0,
        "rollover_progress": 0.0,
    }
    if password:
        create_payload["password_hash"] = hash_password(password)
    update_payload = {
        key: value
        for key, value in create_payload.items()
        if key not in {"balance", "bonus_balance", "rollover_required", "rollover_progress", "password_hash"}
    }
    if password:
        update_payload["password_hash"] = create_payload["password_hash"]

    existing = await get_user_by_username(username)
    if not existing and not password:
        raise RuntimeError(
            "Configure ADMIN_PASSWORD in the backend environment to bootstrap the admin user."
        )

    def upsert_admin():
        client = get_supabase_client()
        if existing:
            return (
                client.table(USERS_TABLE)
                .update(update_payload)
                .eq("id", existing["id"])
                .execute()
            )
        return client.table(USERS_TABLE).insert(create_payload).execute()

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


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


async def get_user_by_document(document: str) -> dict[str, Any] | None:
    def fetch_user():
        return (
            get_supabase_client()
            .table(USERS_TABLE)
            .select("*")
            .eq("document", document)
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


def _clean_text(value: str | None, max_length: int = 500) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:max_length]


def _clean_tracking_path(value: str | None) -> str | None:
    text = _clean_text(value, 512)
    if not text:
        return None
    path, _, query = text.partition("?")
    safe_params = []
    for key, item in parse_qsl(query, keep_blank_values=False):
        if key in {"ref", "utm_source", "utm_medium", "utm_campaign", "utm_content"}:
            safe_params.append((key, item[:160]))
    safe_query = urlencode(safe_params)
    return f"{path[:320]}?{safe_query}" if safe_query else path[:320]


def _clean_referrer_url(value: str | None) -> str | None:
    text = _clean_text(value, 1024)
    if not text:
        return None
    return text.split("#", 1)[0].split("?", 1)[0][:512]


async def list_affiliates() -> list[dict[str, Any]]:
    def fetch_affiliates():
        return (
            get_supabase_client()
            .table(AFFILIATES_TABLE)
            .select("*")
            .order("created_at", desc=True)
            .limit(500)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_affiliates)
    return response.data or []


async def get_affiliate(affiliate_id: str) -> dict[str, Any] | None:
    def fetch_affiliate():
        return (
            get_supabase_client()
            .table(AFFILIATES_TABLE)
            .select("*")
            .eq("id", affiliate_id)
            .limit(1)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_affiliate)
    return response.data[0] if response.data else None


async def create_affiliate(data: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "name": _clean_text(data.get("name"), 120),
        "handle": _clean_text(data.get("handle"), 80),
        "contact": _clean_text(data.get("contact"), 180),
        "status": _clean_text(data.get("status"), 32) or "active",
        "notes": _clean_text(data.get("notes"), 1000),
    }
    payload = {key: value for key, value in payload.items() if value is not None}

    def insert_affiliate():
        return get_supabase_client().table(AFFILIATES_TABLE).insert(payload).execute()

    response = await anyio.to_thread.run_sync(insert_affiliate)
    return response.data[0]


async def update_affiliate(affiliate_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    allowed = {"name", "handle", "contact", "status", "notes"}
    updates = {
        key: _clean_text(value, 1000 if key == "notes" else 180)
        for key, value in data.items()
        if key in allowed and value is not None
    }
    if not updates:
        return await get_affiliate(affiliate_id)
    updates["updated_at"] = utc_now_iso()

    def patch_affiliate():
        return (
            get_supabase_client()
            .table(AFFILIATES_TABLE)
            .update(updates)
            .eq("id", affiliate_id)
            .execute()
        )

    response = await anyio.to_thread.run_sync(patch_affiliate)
    return response.data[0] if response.data else None


def campaign_is_active(campaign: dict[str, Any]) -> bool:
    if not campaign or campaign.get("status") != "active":
        return False
    now = datetime.now(timezone.utc)
    starts_at = parse_datetime_bound(campaign.get("starts_at"))
    ends_at = parse_datetime_bound(campaign.get("ends_at"), end_of_day=True)
    if starts_at and starts_at > now:
        return False
    if ends_at and ends_at < now:
        return False
    return True


async def list_campaigns(
    affiliate_id: str | None = None,
    campaign_id: str | None = None,
) -> list[dict[str, Any]]:
    def fetch_campaigns():
        query = (
            get_supabase_client()
            .table(CAMPAIGNS_TABLE)
            .select("*")
            .order("created_at", desc=True)
            .limit(1000)
        )
        if affiliate_id:
            query = query.eq("affiliate_id", affiliate_id)
        if campaign_id:
            query = query.eq("id", campaign_id)
        return query.execute()

    response = await anyio.to_thread.run_sync(fetch_campaigns)
    return response.data or []


async def get_campaign(campaign_id: str) -> dict[str, Any] | None:
    campaigns = await list_campaigns(campaign_id=campaign_id)
    return campaigns[0] if campaigns else None


async def get_campaign_by_referral_code(referral_code: str) -> dict[str, Any] | None:
    code = normalize_referral_code(referral_code)
    if not code:
        return None

    def fetch_campaign():
        return (
            get_supabase_client()
            .table(CAMPAIGNS_TABLE)
            .select("*")
            .eq("referral_code", code)
            .limit(1)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_campaign)
    return response.data[0] if response.data else None


async def get_active_campaign_by_referral_code(referral_code: str) -> dict[str, Any] | None:
    campaign = await get_campaign_by_referral_code(referral_code)
    return campaign if campaign_is_active(campaign or {}) else None


async def create_campaign(data: dict[str, Any]) -> dict[str, Any]:
    code = require_referral_code(data.get("referral_code"))
    payload = {
        "affiliate_id": data.get("affiliate_id"),
        "name": _clean_text(data.get("name"), 160),
        "referral_code": code,
        "status": _clean_text(data.get("status"), 32) or "active",
        "media_cost": round(float(data.get("media_cost", 0) or 0), 2),
        "starts_at": data.get("starts_at"),
        "ends_at": data.get("ends_at"),
        "metadata": data.get("metadata") or {},
    }
    payload = {key: value for key, value in payload.items() if value is not None}

    def insert_campaign():
        return get_supabase_client().table(CAMPAIGNS_TABLE).insert(payload).execute()

    response = await anyio.to_thread.run_sync(insert_campaign)
    return response.data[0]


async def update_campaign(campaign_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    allowed = {"affiliate_id", "name", "referral_code", "status", "media_cost", "starts_at", "ends_at", "metadata"}
    updates: dict[str, Any] = {}
    for key, value in data.items():
        if key not in allowed or value is None:
            continue
        if key == "referral_code":
            updates[key] = require_referral_code(value)
        elif key == "media_cost":
            updates[key] = round(float(value or 0), 2)
        elif key in {"name", "status"}:
            updates[key] = _clean_text(value, 160)
        else:
            updates[key] = value

    if not updates:
        return await get_campaign(campaign_id)
    updates["updated_at"] = utc_now_iso()

    def patch_campaign():
        return (
            get_supabase_client()
            .table(CAMPAIGNS_TABLE)
            .update(updates)
            .eq("id", campaign_id)
            .execute()
        )

    response = await anyio.to_thread.run_sync(patch_campaign)
    return response.data[0] if response.data else None


async def create_acquisition_click(data: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "campaign_id": data["campaign_id"],
        "visitor_id": _clean_text(data.get("visitor_id"), 80),
        "landing_path": _clean_tracking_path(data.get("landing_path")),
        "referrer_url": _clean_referrer_url(data.get("referrer_url")),
        "utm_source": _clean_text(data.get("utm_source"), 160),
        "utm_medium": _clean_text(data.get("utm_medium"), 160),
        "utm_campaign": _clean_text(data.get("utm_campaign"), 160),
        "utm_content": _clean_text(data.get("utm_content"), 160),
    }
    payload = {key: value for key, value in payload.items() if value is not None}

    def insert_click():
        return get_supabase_client().table(ACQUISITION_CLICKS_TABLE).insert(payload).execute()

    response = await anyio.to_thread.run_sync(insert_click)
    return response.data[0]


async def get_acquisition_click(click_id: str) -> dict[str, Any] | None:
    def fetch_click():
        return (
            get_supabase_client()
            .table(ACQUISITION_CLICKS_TABLE)
            .select("*")
            .eq("id", click_id)
            .limit(1)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_click)
    return response.data[0] if response.data else None


async def resolve_acquisition_attribution(
    click_id: str | None,
    tracking_token: str | None,
    referral_code: str | None = None,
) -> dict[str, Any] | None:
    token_payload = verify_tracking_token(tracking_token)
    if not token_payload:
        return None

    if click_id and token_payload.get("click_id") != click_id:
        return None

    code = normalize_referral_code(referral_code or token_payload.get("referral_code"))
    if not code or token_payload.get("referral_code") != code:
        return None

    click = await get_acquisition_click(token_payload["click_id"])
    if not click:
        return None
    if str(click.get("campaign_id")) != str(token_payload.get("campaign_id")):
        return None

    campaign = await get_campaign(str(click["campaign_id"]))
    if not campaign or normalize_referral_code(campaign.get("referral_code")) != code:
        return None

    return {
        "campaign_id": campaign["id"],
        "click_id": click["id"],
        "referral_code": code,
    }


async def update_user_profile(user_id: str, **kwargs: Any) -> dict[str, Any] | None:
    allowed = {
        "legal_name",
        "document",
        "document_type",
        "phone",
        "email",
        "bonus_balance",
        "rollover_required",
        "rollover_progress",
    }
    updates = {key: value for key, value in kwargs.items() if key in allowed and value is not None}
    if not updates:
        return await get_user_by_id(user_id)

    def update_user():
        return (
            get_supabase_client()
            .table(USERS_TABLE)
            .update(updates)
            .eq("id", user_id)
            .execute()
        )

    response = await anyio.to_thread.run_sync(update_user)
    return response.data[0] if response.data else None


async def record_wallet_transaction(
    user_id: str,
    amount: float,
    balance_after: float,
    transaction_type: str,
    status: str = "completed",
    reference_type: str | None = None,
    reference_id: str | None = None,
    idempotency_key: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    payload = {
        "user_id": user_id,
        "transaction_type": transaction_type,
        "amount": round(float(amount), 2),
        "balance_after": round(float(balance_after), 2),
        "status": status,
        "reference_type": reference_type,
        "reference_id": reference_id,
        "idempotency_key": idempotency_key,
        "metadata": metadata or {},
    }
    payload = {key: value for key, value in payload.items() if value is not None}

    def insert_transaction():
        return get_supabase_client().table(WALLET_TRANSACTIONS_TABLE).insert(payload).execute()

    response = await anyio.to_thread.run_sync(insert_transaction)
    return response.data[0] if response.data else None


async def get_wallet_transaction_by_idempotency(idempotency_key: str) -> dict[str, Any] | None:
    def fetch_transaction():
        return (
            get_supabase_client()
            .table(WALLET_TRANSACTIONS_TABLE)
            .select("*")
            .eq("idempotency_key", idempotency_key)
            .limit(1)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_transaction)
    return response.data[0] if response.data else None


def require_wallet_ledger() -> bool:
    return os.getenv("REQUIRE_WALLET_LEDGER", "false").lower() == "true"


def bonus_for_deposit(amount: float) -> float:
    amount = round(float(amount), 2)
    return round(amount * BONUS_RATE, 2) if amount >= BONUS_MIN_DEPOSIT else 0.0


def rollover_status(user: dict[str, Any]) -> dict[str, Any]:
    required = round(float(user.get("rollover_required", 0) or 0), 2)
    progress = round(float(user.get("rollover_progress", 0) or 0), 2)
    remaining = round(max(0.0, required - progress), 2)
    percent = 100 if required <= 0 else round(min(100.0, (progress / required) * 100))
    return {
        "required": required,
        "progress": min(progress, required) if required > 0 else progress,
        "remaining": remaining,
        "complete": remaining <= 0.01,
        "percent": percent,
        "multiplier": ROLLOVER_MULTIPLIER,
        "bonus_min_deposit": BONUS_MIN_DEPOSIT,
    }


async def adjust_user_balance_rpc(
    user_id: str,
    delta: float,
    transaction_type: str | None = None,
    reference_type: str | None = None,
    reference_id: str | None = None,
    idempotency_key: str | None = None,
    metadata: dict[str, Any] | None = None,
    rollover_required_delta: float = 0.0,
    bonus_delta: float = 0.0,
) -> tuple[bool, float] | None:
    params = {
        "p_user_id": user_id,
        "p_delta": round(float(delta), 2),
        "p_transaction_type": transaction_type,
        "p_reference_type": reference_type,
        "p_reference_id": reference_id,
        "p_idempotency_key": idempotency_key,
        "p_metadata": metadata or {},
        "p_rollover_required_delta": round(float(rollover_required_delta), 2),
        "p_bonus_delta": round(float(bonus_delta), 2),
    }

    def call_rpc():
        return get_supabase_client().rpc("adjust_wallet_balance", params).execute()

    response = await anyio.to_thread.run_sync(call_rpc)
    rows = response.data or []
    result = rows[0] if isinstance(rows, list) and rows else rows if isinstance(rows, dict) else None
    if not result:
        return None
    return bool(result.get("ok")), float(result.get("balance") or 0)


async def adjust_user_balance(
    user_id: str,
    delta: float,
    transaction_type: str | None = None,
    reference_type: str | None = None,
    reference_id: str | None = None,
    idempotency_key: str | None = None,
    metadata: dict[str, Any] | None = None,
    rollover_required_delta: float = 0.0,
    bonus_delta: float = 0.0,
) -> tuple[bool, float]:
    try:
        rpc_result = await adjust_user_balance_rpc(
            user_id=user_id,
            delta=delta,
            transaction_type=transaction_type,
            reference_type=reference_type,
            reference_id=reference_id,
            idempotency_key=idempotency_key,
            metadata=metadata,
            rollover_required_delta=rollover_required_delta,
            bonus_delta=bonus_delta,
        )
        if rpc_result is not None:
            return rpc_result
    except Exception:
        if require_wallet_ledger():
            raise

    user = await get_user_by_id(user_id)
    if not user:
        return False, 0.0

    if idempotency_key:
        try:
            existing_transaction = await get_wallet_transaction_by_idempotency(idempotency_key)
        except Exception:
            if require_wallet_ledger():
                raise
            existing_transaction = None

        if existing_transaction:
            return True, float(existing_transaction.get("balance_after", user.get("balance", 0)) or 0)

    current_balance = float(user.get("balance", 0) or 0)
    new_balance = round(current_balance + delta, 2)
    current_rollover_required = float(user.get("rollover_required", 0) or 0)
    current_rollover_progress = float(user.get("rollover_progress", 0) or 0)
    current_bonus_balance = float(user.get("bonus_balance", 0) or 0)
    new_rollover_required = round(max(0.0, current_rollover_required + rollover_required_delta), 2)
    new_rollover_progress = round(current_rollover_progress, 2)
    if transaction_type == "bet" and delta < 0 and new_rollover_progress < new_rollover_required:
        new_rollover_progress = round(min(new_rollover_required, new_rollover_progress + abs(delta)), 2)
    effective_bonus_delta = bonus_delta
    if transaction_type in {"bet", "withdrawal_hold"} and delta < 0:
        effective_bonus_delta -= min(current_bonus_balance, abs(delta))
    new_bonus_balance = round(max(0.0, current_bonus_balance + effective_bonus_delta), 2)
    if new_balance < 0:
        return False, current_balance

    def update_balance():
        return (
            get_supabase_client()
            .table(USERS_TABLE)
            .update({
                "balance": new_balance,
                "bonus_balance": new_bonus_balance,
                "rollover_required": new_rollover_required,
                "rollover_progress": new_rollover_progress,
            })
            .eq("id", user_id)
            .execute()
        )

    await anyio.to_thread.run_sync(update_balance)

    if transaction_type and round(float(delta), 2) != 0:
        try:
            await record_wallet_transaction(
                user_id=user_id,
                amount=delta,
                balance_after=new_balance,
                transaction_type=transaction_type,
                reference_type=reference_type,
                reference_id=reference_id,
                idempotency_key=idempotency_key,
                metadata=metadata,
            )
        except Exception:
            if require_wallet_ledger():
                raise

    return True, new_balance


async def create_payment_intent(
    user_id: str,
    amount: float,
    provider: str = "sandbox",
    campaign_id: str | None = None,
) -> dict[str, Any]:
    intent_id = str(uuid.uuid4())
    amount = round(float(amount), 2)
    is_sandbox = provider == "sandbox"
    payload = {
        "id": intent_id,
        "user_id": user_id,
        "provider": provider,
        "provider_payment_id": f"sandbox_{intent_id}" if is_sandbox else None,
        "amount": amount,
        "status": "pending",
        "pix_qr_code": f"SEREIA-SANDBOX-PIX:{intent_id}:{amount:.2f}" if is_sandbox else None,
        "pix_copy_paste": f"SEREIA-SANDBOX-PIX:{intent_id}:{amount:.2f}" if is_sandbox else None,
        "campaign_id": campaign_id,
        "metadata": {"mode": provider},
    }
    payload = {key: value for key, value in payload.items() if value is not None}

    def insert_intent():
        return get_supabase_client().table(PAYMENT_INTENTS_TABLE).insert(payload).execute()

    response = await anyio.to_thread.run_sync(insert_intent)
    return response.data[0]


async def update_payment_intent(intent_id: str, **kwargs: Any) -> dict[str, Any] | None:
    allowed = {
        "provider_payment_id",
        "status",
        "pix_qr_code",
        "pix_copy_paste",
        "expires_at",
        "campaign_id",
        "metadata",
    }
    updates = {key: value for key, value in kwargs.items() if key in allowed and value is not None}
    if not updates:
        return await get_payment_intent(intent_id)
    updates["updated_at"] = utc_now_iso()

    def update_intent():
        return (
            get_supabase_client()
            .table(PAYMENT_INTENTS_TABLE)
            .update(updates)
            .eq("id", intent_id)
            .execute()
        )

    response = await anyio.to_thread.run_sync(update_intent)
    return response.data[0] if response.data else None


async def confirm_payment_intent(intent_id: str, admin_user_id: str | None = None) -> dict[str, Any] | None:
    intent = await get_payment_intent(intent_id)
    if not intent:
        return None
    if intent.get("status") == "paid":
        return intent

    amount = round(float(intent.get("amount", 0) or 0), 2)
    bonus_amount = bonus_for_deposit(amount)
    credited_amount = round(amount + bonus_amount, 2)
    rollover_required_added = round(credited_amount * ROLLOVER_MULTIPLIER, 2)
    user_id = intent["user_id"]
    ok, balance = await adjust_user_balance(
        user_id,
        credited_amount,
        transaction_type="deposit",
        reference_type="payment_intent",
        reference_id=intent_id,
        idempotency_key=f"deposit:{intent_id}",
        metadata={
            "provider": intent.get("provider"),
            "confirmed_by": admin_user_id or "sandbox",
            "deposit_amount": amount,
            "bonus_amount": bonus_amount,
            "credited_amount": credited_amount,
            "rollover_required_added": rollover_required_added,
        },
        rollover_required_delta=rollover_required_added,
        bonus_delta=bonus_amount,
    )
    if not ok:
        return None

    def update_intent():
        return (
            get_supabase_client()
            .table(PAYMENT_INTENTS_TABLE)
            .update({
                "status": "paid",
                "updated_at": utc_now_iso(),
                "metadata": {
                    **(intent.get("metadata") or {}),
                    "balance_after": balance,
                    "deposit_amount": amount,
                    "bonus_amount": bonus_amount,
                    "credited_amount": credited_amount,
                    "rollover_required_added": rollover_required_added,
                },
            })
            .eq("id", intent_id)
            .execute()
        )

    response = await anyio.to_thread.run_sync(update_intent)
    return response.data[0] if response.data else None


async def get_payment_intent(intent_id: str) -> dict[str, Any] | None:
    def fetch_intent():
        return (
            get_supabase_client()
            .table(PAYMENT_INTENTS_TABLE)
            .select("*")
            .eq("id", intent_id)
            .limit(1)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_intent)
    return response.data[0] if response.data else None


async def get_payment_intent_by_provider_id(provider: str, provider_payment_id: str) -> dict[str, Any] | None:
    def fetch_intent():
        return (
            get_supabase_client()
            .table(PAYMENT_INTENTS_TABLE)
            .select("*")
            .eq("provider", provider)
            .eq("provider_payment_id", provider_payment_id)
            .limit(1)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_intent)
    return response.data[0] if response.data else None


async def get_withdrawal_request(withdrawal_id: str) -> dict[str, Any] | None:
    def fetch_withdrawal():
        return (
            get_supabase_client()
            .table(WITHDRAWAL_REQUESTS_TABLE)
            .select("*")
            .eq("id", withdrawal_id)
            .limit(1)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_withdrawal)
    return response.data[0] if response.data else None


async def create_withdrawal_request(
    user_id: str,
    amount: float,
    pix_key: str,
    pix_key_type: str,
    owner_name: str | None = None,
    owner_document: str | None = None,
    owner_document_type: str | None = None,
) -> tuple[bool, dict[str, Any] | float]:
    amount = round(float(amount), 2)
    user = await get_user_by_id(user_id)
    if not user:
        return False, 0.0
    rollover = rollover_status(user)
    if not rollover["complete"]:
        return False, {
            "reason": "rollover",
            "balance": float(user.get("balance", 0) or 0),
            "rollover": rollover,
        }

    withdrawal_id = str(uuid.uuid4())
    ok, balance = await adjust_user_balance(
        user_id,
        -amount,
        transaction_type="withdrawal_hold",
        reference_type="withdrawal_request",
        reference_id=withdrawal_id,
        idempotency_key=f"withdrawal_hold:{withdrawal_id}",
        metadata={"pix_key_type": pix_key_type},
    )
    if not ok:
        return False, balance

    payload = {
        "id": withdrawal_id,
        "user_id": user_id,
        "amount": amount,
        "pix_key": pix_key,
        "pix_key_type": pix_key_type,
        "owner_name": owner_name,
        "owner_document": owner_document,
        "owner_document_type": owner_document_type,
        "status": "requested",
        "metadata": {"balance_after_hold": balance},
    }
    payload = {key: value for key, value in payload.items() if value is not None}

    def insert_withdrawal():
        return get_supabase_client().table(WITHDRAWAL_REQUESTS_TABLE).insert(payload).execute()

    response = await anyio.to_thread.run_sync(insert_withdrawal)
    return True, response.data[0]


async def update_withdrawal_request(withdrawal_id: str, **kwargs: Any) -> dict[str, Any] | None:
    allowed = {
        "status",
        "provider_transfer_id",
        "reviewed_by",
        "metadata",
    }
    updates = {key: value for key, value in kwargs.items() if key in allowed and value is not None}
    if not updates:
        return None

    def update_withdrawal():
        return (
            get_supabase_client()
            .table(WITHDRAWAL_REQUESTS_TABLE)
            .update(updates)
            .eq("id", withdrawal_id)
            .execute()
        )

    response = await anyio.to_thread.run_sync(update_withdrawal)
    return response.data[0] if response.data else None


async def get_withdrawal_by_provider_transfer_id(provider_transfer_id: str) -> dict[str, Any] | None:
    def fetch_withdrawal():
        return (
            get_supabase_client()
            .table(WITHDRAWAL_REQUESTS_TABLE)
            .select("*")
            .eq("provider_transfer_id", provider_transfer_id)
            .limit(1)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_withdrawal)
    return response.data[0] if response.data else None


async def get_operator_finance_report() -> dict[str, Any]:
    def fetch_rounds():
        return (
            get_supabase_client()
            .table(ROUNDS_TABLE)
            .select("bet,payout,status")
            .in_("status", ["won", "lost"])
            .limit(10000)
            .execute()
        )

    def fetch_withdrawals():
        return (
            get_supabase_client()
            .table(WITHDRAWAL_REQUESTS_TABLE)
            .select("amount,status")
            .in_("status", OPEN_WITHDRAWAL_STATUSES)
            .limit(10000)
            .execute()
        )

    def fetch_paid_deposits():
        return (
            get_supabase_client()
            .table(PAYMENT_INTENTS_TABLE)
            .select("amount,status")
            .eq("status", "paid")
            .limit(10000)
            .execute()
        )

    def fetch_settlements():
        return (
            get_supabase_client()
            .table(OPERATOR_SETTLEMENTS_TABLE)
            .select("amount,status")
            .in_("status", OPEN_SETTLEMENT_STATUSES)
            .limit(10000)
            .execute()
        )

    def fetch_player_balances():
        return (
            get_supabase_client()
            .table(USERS_TABLE)
            .select("balance,rollover_required,rollover_progress")
            .neq("role", "admin")
            .limit(10000)
            .execute()
        )

    rounds, withdrawals, paid_deposits, settlements, player_balances = await asyncio.gather(
        anyio.to_thread.run_sync(fetch_rounds),
        anyio.to_thread.run_sync(fetch_withdrawals),
        anyio.to_thread.run_sync(fetch_paid_deposits),
        anyio.to_thread.run_sync(fetch_settlements),
        anyio.to_thread.run_sync(fetch_player_balances),
    )

    round_rows = rounds.data or []
    withdrawal_rows = withdrawals.data or []
    paid_deposit_rows = paid_deposits.data or []
    settlement_rows = settlements.data or []
    player_balance_rows = player_balances.data or []
    total_bets = round(sum(float(row.get("bet", 0) or 0) for row in round_rows), 2)
    total_payouts = round(sum(float(row.get("payout", 0) or 0) for row in round_rows), 2)
    gross_gaming_revenue = round(total_bets - total_payouts, 2)
    confirmed_deposits_gross = round(sum(float(row.get("amount", 0) or 0) for row in paid_deposit_rows), 2)
    pending_withdrawals = round(sum(float(row.get("amount", 0) or 0) for row in withdrawal_rows), 2)
    reserved_settlements = round(sum(float(row.get("amount", 0) or 0) for row in settlement_rows), 2)
    player_balance_liability = round(sum(float(row.get("balance", 0) or 0) for row in player_balance_rows), 2)
    rollover_required = round(sum(float(row.get("rollover_required", 0) or 0) for row in player_balance_rows), 2)
    rollover_progress = round(sum(float(row.get("rollover_progress", 0) or 0) for row in player_balance_rows), 2)
    rollover_remaining = round(max(0.0, rollover_required - rollover_progress), 2)
    available_cash_gross = round(
        max(0.0, confirmed_deposits_gross - player_balance_liability - pending_withdrawals - reserved_settlements),
        2,
    )
    available_ggr = round(max(0.0, gross_gaming_revenue - pending_withdrawals - reserved_settlements), 2)
    available_for_settlement = round(min(available_cash_gross, available_ggr), 2)

    return {
        "rounds": len(round_rows),
        "confirmed_deposits_gross": confirmed_deposits_gross,
        "total_bets": total_bets,
        "total_payouts": total_payouts,
        "gross_gaming_revenue": gross_gaming_revenue,
        "pending_withdrawals": pending_withdrawals,
        "reserved_settlements": reserved_settlements,
        "player_balance_liability": player_balance_liability,
        "available_cash_gross": available_cash_gross,
        "rollover_required": rollover_required,
        "rollover_progress": min(rollover_progress, rollover_required) if rollover_required > 0 else rollover_progress,
        "rollover_remaining": rollover_remaining,
        "available_for_settlement": available_for_settlement,
    }


async def create_operator_settlement(
    requested_by: str,
    amount: float,
    pix_key: str | None = None,
    pix_key_type: str | None = None,
    owner_name: str | None = None,
    owner_document: str | None = None,
    owner_document_type: str | None = None,
) -> tuple[bool, dict[str, Any] | float]:
    report = await get_operator_finance_report()
    amount = round(float(amount), 2)
    available = float(report["available_for_settlement"])
    if amount > available:
        return False, available

    payload = {
        "requested_by": requested_by,
        "amount": amount,
        "pix_key": pix_key,
        "pix_key_type": pix_key_type,
        "owner_name": owner_name,
        "owner_document": owner_document,
        "owner_document_type": owner_document_type,
        "status": "requested",
        "metadata": {"report_snapshot": report},
    }
    payload = {key: value for key, value in payload.items() if value is not None}

    def insert_settlement():
        return get_supabase_client().table(OPERATOR_SETTLEMENTS_TABLE).insert(payload).execute()

    response = await anyio.to_thread.run_sync(insert_settlement)
    return True, response.data[0]


async def update_operator_settlement(settlement_id: str, **kwargs: Any) -> dict[str, Any] | None:
    allowed = {"status", "provider_transfer_id", "metadata", "paid_at"}
    updates = {key: value for key, value in kwargs.items() if key in allowed and value is not None}
    if not updates:
        return None

    def update_settlement():
        return (
            get_supabase_client()
            .table(OPERATOR_SETTLEMENTS_TABLE)
            .update(updates)
            .eq("id", settlement_id)
            .execute()
        )

    response = await anyio.to_thread.run_sync(update_settlement)
    return response.data[0] if response.data else None


async def get_operator_settlement_by_provider_transfer_id(provider_transfer_id: str) -> dict[str, Any] | None:
    def fetch_settlement():
        return (
            get_supabase_client()
            .table(OPERATOR_SETTLEMENTS_TABLE)
            .select("*")
            .eq("provider_transfer_id", provider_transfer_id)
            .limit(1)
            .execute()
        )

    response = await anyio.to_thread.run_sync(fetch_settlement)
    return response.data[0] if response.data else None


def _blank_acquisition_metrics(campaign: dict[str, Any] | None = None, affiliate: dict[str, Any] | None = None) -> dict[str, Any]:
    media_cost = round(float((campaign or {}).get("media_cost", 0) or 0), 2)
    return {
        "affiliate": affiliate,
        "campaign": campaign,
        "clicks_total": 0,
        "unique_clicks": 0,
        "signups": 0,
        "depositors": 0,
        "ftd": 0,
        "total_deposited": 0.0,
        "deposit_count": 0,
        "total_bets": 0.0,
        "total_payouts": 0.0,
        "ggr": 0.0,
        "media_cost": media_cost,
        "cac": 0.0,
        "conversion_signup": 0.0,
        "conversion_depositor": 0.0,
        "conversion_click_to_depositor": 0.0,
        "media_gross_result": round(-media_cost, 2),
    }


def _finalize_acquisition_metrics(metrics: dict[str, Any], visitors: set[str], depositors: set[str]) -> dict[str, Any]:
    metrics["unique_clicks"] = len(visitors)
    metrics["depositors"] = len(depositors)
    metrics["total_deposited"] = round(float(metrics["total_deposited"] or 0), 2)
    metrics["total_bets"] = round(float(metrics["total_bets"] or 0), 2)
    metrics["total_payouts"] = round(float(metrics["total_payouts"] or 0), 2)
    metrics["ggr"] = round(metrics["total_bets"] - metrics["total_payouts"], 2)
    metrics["cac"] = safe_div(metrics["media_cost"], metrics["depositors"])
    metrics["conversion_signup"] = safe_percent(metrics["signups"], metrics["unique_clicks"])
    metrics["conversion_depositor"] = safe_percent(metrics["depositors"], metrics["signups"])
    metrics["conversion_click_to_depositor"] = safe_percent(metrics["depositors"], metrics["unique_clicks"])
    metrics["media_gross_result"] = round(metrics["ggr"] - metrics["media_cost"], 2)
    return metrics


def _sum_acquisition_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    overview = _blank_acquisition_metrics()
    for row in rows:
        overview["clicks_total"] += int(row.get("clicks_total", 0) or 0)
        overview["unique_clicks"] += int(row.get("unique_clicks", 0) or 0)
        overview["signups"] += int(row.get("signups", 0) or 0)
        overview["depositors"] += int(row.get("depositors", 0) or 0)
        overview["ftd"] += int(row.get("ftd", 0) or 0)
        overview["total_deposited"] += float(row.get("total_deposited", 0) or 0)
        overview["deposit_count"] += int(row.get("deposit_count", 0) or 0)
        overview["total_bets"] += float(row.get("total_bets", 0) or 0)
        overview["total_payouts"] += float(row.get("total_payouts", 0) or 0)
        overview["media_cost"] += float(row.get("media_cost", 0) or 0)

    overview["total_deposited"] = round(overview["total_deposited"], 2)
    overview["total_bets"] = round(overview["total_bets"], 2)
    overview["total_payouts"] = round(overview["total_payouts"], 2)
    overview["media_cost"] = round(overview["media_cost"], 2)
    overview["ggr"] = round(overview["total_bets"] - overview["total_payouts"], 2)
    overview["cac"] = safe_div(overview["media_cost"], overview["depositors"])
    overview["conversion_signup"] = safe_percent(overview["signups"], overview["unique_clicks"])
    overview["conversion_depositor"] = safe_percent(overview["depositors"], overview["signups"])
    overview["conversion_click_to_depositor"] = safe_percent(overview["depositors"], overview["unique_clicks"])
    overview["media_gross_result"] = round(overview["ggr"] - overview["media_cost"], 2)
    return overview


async def get_acquisition_report(
    from_date: str | None = None,
    to_date: str | None = None,
    affiliate_id: str | None = None,
    campaign_id: str | None = None,
) -> dict[str, Any]:
    start = parse_datetime_bound(from_date)
    end = parse_datetime_bound(to_date, end_of_day=True)
    campaigns = await list_campaigns(affiliate_id=affiliate_id, campaign_id=campaign_id)
    affiliates = await list_affiliates()
    affiliate_by_id = {str(item["id"]): item for item in affiliates}
    campaign_ids = [str(item["id"]) for item in campaigns]
    if not campaign_ids:
        return {"overview": _blank_acquisition_metrics(), "rows": []}

    def fetch_clicks():
        return (
            get_supabase_client()
            .table(ACQUISITION_CLICKS_TABLE)
            .select("id,campaign_id,visitor_id,created_at")
            .in_("campaign_id", campaign_ids)
            .order("created_at", desc=True)
            .limit(10000)
            .execute()
        )

    def fetch_users():
        return (
            get_supabase_client()
            .table(USERS_TABLE)
            .select("id,acquisition_campaign_id,acquisition_click_id,referral_code,attributed_at,created_at")
            .in_("acquisition_campaign_id", campaign_ids)
            .limit(10000)
            .execute()
        )

    def fetch_paid_deposits():
        return (
            get_supabase_client()
            .table(PAYMENT_INTENTS_TABLE)
            .select("id,user_id,campaign_id,amount,status,created_at,updated_at")
            .eq("status", "paid")
            .limit(10000)
            .execute()
        )

    def fetch_rounds():
        return (
            get_supabase_client()
            .table(ROUNDS_TABLE)
            .select("round_id,user_id,bet,payout,status,created_at")
            .in_("status", ["won", "lost"])
            .limit(10000)
            .execute()
        )

    clicks_response, users_response, deposits_response, rounds_response = await asyncio.gather(
        anyio.to_thread.run_sync(fetch_clicks),
        anyio.to_thread.run_sync(fetch_users),
        anyio.to_thread.run_sync(fetch_paid_deposits),
        anyio.to_thread.run_sync(fetch_rounds),
    )

    users = users_response.data or []
    user_campaign = {
        str(user["id"]): str(user["acquisition_campaign_id"])
        for user in users
        if user.get("acquisition_campaign_id")
    }
    metrics_by_campaign: dict[str, dict[str, Any]] = {}
    visitors_by_campaign: dict[str, set[str]] = {}
    depositors_by_campaign: dict[str, set[str]] = {}

    for campaign in campaigns:
        cid = str(campaign["id"])
        affiliate = affiliate_by_id.get(str(campaign.get("affiliate_id")))
        metrics_by_campaign[cid] = _blank_acquisition_metrics(campaign, affiliate)
        visitors_by_campaign[cid] = set()
        depositors_by_campaign[cid] = set()

    for click in clicks_response.data or []:
        cid = str(click.get("campaign_id") or "")
        if cid not in metrics_by_campaign or not date_in_range(click.get("created_at"), start, end):
            continue
        metrics_by_campaign[cid]["clicks_total"] += 1
        visitor_id = str(click.get("visitor_id") or click.get("id") or "")
        if visitor_id:
            visitors_by_campaign[cid].add(visitor_id)

    for user in users:
        cid = str(user.get("acquisition_campaign_id") or "")
        attributed_at = user.get("attributed_at") or user.get("created_at")
        if cid not in metrics_by_campaign or not date_in_range(attributed_at, start, end):
            continue
        metrics_by_campaign[cid]["signups"] += 1

    all_paid_deposits = deposits_response.data or []
    first_deposit_by_user: dict[str, dict[str, Any]] = {}
    for deposit in all_paid_deposits:
        user_id = str(deposit.get("user_id") or "")
        if not user_id:
            continue
        seen = first_deposit_by_user.get(user_id)
        deposit_dt = parse_row_datetime(deposit.get("updated_at") or deposit.get("created_at"))
        seen_dt = parse_row_datetime((seen or {}).get("updated_at") or (seen or {}).get("created_at"))
        if not seen or (deposit_dt and seen_dt and deposit_dt < seen_dt):
            first_deposit_by_user[user_id] = deposit

    for deposit in all_paid_deposits:
        user_id = str(deposit.get("user_id") or "")
        cid = str(deposit.get("campaign_id") or user_campaign.get(user_id) or "")
        event_at = deposit.get("updated_at") or deposit.get("created_at")
        if cid not in metrics_by_campaign or not date_in_range(event_at, start, end):
            continue
        amount = round(float(deposit.get("amount", 0) or 0), 2)
        metrics_by_campaign[cid]["deposit_count"] += 1
        metrics_by_campaign[cid]["total_deposited"] += amount
        if user_id:
            depositors_by_campaign[cid].add(user_id)
            first_deposit = first_deposit_by_user.get(user_id)
            first_campaign_id = str((first_deposit or {}).get("campaign_id") or user_campaign.get(user_id) or "")
            if first_deposit and str(first_deposit.get("id")) == str(deposit.get("id")) and first_campaign_id == cid:
                metrics_by_campaign[cid]["ftd"] += 1

    for round_data in rounds_response.data or []:
        cid = user_campaign.get(str(round_data.get("user_id") or ""))
        if cid not in metrics_by_campaign or not date_in_range(round_data.get("created_at"), start, end):
            continue
        metrics_by_campaign[cid]["total_bets"] += float(round_data.get("bet", 0) or 0)
        metrics_by_campaign[cid]["total_payouts"] += float(round_data.get("payout", 0) or 0)

    rows = [
        _finalize_acquisition_metrics(metrics_by_campaign[cid], visitors_by_campaign[cid], depositors_by_campaign[cid])
        for cid in campaign_ids
        if cid in metrics_by_campaign
    ]
    rows.sort(key=lambda row: (row.get("media_gross_result", 0), row.get("total_deposited", 0)), reverse=True)
    return {"overview": _sum_acquisition_rows(rows), "rows": rows}


async def list_wallet_snapshot(user_id: str) -> dict[str, Any] | None:
    user = await get_user_by_id(user_id)
    if not user:
        return None

    def fetch_transactions():
        return (
            get_supabase_client()
            .table(WALLET_TRANSACTIONS_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(30)
            .execute()
        )

    def fetch_deposits():
        return (
            get_supabase_client()
            .table(PAYMENT_INTENTS_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(10)
            .execute()
        )

    def fetch_withdrawals():
        return (
            get_supabase_client()
            .table(WITHDRAWAL_REQUESTS_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(10)
            .execute()
        )

    transactions, deposits, withdrawals = await asyncio.gather(
        anyio.to_thread.run_sync(fetch_transactions),
        anyio.to_thread.run_sync(fetch_deposits),
        anyio.to_thread.run_sync(fetch_withdrawals),
    )

    return {
        "balance": float(user.get("balance", 0) or 0),
        "bonus_balance": float(user.get("bonus_balance", 0) or 0),
        "rollover": rollover_status(user),
        "transactions": transactions.data or [],
        "deposits": deposits.data or [],
        "withdrawals": withdrawals.data or [],
    }


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
    played_rounds = [
        round_data
        for round_data in rounds
        if round_data.get("status") in {"won", "lost"}
    ]
    won_rounds = [round_data for round_data in played_rounds if round_data.get("status") == "won"]
    max_mult = max([_round_multiplier(round_data) for round_data in played_rounds], default=1.0)
    win_rate = round((len(won_rounds) / len(played_rounds)) * 100) if played_rounds else 0

    history = []
    for round_data in played_rounds[:6]:
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
            "legal_name": user.get("legal_name") or "",
            "document_masked": mask_document(user.get("document")),
            "document_type": user.get("document_type") or "cpf",
            "has_kyc": bool(user.get("legal_name") and user.get("document")),
            "role": user.get("role", "player"),
            "demo_mode": is_demo_user(user),
            "permissions": user.get("permissions", {}),
            "referral_code": user.get("referral_code") or "",
            "acquisition_campaign_id": user.get("acquisition_campaign_id"),
        },
        "balance": float(user.get("balance", 0) or 0),
        "bonus_balance": float(user.get("bonus_balance", 0) or 0),
        "rollover": rollover_status(user),
        "demo_mode": is_demo_user(user),
        "active_block_round": next(({
            "round_id": item["round_id"], "bet": item["bet"],
        } for item in rounds if item.get("game_type") == "block" and item.get("status") == "active"), None),
        "stats": {
            "rounds": len(played_rounds),
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


def mask_document(document: str | None) -> str:
    digits = "".join(char for char in str(document or "") if char.isdigit())
    if len(digits) == 11:
        return f"{digits[:3]}.***.***-{digits[-2:]}"
    if len(digits) == 14:
        return f"{digits[:2]}.***.***/****-{digits[-2:]}"
    if len(digits) > 4:
        return f"{digits[:2]}***{digits[-2:]}"
    return ""
