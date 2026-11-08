import { supabase } from './supabase.js';
import { esc, formatPrice, toast } from './utils.js';

const root = document.getElementById('view-addons');
let items = [];
let categories = [];
let links = new Map();      // addon_id -> Set de category_id
let editingId = null;

export async function load() {
  editingId = null;
  const [addonsRes, catsRes, linksRes] = await Promise.all([
    supabase.from('addons').select('*').order('name'),
    supabase.from('categories').select('id, name').order('sort_order'),
    supabase.from('addon_categories').select('addon_id, category_id'),
  ]);
  const err = addonsRes.error || catsRes.error || linksRes.error;
  if (err) return toast(err.message, true);

  items = addonsRes.data;
  categories = catsRes.data;
  links = new Map();
  for (const l of linksRes.data) {
    if (!links.has(l.addon_id)) links.set(l.addon_id, new Set());
    links.get(l.addon_id).add(l.category_id);
  }
  render();
}

function categoryNames(addonId) {
  const ids = links.get(addonId) ?? new Set();
  const names = categories.filter(c => ids.has(c.id)).map(c => c.name);
  return names.length ? names.join(', ') : '—';
}

function render() {
  const a = items.find(x => x.id === editingId);
  const selected = links.get(a?.id) ?? new Set();

  root.innerHTML = `
    <h2>Adiciones y Extras</h2>
    <form id="addon-form" class="card form-row">
      <div class="card-header-bar" style="width: 100%;">
        <span class="card-title">${a ? '✏️ Editando adición' : '➕ Nueva adición / ingrediente extra'}</span>
        ${a ? '<span class="badge badge-warning">Modo edición</span>' : ''}
      </div>

      <label>Nombre de la adición <input name="name" required value="${esc(a?.name)}" placeholder="Ej: Tocineta extra, Queso cheddar..."></label>
      <label>Precio adicional (COP) <input name="price" type="number" min="0" step="100" required value="${a?.price ?? ''}" placeholder="Ej: 3000"></label>
      <label>Stock disponible <input name="stock" type="number" min="0" step="1" required value="${a?.stock ?? 0}"></label>
      <label class="check"><input name="active" type="checkbox" ${(a?.active ?? true) ? 'checked' : ''}> Visible en kiosko</label>

      <fieldset class="checks-group" style="width: 100%;">
        <legend>¿En qué categorías se ofrece?</legend>
        <div class="options">
          ${categories.length === 0 ? '<p class="hint">No hay categorías creadas aún.</p>' : categories.map(c => `
            <label class="check">
              <input type="checkbox" name="categories" value="${c.id}" ${selected.has(c.id) ? 'checked' : ''}>
              ${esc(c.name)}
            </label>`).join('')}
        </div>
      </fieldset>

      <div style="display: flex; gap: 8px; margin-top: 6px;">
        <button class="btn" type="submit">${a ? 'Guardar cambios' : 'Agregar adición'}</button>
        ${a ? '<button class="btn-outline" type="button" data-action="cancel">Cancelar</button>' : ''}
      </div>
    </form>

    <div class="card table-wrap">
      <table>
        <thead><tr><th>Nombre</th><th>Categorías permitidas</th><th>Precio</th><th>Stock rápido</th><th>Estado</th><th style="text-align: right;">Acciones</th></tr></thead>
        <tbody>
          ${items.length === 0 ? '<tr><td colspan="6" class="empty-state">No hay adiciones creadas todavía.</td></tr>' : items.map(x => `
            <tr>
              <td><strong>${esc(x.name)}</strong></td>
              <td><span class="badge badge-neutral">${esc(categoryNames(x.id))}</span></td>
              <td><span class="price-val">${formatPrice(x.price)}</span></td>
              <td>
                <div class="stock-ctl ${x.stock === 0 ? 'out' : ''}">
                  <button type="button" class="btn-outline btn-sm" data-action="minus" data-id="${x.id}" title="Restar 1">−</button>
                  <strong>${x.stock}</strong>
                  <button type="button" class="btn-outline btn-sm" data-action="plus" data-id="${x.id}" title="Sumar 1">+</button>
                </div>
              </td>
              <td><span class="badge ${x.active ? 'badge-success' : 'badge-neutral'}">${x.active ? '● Visible' : '○ Oculto'}</span></td>
              <td class="actions">
                <button class="btn-outline btn-sm" data-action="edit" data-id="${x.id}">Editar</button>
                <button class="btn-danger btn-sm" data-action="delete" data-id="${x.id}">Borrar</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function showError(error) {
  toast(error.code === '23505' ? 'Ya existe una adición con ese nombre' : error.message, true);
}

root.addEventListener('submit', async e => {
  if (e.target.id !== 'addon-form') return;
  e.preventDefault();
  const f = new FormData(e.target);

  const categoryIds = f.getAll('categories').map(Number);
  if (!categoryIds.length) {
    return toast('Elige al menos una categoría para esta adición', true);
  }

  const row = {
    name: f.get('name').trim(),
    price: parseInt(f.get('price'), 10),
    stock: parseInt(f.get('stock'), 10) || 0,
    active: f.get('active') === 'on',
  };

  let addonId = editingId;
  if (editingId) {
    const { error } = await supabase.from('addons').update(row).eq('id', editingId);
    if (error) return showError(error);
  } else {
    const { data, error } = await supabase.from('addons').insert(row).select('id').single();
    if (error) return showError(error);
    addonId = data.id;
  }

  const del = await supabase.from('addon_categories').delete().eq('addon_id', addonId);
  if (del.error) return toast(del.error.message, true);
  const ins = await supabase.from('addon_categories')
    .insert(categoryIds.map(category_id => ({ addon_id: addonId, category_id })));
  if (ins.error) return toast(ins.error.message, true);

  toast(editingId ? 'Adición actualizada' : 'Adición creada');
  load();
});

root.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const action = btn.dataset.action;

  if (action === 'edit') {
    editingId = id;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (action === 'cancel') {
    editingId = null;
    render();
  } else if (action === 'plus' || action === 'minus') {
    const { data, error } = await supabase.rpc('adjust_addon_stock', {
      p_id: id,
      p_delta: action === 'plus' ? 1 : -1,
    });
    if (error) return toast(error.message, true);
    const item = items.find(x => x.id === id);
    if (item) item.stock = data;
    const ctl = btn.closest('.stock-ctl');
    ctl.querySelector('strong').textContent = data;
    ctl.classList.toggle('out', data === 0);
  } else if (action === 'delete') {
    const a = items.find(x => x.id === id);
    if (!confirm(`¿Borrar la adición "${a?.name}"?`)) return;
    const { error } = await supabase.from('addons').delete().eq('id', id);
    if (error) return toast(error.message, true);
    toast('Adición borrada');
    load();
  }
});
