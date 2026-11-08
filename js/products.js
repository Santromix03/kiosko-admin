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
      <button type="button" class="btn-danger btn-sm" data-action="remove-row">✕</button>
    </div>`;
}

function stockLabel(p) {
  if (p.stock_mode === 'direct') return `${p.stock} und`;
  if (p.stock_mode === 'recipe') {
    const rows = recipes.get(p.id) ?? [];
    if (!rows.length) return 'Sin receta';
    const can = rows.map(r => {
      const ing = ingredients.find(i => i.id === r.ingredient_id);
      return ing ? Math.floor(ing.stock / r.quantity) : 0;
    });
    return `${Math.min(...can)} (por ingredientes)`;
  }
  return 'Sin control';
}

function render() {
  if (!categories.length) {
    root.innerHTML = '<h2>Productos</h2><p>Primero crea al menos una categoría.</p>';
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
      <label>Categoría
        <select name="category_id" required>
          ${categories.map(c => `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </label>
      <label>Nombre <input name="name" required value="${esc(p?.name)}"></label>
      <label>Precio (COP) <input name="price" type="number" min="0" step="100" required value="${p?.price ?? ''}"></label>
      <label>Orden <input name="sort_order" type="number" value="${p?.sort_order ?? 0}"></label>
      <label class="wide">Descripción <textarea name="description" rows="2">${esc(p?.description)}</textarea></label>
      <label class="wide">Foto ${p?.image_url ? '(sube otra para reemplazarla)' : ''}
        ${p?.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt="">` : ''}
        <input name="image" type="file" accept="image/*">
      </label>

      <fieldset class="checks-group wide">
        <legend>Control de stock</legend>
        <div class="options">
          <label class="check"><input type="radio" name="stock_mode" value="none" ${mode === 'none' ? 'checked' : ''}> Sin control</label>
          <label class="check"><input type="radio" name="stock_mode" value="direct" ${mode === 'direct' ? 'checked' : ''}> Stock directo (ej. gaseosa)</label>
          <label class="check"><input type="radio" name="stock_mode" value="recipe" ${mode === 'recipe' ? 'checked' : ''}> Con ingredientes (ej. hamburguesa, latte)</label>
        </div>

        <div id="stock-direct" class="${mode === 'direct' ? '' : 'hidden'}">
          <label>Unidades en stock <input name="stock" type="number" min="0" step="1" value="${p?.stock ?? 0}"></label>
        </div>

        <div id="stock-recipe" class="${mode === 'recipe' ? '' : 'hidden'}">
          ${ingredients.length ? `
            <p class="hint">Qué lleva UNA unidad de este producto:</p>
            <div id="recipe-rows">${rowsHtml}</div>
            <button type="button" class="btn-outline btn-sm" data-action="add-row">+ Agregar ingrediente</button>`
          : '<p class="hint">Primero crea ingredientes en la sección Ingredientes.</p>'}
        </div>
      </fieldset>

      <label class="check"><input name="available" type="checkbox" ${(p?.available ?? true) ? 'checked' : ''}> Visible en el menú</label>
      <div class="wide">
        <button class="btn" type="submit">${p ? 'Guardar cambios' : 'Agregar producto'}</button>
        ${p ? '<button class="btn-outline" type="button" data-action="cancel">Cancelar</button>' : ''}
      </div>
    </form>

    <div class="card table-wrap">
      <table>
        <thead><tr><th>Foto</th><th>Nombre</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Visible</th><th></th></tr></thead>
        <tbody>
          ${items.map(x => `
            <tr>
              <td>${x.image_url ? `<img class="thumb" src="${esc(x.image_url)}" alt="">` : '—'}</td>
              <td>${esc(x.name)}</td>
              <td>${esc(catName(x.category_id))}</td>
              <td>${formatPrice(x.price)}</td>
              <td>${esc(stockLabel(x))}</td>
              <td>${x.available ? 'Sí' : 'No'}</td>
              <td class="actions">
                <button class="btn-outline" data-action="edit" data-id="${x.id}">Editar</button>
                <button class="btn-danger" data-action="delete" data-id="${x.id}">Borrar</button>
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
    // TODO (grupo): hacerlo en una sola transacción con una función SQL.
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