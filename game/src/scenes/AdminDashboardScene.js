import Phaser from 'phaser';
import { H, W } from '../config.js';
import {
  clearSession,
  createAdminAffiliate,
  createAdminCampaign,
  fetchAdminAcquisitionCampaigns,
  listAdminAffiliates,
  listAdminCampaigns,
} from '../services/api.js';

export default class AdminDashboardScene extends Phaser.Scene {
  constructor() {
    super({ key: 'AdminDashboard' });
  }

  init() {
    this.root = null;
    this.loading = true;
    this.error = '';
    this.message = '';
    this.affiliates = [];
    this.campaigns = [];
    this.report = { overview: {}, rows: [] };
    this.filters = { from: '', to: '', affiliate_id: '', campaign_id: '' };
  }

  create() {
    this._drawBackdrop();
    this._mount();
    this._renderLoading();
    this._load();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._cleanup());
  }

  _drawBackdrop() {
    const g = this.add.graphics();
    g.fillGradientStyle(0x11050a, 0x11050a, 0x03040a, 0x03040a, 1);
    g.fillRect(0, 0, W, H);
    g.fillStyle(0xf4c84a, 0.08);
    g.fillCircle(W - 50, 78, 110);
    g.fillStyle(0x9f1426, 0.13);
    g.fillCircle(38, H - 80, 150);
  }

  _mount() {
    this.root = document.createElement('div');
    this.root.className = 'sereia-admin-root';
    document.body.appendChild(this.root);
  }

  _renderLoading() {
    if (!this.root) return;
    this.root.innerHTML = `
      ${this._style()}
      <main class="admin-shell center">
        <section class="admin-loading">
          <strong>Carregando painel</strong>
          <span>Aquisicao e influenciadores</span>
        </section>
      </main>
    `;
  }

  async _load() {
    this.loading = true;
    this.error = '';
    try {
      const [affiliatesData, campaignsData, report] = await Promise.all([
        listAdminAffiliates(),
        listAdminCampaigns(),
        fetchAdminAcquisitionCampaigns(this._activeFilters()),
      ]);
      this.affiliates = affiliatesData.affiliates || [];
      this.campaigns = campaignsData.campaigns || [];
      this.report = report || { overview: {}, rows: [] };
    } catch (error) {
      this.error = error.message || 'Falha ao carregar painel admin.';
      if (String(this.error).includes('401')) {
        clearSession();
        this.scene.start('Auth');
        return;
      }
    } finally {
      this.loading = false;
      this._render();
    }
  }

  _activeFilters() {
    return Object.fromEntries(
      Object.entries(this.filters).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );
  }

  _render() {
    if (!this.root) return;
    if (this.loading) {
      this._renderLoading();
      return;
    }

    const overview = this.report.overview || {};
    this.root.innerHTML = `
      ${this._style()}
      <main class="admin-shell">
        <header class="admin-topbar">
          <div>
            <span>PAINEL ADMIN</span>
            <h1>Aquisicao</h1>
          </div>
          <div class="admin-actions">
            <button type="button" data-action="refresh">Atualizar</button>
            <button type="button" data-action="back">Lobby</button>
          </div>
        </header>

        ${this.error ? `<section class="admin-alert error">${this._escape(this.error)}</section>` : ''}
        ${this.message ? `<section class="admin-alert">${this._escape(this.message)}</section>` : ''}

        ${this._filtersHtml()}
        ${this._kpisHtml(overview)}

        <section class="admin-grid">
          ${this._affiliateFormHtml()}
          ${this._campaignFormHtml()}
        </section>

        ${this._campaignTableHtml()}
      </main>
    `;
    this._bindDom();
  }

  _filtersHtml() {
    return `
      <section class="filter-panel">
        <label>
          De
          <input name="filter-from" type="date" value="${this._escape(this.filters.from)}" />
        </label>
        <label>
          Ate
          <input name="filter-to" type="date" value="${this._escape(this.filters.to)}" />
        </label>
        <label>
          Influenciador
          <select name="filter-affiliate">
            <option value="">Todos</option>
            ${this.affiliates.map((item) => `
              <option value="${this._escape(item.id)}" ${this.filters.affiliate_id === item.id ? 'selected' : ''}>
                ${this._escape(item.name)}
              </option>
            `).join('')}
          </select>
        </label>
        <label>
          Campanha
          <select name="filter-campaign">
            <option value="">Todas</option>
            ${this.campaigns.map((item) => `
              <option value="${this._escape(item.id)}" ${this.filters.campaign_id === item.id ? 'selected' : ''}>
                ${this._escape(item.name)}
              </option>
            `).join('')}
          </select>
        </label>
        <button type="button" data-action="apply-filters">Filtrar</button>
        <button type="button" data-action="export-csv">CSV</button>
      </section>
    `;
  }

  _kpisHtml(overview) {
    const items = [
      ['Cliques', this._num(overview.clicks_total)],
      ['Cadastros', this._num(overview.signups)],
      ['Depositantes', this._num(overview.depositors)],
      ['FTDs', this._num(overview.ftd)],
      ['Depositos', this._money(overview.total_deposited)],
      ['GGR', this._money(overview.ggr)],
      ['Custo midia', this._money(overview.media_cost)],
      ['CAC', this._money(overview.cac)],
      ['Resultado bruto', this._money(overview.media_gross_result)],
    ];
    return `
      <section class="kpi-grid">
        ${items.map(([label, value]) => `
          <article>
            <span>${label}</span>
            <strong>${value}</strong>
          </article>
        `).join('')}
      </section>
    `;
  }

  _affiliateFormHtml() {
    return `
      <section class="admin-card">
        <h2>Criar influenciador</h2>
        <form data-form="affiliate">
          <input name="name" placeholder="Nome" required maxlength="120" />
          <input name="handle" placeholder="@handle" maxlength="80" />
          <input name="contact" placeholder="Contato" maxlength="180" />
          <textarea name="notes" placeholder="Observacoes" maxlength="1000"></textarea>
          <button type="submit">Criar influenciador</button>
        </form>
      </section>
    `;
  }

  _campaignFormHtml() {
    return `
      <section class="admin-card">
        <h2>Criar campanha</h2>
        <form data-form="campaign">
          <select name="affiliate_id" required>
            <option value="">Influenciador</option>
            ${this.affiliates.map((item) => `<option value="${this._escape(item.id)}">${this._escape(item.name)}</option>`).join('')}
          </select>
          <input name="name" placeholder="Nome da campanha" required maxlength="160" />
          <input name="referral_code" placeholder="Referral code. Ex: JULIANA" required maxlength="40" />
          <input name="media_cost" type="number" step="0.01" min="0" placeholder="Custo de midia" />
          <div class="date-row">
            <input name="starts_at" type="date" />
            <input name="ends_at" type="date" />
          </div>
          <select name="status">
            <option value="active">Ativa</option>
            <option value="paused">Pausada</option>
            <option value="archived">Arquivada</option>
          </select>
          <button type="submit">Criar campanha</button>
        </form>
      </section>
    `;
  }

  _campaignTableHtml() {
    const rows = this.report.rows || [];
    return `
      <section class="table-card">
        <div class="table-head">
          <h2>Campanhas</h2>
          <span>${rows.length} campanhas</span>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Influenciador</th>
                <th>Campanha</th>
                <th>Link</th>
                <th>Cliques</th>
                <th>Cadastros</th>
                <th>Depositantes</th>
                <th>Depositos R$</th>
                <th>GGR</th>
                <th>Custo</th>
                <th>CAC</th>
                <th>Conv.</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map((row) => this._campaignRowHtml(row)).join('') : `
                <tr><td colspan="12" class="empty">Nenhuma campanha encontrada.</td></tr>
              `}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  _campaignRowHtml(row) {
    const campaign = row.campaign || {};
    const affiliate = row.affiliate || {};
    const link = this._campaignLink(campaign.referral_code);
    return `
      <tr>
        <td>${this._escape(affiliate.name || '-')}</td>
        <td>
          <strong>${this._escape(campaign.name || '-')}</strong>
          <small>${this._escape(campaign.referral_code || '')}</small>
        </td>
        <td>
          <button type="button" class="link-btn" data-action="copy-link" data-link="${this._escape(link)}">Copiar</button>
          <small>${this._escape(this._campaignUtmExample(campaign.referral_code))}</small>
        </td>
        <td>${this._num(row.clicks_total)} / ${this._num(row.unique_clicks)}</td>
        <td>${this._num(row.signups)}</td>
        <td>${this._num(row.depositors)} <small>FTD ${this._num(row.ftd)}</small></td>
        <td>${this._money(row.total_deposited)}</td>
        <td>${this._money(row.ggr)}</td>
        <td>${this._money(row.media_cost)}</td>
        <td>${this._money(row.cac)}</td>
        <td>${this._pct(row.conversion_click_to_depositor)}</td>
        <td class="${Number(row.media_gross_result || 0) >= 0 ? 'pos' : 'neg'}">${this._money(row.media_gross_result)}</td>
      </tr>
    `;
  }

  _bindDom() {
    this.root.querySelector('[data-action="refresh"]')?.addEventListener('click', () => this._load());
    this.root.querySelector('[data-action="back"]')?.addEventListener('click', () => this.scene.start('Lobby'));
    this.root.querySelector('[data-action="apply-filters"]')?.addEventListener('click', () => {
      this.filters = {
        from: this.root.querySelector('[name="filter-from"]')?.value || '',
        to: this.root.querySelector('[name="filter-to"]')?.value || '',
        affiliate_id: this.root.querySelector('[name="filter-affiliate"]')?.value || '',
        campaign_id: this.root.querySelector('[name="filter-campaign"]')?.value || '',
      };
      this._load();
    });
    this.root.querySelector('[data-action="export-csv"]')?.addEventListener('click', () => this._exportCsv());
    this.root.querySelectorAll('[data-action="copy-link"]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this._copyText(button.dataset.link || '');
      });
    });
    this.root.querySelector('[data-form="affiliate"]')?.addEventListener('submit', (event) => this._submitAffiliate(event));
    this.root.querySelector('[data-form="campaign"]')?.addEventListener('submit', (event) => this._submitCampaign(event));
  }

  async _submitAffiliate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await createAdminAffiliate({
        name: String(values.name || '').trim(),
        handle: String(values.handle || '').trim(),
        contact: String(values.contact || '').trim(),
        notes: String(values.notes || '').trim(),
      });
      this.message = 'Influenciador criado.';
      form.reset();
      await this._load();
    } catch (error) {
      this.error = error.message || 'Falha ao criar influenciador.';
      this._render();
    }
  }

  async _submitCampaign(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await createAdminCampaign({
        affiliate_id: String(values.affiliate_id || ''),
        name: String(values.name || '').trim(),
        referral_code: String(values.referral_code || '').trim(),
        media_cost: Number(values.media_cost || 0),
        starts_at: values.starts_at || null,
        ends_at: values.ends_at || null,
        status: values.status || 'active',
      });
      const code = response.campaign?.referral_code || values.referral_code;
      this.message = `Campanha criada: ${this._campaignLink(code)} | UTM: ${this._campaignUtmExample(code)}`;
      form.reset();
      await this._load();
    } catch (error) {
      this.error = error.message || 'Falha ao criar campanha.';
      this._render();
    }
  }

  async _copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.message = `Link copiado: ${text}`;
    } catch {
      this.message = text;
    }
    this._render();
  }

  _exportCsv() {
    const header = [
      'Influenciador',
      'Campanha',
      'Referral',
      'Cliques',
      'Cliques unicos',
      'Cadastros',
      'Depositantes',
      'FTD',
      'Depositos',
      'Total depositado',
      'Total apostado',
      'Payouts',
      'GGR',
      'Custo midia',
      'CAC',
      'Conv clique depositante',
      'Resultado bruto',
      'Link',
    ];
    const lines = [header, ...(this.report.rows || []).map((row) => {
      const campaign = row.campaign || {};
      const affiliate = row.affiliate || {};
      return [
        affiliate.name || '',
        campaign.name || '',
        campaign.referral_code || '',
        row.clicks_total || 0,
        row.unique_clicks || 0,
        row.signups || 0,
        row.depositors || 0,
        row.ftd || 0,
        row.deposit_count || 0,
        row.total_deposited || 0,
        row.total_bets || 0,
        row.total_payouts || 0,
        row.ggr || 0,
        row.media_cost || 0,
        row.cac || 0,
        row.conversion_click_to_depositor || 0,
        row.media_gross_result || 0,
        this._campaignLink(campaign.referral_code),
      ];
    })].map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','));

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sereia-acquisition-campaigns.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  _campaignLink(referralCode) {
    const code = String(referralCode || '').trim();
    return `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
  }

  _campaignUtmExample(referralCode) {
    const code = String(referralCode || '').trim();
    return `?ref=${encodeURIComponent(code)}&utm_source=instagram&utm_medium=story&utm_campaign=lancamento_sereia`;
  }

  _money(value) {
    return `R$ ${Number(value || 0).toFixed(2)}`;
  }

  _num(value) {
    return String(Number(value || 0).toLocaleString('pt-BR'));
  }

  _pct(value) {
    return `${Number(value || 0).toFixed(2)}%`;
  }

  _escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[char]);
  }

  _style() {
    return `
      <style>
        .sereia-admin-root {
          position: fixed;
          inset: 0;
          z-index: 30;
          height: var(--app-height, 100dvh);
          overflow: auto;
          -webkit-overflow-scrolling: touch;
          color: #fff7dc;
          font-family: Arial, Helvetica, sans-serif;
          pointer-events: auto;
          background: linear-gradient(180deg, rgba(13, 7, 16, 0.96), rgba(3, 4, 10, 0.98));
        }
        .admin-shell {
          width: min(1180px, 100%);
          min-height: var(--app-height, 100dvh);
          margin: 0 auto;
          padding: 18px 16px 28px;
          display: grid;
          gap: 14px;
        }
        .admin-shell.center {
          place-items: center;
        }
        .admin-loading,
        .admin-card,
        .filter-panel,
        .table-card,
        .admin-alert,
        .kpi-grid article {
          border-radius: 10px;
          border: 1px solid rgba(244, 200, 74, 0.28);
          background: rgba(20, 13, 23, 0.94);
          box-shadow: 0 12px 34px rgba(0, 0, 0, 0.30);
        }
        .admin-loading {
          width: min(330px, calc(100vw - 32px));
          padding: 24px;
          text-align: center;
        }
        .admin-loading strong,
        .admin-loading span {
          display: block;
        }
        .admin-loading strong {
          color: #ffdf72;
          font: 900 20px/1 "Arial Black", Arial, sans-serif;
          margin-bottom: 8px;
        }
        .admin-loading span {
          color: #ffd0be;
          font-size: 14px;
        }
        .admin-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding-top: max(0px, env(safe-area-inset-top));
        }
        .admin-topbar span {
          color: #f4c84a;
          font: 900 12px/1 "Arial Black", Arial, sans-serif;
        }
        .admin-topbar h1 {
          margin-top: 4px;
          color: #fff7dc;
          font: 900 28px/1 "Arial Black", Arial, sans-serif;
        }
        .admin-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        button {
          min-height: 38px;
          border: 0;
          border-radius: 8px;
          padding: 0 12px;
          color: #2a070c;
          background: linear-gradient(180deg, #ffe58d, #d59d19);
          font: 900 12px/1 "Arial Black", Arial, sans-serif;
          cursor: pointer;
        }
        .admin-alert {
          padding: 12px 14px;
          color: #80ffd7;
          font-size: 13px;
          font-weight: 800;
          line-height: 1.3;
        }
        .admin-alert.error {
          color: #ff9aa9;
          border-color: rgba(255, 106, 122, 0.48);
        }
        .filter-panel {
          padding: 12px;
          display: grid;
          grid-template-columns: repeat(4, minmax(130px, 1fr)) auto auto;
          gap: 10px;
          align-items: end;
        }
        label {
          display: grid;
          gap: 6px;
          color: #e0b39a;
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
        }
        input,
        select,
        textarea {
          width: 100%;
          min-height: 40px;
          border-radius: 8px;
          border: 1px solid rgba(244, 200, 74, 0.30);
          background: rgba(6, 8, 17, 0.94);
          color: #fff7dc;
          padding: 0 10px;
          font: 800 13px/1 Arial, sans-serif;
          outline: none;
        }
        textarea {
          min-height: 72px;
          padding: 10px;
          resize: vertical;
        }
        input:focus,
        select:focus,
        textarea:focus {
          border-color: #ffdf72;
          box-shadow: 0 0 0 3px rgba(255, 223, 114, 0.12);
        }
        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(9, minmax(104px, 1fr));
          gap: 10px;
        }
        .kpi-grid article {
          min-height: 78px;
          padding: 12px;
        }
        .kpi-grid span {
          display: block;
          color: #dca197;
          font-size: 11px;
          font-weight: 900;
          margin-bottom: 10px;
        }
        .kpi-grid strong {
          color: #ffdf72;
          font: 900 18px/1 "Arial Black", Arial, sans-serif;
          word-break: break-word;
        }
        .admin-grid {
          display: grid;
          grid-template-columns: 0.9fr 1.1fr;
          gap: 14px;
        }
        .admin-card {
          padding: 14px;
        }
        .admin-card h2,
        .table-head h2 {
          color: #ffdf72;
          font: 900 17px/1 "Arial Black", Arial, sans-serif;
          margin-bottom: 12px;
        }
        form {
          display: grid;
          gap: 9px;
        }
        .date-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 9px;
        }
        .table-card {
          min-width: 0;
          padding: 14px;
        }
        .table-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }
        .table-head span {
          color: #dca197;
          font-size: 12px;
          font-weight: 900;
        }
        .table-scroll {
          overflow: auto;
          border-radius: 8px;
          border: 1px solid rgba(244, 200, 74, 0.18);
        }
        table {
          width: 100%;
          min-width: 1040px;
          border-collapse: collapse;
          background: rgba(8, 8, 14, 0.86);
        }
        th,
        td {
          padding: 10px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          text-align: left;
          white-space: nowrap;
          font-size: 12px;
        }
        th {
          position: sticky;
          top: 0;
          z-index: 1;
          color: #ffdf72;
          background: #170b12;
          font: 900 11px/1 "Arial Black", Arial, sans-serif;
        }
        td {
          color: #fff7dc;
          font-weight: 800;
        }
        td strong,
        td small {
          display: block;
        }
        td small {
          margin-top: 4px;
          color: #dca197;
          font-size: 10px;
        }
        .link-btn {
          min-height: 30px;
          padding: 0 10px;
          font-size: 10px;
        }
        .pos {
          color: #80ffd7;
        }
        .neg {
          color: #ff9aa9;
        }
        .empty {
          height: 64px;
          text-align: center;
          color: #dca197;
        }
        @media (max-width: 860px) {
          .admin-shell {
            padding: 14px 12px 24px;
          }
          .admin-topbar {
            align-items: flex-start;
          }
          .filter-panel {
            grid-template-columns: 1fr 1fr;
          }
          .kpi-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .admin-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    `;
  }

  _cleanup() {
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
  }
}
