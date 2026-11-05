import { supabase } from './supabase.js';
import * as categories from './categories.js';
import * as products from './products.js';

// Para agregar una sección: crea js/<nombre>.js con un export `load()`,
// agrégala aquí, y suma su <section id="view-<nombre>"> y su botón en index.html.
const views = { categories, products };

const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');

function showLogin() {
  loginView.classList.remove('hidden');
  appView.classList.add('hidden');
}

function showApp() {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  openView('categories');
}

function openView(name) {
  document.querySelectorAll('#nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  for (const key of Object.keys(views)) {
    document.getElementById(`view-${key}`).classList.toggle('hidden', key !== name);
  }
  views[name].load();
}

document.getElementById('nav').addEventListener('click', e => {
  const btn = e.target.closest('button[data-view]');
  if (btn) openView(btn.dataset.view);
});

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  document.getElementById('login-error').textContent =
    error ? 'Correo o contraseña incorrectos' : '';
});

document.getElementById('logout').addEventListener('click', () => supabase.auth.signOut());

// Reacciona solo cuando cambia el estado (entrar/salir), no en cada refresco de sesión.
let isLoggedIn = null;
supabase.auth.onAuthStateChange((_event, session) => {
  const now = !!session;
  if (now === isLoggedIn) return;
  isLoggedIn = now;
  // setTimeout: Supabase recomienda no hacer llamadas a su API directamente dentro de este callback
  setTimeout(() => (now ? showApp() : showLogin()), 0);
});