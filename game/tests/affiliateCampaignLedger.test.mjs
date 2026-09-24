import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const schema = await readFile(new URL('../../backend/db/schema.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../backend/db/migrations/20260923_affiliate_campaign.sql', import.meta.url), 'utf8');
const query = async (sql, values = []) => (await db.query(sql, values)).rows;
const signature = 'public.create_affiliate_with_campaign(text,text,text,numeric,text,text,text,text)';
const create = async (name, code, campaign = 'Divulgação inicial', cost = 0) =>
  (await query('SELECT create_affiliate_with_campaign($1,$2,$3,$4) AS result', [name, code, campaign, cost]))[0].result;
const counts = async () => (await query(`SELECT
  (SELECT count(*)::integer FROM affiliates) AS affiliates,
  (SELECT count(*)::integer FROM campaigns) AS campaigns`))[0];

try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(schema);
  await db.exec("INSERT INTO users(phone,email,username,password_hash,balance) VALUES ('11999999999','player@example.test','player','test-only',77);");
  await db.exec(migration);
  await db.exec(migration);
  assert.equal((await query('SELECT balance FROM users'))[0].balance, 77, 'migration preserves existing balances');

  const first = await create('  Juliana  ', 'JULIANA-0123456789ABCDEFABCD');
  assert.equal(first.affiliate.name, 'Juliana');
  assert.equal(first.campaign.affiliate_id, first.affiliate.id);
  assert.equal(first.campaign.name, 'Divulgação inicial');
  assert.equal(first.campaign.media_cost, 0);
  assert.equal(first.campaign.referral_code, 'JULIANA-0123456789ABCDEFABCD');
  assert.equal(first.campaign.status, 'active');
  assert.deepEqual(await counts(), { affiliates: 1, campaigns: 1 });

  const custom = (await query('SELECT create_affiliate_with_campaign($1,$2,$3,$4,$5,$6,$7,$8) AS result', [
    'Ana', 'ANA-0123456789ABCDEFABCD', 'Status de setembro', 123.456, ' @ana ', ' Contato ', ' Notas ', 'paused',
  ]))[0].result;
  assert.equal(custom.affiliate.handle, '@ana');
  assert.equal(custom.affiliate.contact, 'Contato');
  assert.equal(custom.affiliate.notes, 'Notas');
  assert.equal(custom.affiliate.status, 'paused');
  assert.equal(custom.campaign.status, 'paused');
  assert.equal(custom.campaign.media_cost, 123.46);

  await assert.rejects(create('Juliana novamente', first.campaign.referral_code), /duplicate key/);
  assert.deepEqual(await counts(), { affiliates: 2, campaigns: 2 }, 'code collision rolls back the influencer too');

  // Exercise failure after the first insert, rather than merely validating input.
  await db.exec(`CREATE FUNCTION reject_campaign_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.name = 'FAIL' THEN RAISE EXCEPTION 'campaign insertion failed'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_campaign_test BEFORE INSERT ON campaigns FOR EACH ROW EXECUTE FUNCTION reject_campaign_test();`);
  await assert.rejects(create('Orphan test', 'ORPHAN-1234567890', 'FAIL'), /campaign insertion failed/);
  assert.deepEqual(await counts(), { affiliates: 2, campaigns: 2 }, 'failed campaign never leaves an orphan influencer');

  for (const [name, code, campaign, cost] of [
    ['  ', 'VALID-CODE', 'Divulgação inicial', 0],
    ['Ana', 'VALID-CODE', ' ', 0],
    ['Ana', 'bad code', 'Divulgação inicial', 0],
    ['Ana', 'VALID-CODE', 'Divulgação inicial', -1],
    ['Ana', 'VALID-CODE', 'Divulgação inicial', 'NaN'],
    ['Ana', 'VALID-CODE', 'Divulgação inicial', 'Infinity'],
    ['Ana', 'VALID-CODE', 'Divulgação inicial', 10000000000],
  ]) {
    await assert.rejects(create(name, code, campaign, cost), /Invalid affiliate campaign fields/);
  }
  assert.deepEqual(await counts(), { affiliates: 2, campaigns: 2 });

  for (const role of ['anon', 'authenticated']) {
    assert.equal((await query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [role, signature]))[0].allowed, false);
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(create('Unauthorized', 'DENIED-CODE'), /permission denied/);
    await db.exec('RESET ROLE');
  }
  assert.equal((await query('SELECT has_function_privilege(\'service_role\',$1,\'EXECUTE\') AS allowed', [signature]))[0].allowed, true);
  await db.exec('SET ROLE service_role');
  const allowed = await create('Permitida', 'SERVICE-ROLE-CODE');
  assert.equal(allowed.campaign.affiliate_id, allowed.affiliate.id);
  await db.exec('RESET ROLE');
  assert.deepEqual(await counts(), { affiliates: 3, campaigns: 3 });
  assert.equal((await query('SELECT balance FROM users'))[0].balance, 77);
  assert.equal((await query('SELECT count(*)::integer AS count FROM wallet_transactions'))[0].count, 0, 'campaign creation has no commission or financial movement');
  console.log('Affiliate campaign SQL: atomicity, unique codes, validation, permissions and preserved balances OK');
} finally {
  await db.close();
}

