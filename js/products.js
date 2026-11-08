import { supabase } from './supabase.js';
import { IMAGES_BUCKET } from './config.js';
import { esc, formatPrice, toast } from './utils.js';

const root = document.getElementById('view-products');
let categories = [];
let ingredients = [];
let items = [];
let recipes = new Map();      // product_id -> [{ ingredient_id, quantity }]
let editingId = null;

const unitShort = u => (u === 'unidad' ? 'und' : u);

export async function load() {
  editingId = null;
  const [cats, prods, ings, recs] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('products').select('*').order('category_id').order('sort_order'),
    supabase.from('ingredients').select('*').order('name'),
    supabase.from('recipe_items').select('product_id, ingredient_id, quantity'),
  ]);
  const err = cats.error || prods.error || ings.error || recs.error;
  if (err) return toast(err.message, true);

  categories = cats.data;
  items = prods.data;
  ingredients = ings.data;
  recipes = new Map();
  for (const r of recs.data) {
    if (!recipes.has(r.product_id)) recipes.set(r.product_id, []);
    recipes.get(r.product_id).push(r);
  }
  render();
}

// ---------- Vista ----------
function recipeRow(ingredientId = null, quantity = '') {
  const current = ingredients.find(i => i.id === ingredientId) ?? ingredients[0];
  return `
    <div class="recipe-row">
      <select name="recipe_ingredient">
        ${ingredients.map(i => `
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
  const mode = p?.stock_mode ?? 'none';
  const catName = id => categories.find(c => c.id === id)?.name ?? '—';

  const existing = p ? (recipes.get(p.id) ?? []) : [];
  const rowsHtml = existing.length
    ? existing.map(r => recipeRow(r.ingredient_id, r.quantity)).join('')
    : (ingredients.length ? recipeRow() : '');

  root.innerHTML = `
    <h2>Productos</h2>
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
          ${ingredients.length ? `
            <p class="hint">Qué porciones de ingredientes consume 1 unidad de este producto:</p>
            <div id="recipe-rows">${rowsHtml}</div>
            <button type="button" class="btn-outline btn-sm" data-action="add-row">+ Agregar ingrediente a la receta</button>`
          : '<p class="hint" style="color: var(--danger-text);">⚠️ No hay ingredientes registrados. Crea ingredientes en la pestaña "Ingredientes" primero.</p>'}
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
      if (!recipeRows.length) throw new Error('Agrega al menos un ingrediente a la receta');
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

    // Sincroniza la receta (si el modo no es "recipe", queda vacía)
    const del = await supabase.from('recipe_items').delete().eq('product_id', productId);
    if (del.error) throw del.error;
    if (recipeRows.length) {
      const ins = await supabase.from('recipe_items')
        .insert(recipeRows.map(r => ({ ...r, product_id: productId })));
      if (ins.error) throw ins.error;
    }

    if (hasNewImage && current?.image_url) await removeImage(current.image_url);
    toast(editingId ? 'Producto actualizado' : 'Producto creado');
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
  } else if (action === 'edit') {
    editingId = Number(btn.dataset.id);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (action === 'cancel') {
    editingId = null;
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
