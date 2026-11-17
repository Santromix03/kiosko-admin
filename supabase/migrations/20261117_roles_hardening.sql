-- =====================================================================
-- Roles y turnos — endurecimiento
-- Ejecutar DESPUÉS de 20261116_roles_shifts.sql. Es seguro repetirlo.
--
-- Qué hace:
--   1. Repara administradores indebidos (empleados que quedaron como admin).
--   2. get_shift_sales: ventas por turno calculadas en el servidor. Un empleado
--      solo ve las de SUS turnos (antes la app bajaba el reporte completo del día).
--   3. close_stale_shifts: cierra turnos que quedaron abiertos más de 14 horas.
--   4. start_shift: un turno cerrado NO se reabre al recargar la página con la misma sesión.
--   5. update_employee: activar/desactivar en una sola operación. Al desactivar cierra
--      el turno, bloquea la cuenta y borra sus sesiones.
--   6. link_employee: al reactivar una cuenta, le quita el bloqueo.
--
-- SUPUESTO: los pedidos están en public.orders con las columnas
--   ticket_number, created_at y total (las mismas que devuelve get_daily_report).
--   Si tu tabla se llama distinto, cambia el nombre en get_shift_sales (sección 2).
-- =====================================================================

-- ---------- 1. Reparación ----------
-- Un administrador nunca es empleado (link_employee ya lo impide). Si una ejecución repetida
-- de la primera versión de la migración promovió empleados, se corrige aquí.
delete from public.admins where user_id in (select id from public.employees);

-- ---------- Columnas nuevas ----------
alter table public.shifts add column if not exists session_id  text;
alter table public.shifts add column if not exists auto_closed boolean not null default false;

-- ---------- 3. Cierre automático de turnos olvidados ----------
-- (Sin parámetros a propósito: así nadie puede llamarla con "0 horas" y cerrar turnos ajenos.)
create or replace function public.close_stale_shifts()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  n integer;
begin
  update public.shifts
     set ended_at = started_at + interval '14 hours',
         auto_closed = true
   where ended_at is null
     and started_at < now() - interval '14 hours';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------- 4. start_shift ----------
create or replace function public.start_shift()
returns public.shifts
language plpgsql security definer set search_path = public
as $$
declare
  v public.shifts;
  v_sess text := auth.jwt() ->> 'session_id';
begin
  if not exists (select 1 from public.employees where id = auth.uid() and active) then
    raise exception 'Tu cuenta no es de un empleado activo';
  end if;

  perform public.close_stale_shifts();

  -- Ya tiene un turno abierto: se devuelve (y se asocia a esta sesión)
  select * into v from public.shifts
   where employee_id = auth.uid() and ended_at is null;
  if found then
    if v_sess is not null and v.session_id is distinct from v_sess then
      update public.shifts set session_id = v_sess where id = v.id returning * into v;
    end if;
    return v;
  end if;

  -- Una sesión = un turno. Si el turno de ESTA sesión ya terminó (lo cerró el administrador,
  -- o el sistema por duración máxima), no se abre otro solo al recargar la página.
  if v_sess is not null and exists (
    select 1 from public.shifts where employee_id = auth.uid() and session_id = v_sess
  ) then
    raise exception 'Tu turno ya terminó. Cierra sesión e inicia de nuevo para empezar otro.';
  end if;

  begin
    insert into public.shifts (employee_id, session_id)
    values (auth.uid(), v_sess) returning * into v;
  exception when unique_violation then
    select * into v from public.shifts
     where employee_id = auth.uid() and ended_at is null;
  end;
  return v;
end;
$$;

