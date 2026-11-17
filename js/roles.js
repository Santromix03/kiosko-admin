import { supabase } from './supabase.js';
import { esc, formatPrice, toast } from './utils.js';
import { isMissingFunction, fmtDateTime } from './history.js';
import {
  dayOf, addDaysIso, dayStartIso, dayEndIso, fmtTimeOnly, fmtDuration,
  shiftDuration, salesForShifts, uniqueTotals, overlappingIds, initials,
} from './shifts-data.js';

const root = document.getElementById('view-roles');
const MAX_RANGE_DAYS = 31;
const REFRESH_MS = 30000;

let state = 'loading';        // loading | ready | needs-migration | forbidden | error
let stateError = '';
let employees = [];
let openShifts = [];
let history = [];
let sales = new Map();
let overlaps = new Set();
let editingId = null;
let linkMode = false;          // formulario: "solo vincular una cuenta que ya existe"
let draft = { full_name: '', email: '' };
let rangeFrom = '';
let rangeTo = '';
let employeeFilter = 'all';
let loadReq = 0;
let dataReq = 0;

const money = n => formatPrice(Number(n ?? 0));
const fmtInt = n => Number(n ?? 0).toLocaleString('es-CO');
const nameOf = id => employees.find(e => e.id === id)?.full_name ?? 'Empleado';

function alertBox(title, text, extra = '') {
  return `
    <div class="alert-box">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <div>
        <strong>${title}</strong>
        <p style="margin: 2px 0 0; font-size: 13px;">${text}</p>
        ${extra}
      </div>
    </div>`;
}

// ---------- Carga ----------
export async function load() {
  editingId = null;
  linkMode = false;
  draft = { full_name: '', email: '' };
  if (!rangeTo) {
    rangeTo = dayOf(new Date());
    rangeFrom = addDaysIso(rangeTo, -6);
  }

  const req = ++loadReq;
  state = 'loading';
  renderShell();

  const { data: role, error } = await supabase.rpc('my_role');
  if (req !== loadReq) return;

  if (error) {
    if (isMissingFunction(error)) state = 'needs-migration';
    else { state = 'error'; stateError = error.message; }
    return renderShell();
  }
  if (role !== 'admin') {
    state = 'forbidden';
    return renderShell();
  }

  state = 'ready';
  renderShell();
  renderForm();
  await refreshData();
}

// Al cerrar sesión se borran los datos en memoria (no deben quedar para el siguiente usuario).
export function reset() {
  loadReq++;
  dataReq++;
  state = 'loading';
  stateError = '';
  employees = [];
  openShifts = [];
  history = [];
  sales = new Map();
  overlaps = new Set();
  editingId = null;
  linkMode = false;
  draft = { full_name: '', email: '' };
  employeeFilter = 'all';
  rangeFrom = '';
  rangeTo = '';
  root.innerHTML = '';
}

async function refreshData() {
  if (state !== 'ready') return;
  const req = ++dataReq;

  // Cierra los turnos que quedaron abiertos más de la cuenta (si la función no existe, se ignora)
  await supabase.rpc('close_stale_shifts');
  if (req !== dataReq) return;

  let historyQuery = supabase.from('shifts').select('*')
    .gte('started_at', dayStartIso(rangeFrom))
    .lte('started_at', dayEndIso(rangeTo))
    .order('started_at', { ascending: false });
  if (employeeFilter !== 'all') historyQuery = historyQuery.eq('employee_id', employeeFilter);

  const [emp, open, hist] = await Promise.all([
    supabase.from('employees').select('*').order('full_name'),
    supabase.from('shifts').select('*').is('ended_at', null).order('started_at'),
    historyQuery,
  ]);
  if (req !== dataReq) return;

  const failure = emp.error || open.error || hist.error;
  if (failure) return toast(failure.message, true);

  employees = emp.data ?? [];
  openShifts = open.data ?? [];
  history = hist.data ?? [];

  const all = [...new Map([...openShifts, ...history].map(s => [s.id, s])).values()];
  overlaps = overlappingIds(all);
  try {
    sales = await salesForShifts(all);
  } catch (err) {
    sales = new Map();
    toast('No se pudieron calcular las ventas: ' + err.message, true);
  }
  if (req !== dataReq) return;

  renderAll();
}

