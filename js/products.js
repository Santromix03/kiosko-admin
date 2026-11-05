import { supabase } from './supabase.js';
import { IMAGES_BUCKET } from './config.js';
import { esc, formatPrice, toast } from './utils.js';

const root = document.getElementById('view-products');
let categories = [];
let items = [];
let editingId = null;

export async function load() {
  editingId = null;
  const [cats, prods] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('products').select('*').order('category_id').order('sort_order'),
  ]);
  const err = cats.error || prods.error;
  if (err) return toast(err.message, true);
  categories = cats.data;
  items = prods.data;
  render();
}

function render() {
  if (!categories.length) {
    root.innerHTML = '<h2>Productos</h2><p>Primero crea al menos una categoría.</p>';
    return;
  }
  const p = items.find(x => x.id === editingId);
  const catName = id => categories.find(c => c.id === id)?.name ?? '—';

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
      <label class="check"><input name="available" type="checkbox" ${(p?.available ?? true) ? 'checked' : ''}> Visible en el menú</label>
      <div class="wide">
        <button class="btn" type="submit">${p ? 'Guardar cambios' : 'Agregar producto'}</button>
        ${p ? '<button class="btn-outline" type="button" data-action="cancel">Cancelar</button>' : ''}
      </div>
    </form>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Foto</th><th>Nombre</th><th>Categoría</th><th>Precio</th><th>Visible</th><th></th></tr></thead>
        <tbody>
          ${items.map(x => `
            <tr>
              <td>${x.image_url ? `<img class="thumb" src="${esc(x.image_url)}" alt="">` : '—'}</td>
              <td>${esc(x.name)}</td>
              <td>${esc(catName(x.category_id))}</td>
              <td>${formatPrice(x.price)}</td>
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
// Reduce la foto a máx. 800 px y la convierte a JPG antes de subirla (la Pi tiene solo 2 GB de RAM).
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
      ctx.fillStyle = '#fff';                       // PNG con transparencia -> fondo blanco
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))),
        'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('El archivo no es una imagen válida'));
    img.src = url;
  });
}

// Cada foto se sube con nombre único, así la app del kiosko detecta que cambió y la vuelve a descargar.
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
  await supabase.storage.from(IMAGES_BUCKET).remove([url.slice(i + marker.length)]); // si falla, no pasa nada
}

// ---------- Eventos ----------
root.addEventListener('submit', async e => {
  if (e.target.id !== 'prod-form') return;
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  const submitBtn = form.querySelector('button[type=submit]');
  submitBtn.disabled = true;

  try {
    const current = items.find(x => x.id === editingId);
    const row = {
      category_id: Number(f.get('category_id')),
      name: f.get('name').trim(),
      description: f.get('description').trim() || null,
      price: parseInt(f.get('price'), 10),
      sort_order: parseInt(f.get('sort_order'), 10) || 0,
      available: f.get('available') === 'on',
    };
    const file = f.get('image');
    const hasNewImage = file && file.size > 0;
    if (hasNewImage) row.image_url = await uploadImage(file);

    const { error } = editingId
      ? await supabase.from('products').update(row).eq('id', editingId)
      : await supabase.from('products').insert(row);
    if (error) throw error;

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
  const id = Number(btn.dataset.id);

  if (btn.dataset.action === 'edit') {
    editingId = id;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (btn.dataset.action === 'cancel') {
    editingId = null;
    render();
  } else if (btn.dataset.action === 'delete') {
    const p = items.find(x => x.id === id);
    if (!confirm(`¿Borrar "${p?.name}"?`)) return;
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) return toast(error.message, true);
    if (p?.image_url) await removeImage(p.image_url);
    toast('Producto borrado');
    load();
  }
});