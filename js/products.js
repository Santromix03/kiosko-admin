import { supabase } from './supabase.js';
import { IMAGES_BUCKET } from './config.js';
import { esc, formatPrice, toast } from './utils.js';
import {
  isHistoryReady,
  isArchived,
  isMissingFunction,
  fmtDateTime,
  fmtQty,
  todayIso,
} from './history.js';

const root = document.getElementById('view-products');
let categories = [];
let ingredients = [];
let items = [];
let recipes = new Map();      // product_id -> [{ ingredient_id, quantity }]
let editingId = null;
let historyReady = false;

let historyProductId = null;
let productHistory = emptyProductHistory();
let asOfState = emptyAsOfState();
let historyReq = 0;
let asOfReq = 0;

const unitShort = u => (u === 'unidad' ? 'und' : u);
const activeIngredients = () => ingredients.filter(i => !isArchived(i));

function emptyProductHistory() {
  return { rows: null, loading: false, error: null, from: '', to: '', status: 'all' };
}

function emptyAsOfState() {
  return { date: '', rows: null, loading: false, error: null };
}

function resetProductHistory() {
  historyProductId = null;
  productHistory = emptyProductHistory();
  asOfState = emptyAsOfState();
  historyReq++;
  asOfReq++;
}

export async function load() {
  editingId = null;
  resetProductHistory();

  const [cats, prods, ings, recs, readyFlag] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('products').select('*').order('category_id').order('sort_order'),
    supabase.from('ingredients').select('*').order('name'),
    supabase.from('recipe_items').select('product_id, ingredient_id, quantity'),
    isHistoryReady(),
  ]);
  const err = cats.error || prods.error || ings.error || recs.error;
  if (err) return toast(err.message, true);

  categories = cats.data;
  items = prods.data;
  ingredients = ings.data;
  historyReady = readyFlag;
  recipes = new Map();
  for (const r of recs.data) {
    if (!recipes.has(r.product_id)) recipes.set(r.product_id, []);
    recipes.get(r.product_id).push(r);
  }
  render();
}

// ---------- Receta (formulario) ----------
function recipeRow(ingredientId = null, quantity = '') {
  const active = activeIngredients();
  const current = active.find(i => i.id === ingredientId) ?? active[0];
  const archived = ingredientId != null
    ? ingredients.find(i => i.id === ingredientId && isArchived(i))
    : null;

  if (archived && !active.some(i => i.id === ingredientId)) {
    return `
      <div class="recipe-row recipe-row-archived">
        <span class="recipe-archived-name">${esc(archived.name)}</span>
        <span class="badge badge-warning">Archivado</span>
        <span class="muted small">Se quitará al guardar la receta</span>
        <button type="button" class="btn-danger btn-sm" data-action="remove-row" title="Quitar ingrediente">✕</button>
      </div>`;
  }

  return `
    <div class="recipe-row">
      <select name="recipe_ingredient">
        ${active.map(i => `
          <option value="${i.id}" data-unit="${esc(unitShort(i.unit))}" ${i.id === current?.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}
      </select>
      <input name="recipe_qty" type="number" min="0" step="any" placeholder="Cantidad" value="${quantity}">
      <span class="unit">${esc(unitShort(current?.unit ?? ''))}</span>
      <button type="button" class="btn-danger btn-sm" data-action="remove-row" title="Quitar ingrediente">✕</button>
    </div>`;
}

function stockLabel(p) {
  if (p.stock_mode === 'direct') {
    const isOut = (p.stock ?? 0) <= 0;
    return `<span class="badge ${isOut ? 'badge-danger' : 'badge-info'}">${p.stock} und</span>`;
  }
  if (p.stock_mode === 'recipe') {
    const rows = recipes.get(p.id) ?? [];
    if (!rows.length) return '<span class="badge badge-warning">Sin receta</span>';
    const can = rows.map(r => {
      const ing = ingredients.find(i => i.id === r.ingredient_id);
      return ing ? Math.floor(ing.stock / r.quantity) : 0;
    });
    const total = Math.min(...can);
    return `<span class="badge ${total <= 0 ? 'badge-danger' : 'badge-success'}">${total} disp. (receta)</span>`;
  }
  return '<span class="badge badge-neutral">Ilimitado</span>';
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
          Mientras tanto, las recetas se guardan como antes, pero no se registran fechas ni periodos.
        </p>
      </div>
    </div>`;
}