// ---------- Render ----------
function renderShell() {
  const title = '<h2>Roles y turnos</h2>';
  if (state === 'ready') {
    root.innerHTML = `
      ${title}
      <p class="hint">Controla a tus empleados: quién está en turno, cuánto vendió cada uno y el historial de entradas y salidas.</p>
      <div id="roles-kpis"></div>
      <div id="roles-live"></div>
      <div id="roles-form"></div>
      <div id="roles-employees"></div>
      <div id="roles-history"></div>`;
  } else if (state === 'loading') {
    root.innerHTML = `${title}<p class="empty-inline">Cargando…</p>`;
  } else if (state === 'needs-migration') {
    root.innerHTML = `${title}${alertBox(
      'Falta activar los roles en la base de datos',
      'Abre Supabase → SQL Editor, pega y ejecuta <code>supabase/migrations/20261116_roles_shifts.sql</code> y luego vuelve a abrir esta pestaña.',
      '<button type="button" class="btn-outline btn-sm" data-action="reload" style="margin-top: 10px;">Ya lo ejecuté, reintentar</button>')}`;
  } else if (state === 'forbidden') {
    root.innerHTML = `${title}${alertBox('Sin acceso', 'Solo los administradores pueden ver este apartado.')}`;
  } else {
    root.innerHTML = `${title}${alertBox('No se pudo cargar', esc(stateError),
      '<button type="button" class="btn-outline btn-sm" data-action="reload" style="margin-top: 10px;">Reintentar</button>')}`;
  }
}

function renderAll() {
  renderKpis();
  renderLive();
  renderEmployees();
  renderHistory();
}

