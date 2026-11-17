import { supabase } from './supabase.js';

// La base guarda los periodos en UTC; los informes se muestran y filtran
// con el mismo día local que usa el kiosko.
export const HISTORY_TIMEZONE = 'America/Bogota';

let readyPromise = null;

// Se consulta una sola vez por carga de página: evita repetir errores si
// todavía no se ha ejecutado supabase/migrations/20261112_recipe_history.sql.
export function isHistoryReady() {
  if (!readyPromise) {
    readyPromise = supabase.rpc('recipe_history_status')
      .then(({ data, error }) => {
        if (error) return false;
        if (typeof data === 'boolean') return data;
        return data?.ready === true;
      })
      .catch(() => false);
  }
  return readyPromise;
}

export function resetHistoryReady() {
  readyPromise = null;
}

export const isArchived = row => !!row?.archived_at;

export function isMissingFunction(error) {
  if (!error) return false;
  const code = String(error.code ?? '');
  const message = String(error.message ?? '');
  return code === 'PGRST202' || code === '42883'
    || /could not find the function|function .* does not exist/i.test(message);
}

export function fmtDateTime(value, fallback = 'Actualmente') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString('es-CO', {
    timeZone: HISTORY_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-CO', {
    timeZone: HISTORY_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function todayIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: HISTORY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = type => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function fmtQty(value) {
  return Number(value ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 3 });
}
