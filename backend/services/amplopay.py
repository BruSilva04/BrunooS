import os
from typing import Any

import httpx

BASE_URL = os.getenv("AMPLOPAY_BASE_URL", "https://app.amplopay.com/api/v1").rstrip("/")


class AmploPayError(RuntimeError):
    pass


def _credentials() -> tuple[str, str]:
    public_key = os.getenv("AMPLOPAY_PUBLIC_KEY", "").strip()
    secret_key = os.getenv("AMPLOPAY_SECRET_KEY", "").strip()
    if not public_key or not secret_key:
        raise AmploPayError("Configure AMPLOPAY_PUBLIC_KEY e AMPLOPAY_SECRET_KEY no backend.")
    return public_key, secret_key


def _headers() -> dict[str, str]:
    public_key, secret_key = _credentials()
    return {
        "Content-Type": "application/json",
        "x-public-key": public_key,
        "x-secret-key": secret_key,
    }


async def _request(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.request(
            method,
            f"{BASE_URL}{path}",
            headers=_headers(),
            json=payload,
        )

    try:
        data = response.json()
    except ValueError:
        data = {"message": response.text}

    if response.status_code >= 400:
        message = data.get("message") or data.get("errorDescription") or response.text
        raise AmploPayError(f"Amplopay HTTP {response.status_code}: {message}")

    return data


async def create_pix_deposit(amount: float, identifier: str, callback_url: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "amount": round(float(amount), 2),
        "identifier": identifier,
    }
    if callback_url:
        payload["callbackUrl"] = callback_url

    return await _request("POST", "/gateway/pix/deposit", payload)


async def create_pix_transfer(
    amount: float,
    identifier: str,
    pix_key: str,
    pix_key_type: str,
    owner_name: str,
    owner_document: str,
    owner_document_type: str,
    ip: str,
    callback_url: str,
) -> dict[str, Any]:
    payload = {
        "identifier": identifier,
        "amount": round(float(amount), 2),
        "discountFeeOfReceiver": False,
        "pix": {
            "type": pix_key_type,
            "key": pix_key,
        },
        "owner": {
            "ip": ip,
            "name": owner_name,
            "document": {
                "type": owner_document_type,
                "number": owner_document,
            },
        },
        "callbackUrl": callback_url,
    }

    return await _request("POST", "/gateway/transfers", payload)


async def get_producer_balance() -> dict[str, Any]:
    return await _request("GET", "/gateway/producer/balance")