// The deployed database predates acquisition tracking. Applying this migration
// must bootstrap that feature without touching existing financial records.
const legacy = new PGlite();
try {
  await legacy.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.users (id uuid PRIMARY KEY, balance double precision NOT NULL,
      bonus_balance double precision NOT NULL, rollover_required double precision NOT NULL,
      rollover_progress double precision NOT NULL);
    CREATE TABLE public.payment_intents (id uuid PRIMARY KEY, user_id text, amount double precision, status text);
    CREATE TABLE public.rounds (round_id text PRIMARY KEY, bet double precision, payout double precision, status text);
    CREATE TABLE public.wallet_transactions (id uuid PRIMARY KEY, amount double precision, balance_after double precision);
    INSERT INTO users VALUES ('00000000-0000-4000-8000-000000000001', 77, 20, 100, 30);
    INSERT INTO payment_intents VALUES ('00000000-0000-4000-8000-000000000002', 'existing-user', 40, 'paid');
    INSERT INTO rounds VALUES ('existing-round', 30, 0, 'lost');
    INSERT INTO wallet_transactions VALUES ('00000000-0000-4000-8000-000000000003', -30, 77);
  `);
  const original = {};
  for (const table of ['users', 'payment_intents', 'rounds', 'wallet_transactions']) {
    original[table] = (await legacy.query(`SELECT * FROM ${table}`)).rows;
  }
  await legacy.exec(migration);
  await legacy.exec(migration);
  for (const [table, rows] of Object.entries(original)) {
    const columns = Object.keys(rows[0]).join(',');
    assert.deepEqual((await legacy.query(`SELECT ${columns} FROM ${table}`)).rows, rows, `legacy ${table} data remains unchanged`);
  }
  assert.deepEqual((await legacy.query('SELECT acquisition_campaign_id, acquisition_click_id, referral_code, attributed_at FROM users')).rows[0], {
    acquisition_campaign_id: null, acquisition_click_id: null, referral_code: null, attributed_at: null,
  });
  assert.equal((await legacy.query('SELECT campaign_id FROM payment_intents')).rows[0].campaign_id, null);
  const security = (await legacy.query(`SELECT c.relname, c.relrowsecurity,
    has_table_privilege('anon',c.oid,'SELECT') AS anon_read,
    has_table_privilege('authenticated',c.oid,'INSERT') AS authenticated_write,
    has_table_privilege('service_role',c.oid,'INSERT') AS backend_write
    FROM pg_class c WHERE c.oid IN ('affiliates'::regclass,'campaigns'::regclass,'acquisition_clicks'::regclass)`)).rows;
  assert.equal(security.length, 3);
  assert.ok(security.every(row => row.relrowsecurity && !row.anon_read && !row.authenticated_write && row.backend_write));
  await legacy.exec('SET ROLE service_role');
  const created = (await legacy.query("SELECT create_affiliate_with_campaign('Legacy test','LEGACY-TEST-CODE') AS result")).rows[0].result;
  const click = (await legacy.query('INSERT INTO acquisition_clicks(campaign_id,visitor_id) VALUES ($1,$2) RETURNING id', [created.campaign.id, 'visitor-test'])).rows[0];
  await assert.rejects(legacy.query('INSERT INTO acquisition_clicks(campaign_id,visitor_id) VALUES ($1,$2)', ['00000000-0000-4000-8000-000000000099', 'invalid']), /foreign key/);
  await legacy.exec('RESET ROLE');
  await legacy.query('UPDATE users SET acquisition_campaign_id=$1, acquisition_click_id=$2, referral_code=$3, attributed_at=now()', [created.campaign.id, click.id, created.campaign.referral_code]);
  await legacy.query('UPDATE payment_intents SET campaign_id=$1', [created.campaign.id]);
  assert.equal((await legacy.query('SELECT balance FROM users')).rows[0].balance, 77);
  console.log('Legacy acquisition bootstrap: tables, attribution, foreign keys, RLS, grants and financial data preserved OK');
} finally {
  await legacy.close();
}
