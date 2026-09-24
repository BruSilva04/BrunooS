import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError
from pydantic import ValidationError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from db import database
from routers import auth, tracking, wallet
from services.tracking import generate_referral_code, normalize_referral_code


AFFILIATE_ID = '00000000-0000-4000-8000-000000000001'
CAMPAIGN_ID = '00000000-0000-4000-8000-000000000002'
CLICK_ID = '00000000-0000-4000-8000-000000000003'
CODE = 'JULIANA-0123456789ABCDEFABCD'
AFFILIATE = {'id': AFFILIATE_ID, 'name': 'Juliana', 'status': 'active'}
CAMPAIGN = {'id': CAMPAIGN_ID, 'affiliate_id': AFFILIATE_ID, 'name': 'Divulgação inicial',
            'referral_code': CODE, 'media_cost': 0, 'status': 'active'}
RESULT = {'affiliate': AFFILIATE, 'campaign': CAMPAIGN}


def duplicate_code_error():
    return APIError({'code': '23505', 'message': 'duplicate key value violates unique constraint "campaigns_referral_code_unique_idx"'})


class AffiliateCampaignAPI(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(tracking.router)
        self.client = TestClient(app)

    def test_creation_returns_influencer_and_campaign_with_defaults(self):
        with patch('routers.tracking.require_admin', new=AsyncMock()), patch(
            'routers.tracking.create_affiliate_with_campaign', new=AsyncMock(return_value=RESULT),
        ) as create:
            response = self.client.post('/api/admin/affiliates', json={'name': '  Juliana  '})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), RESULT)
        self.assertEqual(create.await_args.args[0]['name'], 'Juliana')
        self.assertEqual(create.await_args.args[0]['media_cost'], 0)
        self.assertIsNone(create.await_args.args[0]['campaign_name'])

    def test_creation_accepts_campaign_name_and_media_cost(self):
        with patch('routers.tracking.require_admin', new=AsyncMock()), patch(
            'routers.tracking.create_affiliate_with_campaign', new=AsyncMock(return_value=RESULT),
        ) as create:
            response = self.client.post('/api/admin/affiliates', json={
                'name': 'Juliana', 'campaign_name': '  Status de setembro  ', 'media_cost': 150.50,
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(create.await_args.args[0]['campaign_name'], 'Status de setembro')
        self.assertEqual(create.await_args.args[0]['media_cost'], 150.50)

    def test_only_authenticated_administrators_can_create(self):
        for session, user, expected in [
            (None, None, 401),
            ({'sub': 'user-id'}, {'id': 'user-id', 'role': 'player', 'permissions': {}}, 403),
            ({'sub': 'deleted'}, None, 403),
        ]:
            with self.subTest(expected=expected), patch('routers.tracking.verify_session_token', return_value=session), patch(
                'routers.tracking.get_user_by_id', new=AsyncMock(return_value=user),
            ), patch('routers.tracking.create_affiliate_with_campaign', new=AsyncMock()) as create:
                response = self.client.post('/api/admin/affiliates', json={'name': 'Juliana'})
            self.assertEqual(response.status_code, expected)
            create.assert_not_awaited()

    def test_whitespace_and_invalid_costs_are_rejected_before_writes(self):
        invalid = [{'name': '  '}, {'name': 'Juliana', 'campaign_name': '  '},
                   {'name': 'Juliana', 'media_cost': -1}, {'name': 'Juliana', 'media_cost': 10000000000}]
        with patch('routers.tracking.create_affiliate_with_campaign', new=AsyncMock()) as create:
            for payload in invalid:
                with self.subTest(payload=payload):
                    self.assertEqual(self.client.post('/api/admin/affiliates', json=payload).status_code, 422)
        create.assert_not_awaited()
        for cost in [float('nan'), float('inf'), float('-inf')]:
            with self.assertRaises(ValidationError):
                tracking.AffiliateCreateRequest(name='Juliana', media_cost=cost)

    def test_missing_migration_is_actionable_and_other_errors_hide_details(self):
        cases = [
            (database.AffiliateCampaignMigrationRequired(), '20260923_affiliate_campaign.sql'),
            (APIError({'code': '42501', 'message': 'sensitive internal details'}), 'Tente novamente'),
        ]
        for error, expected in cases:
            with self.subTest(error=type(error)), patch('routers.tracking.require_admin', new=AsyncMock()), patch(
                'routers.tracking.create_affiliate_with_campaign', new=AsyncMock(side_effect=error),
            ):
                response = self.client.post('/api/admin/affiliates', json={'name': 'Juliana'})
            self.assertEqual(response.status_code, 503)
            self.assertIn(expected, response.json()['detail'])
            self.assertNotIn('sensitive', response.text)

    def test_campaign_code_is_optional_but_manual_codes_still_work(self):
        for code in [None, ' campanha manual ']:
            payload = {'affiliate_id': AFFILIATE_ID, 'name': 'Nova campanha'}
            if code is not None:
                payload['referral_code'] = code
            with self.subTest(code=code), patch('routers.tracking.require_admin', new=AsyncMock()), patch(
                'routers.tracking.get_affiliate', new=AsyncMock(return_value=AFFILIATE),
            ), patch('routers.tracking.get_campaign_by_referral_code', new=AsyncMock(return_value=None)) as get_code, patch(
                'routers.tracking.create_campaign', new=AsyncMock(return_value=CAMPAIGN),
            ) as create:
                response = self.client.post('/api/admin/campaigns', json=payload)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(create.await_args.args[0]['referral_code'], None if code is None else 'CAMPANHA-MANUAL')
            self.assertEqual(get_code.await_count, 0 if code is None else 1)

    def test_concurrent_manual_code_conflict_returns_409(self):
        with patch('routers.tracking.require_admin', new=AsyncMock()), patch(
            'routers.tracking.get_affiliate', new=AsyncMock(return_value=AFFILIATE),
        ), patch('routers.tracking.get_campaign_by_referral_code', new=AsyncMock(return_value=None)), patch(
            'routers.tracking.create_campaign', new=AsyncMock(side_effect=database.ReferralCodeConflict()),
        ):
            response = self.client.post('/api/admin/campaigns', json={
                'affiliate_id': AFFILIATE_ID, 'name': 'Nova campanha', 'referral_code': 'MANUAL',
            })
        self.assertEqual(response.status_code, 409)


class AffiliateCampaignDatabase(unittest.IsolatedAsyncioTestCase):
    def test_generated_codes_are_valid_unique_and_readable(self):
        for name in ['Juliana', 'Júlia Souza', '@Ana 😄', 'A' * 160, '😍', '', None]:
            with self.subTest(name=name):
                codes = [generate_referral_code(name) for _ in range(100)]
                self.assertEqual(len(set(codes)), 100)
                self.assertTrue(all(code == normalize_referral_code(code) for code in codes))
                self.assertTrue(all(len(code) <= 40 for code in codes))
        self.assertTrue(generate_referral_code('Júlia Souza').startswith('JULIA-SOUZA-'))

    async def test_affiliate_and_campaign_use_one_rpc_and_never_individual_inserts(self):
        client = MagicMock()
        client.rpc.return_value.execute.return_value = SimpleNamespace(data=RESULT)
        with patch('db.database.get_supabase_client', return_value=client):
            result = await database.create_affiliate_with_campaign({'name': ' Juliana '})
        self.assertEqual(result, RESULT)
        rpc_name, params = client.rpc.call_args.args
        self.assertEqual(rpc_name, 'create_affiliate_with_campaign')
        self.assertEqual(params['p_campaign_name'], 'Divulgação inicial')
        self.assertEqual(params['p_media_cost'], 0)
        self.assertTrue(params['p_referral_code'].startswith('JULIANA-'))
        client.table.assert_not_called()

    async def test_missing_rpc_never_uses_a_partial_insert_fallback(self):
        client = MagicMock()
        client.rpc.return_value.execute.side_effect = APIError({'code': 'PGRST202', 'message': 'missing function'})
        with patch('db.database.get_supabase_client', return_value=client):
            with self.assertRaises(database.AffiliateCampaignMigrationRequired):
                await database.create_affiliate_with_campaign({'name': 'Juliana'})
        self.assertEqual(client.rpc.call_count, 1)
        client.table.assert_not_called()

    async def test_automatic_code_collision_retries_the_whole_rpc(self):
        client = MagicMock()
        client.rpc.return_value.execute.side_effect = [duplicate_code_error(), SimpleNamespace(data=RESULT)]
        with patch('db.database.get_supabase_client', return_value=client), patch(
            'db.database.generate_referral_code', side_effect=['DUPLICATE-CODE', CODE],
        ) as generate:
            result = await database.create_affiliate_with_campaign({'name': 'Juliana'})
        self.assertEqual(result, RESULT)
        self.assertEqual(generate.call_count, 2)
        self.assertEqual(client.rpc.call_count, 2)
        self.assertEqual(client.rpc.call_args.args[1]['p_referral_code'], CODE)
        client.table.assert_not_called()

    async def test_other_database_failures_are_not_retried_or_silenced(self):
        for error in [APIError({'code': '42501', 'message': 'denied'}),
                      APIError({'code': '23505', 'message': 'duplicate other constraint'}), RuntimeError('offline')]:
            client = MagicMock()
            client.rpc.return_value.execute.side_effect = error
            with self.subTest(error=error), patch('db.database.get_supabase_client', return_value=client):
                with self.assertRaises(type(error)):
                    await database.create_affiliate_with_campaign({'name': 'Juliana'})
            self.assertEqual(client.rpc.call_count, 1)
            client.table.assert_not_called()

    async def test_individual_campaign_retries_generated_codes_but_preserves_manual_codes(self):
        client = MagicMock()
        insert = client.table.return_value.insert.return_value.execute
        insert.side_effect = [duplicate_code_error(), SimpleNamespace(data=[CAMPAIGN])]
        with patch('db.database.get_supabase_client', return_value=client), patch(
            'db.database.generate_referral_code', side_effect=['DUPLICATE-CODE', CODE],
        ):
            self.assertEqual(await database.create_campaign({'name': 'Divulgação inicial', 'affiliate_id': AFFILIATE_ID}), CAMPAIGN)
        self.assertEqual(insert.call_count, 2)
        insert.reset_mock(side_effect=True)
        insert.side_effect = duplicate_code_error()
        with patch('db.database.get_supabase_client', return_value=client), patch('db.database.generate_referral_code') as generate:
            with self.assertRaises(database.ReferralCodeConflict):
                await database.create_campaign({'name': 'Manual', 'affiliate_id': AFFILIATE_ID, 'referral_code': 'MANUAL-CODE'})
        self.assertEqual(insert.call_count, 1)
        generate.assert_not_called()


class AcquisitionAttribution(unittest.IsolatedAsyncioTestCase):
    async def test_generated_link_click_signup_and_deposit_keep_the_same_campaign(self):
        click = {'id': CLICK_ID, 'campaign_id': CAMPAIGN_ID, 'visitor_id': 'visitor-test'}
        with patch('routers.tracking.get_active_campaign_by_referral_code', new=AsyncMock(return_value=CAMPAIGN)), patch(
            'routers.tracking.create_acquisition_click', new=AsyncMock(return_value=click),
        ):
            tracked = await tracking.tracking_click(tracking.TrackingClickRequest(referral_code=CODE, visitor_id='visitor-test'))
        with patch('db.database.get_acquisition_click', new=AsyncMock(return_value=click)), patch(
            'db.database.get_campaign', new=AsyncMock(return_value=CAMPAIGN),
        ):
            attribution = await database.resolve_acquisition_attribution(CLICK_ID, tracked['tracking_token'], CODE)
            self.assertEqual(attribution, {'click_id': CLICK_ID, 'campaign_id': CAMPAIGN_ID, 'referral_code': CODE})
            self.assertIsNone(await database.resolve_acquisition_attribution(CLICK_ID, tracked['tracking_token'] + 'x', CODE))
            self.assertIsNone(await database.resolve_acquisition_attribution(CLICK_ID, tracked['tracking_token'], 'ANOTHER-CODE'))

        created_user = {}

        async def create_user(data):
            created_user.update({'id': 'registered-user', **data})
            return created_user

        request = Request({'type': 'http', 'headers': [], 'client': ('127.0.0.1', 1234)})
        auth.RATE_LIMIT_BUCKETS.clear()
        with patch('routers.auth.get_user_by_username', new=AsyncMock(return_value=None)), patch(
            'routers.auth.get_user_by_email', new=AsyncMock(return_value=None),
        ), patch('routers.auth.get_user_by_document', new=AsyncMock(return_value=None)), patch(
            'routers.auth.resolve_acquisition_attribution', new=AsyncMock(return_value=attribution),
        ), patch('routers.auth.create_user', new=AsyncMock(side_effect=create_user)):
            await auth.register(auth.RegisterRequest(phone='11999999999', email='new@example.test', username='new-player',
                legal_name='Pessoa de Teste', document='12345678901', password='test-only-password',
                acquisition_click_id=CLICK_ID, acquisition_tracking_token=tracked['tracking_token'], referral_code=CODE), request)
        auth.RATE_LIMIT_BUCKETS.clear()
        self.assertEqual(created_user['acquisition_campaign_id'], CAMPAIGN_ID)
        self.assertEqual(created_user['acquisition_click_id'], CLICK_ID)
        self.assertEqual(created_user['balance'], 0, 'referral creates no bonus or commission')

        with patch('routers.wallet.current_user', new=AsyncMock(return_value=created_user)), patch(
            'routers.wallet.account_payment_provider', return_value='sandbox',
        ), patch('routers.wallet.create_payment_intent', new=AsyncMock(return_value={'id': 'payment-test'})) as create_intent:
            await wallet.deposit_intent(wallet.DepositIntentRequest(amount=40))
        create_intent.assert_awaited_once_with('registered-user', 40, 'sandbox', campaign_id=CAMPAIGN_ID)

    async def test_campaign_reports_signups_deposits_and_first_deposit_without_commissions(self):
        timestamp = '2026-09-23T12:00:00Z'
        data = {
            'acquisition_clicks': [
                {'id': 'click-1', 'campaign_id': CAMPAIGN_ID, 'visitor_id': 'visitor-1', 'created_at': timestamp},
                {'id': 'click-2', 'campaign_id': CAMPAIGN_ID, 'visitor_id': 'visitor-1', 'created_at': timestamp},
            ],
            'users': [{'id': 'player', 'acquisition_campaign_id': CAMPAIGN_ID, 'created_at': timestamp}],
            'payment_intents': [
                {'id': 'first', 'user_id': 'player', 'campaign_id': CAMPAIGN_ID, 'amount': 40, 'status': 'paid', 'updated_at': timestamp},
                {'id': 'second', 'user_id': 'player', 'campaign_id': CAMPAIGN_ID, 'amount': 20, 'status': 'paid', 'updated_at': '2026-09-23T13:00:00Z'},
            ],
            'rounds': [],
        }
        client = MagicMock()

        def table(name):
            query = MagicMock()
            for method in ['select', 'in_', 'eq', 'order', 'limit']:
                getattr(query, method).return_value = query
            query.execute.return_value = SimpleNamespace(data=data[name])
            return query

        client.table.side_effect = table
        with patch('db.database.get_supabase_client', return_value=client), patch(
            'db.database.list_campaigns', new=AsyncMock(return_value=[CAMPAIGN]),
        ), patch('db.database.list_affiliates', new=AsyncMock(return_value=[AFFILIATE])):
            report = await database.get_acquisition_report(affiliate_id=AFFILIATE_ID)
        overview = report['overview']
        self.assertEqual(overview['clicks_total'], 2)
        self.assertEqual(overview['unique_clicks'], 1)
        self.assertEqual(overview['signups'], 1)
        self.assertEqual(overview['depositors'], 1)
        self.assertEqual(overview['deposit_count'], 2)
        self.assertEqual(overview['total_deposited'], 60)
        self.assertEqual(overview['ftd'], 1)
        self.assertEqual(overview['conversion_signup'], 100)
        self.assertEqual(overview['conversion_depositor'], 100)
        self.assertEqual(report['rows'][0]['affiliate'], AFFILIATE)
        client.rpc.assert_not_called()


if __name__ == '__main__':
    unittest.main()
