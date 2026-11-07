import { supabase } from './supabase.js';
import { esc, formatPrice, toast } from './utils.js';

const root = document.getElementById('view-addons');
let items = [];
let editingId = null;

export async function load() {
  editingId = null;
  const { data, error } = await supabase.from('addons').select('*').order('name');
  if (error) return toast(error.message, true);
  items = data;
  render();
}

function render() {
  const a = items.find(x => x.id === editingId);
  root.innerHTML = `
    <h2>Adiciones</h2>
    <form id="addon-form" class="card form-row">
      <label>Nombre <input name="name" required value="${esc(a?.name)}"></label>
      <label>Precio (COP) <input name="price" type="number" min="0" step="100" required value="${a?.price ?? ''}"></label>
      <label>Stock <input name="stock" type="number" min="0" step="1" required value="${a?.stock ?? 0}"></label>
      <label class="check"><input name="active" type="checkbox" ${(a?.active ?? true) ? 'checked' : ''}> Visible</label>
      <button class="btn" type="submit">${a ? 'Guardar cambios' : 'Agregar adición'}</button>
      ${a ? '<button class="btn-outline" type="button" data-action="cancel">Cancelar</button>' : ''}
    </form>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Nombre</th><th>Precio</th><th>Stock</th><th>Visible</th><th></th></tr></thead>
        <tbody>
          ${items.map(x => `
            <tr>
              <td>${esc(x.name)}</td>
              <td>${formatPrice(x.price)}</td>
              <td>
                <div class="stock-ctl ${x.stock === 0 ? 'out' : ''}">
                  <button class="btn-outline btn-sm" data-action="minus" data-id="${x.id}">−</button>
                  <strong>${x.stock}</strong>
                  <button class="btn-outline btn-sm" data-action="plus" data-id="${x.id}">+</button>
                </div>
              </td>
              <td>${x.active ? 'Sí' : 'No'}</td>
              <td class="actions">
                <button class="btn-outline" data-action="edit" data-id="${x.id}">Editar</button>
                <button class="btn-danger" data-action="delete" data-id="${x.id}">Borrar</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

root.addEventListener('submit', async e => {
  if (e.target.id !== 'addon-form') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const row = {
    name: f.get('name').trim(),
    price: parseInt(f.get('price'), 10),
    stock: parseInt(f.get('stock'), 10) || 0,
    active: f.get('active') === 'on',
  };
  const { error } = editingId
    ? await supabase.from('addons').update(row).eq('id', editingId)
    : await supabase.from('addons').insert(row);
  if (error) {
    return toast(error.code === '23505' ? 'Ya existe una adición con ese nombre' : error.message, true);
  }
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
    const ctl = btn.closest('.stock-ctl');         // actualiza solo esa fila, sin tocar el formulario
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