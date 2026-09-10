import base64
import hashlib
import hmac
import json
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any

from services.auth import auth_secret

TRACKING_TTL_SECONDS = 30 * 24 * 60 * 60
REFERRAL_CODE_RE = re.compile(r"^[A-Z0-9_-]{3,40}$")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_referral_code(value: str | None) -> str:
    raw = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")
    code = raw.strip().upper()
    code = re.sub(r"[\s.]+", "-", code)
    code = re.sub(r"-+", "-", code).strip("-_")
    if not REFERRAL_CODE_RE.fullmatch(code):
        return ""
    return code


def require_referral_code(value: str | None) -> str:
    code = normalize_referral_code(value)
    if not code:
        raise ValueError("Referral code invalido. Use 3 a 40 caracteres: letras, numeros, _ ou -.")
    return code


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def create_tracking_token(
    *,
    click_id: str,
    campaign_id: str,
    referral_code: str,
    visitor_id: str,
    ttl_seconds: int = TRACKING_TTL_SECONDS,
) -> str:
    payload = {
        "click_id": click_id,
        "campaign_id": campaign_id,
        "referral_code": referral_code,
        "visitor_id": visitor_id,
        "iat": int(now_utc().timestamp()),
        "exp": int((now_utc() + timedelta(seconds=ttl_seconds)).timestamp()),
    }
    payload_raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_part = _b64url_encode(payload_raw)
    signature = hmac.new(auth_secret(), payload_part.encode("ascii"), hashlib.sha256).digest()
    return f"{payload_part}.{_b64url_encode(signature)}"


def verify_tracking_token(token: str | None) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None

    try:
        payload_part, signature_part = token.split(".", 1)
        expected = hmac.new(auth_secret(), payload_part.encode("ascii"), hashlib.sha256).digest()
        actual = _b64url_decode(signature_part)
        if not hmac.compare_digest(expected, actual):
            return None

        payload = json.loads(_b64url_decode(payload_part))
        if int(payload.get("exp", 0)) < int(now_utc().timestamp()):
            return None
        return payload
    except (ValueError, json.JSONDecodeError):
        return None


def safe_percent(numerator: float, denominator: float) -> float:
    denominator = float(denominator or 0)
    if denominator <= 0:
        return 0.0
    return round((float(numerator or 0) / denominator) * 100, 2)


def safe_div(numerator: float, denominator: float) -> float:
    denominator = float(denominator or 0)
    if denominator <= 0:
        return 0.0
    return round(float(numerator or 0) / denominator, 2)


def parse_datetime_bound(value: str | None, *, end_of_day: bool = False) -> datetime | None:
    if not value:
        return None

    text = str(value).strip()
    try:
        if len(text) == 10 and text[4] == "-" and text[7] == "-":
            dt = datetime.fromisoformat(text)
            if end_of_day:
                dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
            return dt.replace(tzinfo=timezone.utc)

        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if not dt.tzinfo:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def parse_row_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        text = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        if not dt.tzinfo:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def date_in_range(value: str | None, start: datetime | None, end: datetime | None) -> bool:
    dt = parse_row_datetime(value)
    if not dt:
        return False
    if start and dt < start:
        return False
    if end and dt > end:
        return False
    return True
