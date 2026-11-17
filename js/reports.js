import { supabase } from './supabase.js';
import { esc, formatPrice, toast } from './utils.js';
import { downloadSalesReport } from './report-pdf.js';
import { HISTORY_TIMEZONE, todayIso } from './history.js';

const root = document.getElementById('view-reports');
const MAX_RANGE_DAYS = 90;
const DEFAULT_RANGE_DAYS = 14;
const DAYS_LIMIT = 730;   // máximo de días que se traen de la vista (Supabase corta en 1000 filas)
const DAYS_PAGE = 30;     // días que se muestran en la tabla de historial por vez

let days = [];            // filas de v_daily_sales
let detail = null;        // resultado de get_daily_report
let detailError = null;
let range = [];           // resultado de get_sales_range
let selectedDate = null;
let rangeFrom = '';
let rangeTo = '';

let loadReq = 0;
let detailReq = 0;
let rangeReq = 0;
let generatingPdf = false;
let daysShown = DAYS_PAGE;

// ---------- Fechas / números ----------
const pad = n => String(n).padStart(2, '0');
const toIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = value => {
  const [y, m, d] = String(value).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const addDays = (date, amount) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
};

const fmtDay = iso => parseIso(iso).toLocaleDateString('es-CO', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
const fmtDayShort = iso => parseIso(iso).toLocaleDateString('es-CO', {
  day: 'numeric', month: 'short',
});
const fmtTime = iso => new Date(iso).toLocaleTimeString('es-CO', {
  timeZone: HISTORY_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
});
const fmtInt = n => Number(n ?? 0).toLocaleString('es-CO');
const money = n => formatPrice(Number(n ?? 0));

function compactPrice(n) {
  const value = Number(n ?? 0);
  if (value >= 1000000) {
    return '$' + (value / 1000000).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + 'M';
  }
  if (value >= 1000) return '$' + Math.round(value / 1000).toLocaleString('es-CO') + 'k';
  return '$' + value.toLocaleString('es-CO');
}

function rangeLength(from, to) {
  return Math.round((parseIso(to) - parseIso(from)) / 86400000) + 1;
}

function rangeError(from, to) {
  if (!from || !to) return 'Elige las dos fechas del rango';
  if (from > to) return 'La fecha inicial no puede ser posterior a la final';
  if (rangeLength(from, to) > MAX_RANGE_DAYS) {
    return `El rango máximo es de ${MAX_RANGE_DAYS} días`;
  }
  return null;
}

// ---------- Datos ----------
export async function load() {
  const req = ++loadReq;
  detail = null;
  detailError = null;
  range = [];

  daysShown = DAYS_PAGE;
  const { data, error } = await supabase
    .from('v_daily_sales')
    .select('*')
    .order('date', { ascending: false })
    .limit(DAYS_LIMIT);

  if (req !== loadReq) return;
  if (error) return toast(error.message, true);

  days = data ?? [];
  if (!days.length) {
    selectedDate = null;
    rangeFrom = '';
    rangeTo = '';
    render();
    return;
  }

  selectedDate = days[0].date;
  rangeTo = selectedDate;
  rangeFrom = toIso(addDays(parseIso(selectedDate), -(DEFAULT_RANGE_DAYS - 1)));

  const [reportRes, rangeRes] = await Promise.all([
    supabase.rpc('get_daily_report', { p_date: selectedDate }),
    supabase.rpc('get_sales_range', { p_from: rangeFrom, p_to: rangeTo }),
  ]);

  if (req !== loadReq) return;
  if (reportRes.error) {
    detailError = reportRes.error.message;
    toast(reportRes.error.message, true);
  } else {
    detail = reportRes.data ?? null;
  }
  if (rangeRes.error) toast(rangeRes.error.message, true);
  else range = rangeRes.data ?? [];

  render();
}

async function openDay(date, { scroll = true } = {}) {
  selectedDate = date;
  detail = null;
  detailError = null;
  const req = ++detailReq;
  render();

  const { data, error } = await supabase.rpc('get_daily_report', { p_date: date });
  if (req !== detailReq) return;
  if (error) {
    detailError = error.message;
    render();
    return toast(error.message, true);
  }

  detail = data ?? null;
  render();

  if (scroll) {
    root.querySelector('#report-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function applyRange(from, to) {
  const rangeProblem = rangeError(from, to);
  if (rangeProblem) return toast(rangeProblem, true);

  const req = ++rangeReq;

  const { data, error } = await supabase.rpc('get_sales_range', {
    p_from: from,
    p_to: to,
  });
  if (req !== rangeReq) return;
  if (error) return toast(error.message, true);

  rangeFrom = from;
  rangeTo = to;
  range = data ?? [];
  render();
}

async function downloadPdf(btn) {
  if (generatingPdf) return;

  const form = root.querySelector('#range-form');
  const from = form?.querySelector('input[name="from"]')?.value || rangeFrom;
  const to = form?.querySelector('input[name="to"]')?.value || rangeTo;
  const error = rangeError(from, to);
  if (error) return toast(error, true);

  generatingPdf = true;
  rangeReq += 1; // invalida una actualización de rango que esté en curso
  if (btn) btn.disabled = true;

  try {
    // Solo se consultan los días del rango (no todo el historial)
    const [dailyRes, rangeRes] = await Promise.all([
      supabase.from('v_daily_sales').select('*').gte('date', from).lte('date', to),
      supabase.rpc('get_sales_range', { p_from: from, p_to: to }),
    ]);
    if (dailyRes.error) throw dailyRes.error;
    if (rangeRes.error) throw rangeRes.error;

    rangeFrom = from;
    rangeTo = to;
    range = rangeRes.data ?? [];
    render();

    const points = buildPoints(from, to, range, dailyRes.data ?? []);
    await downloadSalesReport({ from, to, points });
    toast('PDF descargado');
  } catch (err) {
    toast(err?.message || 'No se pudo generar el PDF', true);
  } finally {
    generatingPdf = false;
    if (btn?.isConnected) btn.disabled = false;
  }
}

// ---------- Vistas ----------
function buildPoints(from, to, rows, dayRows = days) {
  const byDate = new Map(rows.map(r => [r.date, r]));
  const dayByDate = new Map(dayRows.map(d => [d.date, d]));
  const points = [];
  const limit = parseIso(to).getTime();
  const total = rangeLength(from, to);
  if (total < 1) return points;

  for (let i = 0, cursor = parseIso(from); i < total; i++, cursor = addDays(cursor, 1)) {
    const iso = toIso(cursor);
    if (cursor.getTime() > limit) break;
    const row = byDate.get(iso);
    points.push({
      date: iso,
      revenue: Number(row?.total_revenue ?? 0),
      orders: Number(row?.total_orders ?? 0),
      items: Number(dayByDate.get(iso)?.total_items_sold ?? 0),
    });
  }
  return points;
}

function chartHtml() {
  const points = buildPoints(rangeFrom, rangeTo, range);
  const totalRevenue = points.reduce((sum, p) => sum + p.revenue, 0);
  const totalOrders = points.reduce((sum, p) => sum + p.orders, 0);
  const avgTicket = totalOrders ? totalRevenue / totalOrders : 0;
  const best = points.reduce((a, b) => (b.revenue > a.revenue ? b : a), points[0] ?? null);
  const maxRevenue = points.reduce((max, p) => Math.max(max, p.revenue), 0);
  const showValues = points.length <= 16;

  const bars = points.map(p => {
    const pct = maxRevenue > 0 ? (p.revenue / maxRevenue) * 100 : 0;
    const label = `${fmtDay(p.date)}: ${money(p.revenue)} en ${fmtInt(p.orders)} pedido(s)`;
    return `
      <button type="button"
        class="chart-col ${p.date === selectedDate ? 'is-selected' : ''} ${p.revenue === 0 ? 'is-zero' : ''}"
        data-action="open-day" data-date="${esc(p.date)}"
        title="${esc(label)}" aria-label="${esc(label)}">
        ${showValues ? `<span class="chart-value">${esc(compactPrice(p.revenue))}</span>` : ''}
        <span class="chart-bar-wrap">
          <span class="chart-bar" style="height: ${pct.toFixed(1)}%"></span>
        </span>
        <span class="chart-label">${esc(fmtDayShort(p.date))}</span>
      </button>`;
  }).join('');

  return `
    <div class="card report-chart-card">
      <div class="report-chart-head">
        <div>
          <span class="card-title">Ingresos por día</span>
          <p class="hint">Haz clic en una barra para abrir el detalle de ese día.</p>
        </div>
        <form id="range-form" class="range-form">
          <label>Desde <input type="date" name="from" value="${esc(rangeFrom)}" required></label>
          <label>Hasta <input type="date" name="to" value="${esc(rangeTo)}" required></label>
          <button type="submit" class="btn btn-sm">Actualizar</button>
        </form>
      </div>

      <div class="chip-row">
        <button type="button" class="btn-outline btn-sm" data-action="quick-range" data-days="7">Últimos 7 días</button>
        <button type="button" class="btn-outline btn-sm" data-action="quick-range" data-days="30">Últimos 30 días</button>
        <span class="hint" style="margin: 0; align-self: center;">Máximo ${MAX_RANGE_DAYS} días por consulta.</span>
        <button type="button" class="btn btn-sm pdf-btn" data-action="download-pdf">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Descargar PDF
        </button>
      </div>

      <div class="kpi-grid">
        <div class="kpi">
          <span class="kpi-label">Ingresos del rango</span>
          <strong class="kpi-value">${esc(money(totalRevenue))}</strong>
          <span class="kpi-sub">${fmtInt(points.length)} días consultados</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Pedidos</span>
          <strong class="kpi-value">${fmtInt(totalOrders)}</strong>
          <span class="kpi-sub">en el rango seleccionado</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Ticket promedio</span>
          <strong class="kpi-value">${esc(money(avgTicket))}</strong>
          <span class="kpi-sub">por pedido</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Mejor día</span>
          <strong class="kpi-value">${best && best.revenue > 0 ? esc(fmtDayShort(best.date)) : '—'}</strong>
          <span class="kpi-sub">${best && best.revenue > 0 ? esc(money(best.revenue)) : 'Sin ventas en el rango'}</span>
        </div>
      </div>

      ${points.length
        ? `<div class="chart-scroll"><div class="chart">${bars}</div></div>
           ${totalRevenue === 0 ? '<p class="empty-inline">No hay ventas registradas en este rango.</p>' : ''}`
        : '<p class="empty-inline">No hay días para mostrar en este rango.</p>'}
    </div>`;
}

function detailHtml() {
  if (!selectedDate) return '';

  if (detailError) {
    return `
      <div class="card report-detail" id="report-detail">
        <div class="report-detail-head">
          <div>
            <span class="card-title">Detalle del día</span>
            <p class="report-date">${esc(fmtDay(selectedDate))}</p>
          </div>
        </div>
        <div class="alert-box">
          <div>
            <strong>No se pudo cargar el reporte</strong>
            <p style="margin: 2px 0 0; font-size: 13px;">${esc(detailError)}</p>
            <button type="button" class="btn-outline btn-sm" style="margin-top: 10px;" data-action="retry-day">
              Reintentar
            </button>
          </div>
        </div>
      </div>`;
  }

  if (!detail) {
    return `
      <div class="card report-detail" id="report-detail">
        <div class="report-detail-head">
          <div>
            <span class="card-title">Detalle del día</span>
            <p class="report-date">${esc(fmtDay(selectedDate))}</p>
          </div>
        </div>
        <p class="empty-inline">Cargando reporte del día…</p>
      </div>`;
  }

  const summary = detail.summary ?? {};
  const products = detail.top_products ?? [];
  const addons = detail.top_addons ?? [];
  const orders = detail.orders ?? [];
  const dayRow = days.find(d => d.date === selectedDate);
  const hasSales = Number(summary.total_orders ?? 0) > 0;

  return `
    <div class="card report-detail" id="report-detail">
      <div class="report-detail-head">
        <div>
          <span class="card-title">Detalle del día</span>
          <p class="report-date">${esc(fmtDay(selectedDate))}</p>
        </div>
        <span class="badge ${hasSales ? 'badge-success' : 'badge-neutral'}">
          ${hasSales ? `${fmtInt(summary.total_orders)} pedidos` : 'Sin ventas'}
        </span>
      </div>

      <div class="kpi-grid">
        <div class="kpi">
          <span class="kpi-label">Ingresos</span>
          <strong class="kpi-value">${esc(money(summary.total_revenue))}</strong>
          <span class="kpi-sub">del día</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Pedidos</span>
          <strong class="kpi-value">${fmtInt(summary.total_orders)}</strong>
          <span class="kpi-sub">tickets registrados</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Ticket promedio</span>
          <strong class="kpi-value">${esc(money(summary.avg_order_value))}</strong>
          <span class="kpi-sub">por pedido</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Ítems vendidos</span>
          <strong class="kpi-value">${fmtInt(dayRow?.total_items_sold)}</strong>
          <span class="kpi-sub">unidades en total</span>
        </div>
      </div>

      <p class="detail-note">
        Pedido más bajo: <strong>${esc(money(summary.min_order))}</strong>
        · Pedido más alto: <strong>${esc(money(summary.max_order))}</strong>
      </p>

      ${hasSales ? `
        <div class="report-columns">
          <div class="mini-card">
            <h3 class="mini-title">Productos más vendidos</h3>
            ${products.length ? `
              <table class="table-compact">
                <thead><tr><th>Producto</th><th style="text-align:right;">Cant.</th><th style="text-align:right;">Ingresos</th></tr></thead>
                <tbody>
                  ${products.map(p => `
                    <tr>
                      <td>${esc(p.product_name)}</td>
                      <td style="text-align:right;">${fmtInt(p.total_qty)}</td>
                      <td style="text-align:right;"><strong>${esc(money(p.total_revenue))}</strong></td>
                    </tr>`).join('')}
                </tbody>
              </table>` : '<p class="empty-inline">Sin productos vendidos.</p>'}
          </div>

          <div class="mini-card">
            <h3 class="mini-title">Adiciones más vendidas</h3>
            ${addons.length ? `
              <table class="table-compact">
                <thead><tr><th>Adición</th><th style="text-align:right;">Cant.</th><th style="text-align:right;">Ingresos</th></tr></thead>
                <tbody>
                  ${addons.map(a => `
                    <tr>
                      <td>${esc(a.addon_name)}</td>
                      <td style="text-align:right;">${fmtInt(a.total_qty)}</td>
                      <td style="text-align:right;"><strong>${esc(money(a.total_revenue))}</strong></td>
                    </tr>`).join('')}
                </tbody>
              </table>` : '<p class="empty-inline">Sin adiciones vendidas.</p>'}
          </div>
        </div>

        <h3 class="mini-title">Pedidos del día <span class="muted">(${orders.length})</span></h3>
        <div class="orders-list">
          ${orders.map(orderCard).join('')}
        </div>`
      : '<p class="empty-inline">No hubo ventas registradas este día.</p>'}
    </div>`;
}

function orderCard(order) {
  const items = (order.items ?? []).map(item => {
    const addons = item.addons ?? [];
    const addonsSum = addons.reduce((sum, a) => sum + Number(a.unit_price ?? 0), 0);
    const lineTotal = (Number(item.unit_price ?? 0) + addonsSum) * Number(item.quantity ?? 0);

    return `
      <li class="order-item">
        <div class="order-item-line">
          <span><strong class="qty">${fmtInt(item.quantity)}×</strong> ${esc(item.name)}</span>
          <span class="price-val">${esc(money(lineTotal))}</span>
        </div>
        ${addons.length ? `
          <ul class="order-addons">
            ${addons.map(a => `
              <li><span>+ ${esc(a.name)}</span><span>${esc(money(a.unit_price))}</span></li>`).join('')}
          </ul>` : ''}
      </li>`;
  }).join('');

  return `
    <article class="order-card">
      <header class="order-head">
        <span class="order-ticket">Ticket #${esc(order.ticket_number)}</span>
        <span class="order-time">${esc(fmtTime(order.created_at))}</span>
        <strong class="order-total">${esc(money(order.total))}</strong>
      </header>
      <ul class="order-items">${items}</ul>
    </article>`;
}

function historyHtml() {
  return `
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Pedidos</th>
            <th>Ingresos</th>
            <th>Ticket prom.</th>
            <th>Rango de pedidos</th>
            <th>Ítems</th>
            <th style="text-align:right;">Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${days.slice(0, daysShown).map(d => `
            <tr class="${d.date === selectedDate ? 'is-selected' : ''}">
              <td>
                <strong>${esc(fmtDayShort(d.date))}</strong>
                <span class="date-year">${esc(String(d.date).slice(0, 4))}</span>
              </td>
              <td>${fmtInt(d.total_orders)}</td>
              <td><strong>${esc(money(d.total_revenue))}</strong></td>
              <td>${esc(money(d.avg_order_value))}</td>
              <td class="muted">${esc(money(d.min_order))} – ${esc(money(d.max_order))}</td>
              <td>${fmtInt(d.total_items_sold)}</td>
              <td class="actions">
                <button type="button" class="btn-outline btn-sm" data-action="open-day" data-date="${esc(d.date)}">
                  Ver detalle
                </button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${days.length > daysShown ? `
      <div style="text-align: center; margin: 12px 0;">
        <button type="button" class="btn-outline btn-sm" data-action="more-days">Mostrar más días (${days.length - daysShown} restantes)</button>
      </div>` : ''}`;
}

function render() {
  if (!days.length) {
    root.innerHTML = `
      <h2>Reportes por día</h2>
      <p class="hint">Resumen de ventas, productos y adiciones registrados por la app del kiosko.</p>
      <div class="alert-box">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <div>
          <strong>Todavía no hay ventas registradas</strong>
          <p style="margin: 2px 0 0; font-size: 13px;">Cuando la app del kiosko registre pedidos, aparecerán aquí automáticamente.</p>
        </div>
      </div>`;
    return;
  }

  root.innerHTML = `
    <h2>Reportes por día</h2>
    <p class="hint">Ventas, productos y adiciones del kiosko. Los días sin pedidos aparecen en cero.</p>
    ${chartHtml()}
    ${detailHtml()}
    ${historyHtml()}`;
}

// ---------- Eventos ----------
root.addEventListener('submit', e => {
  if (e.target.id !== 'range-form') return;
  e.preventDefault();
  const form = new FormData(e.target);
  applyRange(form.get('from'), form.get('to'));
});

root.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'open-day') {
    openDay(btn.dataset.date);
  } else if (action === 'retry-day' && selectedDate) {
    openDay(selectedDate);
  } else if (action === 'download-pdf') {
    downloadPdf(btn);
  } else if (action === 'more-days') {
    daysShown += DAYS_PAGE;
    render();
  } else if (action === 'quick-range') {
    const length = Number(btn.dataset.days);
    const end = todayIso();   // «Últimos N días» cuenta hacia atrás desde HOY (hora de Bogotá)
    const from = toIso(addDays(parseIso(end), -(length - 1)));
    applyRange(from, end);
  }
});
