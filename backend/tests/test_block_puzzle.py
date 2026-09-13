import os
import sys
import unittest
from copy import deepcopy
from unittest.mock import AsyncMock, patch
from uuid import uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routers import block, wallet
from services.account_mode import is_demo_user
from services.block_puzzle import apply_move, new_state, payout_cents, multiplier_hundredths


def piece(key="piece", coords=None, used=False):
    return {"id": key, "coords": coords or [[0, 0]], "used": used, "color": 0xffffff}


class PuzzleRules(unittest.TestCase):
    def test_row_and_column_clear_immediately_without_double_counting_intersection(self):
        state = new_state()
        state["pieces"] = [piece(), piece("other")]
        state["board"][0] = [0] + [1] * 7
        for row in range(1, 8):
            state["board"][row][0] = 1
        before = deepcopy(state)
        result, status = apply_move(state, "piece", 0, 0)
        self.assertEqual(result["total_clears"], 2)
        self.assertEqual(result["moves"], 1)
        self.assertEqual(result["best_combo"], 2)
        self.assertTrue(all(value == 0 for row in result["board"] for value in row))
        self.assertEqual(status, "active")
        self.assertEqual(state, before)

    def test_reused_unknown_and_outside_pieces_are_rejected(self):
        state = new_state()
        state["pieces"] = [piece(used=True)]
        for key, row, col in [("piece", 0, 0), ("unknown", 0, 0), ("piece", -1, 0)]:
            with self.assertRaises(ValueError):
                apply_move(state, key, row, col)

    def test_no_move_ends_round(self):
        state = new_state()
        state["board"] = [[(row + col) % 2 for col in range(8)] for row in range(8)]
        state["pieces"] = [piece(), piece("h2", [[0, 0], [0, 1]])]
        result, status = apply_move(state, "piece", 0, 0)
        self.assertEqual(status, "lost")

    def test_server_generates_next_batch(self):
        state = new_state()
        state["pieces"] = [piece()]
        result, status = apply_move(state, "piece", 0, 0)
        self.assertEqual(len(result["pieces"]), 3)
        self.assertFalse(any(item["used"] for item in result["pieces"]))

    def test_integer_money_rounding_and_cap(self):
        self.assertEqual(multiplier_hundredths({"total_clears": 0, "moves": 1}), 103)
        self.assertEqual(payout_cents(3000, {"total_clears": 3, "moves": 8}), 6480)
        self.assertEqual(payout_cents(50000, {"total_clears": 100, "moves": 100}), 400000)

    def test_only_configured_admin_is_demo(self):
        with patch.dict(os.environ, {"ADMIN_USERNAME": "owner"}):
            self.assertTrue(is_demo_user({"username": "Owner", "role": "admin"}))
            self.assertFalse(is_demo_user({"username": "someone", "role": "admin"}))
            self.assertFalse(is_demo_user({"username": "owner", "role": "player", "permissions": {}}))


