-- =====================================================================
-- VERIFICACIONES PREVIAS — solo lectura, no modifican nada.
-- Pégalas en Supabase → SQL Editor ANTES de ejecutar las migraciones.
-- (El editor muestra solo el resultado de la última consulta: corre una por una.)
-- =====================================================================

-- 1) ¿Quién va a quedar como administrador? La migración 20261116 convierte en admin
--    a TODAS las cuentas que existan en este momento. Borra de Authentication → Users
--    las que no sean tuyas ANTES de migrar.
select id, email, created_at, last_sign_in_at from auth.users order by created_at;

-- 2) ¿Estas funciones son security definer? (prosecdef = true)
--    create_order y apply_direct_stock DEBEN ser true: si no, el kiosko no podrá
--    descontar stock cuando 20261118 deje las tablas solo para administradores.
select proname, prosecdef, proacl
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('create_order','apply_direct_stock','check_addon_category',
                  'adjust_addon_stock','adjust_ingredient_stock','set_product_recipe',
                  'archive_ingredient','restore_ingredient','verificar_empleado',
                  'get_daily_report','get_sales_range')
order by proname;

-- 3) ¿menu_products usa los permisos de quien consulta?
--    Si reloptions contiene security_invoker=true, 20261119 NO cierra ingredients/recipe_items.
select relname, relkind, reloptions from pg_class
where relname in ('menu_products','v_daily_sales') and relnamespace = 'public'::regnamespace;

-- 4) ¿Qué tablas tienen RLS? Todas las de datos sensibles deben salir en true
--    (orders, order_items, empleados, etc.).
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;

-- 5) ¿Qué políticas existen hoy? Revisa que anon NO pueda leer orders ni empleados.
select tablename, policyname, roles, cmd, qual from pg_policies
where schemaname = 'public' order by tablename, policyname;

-- 6) Columnas de recipe_items: si tiene valid_to, la tabla guarda también periodos cerrados
--    (el panel ya los ignora, pero create_order también debe ignorarlos).
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'recipe_items' order by ordinal_position;

-- 7) ¿empleados.password guarda un HASH? Debe empezar por $2a$ o $2b$ (bcrypt). Si ves texto legible, cámbialo.
select email, left(password, 4) as inicio_password from public.empleados;
