-- =====================================================================
-- Arreglos de seguridad posteriores a 20261118_menu_rls.sql
-- Ejecutar DESPUÉS de 20261116, 20261117 y 20261118 (de preferencia en la
-- misma sesión que la 20261118). Se puede repetir sin problema.
--
-- Qué hace:
--   1. Categorías y adiciones: el PÚBLICO (kiosko) solo lee lo activo.
--      (20261118 las dejaba todas visibles: las ocultas reaparecerían.)
--   2. Ingredientes y recetas: dejan de ser públicos (solo administradores),
--      SOLO si la vista menu_products no depende de los permisos de quien consulta.
--   3. Reportes, stock, recetas e historial: solo administradores, también
--      DENTRO de la función (antes un empleado o la clave anon podían llamarlas).
--   4. v_daily_sales: solo administradores.
--   5. Índice en orders(created_at) para las ventas por turno.
--   6. Tablas de historial de recetas (recipe_item_periods, recipe_change_log): solo administradores.
--
-- Cómo protege las funciones sin conocer su código: renombra la original a
-- _raw_<nombre> (sin acceso desde el navegador) y crea en su lugar una función
-- con el nombre y los parámetros de siempre que primero exige is_admin().
-- La app no cambia.
--
-- ⚠️ NO SE PROBÓ contra una base real. Corre antes
--    supabase/checks/00_antes_de_migrar.sql y después 01_despues_de_migrar.sql.
-- =====================================================================

-- ---------- 1. El público solo ve lo activo ----------
do $$
begin
  if to_regclass('public.categories') is not null then
    drop policy if exists categories_read on public.categories;
    create policy categories_read on public.categories
      for select to anon, authenticated using (active);
  end if;

  if to_regclass('public.addons') is not null then
    drop policy if exists addons_read on public.addons;
    create policy addons_read on public.addons
      for select to anon, authenticated using (active);
  end if;
  -- El administrador sigue viendo TODO: la política *_admin_write (for all) también cubre la lectura.
end $$;

-- ---------- 2. Ingredientes y recetas: no públicos ----------
do $$
declare
  v_oid     oid := to_regclass('public.menu_products');
  v_invoker boolean;
begin
  if v_oid is null then
    raise notice 'No existe la vista menu_products: no se tocan las políticas de ingredients ni recipe_items.';
    return;
  end if;

  select coalesce(c.reloptions::text[] && array['security_invoker=true', 'security_invoker=on'], false)
    into v_invoker
    from pg_class c where c.oid = v_oid;

  if v_invoker then
    raise notice 'menu_products usa los permisos de quien consulta (security_invoker): ingredients y recipe_items se dejan públicos para no romper el kiosko.';
    return;
  end if;

  if to_regclass('public.ingredients') is not null then
    drop policy if exists ingredients_read on public.ingredients;
  end if;
  if to_regclass('public.recipe_items') is not null then
    drop policy if exists recipe_items_read on public.recipe_items;
  end if;
  raise notice 'ingredients y recipe_items quedaron solo para administradores.';
end $$;

-- ---------- 3. Funciones solo para administradores ----------
-- Auxiliar (se borra al final de este archivo).
create or replace function public._guard_admin_fn(p_name text)
returns void
language plpgsql
as $g$
declare
  r        record;
  v_ident  text;   -- solo los TIPOS de entrada:  integer, numeric
  v_full   text;   -- argumentos con defaults
  v_call   text;   -- p_id => p_id, p_delta => p_delta
  v_ret    text;
  v_body   text;
  v_vol    text;
  v_raw    text := '_raw_' || p_name;
  v_i      int;
  v_mode   "char";
  v_name   text;
  v_clash  text;
