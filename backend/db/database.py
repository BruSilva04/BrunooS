import asyncio
import os
import uuid
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
    create_payload = {
        "username": username,
        "email": os.getenv("ADMIN_EMAIL", "admin@sereiadotesouro.local"),
        "phone": os.getenv("ADMIN_PHONE", "+5500000000000"),
        "password_hash": hash_password(password),
        "role": "admin",
        "permissions": {"admin": True, "play": True, "wallet": True, "users": True},
        "balance": 100000.0,
    }
    update_payload = {
        key: value
        for key, value in create_payload.items()
        if key not in {"balance"}
    }

    existing = await get_user_by_username(username)

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


async def adjust_user_balance(
    user_id: str,
    delta: float,
    transaction_type: str | None = None,
    reference_type: str | None = None,
    reference_id: str | None = None,
    idempotency_key: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> tuple[bool, float]:
    user = await get_user_by_id(user_id)
    if not user:
        return False, 0.0

    if idempotency_key:
        try:
            existing_transaction = await get_wallet_transaction_by_idempotency(idempotency_key)
        except Exception:
            if os.getenv("REQUIRE_WALLET_LEDGER", "false").lower() == "true":
                raise
            existing_transaction = None

        if existing_transaction:
            return True, float(existing_transaction.get("balance_after", user.get("balance", 0)) or 0)

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
            if os.getenv("REQUIRE_WALLET_LEDGER", "false").lower() == "true":
                raise

    return True, new_balance


async def create_payment_intent(user_id: str, amount: float, provider: str = "sandbox") -> dict[str, Any]:
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
        "metadata",
    }
    updates = {key: value for key, value in kwargs.items() if key in allowed and value is not None}
    if not updates:
        return await get_payment_intent(intent_id)

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

    amount = float(intent.get("amount", 0) or 0)
    user_id = intent["user_id"]
    ok, balance = await adjust_user_balance(
        user_id,
        amount,
        transaction_type="deposit",
        reference_type="payment_intent",
        reference_id=intent_id,
        idempotency_key=f"deposit:{intent_id}",
        metadata={"provider": intent.get("provider"), "confirmed_by": admin_user_id or "sandbox"},
    )
    if not ok:
        return None

    def update_intent():
        return (
            get_supabase_client()
            .table(PAYMENT_INTENTS_TABLE)
            .update({"status": "paid", "metadata": {**(intent.get("metadata") or {}), "balance_after": balance}})
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
            .in_("status", ["requested", "approved"])
            .limit(10000)
            .execute()
        )

    def fetch_settlements():
        return (
            get_supabase_client()
            .table(OPERATOR_SETTLEMENTS_TABLE)
            .select("amount,status")
            .in_("status", ["requested", "paid"])
            .limit(10000)
            .execute()
        )

    rounds, withdrawals, settlements = await asyncio.gather(
        anyio.to_thread.run_sync(fetch_rounds),
        anyio.to_thread.run_sync(fetch_withdrawals),
        anyio.to_thread.run_sync(fetch_settlements),
    )

    round_rows = rounds.data or []
    withdrawal_rows = withdrawals.data or []
    settlement_rows = settlements.data or []
    total_bets = round(sum(float(row.get("bet", 0) or 0) for row in round_rows), 2)
    total_payouts = round(sum(float(row.get("payout", 0) or 0) for row in round_rows), 2)
    gross_gaming_revenue = round(total_bets - total_payouts, 2)
    pending_withdrawals = round(sum(float(row.get("amount", 0) or 0) for row in withdrawal_rows), 2)
    reserved_settlements = round(sum(float(row.get("amount", 0) or 0) for row in settlement_rows), 2)
    available_for_settlement = round(
        max(0.0, gross_gaming_revenue - pending_withdrawals - reserved_settlements),
        2,
    )

    return {
        "rounds": len(round_rows),
        "total_bets": total_bets,
        "total_payouts": total_payouts,
        "gross_gaming_revenue": gross_gaming_revenue,
        "pending_withdrawals": pending_withdrawals,
        "reserved_settlements": reserved_settlements,
        "available_for_settlement": available_for_settlement,
    }


async def create_operator_settlement(requested_by: str, amount: float) -> tuple[bool, dict[str, Any] | float]:
    report = await get_operator_finance_report()
    amount = round(float(amount), 2)
    available = float(report["available_for_settlement"])
    if amount > available:
        return False, available

    payload = {
        "requested_by": requested_by,
        "amount": amount,
        "status": "requested",
        "metadata": {"report_snapshot": report},
    }

    def insert_settlement():
        return get_supabase_client().table(OPERATOR_SETTLEMENTS_TABLE).insert(payload).execute()

    response = await anyio.to_thread.run_sync(insert_settlement)
    return True, response.data[0]


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
