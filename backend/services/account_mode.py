"""Demo access belongs only to the configured owner account."""
import os

DEMO_BALANCE = 100.0


def is_demo_user(user: dict) -> bool:
    owner = os.getenv("ADMIN_USERNAME", "admin").strip().casefold()
    permissions = user.get("permissions") or {}
    return (
        bool(owner)
        and str(user.get("username", "")).strip().casefold() == owner
        and (user.get("role") == "admin" or permissions.get("admin") is True)
    )


def account_balance(user: dict) -> float:
    """Present persistent test credit separately from the real wallet."""
    if is_demo_user(user):
        return float(user.get("demo_balance", DEMO_BALANCE))
    return float(user.get("balance", 0) or 0)
