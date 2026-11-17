-- =====================================================================
-- Seguridad del menú: SOLO los administradores pueden modificar
-- categorías, productos, ingredientes, adiciones y recetas, ni fotos.
-- Ejecutar DESPUÉS de 20261116 y 20261117.
--
-- ⚠️ EJECÚTALO JUNTO CON 20261119_security_fixes.sql: esa migración corrige que aquí las
-- categorías/adiciones ocultas quedan públicas y que ingredients/recipe_items son legibles por anon.
-- Antes corre supabase/checks/00_antes_de_migrar.sql.
--
-- ⚠️ LÉELO ANTES DE EJECUTAR. Este archivo BORRA las políticas actuales de esas
-- tablas y deja estas dos (se puede repetir sin problema):
--   <tabla>_read         → cualquiera (anon o con sesión) puede LEER
--   <tabla>_admin_write  → solo un administrador puede crear/editar/borrar
--
-- Qué puede romper:
--   * La app del kiosko, si ESCRIBE en estas tablas directamente (por ejemplo, si
--     create_order descuenta stock y NO es "security definer", o si usa una cuenta
--     que no está en la tabla admins). Si descuenta stock dentro de una función
--     security definer, no pasa nada.
--   * Si quieres que el stock de ingredientes no sea público, cambia
--     "to anon, authenticated" por "to authenticated" en la lectura de
--     ingredients y recipe_items (solo si el kiosko no necesita leerlos como anon).
--   * Las tablas del historial de recetas (migración 20261112) no se tocan aquí:
--     revísalas y aplícales el mismo patrón.
-- =====================================================================

do $$
declare
  t text;
  pol record;
begin
  foreach t in array array['categories','products','ingredients','addons','addon_categories','recipe_items']
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

    execute format('create policy %I on public.%I for select to anon, authenticated using (true)',
                   t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
                   t || '_admin_write', t);
  end loop;
end $$;

-- ---------- Fotos de productos (Storage) ----------
-- Se quitan las políticas que mencionan el bucket y se dejan: lectura pública,
-- y subir/cambiar/borrar solo administradores.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and (coalesce(qual, '') like '%product-images%' or coalesce(with_check, '') like '%product-images%')
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
  end loop;
end $$;

drop policy if exists product_images_read         on storage.objects;
drop policy if exists product_images_admin_insert on storage.objects;
drop policy if exists product_images_admin_update on storage.objects;
drop policy if exists product_images_admin_delete on storage.objects;

create policy product_images_read on storage.objects
  for select to public using (bucket_id = 'product-images');
create policy product_images_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images' and public.is_admin());
create policy product_images_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());
create policy product_images_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'product-images' and public.is_admin());
