import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

let affiliates = [], campaigns = [], createAffiliate, createCampaign;
const copied = [];
let readReport = async () => ({ overview: {}, rows: [] });
const navigator = { clipboard: { writeText: async value => copied.push(value) } };
class FormData {
  constructor(form) { this.form = form; }
  entries() { return Object.entries(this.form.values); }
}
const context = vm.createContext({ window: { location: { origin: 'https://jogo.example' } }, navigator, FormData });
const api = {
  clearSession() {},
  createAdminAffiliate: payload => createAffiliate(payload),
  createAdminCampaign: payload => createCampaign(payload),
  listAdminAffiliates: async () => ({ affiliates }),
  listAdminCampaigns: async () => ({ campaigns }),
  fetchAdminAcquisitionCampaigns: () => readReport(),
};
const dependencies = {
  phaser: { default: { Scene: class {} } },
  '../brand.js': { BRAND: { upperName: 'BLOCK RUSH', slug: 'block-rush' } },
  '../config.js': { W: 390, H: 760 },
  '../services/api.js': api,
};
const module = new vm.SourceTextModule(await readFile(new URL('../src/scenes/AdminDashboardScene.js', import.meta.url), 'utf8'), { context });
await module.link(specifier => {
  const exports = dependencies[specifier];
  assert.ok(exports, specifier);
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
});
await module.evaluate();
const Admin = module.namespace.default;
function scene() {
  const admin = new Admin();
  admin.init();
  admin.root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], remove() {} };
  admin.scene = { start() {} };
  return admin;
}
function submission(values) {
  const button = { disabled: false };
  const form = { values, resets: 0, querySelector: () => button, reset() { this.resets++; } };
  return { currentTarget: form, preventDefault() {}, button };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const admin = scene();
await admin._load();
assert.match(admin.root.innerHTML, /Criar e gerar link/);
assert.doesNotMatch(admin._campaignFormHtml(), /name="referral_code"[^>]*required/);
const pending = deferred();
let affiliateCalls = 0, affiliatePayload;
createAffiliate = payload => { affiliateCalls++; affiliatePayload = payload; return pending.promise; };
const event = submission({ name: '  Júlia  ', handle: '@julia', campaign_name: ' Status setembro ', media_cost: '250.50' });
const saving = admin._submitAffiliate(event);
await admin._submitAffiliate(event);
assert.equal(affiliateCalls, 1, 'double submit cannot create a duplicate influencer/campaign');
assert.equal(event.button.disabled, true);
assert.equal(affiliatePayload.name, 'Júlia');
assert.equal(affiliatePayload.campaign_name, 'Status setembro');
assert.equal(affiliatePayload.media_cost, 250.5);
const affiliate = { id: 'affiliate-julia', name: 'Júlia' };
const campaign = { id: 'campaign-julia', affiliate_id: affiliate.id, name: 'Status setembro', referral_code: 'JULIA-ABC123', status: 'active' };
affiliates = [affiliate];
campaigns = [campaign];
pending.resolve({ affiliate, campaign });
await saving;
assert.equal(admin.creating, false);
assert.equal(event.currentTarget.resets, 1);
assert.equal(admin.createdCampaign.campaign.id, campaign.id);
assert.match(admin.root.innerHTML, /https:\/\/jogo.example\/\?ref=JULIA-ABC123/);
assert.match(admin.root.innerHTML, /Link pronto para divulgar/);
assert.match(admin.root.innerHTML, /Não há comissão pelo link/);
assert.match(admin.root.innerHTML, /Status setembro/);
assert.equal(admin.report.rows.length, 0, 'the new link stays visible even if report filters hide its campaign');

let campaignPayload;
createCampaign = async payload => {
  campaignPayload = payload;
  return { campaign: { ...campaign, id: 'campaign-second', name: payload.name, referral_code: payload.referral_code || 'JULIA-SECOND' } };
};
await admin._submitCampaign(submission({ affiliate_id: affiliate.id, name: 'Segundo status', referral_code: '', media_cost: '' }));
assert.equal(campaignPayload.referral_code, undefined, 'blank code lets the server generate a new one');
assert.equal(campaignPayload.media_cost, 0);
assert.equal(admin.createdCampaign.affiliate.id, affiliate.id);
assert.match(admin.root.innerHTML, /\?ref=JULIA-SECOND/);
await admin._submitCampaign(submission({ affiliate_id: affiliate.id, name: 'Personalizada', referral_code: 'JULIA-MANUAL' }));
assert.equal(campaignPayload.referral_code, 'JULIA-MANUAL', 'existing custom codes remain supported');

const link = admin._campaignLink('JULIA-MANUAL');
await admin._copyText(link);
assert.deepEqual(copied, [link]);
navigator.clipboard.writeText = async () => { throw Error('clipboard denied'); };
await admin._copyText(link);
assert.ok(admin.message.includes(link), 'clipboard failure still exposes the copyable link');
admin.createdCampaign.affiliate = { name: '<img src=x onerror=alert(1)>' };
assert.match(admin._createdCampaignHtml(), /&lt;img/);
assert.doesNotMatch(admin._createdCampaignHtml(), /<img/);

const failed = scene();
failed.loading = false;
createAffiliate = async () => { throw Error('Falha temporária'); };
await failed._submitAffiliate(submission({ name: 'Teste' }));
assert.equal(failed.creating, false);
assert.equal(failed.createdCampaign, null);
assert.match(failed.root.innerHTML, /Falha temporária/);

const refreshing = scene();
refreshing.loading = false;
const slowReport = deferred();
readReport = () => slowReport.promise;
createAffiliate = async () => ({ affiliate, campaign });
await refreshing._submitAffiliate(submission({ name: 'Júlia' }));
assert.equal(refreshing.creating, false);
assert.match(refreshing.root.innerHTML, /Link pronto para divulgar/, 'the link is available before the report finishes refreshing');
await refreshing._copyText(refreshing._campaignLink(campaign.referral_code));
assert.match(refreshing.root.innerHTML, /Link pronto para divulgar/, 'copying during refresh keeps the link visible');
slowReport.reject(new Error('Relatório temporariamente indisponível'));
await new Promise(resolve => setImmediate(resolve));
assert.match(refreshing.root.innerHTML, /Link pronto para divulgar/, 'a report failure does not hide the successfully created link');
readReport = async () => ({ overview: {}, rows: [] });

const closed = scene();
const late = deferred();
createAffiliate = () => late.promise;
const request = closed._submitAffiliate(submission({ name: 'Outra' }));
closed._cleanup();
late.resolve({ affiliate, campaign });
await request;
assert.equal(closed.root, null);
assert.equal(closed.createdCampaign, null, 'response from a closed admin scene is ignored');

console.log('Admin campaign flow: automatic linked campaign, shareable link, duplicate-submit guard and lifecycle OK');
