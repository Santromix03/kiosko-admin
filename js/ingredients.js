import { supabase } from './supabase.js';
import { esc, toast } from './utils.js';
import {
  isHistoryReady,
  isArchived,
  fmtDateTime,
  fmtQty,
} from './history.js';

const root = document.getElementById('view-ingredients');
const UNITS = [
  ['unidad', 'Por unidad (ej. panes, huevos, envases)'],
  ['g', 'Por gramos (ej. carne, café, queso)'],
  ['ml', 'Por mililitros (ej. leche, jarabes, salsas)'],
];

let items = [];
let editingId = null;
let showArchived = false;
let ready = false;
let busy = false;

let historyId = null;
let historyReq = 0;
let historyState = emptyHistoryState();

const unitShort = u => (u === 'unidad' ? 'und' : u);
const fmt = n => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });

function emptyHistoryState() {
  return { rows: null, loading: false, error: null, from: '', to: '', status: 'all' };
}

function migrationNotice() {
  return `
    <div class="alert-box migration-alert">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <div>
        <strong>Historial de recetas pendiente de activar</strong>
        <p class="migration-text">
          Ejecuta <code>supabase/migrations/20261112_recipe_history.sql</code> en el SQL Editor de Supabase.
          Mientras tanto, los ingredientes se pueden editar, pero archivar y consultar fechas quedará deshabilitado.
        </p>
      </div>
    </div>`;
}

export async function load() {
  editingId = null;
  historyId = null;
  historyReq++;
  historyState = emptyHistoryState();

  const [res, readyFlag] = await Promise.all([
    supabase.from('ingredients').select('*').order('name'),
    isHistoryReady(),
  ]);

  if (res.error) return toast(res.error.message, true);
  ready = readyFlag;
  items = res.data ?? [];
  render();
}

