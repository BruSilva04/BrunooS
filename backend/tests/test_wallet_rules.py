import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.database import bonus_for_deposit, rollover_status


def test_deposit_bonus_threshold():
    assert bonus_for_deposit(20) == 0
    assert bonus_for_deposit(99.99) == 0
    assert bonus_for_deposit(100) == 100
    assert bonus_for_deposit(250) == 250


def test_rollover_status_progress():
    status = rollover_status({
        "rollover_required": 400,
        "rollover_progress": 125,
    })
    assert status["required"] == 400
    assert status["progress"] == 125
    assert status["remaining"] == 275
    assert status["complete"] is False


def test_rollover_status_complete():
    status = rollover_status({
        "rollover_required": 40,
        "rollover_progress": 40,
    })
    assert status["remaining"] == 0
    assert status["complete"] is True


if __name__ == "__main__":
    test_deposit_bonus_threshold()
    test_rollover_status_progress()
    test_rollover_status_complete()
    print("Wallet rules OK")
