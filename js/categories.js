import { supabase } from './supabase.js';
import { esc, toast } from './utils.js';

const root = document.getElementById('view-categories');
let items = [];
let editingId = null;

export async function load() {
  editingId = null;
  const { data, error } = await supabase.from('categories').select('*').order('sort_order');
  if (error) return toast(error.message, true);
  items = data;
  render();
}

function render() {
  const c = items.find(x => x.id === editingId);
  root.innerHTML = `
    <h2>Categorías</h2>
    <form id="cat-form" class="card form-row">
      <div class="card-header-bar" style="width: 100%;">
        <span class="card-title">${c ? '✏️ Editando categoría' : '➕ Nueva categoría'}</span>
        ${c ? '<span class="badge badge-warning">Modo edición</span>' : ''}
      </div>
      <label>Nombre <input name="name" required value="${esc(c?.name)}" placeholder="Ej: Bebidas, Hamburguesas..."></label>
      <label>Orden en el menú <input name="sort_order" type="number" value="${c?.sort_order ?? items.length + 1}"></label>
      <label class="check"><input name="active" type="checkbox" ${(c?.active ?? true) ? 'checked' : ''}> Visible en el kiosko</label>
      <div style="display: flex; gap: 8px;">
        <button class="btn" type="submit">${c ? 'Guardar cambios' : 'Agregar categoría'}</button>
        ${c ? '<button class="btn-outline" type="button" data-action="cancel">Cancelar</button>' : ''}
      </div>
    </form>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Orden</th><th>Nombre</th><th>Estado</th><th style="text-align: right;">Acciones</th></tr></thead>
        <tbody>
          ${items.length === 0 ? '<tr><td colspan="4" class="empty-state">No hay categorías registradas aún. Agrega la primera arriba.</td></tr>' : items.map(x => `
            <tr>
              <td><strong>#${x.sort_order}</strong></td>
              <td><strong>${esc(x.name)}</strong></td>
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

root.addEventListener('submit', async e => {
  if (e.target.id !== 'cat-form') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const row = {
    name: f.get('name').trim(),
    sort_order: parseInt(f.get('sort_order'), 10) || 0,
    active: f.get('active') === 'on',
  };
  const { error } = editingId
    ? await supabase.from('categories').update(row).eq('id', editingId)
    : await supabase.from('categories').insert(row);
  if (error) return toast(error.message, true);
  toast(editingId ? 'Categoría actualizada' : 'Categoría creada');
  load();
});

root.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);

  if (btn.dataset.action === 'edit') {
    editingId = id;
    render();
  } else if (btn.dataset.action === 'cancel') {
    editingId = null;
    render();
  } else if (btn.dataset.action === 'delete') {
    // Ojo: en la base de datos, borrar una categoría borra también sus productos (ON DELETE CASCADE)
    if (!confirm('¿Borrar esta categoría? También se borrarán TODOS sus productos.')) return;
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) return toast(error.message, true);
    toast('Categoría borrada');
    load();
  }
});
