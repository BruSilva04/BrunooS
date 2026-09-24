import os
import sys
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from db.database import list_wallet_snapshot
from routers.auth import public_user


class DemoBalance(unittest.IsolatedAsyncioTestCase):
    def accounts(self):
        base = {'id': 'user-id', 'email': 'user@example.test', 'balance': 37.5}
        return [
            ({**base, 'username': 'OWNER', 'role': 'admin'}, 100, True),
            ({**base, 'username': 'owner', 'role': 'player', 'permissions': {'admin': True}}, 100, True),
            ({**base, 'username': 'owner', 'role': 'admin', 'demo_balance': 154}, 154, True),
            ({**base, 'username': 'owner', 'role': 'admin', 'demo_balance': 0}, 0, True),
            ({**base, 'username': 'other-admin', 'role': 'admin'}, 37.5, False),
            ({**base, 'username': 'player', 'role': 'player', 'demo_mode': True}, 37.5, False),
            ({**base, 'username': 'owner', 'role': 'player', 'permissions': {}}, 37.5, False),
        ]

    def test_auth_balance_uses_verified_account_mode_without_changing_wallet(self):
        with patch.dict(os.environ, {'ADMIN_USERNAME': 'owner'}):
            for user, expected_balance, expected_demo in self.accounts():
                with self.subTest(user=user):
                    original = deepcopy(user)
                    result = public_user(user)
                    self.assertEqual(result['balance'], expected_balance)
                    self.assertEqual(result['demo_mode'], expected_demo)
                    self.assertEqual(user, original)

    async def test_wallet_balance_uses_verified_account_mode_without_writes(self):
        client = MagicMock()
        query = client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value
        query.execute.return_value = SimpleNamespace(data=[])
        with patch('db.database.get_supabase_client', return_value=client), patch.dict(os.environ, {'ADMIN_USERNAME': 'owner'}):
            for user, expected_balance, _ in self.accounts():
                with self.subTest(user=user), patch('db.database.get_user_by_id', new=AsyncMock(return_value=user)):
                    original = deepcopy(user)
                    result = await list_wallet_snapshot(user['id'])
                    self.assertEqual(result['balance'], expected_balance)
                    self.assertEqual(user, original)
        client.rpc.assert_not_called()
        client.table.return_value.update.assert_not_called()
        client.table.return_value.insert.assert_not_called()


if __name__ == '__main__':
    unittest.main()
