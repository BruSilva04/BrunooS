"""Demo access belongs only to the configured owner account."""
import os


def is_demo_user(user: dict) -> bool:
    owner = os.getenv("ADMIN_USERNAME", "admin").strip().casefold()
    permissions = user.get("permissions") or {}
    return (
        bool(owner)
        and str(user.get("username", "")).strip().casefold() == owner
        and (user.get("role") == "admin" or permissions.get("admin") is True)
    )