class BlockAPI(unittest.TestCase):
    def setUp(self):
        self.user = {"id": str(uuid4()), "username": "player", "role": "player", "balance": 100}
        self.round_id = str(uuid4())
        self.state = new_state()
        self.state["pieces"] = [piece()]
        self.round = {"round_id": self.round_id, "bet": 30, "version": 0,
                      "status": "active", "payout": 0, "game_state": self.state}
        self.auth = patch.object(block, "verify_session_token", side_effect=lambda token: {"sub": self.user["id"]} if token == "test-token" else None)
        self.get_user = patch.object(block, "get_user_by_id", new=AsyncMock(side_effect=lambda _: self.user))
        self.find = patch.object(block, "find_round", new=AsyncMock(side_effect=lambda *_: deepcopy(self.round)))
        self.rpc = patch.object(block, "call_round_rpc", new=AsyncMock(return_value={"ok": True, "round": self.round, "balance": 70}))
        self.auth.start(); self.get_user.start(); self.find.start(); self.rpc.start()
        self.addCleanup(patch.stopall)
        app = FastAPI()
        app.include_router(block.router)
        app.include_router(wallet.router)
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer test-token"}

    def post(self, path, body):
        return self.client.post('/api/block' + path, json=body, headers=self.headers)

    def test_unauthenticated_start_cannot_debit(self):
        response = self.client.post('/api/block/rounds', json={"request_id": str(uuid4()), "bet": 30})
        self.assertEqual(response.status_code, 401)
        block.call_round_rpc.assert_not_awaited()

    def test_player_start_always_uses_atomic_real_wallet(self):
        response = self.post('/rounds', {"request_id": str(uuid4()), "bet": 30})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["demo_mode"])
        self.assertEqual(response.json()["balance"], 70)
        self.assertEqual(block.call_round_rpc.call_args.args[0], 'start_block_round')
        self.assertNotIn('server_seed', response.json())

    def test_client_cannot_request_demo_or_override_payout(self):
        response = self.post('/rounds', {"request_id": str(uuid4()), "bet": 30, "demo_mode": True})
        self.assertEqual(response.status_code, 422)
        response = self.post(f'/rounds/{self.round_id}/cashout', {"action_id": str(uuid4()), "version": 0, "payout": 999})
        self.assertEqual(response.status_code, 422)
        block.call_round_rpc.assert_not_awaited()

    def test_admin_start_does_not_touch_wallet_or_rounds(self):
        self.user.update(username='owner', role='admin')
        with patch.dict(os.environ, {"ADMIN_USERNAME": "owner"}):
            response = self.post('/rounds', {"request_id": str(uuid4()), "bet": 30})
        self.assertTrue(response.json()["demo_mode"])
        block.call_round_rpc.assert_not_awaited()
        block.find_round.assert_not_awaited()

    def test_other_admin_is_real(self):
        self.user.update(role='admin')
        with patch.dict(os.environ, {"ADMIN_USERNAME": "owner"}):
            response = self.post('/rounds', {"request_id": str(uuid4()), "bet": 30})
        self.assertFalse(response.json()["demo_mode"])

    def test_invalid_move_does_not_change_persisted_round(self):
        response = self.post(f'/rounds/{self.round_id}/moves', {"action_id": str(uuid4()), "version": 0, "piece_id": "forged", "row": 0, "col": 0})
        self.assertEqual(response.status_code, 422)
        block.call_round_rpc.assert_not_awaited()

    def test_cashout_uses_persisted_progress_and_cents(self):
        body = {"action_id": str(uuid4()), "version": 0}
        self.assertEqual(self.post(f'/rounds/{self.round_id}/cashout', body).status_code, 409)
        self.state.update(total_clears=3, moves=8)
        self.assertEqual(self.post(f'/rounds/{self.round_id}/cashout', body).status_code, 200)
        params = block.call_round_rpc.call_args.args[1]
        self.assertEqual(params['p_payout_cents'], 6480)
        self.assertEqual(params['p_status'], 'won')

    def test_retry_returns_committed_result_without_second_rpc(self):
        action = str(uuid4())
        self.round.update(last_action_id=action, status='won', payout=64.8)
        response = self.post(f'/rounds/{self.round_id}/cashout', {"action_id": action, "version": 0})
        self.assertEqual(response.json()['payout'], 64.8)
        self.assertEqual(block.call_round_rpc.call_args.args[0], 'read_block_round')

    def test_persistence_failure_never_falls_back_to_demo(self):
        block.call_round_rpc.side_effect = RuntimeError('missing schema')
        with patch.object(block.logger, 'exception'):
            response = self.post('/rounds', {"request_id": str(uuid4()), "bet": 30})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('demo_mode', response.json())

    def test_player_cannot_create_or_confirm_sandbox_deposit(self):
        with patch.object(wallet, 'current_user', new=AsyncMock(return_value=self.user)), patch.dict(os.environ, {'PAYMENT_PROVIDER': 'sandbox'}), patch.object(wallet, 'create_payment_intent', new=AsyncMock()) as create:
            response = self.client.post('/api/wallet/deposit-intents', json={'amount': 20})
            self.assertEqual(response.status_code, 503)
            create.assert_not_awaited()
            response = self.client.post('/api/wallet/deposit-intents/test/sandbox-confirm')
            self.assertEqual(response.status_code, 403)

    def test_admin_wallet_never_uses_real_provider(self):
        self.user.update(username='owner', role='admin')
        with patch.dict(os.environ, {'ADMIN_USERNAME': 'owner', 'PAYMENT_PROVIDER': 'amplopay'}):
            self.assertEqual(wallet.account_payment_provider(self.user), 'sandbox')

    def test_missing_callback_does_not_reserve_withdrawal(self):
        with patch.object(wallet, 'current_user', new=AsyncMock(return_value=self.user)), patch.object(wallet, 'create_withdrawal_request', new=AsyncMock()) as reserve, patch.dict(os.environ, {'PAYMENT_PROVIDER': 'amplopay', 'BACKEND_PUBLIC_URL': '', 'RENDER_EXTERNAL_URL': ''}):
            response = self.client.post('/api/wallet/withdrawals', json={
                'amount': 20, 'pix_key': 'player@example.test', 'pix_key_type': 'email',
                'owner_name': 'Player Test', 'owner_document': '12345678901',
            })
            self.assertEqual(response.status_code, 503)
            reserve.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
