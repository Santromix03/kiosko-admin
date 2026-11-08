import { supabase } from './supabase.js';
import { esc, toast } from './utils.js';

const root = document.getElementById('view-ingredients');
const UNITS = [
  ['unidad', 'Por unidad (ej. panes, huevos, envases)'],
  ['g', 'Por gramos (ej. carne, café, queso)'],
  ['ml', 'Por mililitros (ej. leche, jarabes, salsas)'],
];
let items = [];
let editingId = null;

const unitShort = u => (u === 'unidad' ? 'und' : u);
const fmt = n => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });

export async function load() {
  editingId = null;
  const { data, error } = await supabase.from('ingredients').select('*').order('name');
  if (error) return toast(error.message, true);
  items = data;
  render();
}

function render() {
  const g = items.find(x => x.id === editingId);
  root.innerHTML = `
    <h2>Materia Prima e Ingredientes</h2>
    <p class="hint">Control de insumos base para las recetas. Cuando se vende un producto con receta, se descuentan automáticamente.</p>

    <form id="ing-form" class="card form-row">
      <div class="card-header-bar" style="width: 100%;">
        <span class="card-title">${g ? '✏️ Editando ingrediente' : '➕ Registrar nuevo insumo / ingrediente'}</span>
        ${g ? '<span class="badge badge-warning">Modo edición</span>' : ''}
      </div>

      <label>Nombre del ingrediente <input name="name" required value="${esc(g?.name)}" placeholder="Ej: Carne de res, Pan brioche..."></label>
      <label>Unidad de medida
        <select name="unit" ${g ? 'disabled' : ''}>
          ${UNITS.map(([v, label]) => `<option value="${v}" ${g?.unit === v ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
      <label>Stock actual en bodega <input name="stock" type="number" min="0" step="any" required value="${g?.stock ?? 0}"></label>
      <div style="display: flex; gap: 8px;">
        <button class="btn" type="submit">${g ? 'Guardar cambios' : 'Agregar ingrediente'}</button>
        ${g ? '<button class="btn-outline" type="button" data-action="cancel">Cancelar</button>' : ''}
      </div>
    </form>
    ${g ? '<p class="hint" style="color: var(--text-muted); font-size: 13px;">💡 La unidad de medida no se puede modificar porque las recetas dependen de ella. Si necesitas cambiarla, elimina el ingrediente y créalo nuevamente.</p>' : ''}

    <div class="card table-wrap">
      <table>
        <thead><tr><th>Ingrediente</th><th>Stock disponible</th><th>Ajuste / Reposición rápida</th><th style="text-align: right;">Acciones</th></tr></thead>
        <tbody>
          ${items.length === 0 ? '<tr><td colspan="4" class="empty-state">No hay ingredientes registrados. Registra el primero arriba.</td></tr>' : items.map(x => `
            <tr>
              <td><strong>${esc(x.name)}</strong></td>
              <td>
                <span class="stock-val ${Number(x.stock) === 0 ? 'out' : ''}" data-stock="${x.id}">
                  ${fmt(x.stock)} ${unitShort(x.unit)}
                </span>
              </td>
              <td>
                <div class="refill">
                  <input type="number" min="0" step="any" placeholder="Cant." data-refill="${x.id}">
                  <button type="button" class="btn-outline btn-sm" data-action="add" data-id="${x.id}" title="Sumar inventario">+ Sumar</button>
                  <button type="button" class="btn-outline btn-sm" data-action="sub" data-id="${x.id}" title="Restar inventario">− Restar</button>
                </div>
              </td>
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
  if (e.target.id !== 'ing-form') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const current = items.find(x => x.id === editingId);
  const row = {
    name: f.get('name').trim(),
    unit: current ? current.unit : f.get('unit'),
    stock: Number(f.get('stock')) || 0,
  };
  const { error } = editingId
    ? await supabase.from('ingredients').update(row).eq('id', editingId)
    : await supabase.from('ingredients').insert(row);
  if (error) {
    return toast(error.code === '23505' ? 'Ya existe un ingrediente con ese nombre' : error.message, true);
  }
  toast(editingId ? 'Ingrediente actualizado' : 'Ingrediente creado');
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
  } else if (action === 'add' || action === 'sub') {
    const input = root.querySelector(`input[data-refill="${id}"]`);
    const amount = Number(input.value);
    if (!(amount > 0)) return toast('Escribe una cantidad mayor a 0', true);
    const { data, error } = await supabase.rpc('adjust_ingredient_stock', {
      p_id: id,
      p_delta: action === 'add' ? amount : -amount,
    });
    if (error) return toast(error.message, true);
    const item = items.find(x => x.id === id);
    item.stock = data;
    const cell = root.querySelector(`td[data-stock="${id}"]`);
    cell.textContent = `${fmt(data)} ${unitShort(item.unit)}`;
    cell.classList.toggle('out', Number(data) === 0);
    input.value = '';
  } else if (action === 'delete') {
    const g = items.find(x => x.id === id);
    if (!confirm(`¿Borrar el ingrediente "${g?.name}"?`)) return;
    const { error } = await supabase.from('ingredients').delete().eq('id', id);
    if (error) {
      return toast(error.code === '23503'
        ? 'No se puede borrar: lo usan recetas de productos. Quítalo de esas recetas primero.'
        : error.message, true);
    }
    toast('Ingrediente borrado');
    load();
  }
});
