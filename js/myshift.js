import { supabase } from './supabase.js';
import { esc, formatPrice, toast } from './utils.js';
import { fmtDateTime } from './history.js';
import { fmtTimeOnly, fmtDuration, shiftDuration, salesForShifts, initials } from './shifts-data.js';

// Pantalla que ve un EMPLEADO al iniciar sesión: su turno en curso y el botón de terminar.
const root = document.getElementById('view-myshift');
const REFRESH_MS = 30000;

let me = null;          // fila de employees
let shift = null;       // turno abierto
let sales = null;       // { count, total, orders } | { unavailable: true }
let closed = false;     // el turno ya terminó (por ejemplo, lo cerró el administrador)
let failure = '';
let timer = null;
let reqId = 0;

const money = n => formatPrice(Number(n ?? 0));
const fmtInt = n => Number(n ?? 0).toLocaleString('es-CO');

export async function start() {
  stop();
  closed = false;
  failure = '';
  me = null;
  shift = null;
  sales = null;
  root.innerHTML = '<p class="empty-inline">Iniciando tu turno…</p>';

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const [{ data: profile }, started] = await Promise.all([
    supabase.from('employees').select('*').eq('id', userId).maybeSingle(),
    supabase.rpc('start_shift'),
  ]);
  me = profile;

  if (started.error) {
    failure = started.error.message;
    return render();
  }
  shift = started.data;
  await refreshSales();
  render();
  timer = setInterval(refresh, REFRESH_MS);
}

export function stop() {
  clearInterval(timer);
  timer = null;
  reqId++;
}

async function refreshSales() {
  try {
    sales = (await salesForShifts([shift])).get(shift.id);
  } catch {
    sales = { unavailable: true };
  }
}

async function refresh() {
  if (!me || closed) return;
  const req = ++reqId;
  const { data, error } = await supabase.from('shifts').select('*')
    .eq('employee_id', me.id).is('ended_at', null).maybeSingle();
  if (req !== reqId || error) return;

  if (!data) {            // lo cerró el administrador
    closed = true;
    stop();
    return render();
  }
  shift = data;
  await refreshSales();
  if (req === reqId) render();
}

function render() {
  if (failure) {
    root.innerHTML = `
      <div class="card myshift-card">
        <div class="card-header-bar"><span class="card-title">No se pudo iniciar tu turno</span></div>
        <p class="hint" style="margin: 0 0 16px;">${esc(failure)}</p>
        <button class="btn btn-block" data-action="logout">Cerrar sesión</button>
      </div>`;
    return;
  }

  if (closed) {
    root.innerHTML = `
      <div class="card myshift-card">
        <div class="card-header-bar"><span class="card-title">Tu turno terminó</span><span class="badge badge-neutral">Cerrado</span></div>
        <p class="hint" style="margin: 0 0 16px;">Tu turno fue cerrado (por el administrador, o automáticamente por superar la duración máxima). Gracias por tu trabajo.</p>
        <button class="btn btn-block" data-action="logout">Cerrar sesión</button>
      </div>`;
    return;
  }

  const ok = sales && !sales.unavailable;
  const name = me?.full_name ?? 'Empleado';
  const avg = ok && sales.count ? sales.total / sales.count : 0;
  const recent = ok ? sales.orders.slice(0, 10) : [];

  root.innerHTML = `
    <div class="card myshift-card">
      <div class="myshift-head">
        <div class="avatar avatar-lg">${esc(initials(name))}</div>
        <div>
          <span class="card-title">Hola, ${esc(name.split(' ')[0])}</span>
          <p class="shift-meta" style="margin: 4px 0 0;">
            <span class="live-dot"></span> Turno en curso · desde las ${esc(fmtTimeOnly(shift.started_at))}
            (${esc(fmtDuration(shiftDuration(shift)))})
          </p>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi">
          <span class="kpi-label">Pedidos</span>
          <strong class="kpi-value">${ok ? fmtInt(sales.count) : '—'}</strong>
          <span class="kpi-sub">en tu turno</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Ventas</span>
          <strong class="kpi-value">${ok ? esc(money(sales.total)) : '—'}</strong>
          <span class="kpi-sub">generadas</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Ticket promedio</span>
          <strong class="kpi-value">${ok ? esc(money(avg)) : '—'}</strong>
          <span class="kpi-sub">por pedido</span>
        </div>
      </div>

      ${ok ? `
        <h3 class="section-title">Tus últimos pedidos</h3>
        <div class="table-wrap">
          <table class="myshift-table">
            <thead><tr><th>Ticket</th><th>Hora</th><th>Total</th></tr></thead>
            <tbody>
              ${recent.length === 0
                ? '<tr><td colspan="3" class="empty-state">Todavía no hay pedidos en tu turno.</td></tr>'
                : recent.map(o => `
                  <tr>
                    <td><strong>#${esc(o.ticket_number)}</strong></td>
                    <td>${esc(fmtTimeOnly(o.created_at))}</td>
                    <td><strong>${esc(money(o.total))}</strong></td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<p class="hint">No se pudieron cargar tus ventas por ahora.</p>'}

      <button class="btn-danger btn-block" data-action="finish" style="margin-top: 20px;">Terminar turno</button>
      <p class="hint" style="margin: 10px 0 0; text-align: center;">Al terminar tu turno se cerrará tu sesión.</p>
    </div>`;
}

async function finish(btn) {
  if (!confirm('¿Terminar tu turno ahora? Se cerrará tu sesión.')) return;
  btn.disabled = true;
  const { error } = await supabase.rpc('end_shift');
  if (error) {
    btn.disabled = false;
    return toast(error.message, true);
  }
  stop();
  toast('Turno terminado. ¡Buen trabajo!');
  await supabase.auth.signOut();
}

root.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'finish') finish(btn);
  else if (btn.dataset.action === 'logout') supabase.auth.signOut();
});