// ---------- Vista ----------
function render() {
  const current = items.find(x => x.id === editingId);
  const archivedCount = items.filter(isArchived).length;
  const visible = showArchived ? items : items.filter(x => !isArchived(x));

  root.innerHTML = `
    <h2>Materia Prima e Ingredientes</h2>
    <p class="hint">Control de insumos base para las recetas. Los ingredientes nunca se borran: se archivan para conservar el historial.</p>

    ${ready ? '' : migrationNotice()}

    <form id="ing-form" class="card form-row">
      <div class="card-header-bar" style="width: 100%;">
        <span class="card-title">${current ? '✏️ Editando ingrediente' : '➕ Registrar nuevo insumo / ingrediente'}</span>
        ${current ? '<span class="badge badge-warning">Modo edición</span>' : ''}
      </div>

      <label>Nombre del ingrediente <input name="name" required value="${esc(current?.name)}" placeholder="Ej: Carne de res, Pan brioche..."></label>
      <label>Unidad de medida
        <select name="unit" ${current ? 'disabled' : ''}>
          ${UNITS.map(([v, label]) => `<option value="${v}" ${current?.unit === v ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
      <label>Stock actual en bodega <input name="stock" type="number" min="0" step="any" required value="${current?.stock ?? 0}"></label>
      <div style="display: flex; gap: 8px;">
        <button class="btn" type="submit">${current ? 'Guardar cambios' : 'Agregar ingrediente'}</button>
        ${current ? '<button class="btn-outline" type="button" data-action="cancel">Cancelar</button>' : ''}
      </div>
    </form>
    ${current ? '<p class="hint" style="color: var(--text-muted); font-size: 13px;">💡 La unidad de medida no se puede modificar porque las recetas dependen de ella. Si necesitas cambiarla, archiva el ingrediente y crea uno nuevo.</p>' : ''}

    <div class="view-toolbar">
      <label class="check archive-toggle">
        <input type="checkbox" id="show-archived" ${showArchived ? 'checked' : ''}>
        Mostrar archivados
        ${archivedCount ? `<span class="badge badge-neutral">${archivedCount}</span>` : ''}
      </label>
      <span class="muted small">${visible.length} ingrediente(s) ${showArchived ? 'en total' : 'activo(s)'}</span>
    </div>

    <div class="card table-wrap">
      <table>
        <thead><tr><th>Ingrediente</th><th>Stock disponible</th><th>Ajuste / Reposición rápida</th><th style="text-align: right;">Acciones</th></tr></thead>
        <tbody>
          ${visible.length === 0 ? `<tr><td colspan="4" class="empty-state">${items.length
            ? 'No hay ingredientes activos. Activa «Mostrar archivados» para ver y restaurar los archivados.'
            : 'No hay ingredientes registrados. Registra el primero arriba.'}</td></tr>` : visible.map(x => {
              const archived = isArchived(x);
              return `
              <tr class="${archived ? 'archived-row' : ''}">
                <td>
                  <strong>${esc(x.name)}</strong>
                  ${archived ? '<span class="badge badge-warning">Archivado</span>' : ''}
                  ${archived ? `<div class="muted small">Archivado el ${esc(fmtDateTime(x.archived_at, '—'))}</div>` : ''}
                </td>
                <td>
                  <span class="stock-val ${!archived && Number(x.stock) === 0 ? 'out' : ''}" data-stock="${x.id}">
                    ${fmt(x.stock)} ${unitShort(x.unit)}
                  </span>
                </td>
                <td>
                  ${archived
                    ? '<span class="muted small">Fuera de las recetas activas</span>'
                    : `<div class="refill">
                        <input type="number" min="0" step="any" placeholder="Cant." data-refill="${x.id}">
                        <button type="button" class="btn-outline btn-sm" data-action="add" data-id="${x.id}" title="Sumar inventario">+ Sumar</button>
                        <button type="button" class="btn-outline btn-sm" data-action="sub" data-id="${x.id}" title="Restar inventario">− Restar</button>
                      </div>`}
                </td>
                <td class="actions">
                  ${archived
                    ? `<button class="btn-outline btn-sm" data-action="history" data-id="${x.id}">Historial</button>
                       <button class="btn-outline btn-sm" data-action="restore" data-id="${x.id}" ${ready ? '' : 'disabled title="Aplica la migración de historial para restaurar"'}>Restaurar</button>`
                    : `<button class="btn-outline btn-sm" data-action="edit" data-id="${x.id}">Editar</button>
                       <button class="btn-outline btn-sm" data-action="history" data-id="${x.id}">Historial</button>
                       <button class="btn-danger btn-sm" data-action="archive" data-id="${x.id}" ${ready ? '' : 'disabled title="Aplica la migración de historial para archivar sin borrar"'}>Archivar</button>`}
                </td>
              </tr>`;
            }).join('')}
        </tbody>
      </table>
    </div>
    ${historyId ? '<div id="ing-history-slot"></div>' : ''}`;

  if (historyId) renderHistoryCard();
}

function historyFiltersHtml() {
  return `
    <form id="ing-history-filter" class="range-form history-filters">
      <label>Desde <input type="date" name="from" value="${esc(historyState.from)}"></label>
      <label>Hasta <input type="date" name="to" value="${esc(historyState.to)}"></label>
      <label>Estado
        <select name="status">
          <option value="all" ${historyState.status === 'all' ? 'selected' : ''}>Todos</option>
          <option value="active" ${historyState.status === 'active' ? 'selected' : ''}>Vigentes</option>
          <option value="archived" ${historyState.status === 'archived' ? 'selected' : ''}>Finalizados</option>
        </select>
      </label>
      <button class="btn-outline btn-sm" type="submit">Aplicar</button>
      <button class="btn-outline btn-sm" type="button" data-action="history-clear">Limpiar</button>
    </form>`;
}

function usageTable(rows, withDates, unit) {
  return `
    <div class="table-wrap history-table">
      <table class="table-compact">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Cantidad</th>
            ${withDates ? '<th>Desde</th><th>Hasta</th>' : ''}
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><strong>${esc(r.product_name ?? '—')}</strong></td>
              <td>${fmtQty(r.quantity)} ${esc(unitShort(r.unit ?? unit))}</td>
              ${withDates ? `
                <td>${esc(fmtDateTime(r.valid_from, '—'))}</td>
                <td>${r.is_active ? '<span class="badge badge-success">Actualmente</span>' : esc(fmtDateTime(r.valid_to, '—'))}</td>` : ''}
              <td>
                ${r.is_active
                  ? '<span class="badge badge-success">Vigente</span>'
                  : '<span class="badge badge-neutral">Finalizado</span>'}
                ${r.close_reason === 'ingrediente_archivado' ? '<div class="muted small">Cerrado al archivar el ingrediente</div>' : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function historyBody(ing) {
  if (historyState.loading) {
    return '<p class="empty-inline">Cargando historial…</p>';
  }
  if (historyState.error) {
    return `<div class="alert-box">${esc(historyState.error)}</div>`;
  }
  const rows = historyState.rows ?? [];
  if (!ready) {
    if (!rows.length) {
      return '<p class="empty-inline">No hay recetas actuales que usen este ingrediente. Aplica la migración para conservar y consultar el historial con fechas.</p>';
    }
    return `
      <p class="detail-note">Vista sin fechas: la migración de historial aún no está aplicada. Esto muestra solo las recetas actuales.</p>
      ${usageTable(rows, false, ing.unit)}`;
  }
  if (!rows.length) {
    return '<p class="empty-inline">Sin registros para los filtros seleccionados.</p>';
  }
  return usageTable(rows, true, ing.unit);
}

function renderHistoryCard() {
  const slot = root.querySelector('#ing-history-slot');
  if (!slot) return;
  const ing = items.find(x => x.id === historyId);
  if (!ing) {
    slot.innerHTML = '';
    return;
  }
  slot.innerHTML = `
    <div class="card history-card">
      <div class="card-header-bar">
        <span class="card-title">
          🕘 Historial de ${esc(ing.name)}
          ${isArchived(ing) ? '<span class="badge badge-warning">Archivado</span>' : ''}
        </span>
        <button class="btn-outline btn-sm" type="button" data-action="history-close">Cerrar</button>
      </div>
      <p class="detail-note">Productos en los que se usó este ingrediente y el periodo de vigencia de cada uno.</p>
      ${historyFiltersHtml()}
      ${historyBody(ing)}
    </div>`;
}

async function openHistory(id) {
  if (historyId === id) return closeHistory();
  historyId = id;
  historyState = emptyHistoryState();
  historyReq++;
  if (!root.querySelector('#ing-history-slot')) {
    root.insertAdjacentHTML('beforeend', '<div id="ing-history-slot"></div>');
  }
  renderHistoryCard();
  await loadIngredientHistory();
}

function closeHistory() {
  historyId = null;
  historyReq++;
  root.querySelector('#ing-history-slot')?.remove();
}

async function loadIngredientHistory() {
  if (!historyId) return;
  const req = ++historyReq;
  historyState = { ...historyState, rows: null, loading: true, error: null };
  renderHistoryCard();

  // Antes de la migración no hay fechas: mostramos al menos el uso actual.
  if (!ready) {
    const [recsRes, prodsRes] = await Promise.all([
      supabase.from('recipe_items').select('product_id, quantity').eq('ingredient_id', historyId),
      supabase.from('products').select('id, name'),
    ]);
    if (req !== historyReq) return;
    historyState.loading = false;
    const err = recsRes.error || prodsRes.error;
    if (err) {
      historyState.error = err.message;
    } else {
      const names = new Map((prodsRes.data ?? []).map(p => [p.id, p.name]));
      const ing = items.find(x => x.id === historyId);
      historyState.rows = (recsRes.data ?? []).map(r => ({
        product_id: r.product_id,
        product_name: names.get(r.product_id) ?? '—',
        quantity: r.quantity,
        unit: ing?.unit,
        valid_from: null,
        valid_to: null,
        is_active: true,
      })).sort((a, b) => a.product_name.localeCompare(b.product_name, 'es'));
    }
    renderHistoryCard();
    return;
  }

  const { data, error } = await supabase.rpc('get_ingredient_usage', {
    p_ingredient_id: historyId,
    p_from: historyState.from || null,
    p_to: historyState.to || null,
    p_status: historyState.status,
  });
  if (req !== historyReq) return;
  historyState.loading = false;
  if (error) historyState.error = error.message;
  else historyState.rows = data ?? [];
  renderHistoryCard();
}

async function archiveIngredient(id) {
  const ing = items.find(x => x.id === id);
  if (!ing) return;
  if (!ready) {
    return toast('Falta aplicar la migración de historial para poder archivar sin borrar.', true);
  }
  if (busy) return;
  busy = true;

  let affected = [];
  const usage = await supabase.rpc('get_ingredient_usage', {
    p_ingredient_id: id,
    p_from: null,
    p_to: null,
    p_status: 'active',
  });
  busy = false;
  if (usage.error) return toast(usage.error.message, true);
  affected = usage.data ?? [];

  const productNames = [...new Set(affected.map(r => r.product_name).filter(Boolean))];
  const detail = productNames.length
    ? `\n\nEstá en ${productNames.length} receta(s) activa(s):\n• ${productNames.join('\n• ')}\n\nEsos periodos se cerrarán con la fecha y hora actual.`
    : '\n\nNo está en ninguna receta activa.';

  if (!confirm(`¿Archivar "${ing.name}"?${detail}\n\nNo se borra: queda en el historial y se puede restaurar.`)) {
    return;
  }

  busy = true;
  const { data, error } = await supabase.rpc('archive_ingredient', { p_id: id });
  busy = false;
  if (error) return toast(error.message, true);

  const closedNames = [...new Set((data?.affected_products ?? affected)
    .map(p => p.name ?? p.product_name)
    .filter(Boolean))];
  toast(closedNames.length
    ? `Ingrediente archivado. Se cerraron ${closedNames.length} receta(s).`
    : 'Ingrediente archivado');
  if (editingId === id) editingId = null;
  await load();
}

async function restoreIngredient(id) {
  if (!ready) {
    return toast('Falta aplicar la migración de historial para poder restaurar.', true);
  }
  if (busy) return;
  const ing = items.find(x => x.id === id);
  if (!confirm(`¿Restaurar "${ing?.name ?? 'este ingrediente'}"? Volverá a aparecer en las listas y podrá usarse en recetas nuevas.`)) {
    return;
  }
  busy = true;
  const { error } = await supabase.rpc('restore_ingredient', { p_id: id });
  busy = false;
  if (error) return toast(error.message, true);
  toast('Ingrediente reactivado');
  await load();
}

// ---------- Eventos ----------
root.addEventListener('change', e => {
  if (e.target.id === 'show-archived') {
    showArchived = e.target.checked;
    render();
  }
});

root.addEventListener('submit', async e => {
  if (e.target.id === 'ing-history-filter') {
    e.preventDefault();
    const f = new FormData(e.target);
    const from = String(f.get('from') || '');
    const to = String(f.get('to') || '');
    if (from && to && from > to) {
      return toast('La fecha inicial no puede ser posterior a la final', true);
    }
    historyState.from = from;
    historyState.to = to;
    historyState.status = String(f.get('status') || 'all');
    loadIngredientHistory();
    return;
  }
  if (e.target.id !== 'ing-form') return;

  e.preventDefault();
  if (busy) return;

  const f = new FormData(e.target);
  const name = String(f.get('name') ?? '').trim();
  if (!name) return toast('Escribe el nombre del ingrediente', true);

  const current = items.find(x => x.id === editingId);
  const unit = current ? current.unit : String(f.get('unit') || 'unidad');
  const stock = Number(f.get('stock')) || 0;
  const duplicate = items.find(x =>
    x.id !== editingId && String(x.name).trim().toLowerCase() === name.toLowerCase());

  if (duplicate) {
    if (editingId) {
      return toast(isArchived(duplicate)
        ? 'Ese nombre pertenece a un ingrediente archivado. Restáuralo o usa otro nombre.'
        : 'Ya existe un ingrediente con ese nombre', true);
    }
    if (isArchived(duplicate)) {
      if (!ready) {
        return toast('Ese nombre pertenece a un ingrediente archivado, pero falta aplicar la migración.', true);
      }
      if (!confirm(`Ya existe un ingrediente archivado llamado "${duplicate.name}" (${unitShort(duplicate.unit)}).\n\n¿Quieres reactivarlo en lugar de crear uno nuevo?`)) {
        return;
      }
      busy = true;
      const { error } = await supabase.rpc('restore_ingredient', { p_id: duplicate.id });
      busy = false;
      if (error) return toast(error.message, true);
      toast('Ingrediente reactivado. Revisa su stock y unidad.');
      await load();
      return;
    }
    return toast('Ya existe un ingrediente con ese nombre', true);
  }

  const row = { name, unit, stock };
  busy = true;
  let error;
  if (editingId) {
    ({ error } = await supabase.from('ingredients').update(row).eq('id', editingId));
  } else {
    ({ error } = await supabase.from('ingredients').insert(row));
  }
  busy = false;

  if (error) {
    if (error.code === '23505') {
      // Puede ser un duplicado creado en paralelo o una restricción de nombre.
      const { data } = await supabase.from('ingredients').select('*').ilike('name', name).limit(5);
      const archived = (data ?? []).find(isArchived);
      if (archived && ready && !editingId
        && confirm(`Ya existe un ingrediente archivado llamado "${archived.name}".\n\n¿Quieres reactivarlo?`)) {
        const { error: restoreError } = await supabase.rpc('restore_ingredient', { p_id: archived.id });
        if (restoreError) return toast(restoreError.message, true);
        toast('Ingrediente reactivado');
        await load();
        return;
      }
      return toast('Ya existe un ingrediente con ese nombre', true);
    }
    return toast(error.message, true);
  }

  toast(editingId ? 'Ingrediente actualizado' : 'Ingrediente creado');
  await load();
});

root.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const action = btn.dataset.action;

  if (action === 'edit') {
    const item = items.find(x => x.id === id);
    if (isArchived(item)) return toast('Restaura el ingrediente antes de editarlo', true);
    editingId = id;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (action === 'cancel') {
    editingId = null;
    render();
  } else if (action === 'archive') {
    archiveIngredient(id);
  } else if (action === 'restore') {
    restoreIngredient(id);
  } else if (action === 'history') {
    openHistory(id);
  } else if (action === 'history-close') {
    closeHistory();
  } else if (action === 'history-clear') {
    historyState = { ...historyState, from: '', to: '', status: 'all' };
    loadIngredientHistory();
  } else if (action === 'add' || action === 'sub') {
    const item = items.find(x => x.id === id);
    if (isArchived(item)) return toast('Un ingrediente archivado no se puede ajustar', true);
    const input = root.querySelector(`input[data-refill="${id}"]`);
    const amount = Number(input.value);
    if (!(amount > 0)) return toast('Escribe una cantidad mayor a 0', true);

    const { data, error } = await supabase.rpc('adjust_ingredient_stock', {
      p_id: id,
      p_delta: action === 'add' ? amount : -amount,
    });
    if (error) return toast(error.message, true);

    item.stock = data;
    const cell = root.querySelector(`[data-stock="${id}"]`);
    if (cell) {
      cell.textContent = `${fmt(data)} ${unitShort(item.unit)}`;
      cell.classList.toggle('out', Number(data) === 0);
    }
    input.value = '';
  }
});