-- ---------- 2. Ventas por turno (en el servidor) ----------
create or replace function public.get_shift_sales(p_shift_ids bigint[])
returns table (shift_id bigint, ticket_number text, created_at timestamptz, total numeric)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if p_shift_ids is null or coalesce(array_length(p_shift_ids, 1), 0) = 0 then
    return;
  end if;
  if array_length(p_shift_ids, 1) > 500 then
    raise exception 'Demasiados turnos en una sola consulta (máximo 500)';
  end if;

  return query
    select s.id, o.ticket_number::text, o.created_at, o.total::numeric
      from public.shifts s
      join public.orders o
        on o.created_at >= s.started_at
       and o.created_at <= coalesce(s.ended_at, now())
     where s.id = any (p_shift_ids)
       and (public.is_admin() or s.employee_id = auth.uid())   -- un empleado solo ve lo suyo
     order by o.created_at desc;
end;
$$;

-- ---------- 5. Activar / desactivar empleado ----------
create or replace function public.update_employee(p_id uuid, p_name text, p_active boolean)
returns public.employees
language plpgsql security definer set search_path = public, auth
as $$
declare
  v public.employees;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede hacer esto';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'El nombre no puede estar vacío';
  end if;

  update public.employees
     set full_name = trim(p_name), active = p_active
   where id = p_id
   returning * into v;
  if not found then
    raise exception 'Empleado no encontrado';
  end if;

  if not p_active then
    -- cierra su turno, bloquea la cuenta y borra sus sesiones: ya no puede seguir entrando
    update public.shifts
       set ended_at = now(), ended_by = auth.uid()
     where employee_id = p_id and ended_at is null;
    update auth.users set banned_until = now() + interval '100 years' where id = p_id;
    begin
      delete from auth.sessions where user_id = p_id;
    exception when others then
      null;  -- si esta versión de Supabase no permite borrar sesiones, el bloqueo ya basta
    end;
  else
    update auth.users set banned_until = null where id = p_id;
  end if;

  return v;
end;
$$;

-- ---------- 6. link_employee (reactiva y desbloquea) ----------
create or replace function public.link_employee(p_email text, p_name text)
returns public.employees
language plpgsql security definer set search_path = public, auth
as $$
declare
  uid uuid;
  v public.employees;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede hacer esto';
  end if;

  select id into uid from auth.users
   where lower(email) = lower(trim(p_email));
  if uid is null then
    raise exception 'No existe una cuenta con ese correo en Supabase (Authentication → Users)';
  end if;
  if exists (select 1 from public.admins where user_id = uid) then
    raise exception 'Esa cuenta es de un administrador, no puede ser empleado';
  end if;

  insert into public.employees (id, full_name, email)
  values (uid, trim(p_name), lower(trim(p_email)))
  on conflict (id) do update
    set full_name = excluded.full_name, active = true
  returning * into v;

  update auth.users set banned_until = null where id = uid and banned_until is not null;
  return v;
end;
$$;

-- ---------- Permisos ----------
revoke all on function public.close_stale_shifts()                  from public, anon;
revoke all on function public.get_shift_sales(bigint[])             from public, anon;
revoke all on function public.update_employee(uuid, text, boolean)  from public, anon;
grant execute on function public.close_stale_shifts()                 to authenticated;
grant execute on function public.get_shift_sales(bigint[])            to authenticated;
grant execute on function public.update_employee(uuid, text, boolean) to authenticated;

-- =====================================================================
-- (YA CUBIERTO por 20261119_security_fixes.sql, que envuelve get_daily_report, get_sales_range
-- y v_daily_sales con is_admin() sin necesitar su código. Lo de abajo es solo el método manual.)
-- PENDIENTE MANUAL (el código de estos objetos no venía en el proyecto):
-- Los empleados también son usuarios con sesión, así que hoy pueden llamar
-- directamente a las funciones/vistas de REPORTES y ver las ventas de todo el
-- negocio. La app ya no lo usa para ellos, pero hay que cerrarlo en la base:
--
--   * En get_daily_report(date) y get_sales_range(date, date), agrega al inicio:
--         if not public.is_admin() then
--           raise exception 'Solo administradores';
--         end if;
--   * En la vista v_daily_sales, agrega al final de su definición:
--         where public.is_admin()
--     (y si la vista no es security_invoker, esto es lo que la protege).
-- =====================================================================
