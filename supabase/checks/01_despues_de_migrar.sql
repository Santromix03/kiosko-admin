-- =====================================================================
-- VERIFICACIONES POSTERIORES — solo lectura.
-- Pégalas en SQL Editor DESPUÉS de ejecutar 20261116 → 20261119.
-- =====================================================================

-- 1) Administradores actuales (deben ser SOLO personas de confianza)
select u.email from public.admins a join auth.users u on u.id = a.user_id;

-- 2) Nadie es admin y empleado a la vez (debe devolver 0 filas)
select e.email from public.employees e join public.admins a on a.user_id = e.id;

-- 3) ¿Qué funciones quedaron protegidas? Debe haber una _raw_* por cada función envuelta,
--    y las _raw_* NO deben tener permisos para anon ni authenticated.
select proname, prosecdef, proacl
from pg_proc
where pronamespace = 'public'::regnamespace
  and (proname like '\_raw\_%' or proname in ('get_daily_report','get_sales_range'))
order by proname;

-- 4) ¿Quién puede leer cada tabla del menú como anon? categories y addons con "active";
--    ingredients y recipe_items sin política de lectura para anon.
select tablename, policyname, roles, cmd, qual from pg_policies
where schemaname = 'public'
  and tablename in ('categories','addons','ingredients','recipe_items','products','recipe_item_periods','recipe_change_log')
order by tablename, policyname;

-- 5) Índice de pedidos
select indexname from pg_indexes where schemaname='public' and indexname = 'orders_created_at_idx';

-- =====================================================================
-- PRUEBA MANUAL (importante): con el kiosko (clave anon) confirma que
--   · el menú carga, y las categorías/adiciones ocultas NO aparecen
--   · se puede hacer un pedido y el stock baja
--   · en el panel, Reportes, Productos, Ingredientes y Roles siguen funcionando como admin
--   · un empleado NO puede abrir Reportes (debe fallar con "Solo administradores")
-- =====================================================================
