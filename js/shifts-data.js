import { supabase } from './supabase.js';
import { HISTORY_TIMEZONE } from './history.js';

// Colombia no usa horario de verano: siempre es UTC-5.
export const TZ_OFFSET = '-05:00';

// ---------- Fechas ----------
export function dayOf(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: HISTORY_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const part = type => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addDaysIso(iso, amount) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + amount)).toISOString().slice(0, 10);
}

export const dayStartIso = day => `${day}T00:00:00${TZ_OFFSET}`;
export const dayEndIso = day => `${day}T23:59:59.999${TZ_OFFSET}`;

export function fmtTimeOnly(value) {
  return new Date(value).toLocaleTimeString('es-CO', {
    timeZone: HISTORY_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function fmtDuration(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

export function shiftDuration(shift, now = Date.now()) {
  const end = shift.ended_at ? new Date(shift.ended_at).getTime() : now;
  return end - new Date(shift.started_at).getTime();
}

export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
}

// ---------- Ventas por turno ----------
// El cálculo lo hace el servidor (get_shift_sales): devuelve los pedidos creados mientras cada
// turno estuvo abierto, en UNA sola llamada, y un empleado solo recibe los de sus propios turnos.
const CHUNK = 200;

// Devuelve Map(shift.id -> { count, total, orders }). Lanza error si la consulta falla.
export async function salesForShifts(shifts) {
  const result = new Map();
  if (!shifts.length) return result;

  const byShift = new Map(shifts.map(s => [Number(s.id), []]));
  const ids = shifts.map(s => Number(s.id));
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.rpc('get_shift_sales', { p_shift_ids: ids.slice(i, i + CHUNK) });
    if (error) throw error;
    for (const r of data ?? []) {
      byShift.get(Number(r.shift_id))?.push({
        ticket_number: r.ticket_number,
        created_at: r.created_at,
        total: Number(r.total ?? 0),
      });
    }
  }

  for (const s of shifts) {
    const orders = (byShift.get(Number(s.id)) ?? [])
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    result.set(s.id, { count: orders.length, total: orders.reduce((sum, o) => sum + o.total, 0), orders });
  }
  return result;
}

// Totales sin contar dos veces un mismo pedido (cuando dos turnos se cruzan, el pedido aparece
// en ambos turnos, pero en el total general cuenta una sola vez).
export function uniqueTotals(shifts, sales) {
  const seen = new Set();
  let orders = 0;
  let revenue = 0;
  for (const s of shifts) {
    const sa = sales.get(s.id);
    if (!sa || sa.unavailable) continue;
    for (const o of sa.orders) {
      const key = `${o.ticket_number}|${o.created_at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      orders += 1;
      revenue += o.total;
    }
  }
  return { orders, revenue };
}

// Turnos de distintos empleados que se cruzan en el tiempo: sus ventas se cuentan para ambos.
export function overlappingIds(shifts) {
  const now = Date.now();
  const spans = shifts.map(s => ({
    s,
    a: new Date(s.started_at).getTime(),
    b: s.ended_at ? new Date(s.ended_at).getTime() : now,
  }));
  const out = new Set();
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      if (spans[i].s.employee_id !== spans[j].s.employee_id
        && spans[i].a < spans[j].b && spans[j].a < spans[i].b) {
        out.add(spans[i].s.id);
        out.add(spans[j].s.id);
      }
    }
  }
  return out;
}
