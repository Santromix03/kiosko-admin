// Escapa texto antes de meterlo en HTML (evita inyección de código desde la base de datos).
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function formatPrice(n) {
  return '$' + Number(n).toLocaleString('es-CO');
}

let toastTimer;
export function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}