// ---------- Historial por producto ----------
function prepareProductHistory(p) {
  if (historyProductId === p.id) return;
  historyProductId = p.id;
  historyReq++;
  asOfReq++;
  productHistory = emptyProductHistory();
  asOfState = { ...emptyAsOfState(), date: todayIso() };
}

function historyFiltersHtml() {
  return `
    <form id="prod-history-filter" class="range-form history-filters">
      <label>Desde <input type="date" name="from" value="${esc(productHistory.from)}"></label>
      <label>Hasta <input type="date" name="to" value="${esc(productHistory.to)}"></label>
      <label>Estado
        <select name="status">
          <option value="all" ${productHistory.status === 'all' ? 'selected' : ''}>Todos</option>
          <option value="active" ${productHistory.status === 'active' ? 'selected' : ''}>Vigentes</option>
          <option value="archived" ${productHistory.status === 'archived' ? 'selected' : ''}>Finalizados</option>
        </select>
      </label>
      <button class="btn-outline btn-sm" type="submit">Aplicar</button>
      <button class="btn-outline btn-sm" type="button" data-action="history-clear">Limpiar</button>
    </form>`;
}

function timelineHtml(rows) {
  if (!rows.length) {
    return '<p class="empty-inline">Sin periodos para los filtros seleccionados.</p>';
  }

  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.ingredient_id)) {
      groups.set(row.ingredient_id, {
        id: row.ingredient_id,
        name: row.ingredient_name,
        unit: row.unit,
        archived: !!row.ingredient_archived_at,
        rows: [],
      });
    }
    groups.get(row.ingredient_id).rows.push(row);
  }

  return `
    <div class="history-groups">
      ${[...groups.values()].map(g => `
        <div class="history-group">
          <div class="history-group-head">
            <strong>${esc(g.name)}</strong>
            <span class="badge badge-neutral">${esc(unitShort(g.unit))}</span>
            ${g.archived ? '<span class="badge badge-warning">Ingrediente archivado</span>' : ''}
            <span class="muted small">${g.rows.length} periodo(s)</span>
          </div>
          <div class="timeline">
            ${g.rows.map(r => `
              <div class="timeline-item ${r.is_active ? 'is-current' : ''}">
                <span class="timeline-dot"></span>
                <div class="timeline-content">
                  <div class="timeline-qty">${fmtQty(r.quantity)} ${esc(unitShort(r.unit))}</div>
                  <div class="timeline-dates">
                    ${esc(fmtDateTime(r.valid_from, '—'))}
                    <span class="timeline-arrow">→</span>
                    ${r.is_active ? '<strong>Actualmente</strong>' : esc(fmtDateTime(r.valid_to, '—'))}
                  </div>
                  <div class="timeline-meta">
                    ${r.is_active
                      ? '<span class="badge badge-success">Vigente</span>'
                      : '<span class="badge badge-neutral">Finalizado</span>'}
                    ${r.close_reason === 'cambio_cantidad' ? '<span class="muted small">Cambió la cantidad</span>' : ''}
                    ${r.close_reason === 'quitado' ? '<span class="muted small">Se quitó de la receta</span>' : ''}
                    ${r.close_reason === 'ingrediente_archivado' ? '<span class="muted small">Ingrediente archivado</span>' : ''}
                    ${r.created_by_email ? `<span class="muted small">Registró: ${esc(r.created_by_email)}</span>` : ''}
                    ${r.closed_by_email ? `<span class="muted small">Cerró: ${esc(r.closed_by_email)}</span>` : ''}
                  </div>
                </div>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
}

function asOfHtml() {
  let result = '';
  if (asOfState.loading) {
    result = '<p class="empty-inline">Consultando…</p>';
  } else if (asOfState.error) {
    result = `<div class="alert-box">${esc(asOfState.error)}</div>`;
  } else if (asOfState.rows !== null) {
    if (!asOfState.rows.length) {
      result = '<p class="empty-inline">No había receta registrada en esa fecha.</p>';
    } else {
      result = `
        <div class="table-wrap history-table">
          <table class="table-compact">
            <thead><tr><th>Ingrediente</th><th>Cantidad</th></tr></thead>
            <tbody>
              ${asOfState.rows.map(r => `
                <tr>
                  <td><strong>${esc(r.ingredient_name)}</strong></td>
                  <td>${fmtQty(r.quantity)} ${esc(unitShort(r.unit))}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    }
  }

  return `
    <div class="asof-box">
      <div class="asof-head">
        <strong>📅 Receta exacta en una fecha</strong>
        <span class="muted small">Se muestra la receta vigente al final de ese día (hora de Bogotá).</span>
      </div>
      <form id="asof-form" class="range-form">
        <label>Fecha <input type="date" name="date" value="${esc(asOfState.date || todayIso())}"></label>
        <button class="btn-outline btn-sm" type="submit">Ver receta</button>
      </form>
      ${result}
    </div>`;
}

function currentRecipeFallback(p) {
  const rows = recipes.get(p.id) ?? [];
  if (!rows.length) return '<p class="empty-inline">Este producto no tiene una receta activa.</p>';
  return `
    <div class="table-wrap history-table">
      <table class="table-compact">
        <thead><tr><th>Ingrediente actual</th><th>Cantidad</th></tr></thead>
        <tbody>
          ${rows.map(r => {
            const ing = ingredients.find(i => i.id === r.ingredient_id);
            return `
              <tr>
                <td><strong>${esc(ing?.name ?? '—')}</strong></td>
                <td>${fmtQty(r.quantity)} ${esc(unitShort(ing?.unit ?? ''))}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderProductHistory() {
  const slot = root.querySelector('#product-history-slot');
  if (!slot || !historyProductId) return;
  const p = items.find(x => x.id === historyProductId);
  if (!p) {
    slot.innerHTML = '';
    return;
  }

  if (!historyReady) {
    slot.innerHTML = `
      <div class="card history-card">
        <div class="card-header-bar">
          <span class="card-title">🕘 Historial de la receta</span>
          <span class="muted small">${esc(p.name)}</span>
        </div>
        ${migrationNotice()}
        <p class="detail-note">Receta actual (sin fechas, porque la migración aún no está aplicada):</p>
        ${currentRecipeFallback(p)}
      </div>`;
    return;
  }

  let body = '';
  if (productHistory.loading) body = '<p class="empty-inline">Cargando historial…</p>';
  else if (productHistory.error) body = `<div class="alert-box">${esc(productHistory.error)}</div>`;
  else body = timelineHtml(productHistory.rows ?? []);

  slot.innerHTML = `
    <div class="card history-card">
      <div class="card-header-bar">
        <span class="card-title">🕘 Historial de la receta</span>
        <span class="muted small">${esc(p.name)}</span>
      </div>
      <p class="detail-note">Cada ingrediente con su cantidad y el periodo en que estuvo vigente. Los cambios solo afectan ventas futuras.</p>
      ${historyFiltersHtml()}
      ${body}
      ${asOfHtml()}
    </div>`;
}

async function loadProductHistory() {
  if (!historyProductId || !historyReady) return;
  const productId = historyProductId;
  const req = ++historyReq;
  productHistory = { ...productHistory, rows: null, loading: true, error: null };
  renderProductHistory();

  const { data, error } = await supabase.rpc('get_product_recipe_history', {
    p_product_id: productId,
    p_from: productHistory.from || null,
    p_to: productHistory.to || null,
    p_status: productHistory.status,
  });
  if (req !== historyReq || productId !== historyProductId) return;

  productHistory = {
    ...productHistory,
    loading: false,
    error: error?.message ?? null,
    rows: error ? null : (data ?? []),
  };
  renderProductHistory();
}

async function loadAsOfRecipe() {
  if (!historyProductId || !historyReady) return;
  const productId = historyProductId;
  const date = asOfState.date || todayIso();
  const req = ++asOfReq;
  asOfState = { ...asOfState, date, rows: null, loading: true, error: null };
  renderProductHistory();

  const { data, error } = await supabase.rpc('get_recipe_at', {
    p_product_id: productId,
    p_date: date,
  });
  if (req !== asOfReq || productId !== historyProductId) return;

  asOfState = {
    ...asOfState,
    loading: false,
    error: error?.message ?? null,
    rows: error ? null : (data ?? []),
  };
  renderProductHistory();
}

function ensureProductHistory() {
  if (!historyProductId || !historyReady) return;
  if (productHistory.rows === null && !productHistory.loading) loadProductHistory();
  if (asOfState.date && asOfState.rows === null && !asOfState.loading) loadAsOfRecipe();
}

// ---------- Vista ----------
function render() {
  if (!categories.length) {
    root.innerHTML = `
      <h2>Productos</h2>
      <div class="alert-box">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <div>
          <strong>No hay categorías creadas</strong>
          <p style="margin: 2px 0 0; font-size: 13px;">Primero debes crear al menos una categoría para poder asociar tus productos.</p>
        </div>
      </div>`;
    return;
  }
  const p = items.find(x => x.id === editingId);
  if (p) prepareProductHistory(p);
  else resetProductHistory();

  const mode = p?.stock_mode ?? 'none';
  const catName = id => categories.find(c => c.id === id)?.name ?? '—';
  const active = activeIngredients();

  const existing = p ? (recipes.get(p.id) ?? []) : [];
  const rowsHtml = existing.length
    ? existing.map(r => recipeRow(r.ingredient_id, r.quantity)).join('')
    : (active.length ? recipeRow() : '');
  const canAddRows = active.length > 0;

  root.innerHTML = `
    <h2>Productos</h2>
    ${historyReady || p ? '' : migrationNotice()}
    <form id="prod-form" class="card form-grid">
      <div class="card-header-bar wide">
        <span class="card-title">${p ? '✏️ Editando: ' + esc(p.name) : '➕ Agregar nuevo producto'}</span>
        ${p ? '<span class="badge badge-warning">Modo edición</span>' : ''}
      </div>

      <label>Categoría
        <select name="category_id" required>
          ${categories.map(c => `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </label>
      <label>Nombre del producto <input name="name" required value="${esc(p?.name)}" placeholder="Ej: Hamburguesa Clásica"></label>
      <label>Precio (COP) <input name="price" type="number" min="0" step="100" required value="${p?.price ?? ''}" placeholder="Ej: 18000"></label>
      <label>Orden en el catálogo <input name="sort_order" type="number" value="${p?.sort_order ?? 0}"></label>

      <label class="wide">Descripción <textarea name="description" rows="2" placeholder="Detalles o ingredientes visibles para el cliente...">${esc(p?.description)}</textarea></label>

      <label class="wide">Fotografía del producto ${p?.image_url ? '<small style="color:var(--text-muted);">(sube otra para reemplazar la actual)</small>' : ''}
        ${p?.image_url ? `<div style="margin: 6px 0;"><img class="thumb" style="width: 80px; height: 80px;" src="${esc(p.image_url)}" alt=""></div>` : ''}
        <input name="image" type="file" accept="image/*">
      </label>

      <fieldset class="checks-group wide">
        <legend>Control y método de inventario (Stock)</legend>
        <div class="options">
          <label class="check"><input type="radio" name="stock_mode" value="none" ${mode === 'none' ? 'checked' : ''}> Sin control (siempre disponible)</label>
          <label class="check"><input type="radio" name="stock_mode" value="direct" ${mode === 'direct' ? 'checked' : ''}> Stock directo (ej. botellas, latas)</label>
          <label class="check"><input type="radio" name="stock_mode" value="recipe" ${mode === 'recipe' ? 'checked' : ''}> Con receta / ingredientes (ej. hamburguesa, café)</label>
        </div>

        <div id="stock-direct" class="${mode === 'direct' ? '' : 'hidden'}" style="margin-top: 12px;">
          <label>Unidades físicas disponibles <input name="stock" type="number" min="0" step="1" value="${p?.stock ?? 0}" style="max-width: 200px;"></label>
        </div>

        <div id="stock-recipe" class="${mode === 'recipe' ? '' : 'hidden'}" style="margin-top: 12px;">
          ${canAddRows || existing.length ? `
            <p class="hint">Qué porciones de ingredientes consume 1 unidad de este producto:</p>
            <div id="recipe-rows">${rowsHtml}</div>
            ${canAddRows ? '<button type="button" class="btn-outline btn-sm" data-action="add-row">+ Agregar ingrediente a la receta</button>' : ''}`
          : '<p class="hint" style="color: var(--danger-text);">⚠️ No hay ingredientes activos. Crea o restaura ingredientes en la pestaña "Ingredientes" primero.</p>'}
        </div>
      </fieldset>

      <div class="wide" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; margin-top: 6px;">
        <label class="check"><input name="available" type="checkbox" ${(p?.available ?? true) ? 'checked' : ''}> Visible en el menú del kiosko</label>
        <div style="display: flex; gap: 8px;">
          <button class="btn" type="submit">${p ? 'Guardar cambios' : 'Agregar producto'}</button>
          ${p ? '<button class="btn-outline" type="button" data-action="cancel">Cancelar</button>' : ''}
        </div>
      </div>
    </form>

    ${p ? '<div id="product-history-slot"></div>' : ''}

    <div class="card table-wrap">
      <table>
        <thead><tr><th>Foto</th><th>Nombre</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Estado</th><th style="text-align: right;">Acciones</th></tr></thead>
        <tbody>
          ${items.length === 0 ? '<tr><td colspan="7" class="empty-state">No hay productos registrados aún. Agrega el primero arriba.</td></tr>' : items.map(x => `
            <tr>
              <td>${x.image_url ? `<img class="thumb" src="${esc(x.image_url)}" alt="">` : '<div class="thumb-placeholder">📷</div>'}</td>
              <td><strong>${esc(x.name)}</strong></td>
              <td><span class="badge badge-neutral">${esc(catName(x.category_id))}</span></td>
              <td><span class="price-val">${formatPrice(x.price)}</span></td>
              <td>${stockLabel(x)}</td>
              <td><span class="badge ${x.available ? 'badge-success' : 'badge-neutral'}">${x.available ? '● Visible' : '○ Oculto'}</span></td>
              <td class="actions">
                <button class="btn-outline btn-sm" data-action="edit" data-id="${x.id}">Editar</button>
                <button class="btn-danger btn-sm" data-action="delete" data-id="${x.id}">Borrar</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  if (p) {
    renderProductHistory();
    ensureProductHistory();
  }
}

// ---------- Imágenes ----------
function resizeImage(file, maxSize = 800, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))),
        'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('El archivo no es una imagen válida'));
    img.src = url;
  });
}

async function uploadImage(file) {
  const blob = await resizeImage(file);
  const path = `${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from(IMAGES_BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from(IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function removeImage(url) {
  const marker = `/${IMAGES_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return;
  await supabase.storage.from(IMAGES_BUCKET).remove([url.slice(i + marker.length)]);
}

async function legacySyncRecipe(productId, recipeRows) {
  const del = await supabase.from('recipe_items').delete().eq('product_id', productId);
  if (del.error) throw del.error;
  if (recipeRows.length) {
    const ins = await supabase.from('recipe_items')
      .insert(recipeRows.map(r => ({ ...r, product_id: productId })));
    if (ins.error) throw ins.error;
  }
}

async function syncRecipe(productId, recipeRows) {
  if (!historyReady) return legacySyncRecipe(productId, recipeRows);

  const { error } = await supabase.rpc('set_product_recipe', {
    p_product_id: productId,
    p_items: recipeRows,
  });

  if (!error) return;

  // Si la migración aún no se aplicó (o PostgREST no la ha recargado),
  // guardamos como antes para no bloquear la edición del producto.
  if (isMissingFunction(error)) {
    historyReady = false;
    return legacySyncRecipe(productId, recipeRows);
  }
  throw error;
}

// ---------- Eventos ----------
root.addEventListener('change', e => {
  if (e.target.name === 'stock_mode') {
    const mode = e.target.value;
    root.querySelector('#stock-direct').classList.toggle('hidden', mode !== 'direct');
    root.querySelector('#stock-recipe').classList.toggle('hidden', mode !== 'recipe');
  } else if (e.target.name === 'recipe_ingredient') {
    const unit = e.target.selectedOptions[0]?.dataset.unit ?? '';
    e.target.closest('.recipe-row').querySelector('.unit').textContent = unit;
  }
});

root.addEventListener('submit', async e => {
  if (e.target.id === 'prod-history-filter') {
    e.preventDefault();
    const f = new FormData(e.target);
    const from = String(f.get('from') || '');
    const to = String(f.get('to') || '');
    if (from && to && from > to) {
      return toast('La fecha inicial no puede ser posterior a la final', true);
    }
    productHistory.from = from;
    productHistory.to = to;
    productHistory.status = String(f.get('status') || 'all');
    productHistory.rows = null;
    loadProductHistory();
    return;
  }

  if (e.target.id === 'asof-form') {
    e.preventDefault();
    const date = String(new FormData(e.target).get('date') || '');
    if (!date) return toast('Elige una fecha', true);
    asOfState.date = date;
    asOfState.rows = null;
    loadAsOfRecipe();
    return;
  }

  if (e.target.id !== 'prod-form') return;
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const submitBtn = form.querySelector('button[type=submit]');
  submitBtn.disabled = true;

  try {
    const current = items.find(x => x.id === editingId);
    const mode = f.get('stock_mode');
    const row = {
      category_id: Number(f.get('category_id')),
      name: f.get('name').trim(),
      description: f.get('description').trim() || null,
      price: parseInt(f.get('price'), 10),
      sort_order: parseInt(f.get('sort_order'), 10) || 0,
      available: f.get('available') === 'on',
      stock_mode: mode,
      stock: mode === 'direct' ? (parseInt(f.get('stock'), 10) || 0) : 0,
    };

    // Receta: se valida ANTES de subir la foto o guardar nada
    let recipeRows = [];
    if (mode === 'recipe') {
      const ids = f.getAll('recipe_ingredient').map(Number);
      const qtys = f.getAll('recipe_qty').map(Number);
      recipeRows = ids.map((ingredient_id, i) => ({ ingredient_id, quantity: qtys[i] }));
      if (!recipeRows.length) throw new Error('Agrega al menos un ingrediente activo a la receta');
      if (recipeRows.some(r => !(r.quantity > 0))) throw new Error('Cada ingrediente necesita una cantidad mayor a 0');
      if (new Set(ids).size !== ids.length) throw new Error('Hay un ingrediente repetido en la receta');
    }

    const file = f.get('image');
    const hasNewImage = file && file.size > 0;
    if (hasNewImage) row.image_url = await uploadImage(file);

    let productId = editingId;
    if (editingId) {
      const { error } = await supabase.from('products').update(row).eq('id', editingId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('products').insert(row).select('id').single();
      if (error) throw error;
      productId = data.id;
    }

    await syncRecipe(productId, recipeRows);

    if (hasNewImage && current?.image_url) await removeImage(current.image_url);
    toast(editingId ? 'Producto actualizado' : 'Producto creado');
    resetProductHistory();
    await load();
  } catch (err) {
    toast(err.message, true);
  } finally {
    submitBtn.disabled = false;
  }
});

root.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'add-row') {
    root.querySelector('#recipe-rows').insertAdjacentHTML('beforeend', recipeRow());
  } else if (action === 'remove-row') {
    btn.closest('.recipe-row').remove();
  } else if (action === 'history-clear') {
    productHistory.from = '';
    productHistory.to = '';
    productHistory.status = 'all';
    productHistory.rows = null;
    loadProductHistory();
  } else if (action === 'edit') {
    editingId = Number(btn.dataset.id);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (action === 'cancel') {
    editingId = null;
    resetProductHistory();
    render();
  } else if (action === 'delete') {
    const id = Number(btn.dataset.id);
    const p = items.find(x => x.id === id);
    if (!confirm(`¿Borrar "${p?.name}"?`)) return;
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) return toast(error.message, true);
    if (p?.image_url) await removeImage(p.image_url);
    toast('Producto borrado');
    load();
  }
});
