import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db = new PGlite();
const sql = name => readFile(new URL(`../../backend/db/${name}`, import.meta.url), 'utf8');
const q = async (query, params=[]) => (await db.query(query,params)).rows;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1), other=id(2), player=id(3);
const balance = async user => Number((await q('SELECT demo_balance FROM users WHERE id=$1',[user]))[0].demo_balance);
const start = async (round,bet=30,user=owner) => (await q('SELECT start_block_demo_round($1,$2,$3) AS result',[user,id(round),bet]))[0].result;
const settle = async (round,status='won',bet=30,user=owner) => (await q('SELECT settle_block_demo_round($1,$2,$3,$4,8,5,2) AS result',[user,id(round),bet,status]))[0].result;
const credit = async (intent,user=owner) => (await q('SELECT confirm_block_demo_deposit($1,$2) AS result',[user,id(intent)]))[0].result;
try {
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
 await db.exec(await sql('schema.sql'));
 await db.exec(await sql('migrations/20260912_block_rounds.sql'));
 await db.exec(await sql('migrations/20260914_block_cashout_history.sql'));
 for (const [user,role] of [[owner,'admin'],[other,'admin'],[player,'player']]) {
  await q('INSERT INTO users(id,phone,email,username,password_hash,role,balance,bonus_balance,rollover_required,rollover_progress) VALUES($1,$2,$2,$2,\'test\',$3,77,20,100,30)',[user,user,role]);
 }
 const realBefore = await q('SELECT id,balance,bonus_balance,rollover_required,rollover_progress FROM users ORDER BY id');
 const migration=await sql('migrations/20260924_demo_balance.sql');
 await db.exec(migration); await db.exec(migration);
 assert.equal(await balance(owner),100);
 assert.equal((await start(10)).balance,70);
 assert.equal((await start(10)).balance,70,'start retry does not debit twice');
 assert.equal((await start(10,50)).reason,'conflict');
 assert.equal((await start(10,30,other)).reason,'conflict');
 assert.equal(await balance(other),100);
 assert.equal((await settle(10)).balance,154,'100 - 30 + 84 = 154');
 assert.equal((await settle(10)).balance,154,'settlement retry does not pay twice');
 assert.equal((await settle(10,'lost')).reason,'conflict');
 assert.equal((await settle(10,'won',30,other)).reason,'conflict');
 assert.equal((await start(10)).reason,'conflict','finished request cannot reopen a round');
 assert.equal((await start(11,50)).balance,104);
 assert.equal((await settle(11,'lost',50)).balance,104,'loss keeps only the original debit');
 assert.equal((await start(12,500)).reason,'insufficient_balance');
 assert.equal((await q('SELECT count(*)::integer AS n FROM block_demo_stakes WHERE round_id=$1',[id(12)]))[0].n,0);
 assert.equal((await start(13,30,player)).reason,'not_found');
 await q("UPDATE users SET permissions='{}'::jsonb WHERE id=$1",[player]);
 assert.equal((await start(13,30,player)).reason,'not_found','missing admin flag cannot bypass authorization');
 assert.equal((await settle(13,'won',30,player)).reason,'not_found');
 assert.equal((await start(14,40)).reason,'invalid');
 assert.equal((await settle(15)).balance,104,'older queued results are history-only');
 await db.exec(migration);
 assert.equal(await balance(owner),104,'reapplying the migration preserves changed test credit');
 assert.equal((await q('SELECT read_lobby_snapshot($1) AS result',[owner]))[0].result.user.demo_balance,104);
 await start(16);
 assert.equal((await q("SELECT settle_block_demo_round($1,$2,30,'won',8,4,2) AS result",[owner,id(16)]))[0].result.reason,'invalid');
 await db.exec(`CREATE FUNCTION reject_test_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.round_id='${id(16)}' THEN RAISE EXCEPTION 'test history failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER reject_test_result BEFORE INSERT ON block_demo_rounds FOR EACH ROW EXECUTE FUNCTION reject_test_result();`);
 await assert.rejects(settle(16),/test history failure/);
 assert.equal(await balance(owner),74,'failed history insertion cannot credit test winnings');
 for (const [intent,user,provider] of [[20,owner,'sandbox'],[21,owner,'amplopay'],[22,other,'sandbox']]) {
  await q('INSERT INTO payment_intents(id,user_id,provider,amount) VALUES($1,$2,$3,40)',[id(intent),user,provider]);
 }
 assert.equal((await credit(20)).balance,114);
 assert.equal((await credit(20)).balance,114,'repeated simulated deposit cannot credit twice');
 assert.equal((await credit(21)).reason,'not_found','real payments never enter the test wallet');
 assert.equal((await credit(22)).reason,'not_found');
 assert.equal((await credit(20,player)).reason,'not_found');
 assert.equal((await q('SELECT metadata FROM payment_intents WHERE id=$1',[id(20)]))[0].metadata.demo_balance_credit,true);
 assert.deepEqual(await q('SELECT id,balance,bonus_balance,rollover_required,rollover_progress FROM users ORDER BY id'),realBefore);
 for (const table of ['wallet_transactions','rounds']) assert.equal((await q(`SELECT count(*)::integer AS n FROM ${table}`))[0].n,0);
 for (const role of ['anon','authenticated']) {
  await db.exec(`SET ROLE ${role}`);
  await assert.rejects(start(25),/permission denied/);
  await assert.rejects(settle(25),/permission denied/);
  await assert.rejects(credit(20),/permission denied/);
  await assert.rejects(q('SELECT * FROM block_demo_stakes'),/permission denied/);
  await db.exec('RESET ROLE');
 }
 await db.exec('SET ROLE service_role');
 assert.equal((await start(30)).balance,84,'only backend can reserve test credit');
 await db.exec('RESET ROLE');
 console.log('Test balance SQL: debit, win/loss, retries, ownership, legacy history, simulated deposits, permissions and real-wallet isolation OK');
} finally { await db.close(); }