begin
  for r in
    select p.*
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = p_name
       and p.prokind = 'f'
  loop
    v_ident := oidvectortypes(r.proargtypes);
    v_full  := pg_get_function_arguments(r.oid);
    v_ret   := pg_get_function_result(r.oid);

    -- Si create_order / triggers / login del kiosko usan esta función por dentro, NO se toca:
    -- ellos corren como anon y el chequeo de administrador los rompería.
    select string_agg(k.proname, ', ') into v_clash
      from pg_proc k
     where k.pronamespace = 'public'::regnamespace
       and k.proname in ('create_order', 'apply_direct_stock', 'check_addon_category', 'verificar_empleado')
       and k.prokind = 'f'
       and position(p_name in pg_get_functiondef(k.oid)) > 0;
    if v_clash is not null then
      raise notice 'OMITIDA %(%): la usa %', p_name, v_ident, v_clash;
      continue;
    end if;

    -- Parámetros de entrada con nombre (con OUT/INOUT/VARIADIC no se envuelve)
    v_call := '';
    if r.proargmodes is not null and exists (
         select 1 from unnest(r.proargmodes) m where m in ('o', 'b', 'v')) then
      raise notice 'OMITIDA %(%): tiene parámetros OUT/INOUT/VARIADIC', p_name, v_ident;
      continue;
    end if;
    if r.pronargs > 0 and r.proargnames is null then
      raise notice 'OMITIDA %(%): sus parámetros no tienen nombre', p_name, v_ident;
      continue;
    end if;
    for v_i in 1 .. coalesce(array_length(r.proargnames, 1), 0) loop
      v_mode := coalesce(r.proargmodes[v_i], 'i');
      if v_mode = 'i' then
        v_name := r.proargnames[v_i];
        if v_name is null or v_name = '' then
          raise notice 'OMITIDA %(%): parámetro sin nombre', p_name, v_ident;
          v_call := null;
          exit;
        end if;
        v_call := v_call || case when v_call = '' then '' else ', ' end
                  || quote_ident(v_name) || ' => ' || quote_ident(v_name);
      end if;
    end loop;
    if v_call is null then continue; end if;

    -- La original pasa a _raw_<nombre>
    if not exists (
         select 1 from pg_proc x
          where x.pronamespace = 'public'::regnamespace
            and x.proname = v_raw
            and x.proargtypes = r.proargtypes) then
      execute format('alter function public.%I(%s) rename to %I', p_name, v_ident, v_raw);
    end if;
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', v_raw, v_ident);

    v_vol := case r.provolatile when 'v' then 'volatile' else 'stable' end;
    v_body := case
      when v_ret = 'void' then format('perform public.%I(%s);', v_raw, v_call)
      when r.proretset     then format('return query select * from public.%I(%s);', v_raw, v_call)
      else                      format('return public.%I(%s);', v_raw, v_call)
    end;

    execute format($f$
      create or replace function public.%1$I(%2$s)
      returns %3$s
      language plpgsql %4$s security definer set search_path = public
      as $w$
      begin
        if not public.is_admin() then
          raise exception 'Solo administradores';
        end if;
        %5$s
      end;
      $w$
    $f$, p_name, v_full, v_ret, v_vol, v_body);

    execute format('revoke all on function public.%I(%s) from public, anon', p_name, v_ident);
    execute format('grant execute on function public.%I(%s) to authenticated', p_name, v_ident);
    raise notice 'PROTEGIDA %(%)', p_name, v_ident;
  end loop;
end;
$g$;

select public._guard_admin_fn(n) from unnest(array[
  'get_daily_report', 'get_sales_range',
  'adjust_addon_stock', 'adjust_ingredient_stock',
  'set_product_recipe', 'archive_ingredient', 'restore_ingredient',
  'get_product_recipe_history', 'get_recipe_at', 'get_ingredient_usage'
]) as n;

drop function public._guard_admin_fn(text);

-- Funciones que solo usa el panel: cerradas para la clave anon (el kiosko solo usa create_order y verificar_empleado)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'recipe_history_status'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ---------- 4. Vista de ventas diarias ----------
do $$
declare
  v_kind "char";
begin
  select c.relkind into v_kind from pg_class c where c.oid = to_regclass('public.v_daily_sales');

  if v_kind is not null and v_kind <> 'v' then
    raise notice 'v_daily_sales no es una vista normal (relkind=%): protégela a mano.', v_kind;
    return;
  end if;

  if v_kind = 'v' and to_regclass('public.v_daily_sales_raw') is null then
    alter view public.v_daily_sales rename to v_daily_sales_raw;
  end if;

  if to_regclass('public.v_daily_sales_raw') is not null then
    revoke all on public.v_daily_sales_raw from public, anon, authenticated;
    create or replace view public.v_daily_sales as
      select * from public.v_daily_sales_raw where public.is_admin();
    revoke all on public.v_daily_sales from public, anon;
    grant select on public.v_daily_sales to authenticated;
    raise notice 'v_daily_sales protegida.';
  else
    raise notice 'No existe v_daily_sales: nada que proteger.';
  end if;
end $$;

-- ---------- 5. Rendimiento ----------
do $$
begin
  if to_regclass('public.orders') is not null then
    create index if not exists orders_created_at_idx on public.orders (created_at);
  end if;
end $$;

-- ---------- 6. Historial de recetas: solo administradores ----------
-- Guardan quién cambió cada receta (correos incluidos). Las funciones de historial ya corren
-- con permisos de dueño (sección 3), así que siguen funcionando.
do $$
declare
  t   text;
  pol record;
begin
  foreach t in array array['recipe_item_periods', 'recipe_change_log']
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'Tabla % no existe, se omite', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('revoke all on public.%I from anon', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
                   t || '_admin_only', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
