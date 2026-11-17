// La clave "anon"/"publishable" es pública por diseño: la seguridad real está en las políticas RLS de Supabase.
// NUNCA pongas aquí la clave service_role.
export const SUPABASE_URL = 'https://xpvipclordobiguqjihh.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_hwaKmUIMtRWv9iBo-rErFQ_o6EuN_lc';
export const IMAGES_BUCKET = 'product-images';

// true  = el panel EXIGE la migración de roles: si falta, nadie entra (seguro, recomendado).
// false = solo mientras migras: sin la migración, todas las cuentas entran como administradoras.
export const ROLES_REQUIRED = true;
