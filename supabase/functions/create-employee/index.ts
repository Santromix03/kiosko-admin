// Crea la cuenta de un empleado desde el servidor, con permisos de administrador.
// Así NO hace falta dejar abiertos los registros públicos ni desactivar «Confirm email».
//
// Despliegue:   supabase functions deploy create-employee
// (SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las inyecta Supabase solas.)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'No autorizado' }, 401);

  // 1. Solo un administrador puede crear empleados (se verifica con SU sesión)
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminError } = await caller.rpc('is_admin');
  if (adminError || isAdmin !== true) {
    return json({ error: 'Solo un administrador puede crear empleados' }, 403);
  }

  // 2. Validar datos
  let body: { full_name?: unknown; email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Datos inválidos' }, 400);
  }
  const fullName = String(body.full_name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  if (!fullName || fullName.length > 120) return json({ error: 'El nombre es obligatorio (máximo 120 caracteres)' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'El correo no es válido' }, 400);
  if (password.length < 8) return json({ error: 'La contraseña debe tener mínimo 8 caracteres' }, 400);

  // 3. Crear la cuenta (ya confirmada) y el empleado
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data?.user) {
    const message = error?.message ?? 'No se pudo crear la cuenta';
    return json({ error: message }, /already|registered|exists/i.test(message) ? 409 : 400);
  }

  const { error: insertError } = await admin
    .from('employees')
    .insert({ id: data.user.id, full_name: fullName, email });

  if (insertError) {
    // Si no se pudo registrar como empleado, se deshace la cuenta para no dejar una huérfana
    await admin.auth.admin.deleteUser(data.user.id);
    return json({ error: 'No se pudo registrar al empleado: ' + insertError.message }, 500);
  }

  return json({ ok: true, id: data.user.id });
});
