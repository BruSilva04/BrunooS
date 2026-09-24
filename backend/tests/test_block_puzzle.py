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
from services.block_puzzle import apply_move, new_state, payout_cents, multiplier_hundredths, generate_batch, has_move, difficulty


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

    def test_difficulty_increases_with_each_completed_batch(self):
        self.assertEqual(new_state()['difficulty_tier'], 2)
        self.assertEqual([difficulty(0, moves) for moves in (0, 2, 3, 6, 300)], [2, 2, 3, 4, 4])
        self.assertEqual([difficulty(clears, 0) for clears in (0, 3, 6, 90)], [2, 3, 4, 4])

    def test_each_new_batch_contains_a_blocked_shape_when_possible(self):
        board = [[0 if row == 0 else (row + col) % 2 for col in range(8)] for row in range(8)]
        before = deepcopy(board)
        for trial in range(100):
            batch = generate_batch(board, 4, randbelow=lambda size: trial * size // 100)
            self.assertEqual(len(batch), 3)
            self.assertEqual(len({item['key'] for item in batch}), 3)
            self.assertTrue(any(not has_move(board, [item]) for item in batch))
            self.assertTrue(all(len(item['coords']) >= 4 for item in batch))
        self.assertEqual(board, before)

    def test_unplayable_new_batch_ends_round_without_rescue(self):
        state = new_state()
        state['board'] = [[(row + col) % 2 for col in range(8)] for row in range(8)]
        state.update(pieces=[piece()], moves=2)
        result, status = apply_move(state, 'piece', 0, 0)
        self.assertEqual(result['difficulty_tier'], 3)
        self.assertEqual(len(result['pieces']), 3)
        self.assertFalse(has_move(result['board'], result['pieces']))
        self.assertEqual(status, 'lost')

    def test_clearing_a_line_can_unlock_a_previously_blocked_piece(self):
        state = new_state()
        state['board'] = [[(row + col) % 2 for col in range(8)] for row in range(8)]
        state['board'][2] = [1, 1, 1, 1, 1, 0, 0, 0]
        state['board'][1][4] = state['board'][3][4] = 0
        state['board'][1][5] = state['board'][1][7] = 1
        horizontal = piece('h3', [[0, 0], [0, 1], [0, 2]])
        vertical = piece('v3', [[0, 0], [1, 0], [2, 0]])
        state['pieces'] = [horizontal, vertical]
        self.assertFalse(has_move(state['board'], [vertical]))
        result, status = apply_move(state, 'h3', 2, 5)
        self.assertEqual(result['total_clears'], 1)
        self.assertTrue(has_move(result['board'], result['pieces']))
        self.assertEqual(status, 'active')

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
            for stored_balance in (0, 154, 100000):
                with self.subTest(stored_balance=stored_balance):
                    self.user['balance'] = stored_balance
                    response = self.post('/rounds', {"request_id": str(uuid4()), "bet": 30})
                    self.assertEqual(response.status_code, 200)
                    self.assertTrue(response.json()["demo_mode"])
                    self.assertEqual(response.json()["balance"], 70)
                    self.assertEqual(self.user['balance'], stored_balance)
        self.assertEqual(block.call_round_rpc.await_count, 3)
        self.assertTrue(all(call.args[0] == 'start_block_demo_round' for call in block.call_round_rpc.await_args_list))
        block.find_round.assert_not_awaited()

    def test_owner_start_rejects_insufficient_test_balance_and_database_failure(self):
        self.user.update(username='owner', role='admin')
        with patch.dict(os.environ, {'ADMIN_USERNAME': 'owner'}):
            block.call_round_rpc.return_value = {'ok': False, 'reason': 'insufficient_balance'}
            response = self.post('/rounds', {'request_id': str(uuid4()), 'bet': 500})
            self.assertEqual(response.status_code, 409)
            block.call_round_rpc.side_effect = RuntimeError('missing test ledger')
            with patch.object(block.logger, 'exception'):
                response = self.post('/rounds', {'request_id': str(uuid4()), 'bet': 30})
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('demo_mode', response.json())

    def test_owner_simulated_deposit_never_credits_real_wallet(self):
        self.user.update(username='owner', role='admin')
        intent_id = str(uuid4())
        intent = {'id': intent_id, 'provider': 'sandbox', 'user_id': self.user['id']}
        with patch.dict(os.environ, {'ADMIN_USERNAME': 'owner'}), patch.object(
            wallet, 'current_user', new=AsyncMock(return_value=self.user),
        ), patch.object(wallet, 'get_payment_intent', new=AsyncMock(return_value=intent)), patch.object(
            wallet, 'call_round_rpc', new=AsyncMock(return_value={'ok': True, 'intent': intent, 'balance': 140}),
        ) as credit, patch.object(wallet, 'confirm_payment_intent', new=AsyncMock()) as real_credit:
            response = self.client.post('/api/wallet/deposit-intents/' + intent_id + '/sandbox-confirm', headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['balance'], 140)
        credit.assert_awaited_once_with('confirm_block_demo_deposit', {'p_user_id': self.user['id'], 'p_intent_id': intent_id})
        real_credit.assert_not_awaited()

    def test_other_admin_is_real(self):
        self.user.update(role='admin')
        with patch.dict(os.environ, {"ADMIN_USERNAME": "owner"}):
            response = self.post('/rounds', {"request_id": str(uuid4()), "bet": 30})
        self.assertFalse(response.json()["demo_mode"])
        self.assertEqual(response.json()["balance"], 70)
        self.assertEqual(block.call_round_rpc.call_args.args[0], 'start_block_round')

    def test_invalid_move_does_not_change_persisted_round(self):
        response = self.post(f'/rounds/{self.round_id}/moves', {"action_id": str(uuid4()), "version": 0, "piece_id": "forged", "row": 0, "col": 0})
        self.assertEqual(response.status_code, 422)
        block.call_round_rpc.assert_not_awaited()

    def test_cashout_uses_persisted_progress_and_cents(self):
        body = {"action_id": str(uuid4()), "version": 0}
        self.assertEqual(self.post(f'/rounds/{self.round_id}/cashout', body).status_code, 409)
        self.state.update(total_clears=4, moves=8)
        self.assertEqual(self.post(f'/rounds/{self.round_id}/cashout', body).status_code, 409)
        self.state.update(total_clears=5, moves=8)
        self.assertEqual(self.post(f'/rounds/{self.round_id}/cashout', body).status_code, 200)
        params = block.call_round_rpc.call_args.args[1]
        self.assertEqual(params['p_payout_cents'], 8400)
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
        with patch.object(wallet, 'current_user', new=AsyncMock(return_value=self.user)), patch.object(wallet, 'create_withdrawal_request', new=AsyncMock()) as reserve, patch.dict(os.environ, {'WITHDRAWALS_ENABLED': 'false', 'PAYMENT_PROVIDER': 'amplopay', 'BACKEND_PUBLIC_URL': '', 'RENDER_EXTERNAL_URL': ''}):
            response = self.client.post('/api/wallet/withdrawals', json={
                'amount': 20, 'pix_key': 'player@example.test', 'pix_key_type': 'email',
                'owner_name': 'Player Test', 'owner_document': '12345678901',
            })
            self.assertEqual(response.status_code, 403)
            reserve.assert_not_awaited()

        with patch.object(wallet, 'current_user', new=AsyncMock(return_value=self.user)), patch.object(wallet, 'create_withdrawal_request', new=AsyncMock()) as reserve, patch.dict(os.environ, {'WITHDRAWALS_ENABLED': 'true', 'PAYMENT_PROVIDER': 'amplopay', 'BACKEND_PUBLIC_URL': '', 'RENDER_EXTERNAL_URL': ''}):
            response = self.client.post('/api/wallet/withdrawals', json={
                'amount': 20, 'pix_key': 'player@example.test', 'pix_key_type': 'email',
                'owner_name': 'Player Test', 'owner_document': '12345678901',
            })
            self.assertEqual(response.status_code, 503)
            reserve.assert_not_awaited()

    def test_demo_history_only_accepts_the_demo_owner_without_wallet_writes(self):
        body = {'request_id': str(uuid4()), 'bet': 30, 'status': 'won', 'moves': 8, 'total_clears': 5, 'best_combo': 2}
        with patch.object(block, 'save_demo_round', new=AsyncMock(return_value={'round_id': body['request_id'], 'balance': 154})) as save:
            self.assertEqual(self.post('/demo-results', body).status_code, 403)
            save.assert_not_awaited()
            self.user.update(username='owner', role='admin')
            with patch.dict(os.environ, {'ADMIN_USERNAME': 'owner'}):
                result = self.post('/demo-results', body)
            self.assertEqual(result.status_code, 200)
            self.assertTrue(result.json()['saved'])
            self.assertEqual(result.json()['balance'], 154)
            self.assertEqual(save.call_args.args[0]['payout'], 84)
            self.assertEqual(save.call_args.args[0]['user_id'], self.user['id'])
            block.call_round_rpc.assert_not_awaited()

    def test_demo_cannot_record_a_cashout_before_five_clears(self):
        self.user.update(username='owner', role='admin')
        with patch.dict(os.environ, {'ADMIN_USERNAME': 'owner'}), patch.object(block, 'save_demo_round', new=AsyncMock()) as save:
            for clears in (0, 3, 4):
                result = self.post('/demo-results', {'request_id': str(uuid4()), 'bet': 30, 'status': 'won', 'moves': 8, 'total_clears': clears, 'best_combo': 0})
                self.assertEqual(result.status_code, 422)
            save.assert_not_awaited()

    def test_lost_demo_has_zero_payout_and_persistence_failure_is_visible(self):
        self.user.update(username='owner', role='admin')
        body = {'request_id': str(uuid4()), 'bet': 30, 'status': 'lost', 'moves': 8, 'total_clears': 2, 'best_combo': 1}
        with patch.dict(os.environ, {'ADMIN_USERNAME': 'owner'}), patch.object(block, 'save_demo_round', new=AsyncMock(return_value={'round_id': body['request_id']})) as save:
            self.assertEqual(self.post('/demo-results', body).status_code, 200)
            self.assertEqual(save.call_args.args[0]['payout'], 0)
            save.side_effect = RuntimeError('offline')
            with patch.object(block.logger, 'exception'):
                self.assertEqual(self.post('/demo-results', body).status_code, 503)


if __name__ == '__main__':
    unittest.main()
