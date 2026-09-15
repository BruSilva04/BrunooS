import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from postgrest.exceptions import APIError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from db.database import get_lobby_snapshot


class LobbyHistory(unittest.IsolatedAsyncioTestCase):
    async def test_real_and_demo_history_share_a_consistent_snapshot(self):
        user = {'id': 'owner-id', 'username': 'owner', 'email': 'owner@example.test', 'role': 'admin', 'balance': 154}
        rounds = [
            {'round_id': 'pending', 'bet': 30, 'payout': 0, 'status': 'active', 'game_type': 'block'},
            {'round_id': 'demo', 'bet': 30, 'payout': 84, 'status': 'won', 'cash_out_at': 2.8, 'demo_mode': True},
            {'round_id': 'real', 'bet': 30, 'payout': 0, 'status': 'lost', 'cash_out_at': 1.2, 'demo_mode': False},
        ]
        client = MagicMock()
        client.rpc.return_value.execute.return_value = SimpleNamespace(data={'user': user, 'rounds': rounds})
        with patch('db.database.get_supabase_client', return_value=client), patch.dict(os.environ, {'ADMIN_USERNAME': 'owner'}):
            snapshot = await get_lobby_snapshot('owner-id')
        client.rpc.assert_called_once_with('read_lobby_snapshot', {'p_user_id': 'owner-id'})
        client.table.assert_not_called()
        self.assertEqual(snapshot['balance'], 154)
        self.assertTrue(snapshot['demo_history_available'])
        self.assertEqual(snapshot['stats']['rounds'], 2)
        self.assertEqual([row['round_id'] for row in snapshot['history']], ['demo', 'real'])
        self.assertEqual([row['payout'] for row in snapshot['history']], [54, -30])
        self.assertEqual([row['demo_mode'] for row in snapshot['history']], [True, False])
        self.assertEqual(snapshot['active_block_round']['round_id'], 'pending')

    async def test_missing_user_is_not_replaced_with_empty_fake_account(self):
        client = MagicMock()
        client.rpc.return_value.execute.return_value = SimpleNamespace(data={'user': None, 'rounds': []})
        with patch('db.database.get_supabase_client', return_value=client):
            self.assertIsNone(await get_lobby_snapshot('missing'))
            client.rpc.return_value.execute.side_effect = RuntimeError('unavailable')
            with self.assertRaises(RuntimeError):
                await get_lobby_snapshot('missing')

    async def test_missing_rpc_preserves_existing_real_lobby_until_migration(self):
        user = {'id': 'player-id', 'username': 'player', 'email': 'player@example.test', 'balance': 70}
        rounds = [
            {'round_id': 'active', 'bet': 30, 'payout': 0, 'status': 'active', 'game_type': 'block'},
            {'round_id': 'real', 'bet': 30, 'payout': 0, 'status': 'lost', 'cash_out_at': 1.2},
        ]
        client = MagicMock()
        client.rpc.return_value.execute.side_effect = APIError({'code': 'PGRST202', 'message': 'Missing function'})
        query = client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value
        query.execute.return_value = SimpleNamespace(data=rounds)
        with patch('db.database.get_supabase_client', return_value=client), patch(
            'db.database.get_user_by_id', new=AsyncMock(return_value=user),
        ) as get_user:
            snapshot = await get_lobby_snapshot('player-id')
        get_user.assert_awaited_once_with('player-id')
        client.table.assert_called_once_with('rounds')
        client.table.return_value.select.return_value.eq.assert_called_once_with('user_id', 'player-id')
        self.assertEqual(snapshot['balance'], 70)
        self.assertFalse(snapshot['demo_history_available'])
        self.assertEqual(snapshot['active_block_round']['round_id'], 'active')
        self.assertEqual(snapshot['history'][0]['round_id'], 'real')
        self.assertFalse(snapshot['history'][0]['demo_mode'])
        self.assertEqual(snapshot['stats']['rounds'], 1)

    async def test_missing_rpc_does_not_invent_a_user_or_swallow_round_errors(self):
        client = MagicMock()
        client.rpc.return_value.execute.side_effect = APIError({'code': 'PGRST202', 'message': 'Missing function'})
        with patch('db.database.get_supabase_client', return_value=client), patch(
            'db.database.get_user_by_id', new=AsyncMock(return_value=None),
        ) as get_user:
            self.assertIsNone(await get_lobby_snapshot('missing'))
            client.table.assert_not_called()
            get_user.return_value = {'id': 'player-id'}
            client.table.side_effect = RuntimeError('rounds unavailable')
            with self.assertRaisesRegex(RuntimeError, 'rounds unavailable'):
                await get_lobby_snapshot('player-id')

    async def test_other_rpc_errors_never_use_legacy_reads(self):
        client = MagicMock()
        errors = [
            APIError({'code': '42501', 'message': 'Permission denied'}),
            APIError({'code': 'PGRST204', 'message': 'Missing column'}),
            RuntimeError('PGRST202 text is not a PostgREST error code'),
        ]
        with patch('db.database.get_supabase_client', return_value=client), patch(
            'db.database.get_user_by_id', new=AsyncMock(),
        ) as get_user:
            for error in errors:
                with self.subTest(error=error):
                    client.rpc.return_value.execute.side_effect = error
                    with self.assertRaises(type(error)) as raised:
                        await get_lobby_snapshot('player-id')
                    self.assertIs(raised.exception, error)
            get_user.assert_not_awaited()
            client.table.assert_not_called()


if __name__ == '__main__':
    unittest.main()
