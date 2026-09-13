import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const schema = await readFile(new URL('../../backend/db/schema.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../backend/db/migrations/20260912_block_rounds.sql', import.meta.url), 'utf8');
const player = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const state = { board: Array.from({ length: 8 }, () => Array(8).fill(0)), pieces: [], moves: 0, total_clears: 0, best_combo: 0, difficulty_tier: 1 };
const query = async (sql, values = []) => (await db.query(sql, values)).rows;
const start = async (user, id, bet = 30) => (await query('SELECT start_block_round($1,$2,$3,$4,$5,$6) AS result', [user, id, bet, state, 'test-seed', 'test-hash']))[0].result;
const commit = async (user, id, action, version, nextState, status = 'active', payout = 0) => (await query('SELECT commit_block_round($1,$2,$3,$4,$5,$6,$7) AS result', [user, id, action, version, nextState, status, payout]))[0].result;
const balance = async user => (await query('SELECT balance FROM users WHERE id=$1', [user]))[0].balance;
const read = async user => (await query('SELECT read_block_round($1,$2) AS result', [user, 'round-1']))[0].result;

try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(schema);
  await query('INSERT INTO users(id,phone,email,username,password_hash,balance,rollover_required) VALUES ($1,$2,$3,$4,$5,100,200),($6,$7,$8,$9,$5,0,0)', [player, '11000000000', 'one@example.test', 'player1', 'test-only', other, '11000000001', 'two@example.test', 'player2']);
  await db.exec(migration);
  assert.equal(await balance(player), 100, 'migration must preserve an existing balance');
  await db.exec(migration);
  assert.equal(await balance(player), 100, 'migration is safe to reapply');
  assert.equal((await start(other, 'no-funds')).reason, 'insufficient_balance');
  assert.equal((await start(player, 'bad-bet', 1)).reason, 'invalid');
  const opened = await start(player, 'round-1');
  assert.equal(opened.balance, 70);
  assert.equal(opened.round.version, 0);
  assert.equal((await start(player, 'round-1')).balance, 70, 'start retry must not debit twice');
  assert.equal((await start(player, 'another-tab')).round.round_id, 'round-1', 'another tab resumes existing round');
  assert.equal((await start(other, 'round-1')).reason, 'not_found', 'another account cannot resume the round');
  assert.equal((await query('SELECT rollover_progress FROM users WHERE id=$1', [player]))[0].rollover_progress, 30);
  const played = { ...state, moves: 8, total_clears: 3, best_combo: 1 };
  const move = await commit(player, 'round-1', 'move-1', 0, played);
  assert.equal(move.round.version, 1);
  assert.equal((await commit(player, 'round-1', 'move-1', 0, played)).round.version, 1, 'move retry is idempotent');
  assert.equal((await commit(player, 'round-1', 'stale', 0, played)).reason, 'conflict');
  assert.equal((await commit(other, 'round-1', 'foreign', 1, played)).reason, 'not_found');
  assert.equal((await commit(player, 'round-1', 'fake-payout', 1, played, 'won', 100000)).reason, 'invalid');
  assert.equal((await commit(player, 'round-1', 'fake-state', 1, { ...played, total_clears: 99 }, 'won', 24000)).reason, 'invalid');
  const won = await commit(player, 'round-1', 'cashout-1', 1, played, 'won', 6480);
  assert.equal(won.round.payout, 64.8);
  assert.equal(won.balance, 134.8);
  assert.equal((await read(player)).balance, 134.8, 'resume reads the settled wallet');
  assert.equal((await read(player)).round.status, 'won');
  assert.equal((await read(other)).reason, 'not_found', 'resume enforces ownership');
  assert.equal((await commit(player, 'round-1', 'cashout-1', 1, played, 'won', 6480)).balance, 134.8);
  assert.equal((await commit(player, 'round-1', 'second-cashout', 1, played, 'won', 6480)).reason, 'conflict');
  const ledger = await query('SELECT amount,transaction_type FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at', [player]);
  assert.deepEqual(ledger.map(row => row.transaction_type), ['bet', 'payout']);
  assert.deepEqual(ledger.map(row => row.amount), [-30, 64.8]);
  await start(player, 'round-2');
  assert.equal((await commit(player, 'round-2', 'too-early', 0, state, 'won', 3000)).reason, 'invalid');
  const lost = await commit(player, 'round-2', 'loss', 0, { ...state, moves: 2 }, 'lost');
  assert.equal(lost.balance, 104.8);
  assert.equal(lost.round.payout, 0);
  assert.equal((await start(player, 'round-2')).round.status, 'lost', 'retry after terminal round cannot open another bet');
  // A history insert failure must roll back the debit, ledger and rollover together.
  await db.exec("CREATE FUNCTION reject_test_round() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.round_id='rollback-test' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_failure BEFORE INSERT ON rounds FOR EACH ROW EXECUTE FUNCTION reject_test_round();");
  await assert.rejects(start(player, 'rollback-test'), /test failure/);
  assert.equal(await balance(player), 104.8);
  assert.equal((await query("SELECT count(*)::integer AS count FROM wallet_transactions WHERE reference_id='rollback-test'"))[0].count, 0);
  const rolloverBefore = (await query('SELECT rollover_progress FROM users WHERE id=$1', [player]))[0].rollover_progress;
  await start(player, 'payout-rollback');
  await commit(player, 'payout-rollback', 'move', 0, played);
  await db.exec("CREATE FUNCTION reject_test_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.round_id='payout-rollback' AND NEW.status='won' THEN RAISE EXCEPTION 'settlement failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_settlement_failure BEFORE UPDATE ON rounds FOR EACH ROW EXECUTE FUNCTION reject_test_settlement();");
  await assert.rejects(commit(player, 'payout-rollback', 'cashout', 1, played, 'won', 6480), /settlement failure/);
  assert.equal(await balance(player), 74.8, 'failed settlement cannot credit the wallet');
  assert.equal((await query("SELECT status FROM rounds WHERE round_id='payout-rollback'"))[0].status, 'active');
  assert.equal((await query("SELECT count(*)::integer AS count FROM wallet_transactions WHERE reference_id='payout-rollback' AND transaction_type='payout'"))[0].count, 0);
  assert.equal((await query('SELECT rollover_progress FROM users WHERE id=$1', [player]))[0].rollover_progress, rolloverBefore + 30);
  for (const role of ['anon', 'authenticated']) {
    const permissions = await query("SELECT has_function_privilege($1,'public.start_block_round(text,text,double precision,jsonb,text,text)','EXECUTE') AS start, has_function_privilege($1,'public.commit_block_round(text,text,text,integer,jsonb,text,bigint)','EXECUTE') AS commit, has_function_privilege($1,'public.adjust_wallet_balance(text,double precision,text,text,text,text,jsonb,double precision,double precision)','EXECUTE') AS wallet", [role]);
    assert.deepEqual(permissions[0], { start: false, commit: false, wallet: false });
    assert.equal((await query("SELECT has_function_privilege($1,'public.read_block_round(text,text)','EXECUTE') AS read", [role]))[0].read, false);
  }
  console.log('Block ledger: atomic debit/payout, idempotency, ownership, rollover and permissions OK');
} finally {
  await db.close();
}
