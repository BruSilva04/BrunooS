import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.tracking import (
    create_tracking_token,
    normalize_referral_code,
    safe_div,
    safe_percent,
    verify_tracking_token,
)


def test_referral_code_normalization():
    assert normalize_referral_code(" juliana ") == "JULIANA"
    assert normalize_referral_code("Juliana Setembro") == "JULIANA-SETEMBRO"
    assert normalize_referral_code("JULIANA;DROP") == ""
    assert normalize_referral_code("ab") == ""


def test_tracking_token_roundtrip():
    token = create_tracking_token(
        click_id="click-1",
        campaign_id="campaign-1",
        referral_code="JULIANA",
        visitor_id="visitor-1",
        ttl_seconds=60,
    )
    payload = verify_tracking_token(token)
    assert payload["click_id"] == "click-1"
    assert payload["campaign_id"] == "campaign-1"
    assert payload["referral_code"] == "JULIANA"
    assert payload["visitor_id"] == "visitor-1"
    assert verify_tracking_token(token + "x") is None


def test_safe_metric_math():
    assert safe_percent(10, 20) == 50
    assert safe_percent(10, 0) == 0
    assert safe_div(100, 4) == 25
    assert safe_div(100, 0) == 0


if __name__ == "__main__":
    test_referral_code_normalization()
    test_tracking_token_roundtrip()
    test_safe_metric_math()
    print("Tracking rules OK")
