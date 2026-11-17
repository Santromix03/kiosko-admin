import { supabase } from './supabase.js';
import * as categories from './categories.js';
import * as products from './products.js';
import * as addons from './addons.js';
import * as ingredients from './ingredients.js';
import * as reports from './reports.js';
import * as roles from './roles.js';
import * as myshift from './myshift.js';
import { isMissingFunction } from './history.js';
import { ROLES_REQUIRED } from './config.js';

const views = { categories, products, ingredients, addons, reports, roles };

const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');

const myshiftView = document.getElementById('view-myshift');

let currentView = null;
let dirty = false;   // hay un formulario con cambios sin guardar

// Al cerrar sesión se borran los datos de pantalla y de memoria: no deben quedar para el siguiente usuario.
function clearViews() {
  for (const key of Object.keys(views)) {
    document.getElementById(`view-${key}`).innerHTML = '';
  }
  myshiftView.innerHTML = '';
  roles.reset();
  currentView = null;
  dirty = false;
}

function showLogin() {
  myshift.stop();
  clearViews();
  loginView.classList.remove('hidden');
  appView.classList.add('hidden');
}

// El administrador ve el menú completo; el empleado solo su turno
function setAdminChrome(isAdmin) {
  document.getElementById('nav').classList.toggle('hidden', !isAdmin);
  document.getElementById('logout').classList.toggle('hidden', !isAdmin);
}

function showApp() {
  myshift.stop();
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  myshiftView.classList.add('hidden');
  setAdminChrome(true);
  currentView = null;
  openView('categories');
}

function showEmployee() {
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  setAdminChrome(false);
  for (const key of Object.keys(views)) {
    document.getElementById(`view-${key}`).classList.add('hidden');
  }
  myshiftView.classList.remove('hidden');
  return myshift.start();
}

async function rejectLogin(message) {
  await supabase.auth.signOut();
  document.getElementById('login-error').textContent = message;
}

// Según el rol de la cuenta: administrador → panel; empleado → su turno (se abre solo)
async function enter() {
  const { data: role, error } = await supabase.rpc('my_role');
  // Con ROLES_REQUIRED = true (por defecto), si falta la migración nadie entra: nunca se
  // deja pasar a todos como administradores. Con false (solo mientras migras) se permite.
  const missing = !!error && isMissingFunction(error);
  if (error && !(missing && !ROLES_REQUIRED)) {
    return rejectLogin(missing
      ? 'Falta aplicar la migración de roles en Supabase (carpeta supabase/migrations).'
      : 'No se pudo verificar tu cuenta: ' + error.message);
  }
  const kind = error ? 'admin' : role;   // solo llega aquí con error si ROLES_REQUIRED es false
  if (kind === 'admin') return showApp();
  if (kind === 'employee') return showEmployee();
  return rejectLogin(kind === 'inactive'
    ? 'Tu cuenta de empleado está desactivada. Habla con el administrador.'
    : 'Esta cuenta no tiene acceso al panel.');
}

function openView(name) {
  if (!views[name]) {
    console.error('Vista no registrada:', name, '| vistas disponibles:', Object.keys(views));
    return;
  }
  if (currentView && name !== currentView && dirty
      && !confirm('Tienes cambios sin guardar en este formulario. ¿Salir sin guardar?')) {
    return;
  }
  dirty = false;
  currentView = name;
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
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const errorEl = document.getElementById('login-error');

  if (submitBtn) {
    submitBtn.disabled = true;
  }
  errorEl.textContent = '';

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const wrongCredentials = error.code === 'invalid_credentials'
      || /invalid login credentials/i.test(error.message ?? '');
    errorEl.textContent = wrongCredentials
      ? 'Correo o contraseña incorrectos'
      : error.status === 429
        ? 'Demasiados intentos. Espera un momento e inténtalo de nuevo.'
        : 'No se pudo iniciar sesión: ' + (error.message || 'revisa tu conexión');
  }
  if (submitBtn) {
    submitBtn.disabled = false;
  }
});

document.getElementById('logout').addEventListener('click', () => supabase.auth.signOut());

// Aviso de cambios sin guardar al cambiar de pestaña
const GUARDED_FORMS = new Set(['cat-form', 'prod-form', 'addon-form', 'ing-form', 'emp-form']);
document.addEventListener('input', e => {
  const form = e.target.closest?.('form');
  if (form && GUARDED_FORMS.has(form.id)) dirty = true;
});
document.addEventListener('submit', e => {
  if (GUARDED_FORMS.has(e.target.id)) dirty = false;
}, true);
document.addEventListener('click', e => {
  if (e.target.closest?.('[data-action="edit"], [data-action="cancel"]')) dirty = false;
}, true);

// Reacciona solo cuando cambia el estado (entrar/salir), no en cada refresco de sesión.
let isLoggedIn = null;
supabase.auth.onAuthStateChange((_event, session) => {
  window.__adminAuthSeen = true;   // lo lee js/boot-check.js
  const now = !!session;
  if (now === isLoggedIn) return;
  isLoggedIn = now;
  // setTimeout: Supabase recomienda no hacer llamadas a su API directamente dentro de este callback
  setTimeout(() => (now ? enter() : showLogin()), 0);
});

window.__adminLoaded = true;   // el módulo cargó completo (lo lee js/boot-check.js)