function renderKpis() {
  const el = root.querySelector('#roles-kpis');
  if (!el) return;
  const active = employees.filter(e => e.active).length;
  const { orders, revenue } = uniqueTotals(history, sales);
  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi">
        <span class="kpi-label">En turno ahora</span>
        <strong class="kpi-value">${fmtInt(openShifts.length)}</strong>
        <span class="kpi-sub">de ${fmtInt(active)} empleado(s) activo(s)</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Turnos en el rango</span>
        <strong class="kpi-value">${fmtInt(history.length)}</strong>
        <span class="kpi-sub">${esc(rangeFrom)} a ${esc(rangeTo)}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Pedidos atendidos</span>
        <strong class="kpi-value">${fmtInt(orders)}</strong>
        <span class="kpi-sub">durante esos turnos</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Ventas generadas</span>
        <strong class="kpi-value">${esc(money(revenue))}</strong>
        <span class="kpi-sub">durante esos turnos</span>
      </div>
    </div>`;
}

function renderLive() {
  const el = root.querySelector('#roles-live');
  if (!el) return;
  const now = Date.now();
  const cards = openShifts.map(s => {
    const sa = sales.get(s.id);
    const ok = sa && !sa.unavailable;
    const name = nameOf(s.employee_id);
    return `
      <div class="shift-card">
        <div class="shift-card-top">
          <div class="avatar">${esc(initials(name))}</div>
          <div>
            <div class="shift-name">${esc(name)}</div>
            <div class="shift-meta">
              <span class="live-dot"></span> Entró a las ${esc(fmtTimeOnly(s.started_at))} · ${esc(fmtDuration(shiftDuration(s, now)))}
            </div>
          </div>
        </div>
        <div class="shift-stats">
          <div><strong>${ok ? fmtInt(sa.count) : '—'}</strong><span>Pedidos</span></div>
          <div><strong>${ok ? esc(money(sa.total)) : '—'}</strong><span>Ventas</span></div>
        </div>
        <button class="btn-danger btn-sm" data-action="end-shift" data-employee="${esc(s.employee_id)}">Terminar turno</button>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="card">
      <div class="card-header-bar">
        <span class="card-title"><span class="live-dot"></span> En turno ahora</span>
        <span class="badge ${openShifts.length ? 'badge-success' : 'badge-neutral'}">${fmtInt(openShifts.length)}</span>
      </div>
      ${openShifts.length
        ? `<div class="shift-live-grid">${cards}</div>`
        : '<p class="empty-inline">Nadie está en turno en este momento. Cuando un empleado inicie sesión, aparecerá aquí.</p>'}
    </div>`;
}

function renderForm() {
  const el = root.querySelector('#roles-form');
  if (!el) return;
  const e = employees.find(x => x.id === editingId);
  const fullName = e ? e.full_name : draft.full_name;
  const email = e ? e.email : draft.email;

  el.innerHTML = `
    <form id="emp-form" class="card form-grid" autocomplete="off">
      <div class="card-header-bar wide">
        <span class="card-title">${e ? '✏️ Editando empleado' : '➕ Nuevo empleado'}</span>
        ${e ? '<span class="badge badge-warning">Modo edición</span>' : ''}
      </div>
      <label>Nombre completo
        <input name="full_name" required value="${esc(fullName)}" placeholder="Ej: Laura Gómez">
      </label>
      <label>Correo electrónico
        <input name="email" type="email" required ${e ? 'readonly' : ''} value="${esc(email)}" placeholder="laura@kiosko.com" autocomplete="off">
      </label>
      ${!e && !linkMode ? `
        <label>Contraseña
          <input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="Mínimo 8 caracteres">
          <span class="field-hint">Con este correo y contraseña el empleado entrará al sistema.</span>
        </label>` : ''}
      ${e
        ? `<label class="check wide"><input name="active" type="checkbox" ${e.active ? 'checked' : ''}> Empleado activo (puede iniciar turno)</label>`
        : `<label class="check wide"><input name="link" type="checkbox" data-action="toggle-link" ${linkMode ? 'checked' : ''}> La cuenta ya existe en Supabase (solo vincular, sin contraseña)</label>`}
      <div class="wide" style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button class="btn" type="submit">${e ? 'Guardar cambios' : (linkMode ? 'Vincular empleado' : 'Crear empleado')}</button>
        ${e ? '<button class="btn-outline" type="button" data-action="cancel">Cancelar</button>' : ''}
      </div>
    </form>`;
}

function renderEmployees() {
  const el = root.querySelector('#roles-employees');
  if (!el) return;
  const openByEmployee = new Map(openShifts.map(s => [s.employee_id, s]));

  el.innerHTML = `
    <h3 class="section-title">Empleados</h3>
    <div class="card table-wrap">
      <table class="employees-table">
        <thead><tr><th>Empleado</th><th>Correo</th><th>Estado</th><th>Turno</th><th style="text-align: right;">Acciones</th></tr></thead>
        <tbody>
          ${employees.length === 0
            ? '<tr><td colspan="5" class="empty-state">Todavía no hay empleados. Crea el primero arriba.</td></tr>'
            : employees.map(emp => {
              const open = openByEmployee.get(emp.id);
              return `
                <tr>
                  <td><strong>${esc(emp.full_name)}</strong></td>
                  <td>${esc(emp.email)}</td>
                  <td><span class="badge ${emp.active ? 'badge-success' : 'badge-neutral'}">${emp.active ? '● Activo' : '○ Inactivo'}</span></td>
                  <td>${open
                    ? `<span class="badge badge-info">En turno desde ${esc(fmtTimeOnly(open.started_at))}</span>`
                    : '<span class="muted">Fuera de turno</span>'}</td>
                  <td class="actions">
                    <button class="btn-outline btn-sm" data-action="edit" data-id="${esc(emp.id)}">Editar</button>
                    <button class="${emp.active ? 'btn-danger' : 'btn-outline'} btn-sm" data-action="toggle-active" data-id="${esc(emp.id)}">${emp.active ? 'Desactivar' : 'Activar'}</button>
                  </td>
                </tr>`;
            }).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderHistory() {
  const el = root.querySelector('#roles-history');
  if (!el) return;
  const now = Date.now();

  const { orders: totalOrders, revenue: totalRevenue } = uniqueTotals(history, sales);
  const rows = history.map(s => {
    const sa = sales.get(s.id);
    const ok = sa && !sa.unavailable;
    return `
      <tr>
        <td>
          <strong>${esc(nameOf(s.employee_id))}</strong>
          ${overlaps.has(s.id) ? '<span class="badge badge-warning" title="Otro empleado tenía turno abierto al mismo tiempo: las ventas de ese lapso se cuentan para ambos.">Simultáneo</span>' : ''}
        </td>
        <td>${esc(fmtDateTime(s.started_at))}</td>
        <td>${s.ended_at
          ? `${esc(fmtDateTime(s.ended_at))}${s.auto_closed ? ' <span class="badge badge-neutral" title="Se cerró solo porque el turno superó la duración máxima (14 h).">Auto</span>' : ''}`
          : '<span class="badge badge-success">En turno</span>'}</td>
        <td>${esc(fmtDuration(shiftDuration(s, now)))}</td>
        <td>${ok ? fmtInt(sa.count) : '—'}</td>
        <td><strong>${ok ? esc(money(sa.total)) : '—'}</strong></td>
      </tr>`;
  }).join('');

  const options = employees.map(e =>
    `<option value="${esc(e.id)}" ${employeeFilter === e.id ? 'selected' : ''}>${esc(e.full_name)}</option>`).join('');

  el.innerHTML = `
    <h3 class="section-title">Historial de turnos</h3>
    <div class="card">
      <form id="shift-range-form" class="range-form">
        <label>Desde <input type="date" name="from" value="${esc(rangeFrom)}" required></label>
        <label>Hasta <input type="date" name="to" value="${esc(rangeTo)}" required></label>
        <label>Empleado
          <select name="employee">
            <option value="all">Todos</option>
            ${options}
          </select>
        </label>
        <button type="submit" class="btn btn-sm">Actualizar</button>
      </form>
      <div class="chip-row" style="margin-top: 14px;">
        <button type="button" class="btn-outline btn-sm" data-action="quick-range" data-days="1">Hoy</button>
        <button type="button" class="btn-outline btn-sm" data-action="quick-range" data-days="7">Últimos 7 días</button>
        <button type="button" class="btn-outline btn-sm" data-action="quick-range" data-days="30">Últimos 30 días</button>
        <span class="hint" style="margin: 0; align-self: center;">Máximo ${MAX_RANGE_DAYS} días por consulta.</span>
      </div>
    </div>
    <div class="card table-wrap">
      <table class="shifts-table">
        <thead><tr><th>Empleado</th><th>Entrada</th><th>Salida</th><th>Duración</th><th>Pedidos</th><th>Ventas</th></tr></thead>
        <tbody>
          ${history.length === 0
            ? '<tr><td colspan="6" class="empty-state">No hay turnos en este rango.</td></tr>'
            : rows}
        </tbody>
      </table>
    </div>
    ${history.length ? `<p class="hint" style="margin-top: 0;">Total del rango: <strong>${fmtInt(history.length)}</strong> turno(s) · <strong>${fmtInt(totalOrders)}</strong> pedido(s) · <strong>${esc(money(totalRevenue))}</strong>. Las ventas se asignan al empleado que tenía el turno abierto cuando se hizo el pedido. Si dos turnos se cruzan, ese pedido aparece en ambos turnos pero en este total cuenta una sola vez.</p>` : ''}`;
}

// ---------- Acciones ----------
function friendlyError(message) {
  if (message === 'FUNCTION_MISSING') {
    return 'Falta desplegar la función "create-employee" en Supabase (ver README). Mientras tanto, crea la cuenta en Authentication → Users y usa "solo vincular".';
  }
  if (/already registered|already been registered|already exists/i.test(message)) {
    return 'Ese correo ya está registrado. Marca "La cuenta ya existe en Supabase" para vincularlo.';
  }
  return message;
}

// Saca el mensaje de error que devuelve la Edge Function
async function functionErrorMessage(error) {
  try {
    const body = await error.context?.json?.();
    const text = body?.error ?? body?.message;
    if (text) return /not found/i.test(String(text)) ? 'FUNCTION_MISSING' : String(text);
  } catch { /* sin cuerpo */ }
  if (/failed to send|failed to fetch/i.test(error.message ?? '')) return 'FUNCTION_MISSING';
  return error.message ?? 'Error desconocido';
}

async function saveEmployee(form) {
  const f = new FormData(form);
  const full_name = String(f.get('full_name') ?? '').trim();
  const email = String(f.get('email') ?? '').trim().toLowerCase();
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;

  try {
    if (editingId) {
      const wantActive = f.get('active') === 'on';
      const current = employees.find(x => x.id === editingId);
      if (current?.active && !wantActive && !confirmDeactivate(editingId)) return;
      // Una sola función en el servidor: actualiza, y si se desactiva cierra su turno y su sesión
      const { error } = await supabase.rpc('update_employee', {
        p_id: editingId, p_name: full_name, p_active: wantActive,
      });
      if (error) return toast(error.message, true);
      toast('Empleado actualizado');
    } else if (linkMode) {
      const { error } = await supabase.rpc('link_employee', { p_email: email, p_name: full_name });
      if (error) return toast(error.message, true);
      toast('Empleado vinculado');
    } else {
      const password = String(f.get('password') ?? '');
      // La cuenta se crea en el servidor (Edge Function con permisos de administrador):
      // así no hace falta dejar abiertos los registros públicos de Supabase.
      const { data, error } = await supabase.functions.invoke('create-employee', {
        body: { full_name, email, password },
      });
      if (error) return toast(friendlyError(await functionErrorMessage(error)), true);
      if (data?.error) return toast(friendlyError(data.error), true);
      toast('Empleado creado');
    }
    editingId = null;
    linkMode = false;
    draft = { full_name: '', email: '' };
    renderForm();
    await refreshData();
  } finally {
    if (submit) submit.disabled = false;
  }
}

// Al desactivar, el servidor cierra su turno y su sesión (update_employee)
function confirmDeactivate(id) {
  const open = openShifts.find(s => s.employee_id === id);
  return confirm(open
    ? `${nameOf(id)} está en turno. Se terminará su turno, se cerrará su sesión y no podrá volver a entrar. ¿Continuar?`
    : `¿Desactivar a ${nameOf(id)}? Ya no podrá iniciar sesión ni turno.`);
}

async function toggleActive(id) {
  const emp = employees.find(x => x.id === id);
  if (!emp) return;
  if (emp.active && !confirmDeactivate(id)) return;
  const { error } = await supabase.rpc('update_employee', {
    p_id: id, p_name: emp.full_name, p_active: !emp.active,
  });
  if (error) return toast(error.message, true);
  toast(emp.active ? 'Empleado desactivado' : 'Empleado activado');
  await refreshData();
}

async function endShift(employeeId) {
  if (!confirm(`¿Terminar el turno de ${nameOf(employeeId)} ahora?`)) return;
  const { error } = await supabase.rpc('end_shift', { p_employee: employeeId });
  if (error) return toast(error.message, true);
  toast('Turno terminado');
  await refreshData();
}

function rangeProblem(from, to) {
  if (!from || !to) return 'Elige las dos fechas del rango';
  if (from > to) return 'La fecha inicial no puede ser posterior a la final';
  const length = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  if (length > MAX_RANGE_DAYS) return `El rango máximo es de ${MAX_RANGE_DAYS} días`;
  return null;
}

async function applyRange(from, to, employee = employeeFilter) {
  const problem = rangeProblem(from, to);
  if (problem) return toast(problem, true);
  rangeFrom = from;
  rangeTo = to;
  employeeFilter = employee;
  await refreshData();
}

// ---------- Eventos ----------
root.addEventListener('submit', async e => {
  if (e.target.id === 'emp-form') {
    e.preventDefault();
    await saveEmployee(e.target);
  } else if (e.target.id === 'shift-range-form') {
    e.preventDefault();
    const f = new FormData(e.target);
    await applyRange(f.get('from'), f.get('to'), f.get('employee') || 'all');
  }
});

root.addEventListener('change', e => {
  if (e.target.dataset?.action !== 'toggle-link') return;
  const form = e.target.closest('form');
  draft = {
    full_name: form.elements.full_name.value,
    email: form.elements.email.value,
  };
  linkMode = e.target.checked;
  renderForm();
});

root.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action } = btn.dataset;

  if (action === 'reload') load();
  else if (action === 'edit') {
    editingId = btn.dataset.id;
    renderForm();
    root.querySelector('#roles-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (action === 'cancel') {
    editingId = null;
    renderForm();
  } else if (action === 'toggle-active') toggleActive(btn.dataset.id);
  else if (action === 'end-shift') endShift(btn.dataset.employee);
  else if (action === 'quick-range') {
    const end = dayOf(new Date());
    applyRange(addDaysIso(end, -(Number(btn.dataset.days) - 1)), end);
  }
});

// Mientras la pestaña está abierta, se refresca sola (nuevas entradas, duración, ventas)
setInterval(() => {
  if (state === 'ready' && !document.hidden && root.offsetParent !== null) refreshData();
}, REFRESH_MS);
