-- =====================================================================
-- Roles y turnos de empleados
-- Ejecutar UNA vez en Supabase → SQL Editor (es seguro repetirlo).
--
-- Crea:
--   admins     quiénes son administradores
--   employees  empleados (cada uno es un usuario de Supabase Auth)
--   shifts     turnos (entrada / salida)
-- y las funciones: my_role, is_admin, start_shift, end_shift, link_employee.
-- =====================================================================

-- ---------- Administradores ----------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- Empleados ----------
create table if not exists public.employees (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null check (length(trim(full_name)) > 0),
  email      text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Las cuentas que existen HOY se consideran administradoras (son las que ya usan el panel).
-- Esto se hace SOLO la primera vez (cuando `admins` está vacía) y nunca incluye a un
-- empleado: así volver a ejecutar este archivo NO convierte a nadie en administrador.
do $$
begin
  if not exists (select 1 from public.admins) then
    insert into public.admins (user_id)
    select u.id from auth.users u
     where not exists (select 1 from public.employees e where e.id = u.id)
    on conflict do nothing;
  end if;
end $$;

-- ---------- Turnos ----------
create table if not exists public.shifts (
  id          bigint generated always as identity primary key,
  employee_id uuid not null references public.employees(id) on delete restrict,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  ended_by    uuid references auth.users(id),
  constraint shifts_end_after_start check (ended_at is null or ended_at >= started_at)
);

-- Un empleado solo puede tener UN turno abierto a la vez
create unique index if not exists shifts_one_open_per_employee
  on public.shifts (employee_id) where ended_at is null;
create index if not exists shifts_started_at_idx
  on public.shifts (started_at desc);

-- ---------- Funciones ----------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- 'admin' | 'employee' | 'inactive' | null (sin acceso)
create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when exists (select 1 from public.admins where user_id = auth.uid()) then 'admin'
    when exists (select 1 from public.employees where id = auth.uid() and active) then 'employee'
    when exists (select 1 from public.employees where id = auth.uid()) then 'inactive'
    else null
  end;
$$;

-- El empleado entra: abre su turno (si ya tenía uno abierto, lo devuelve)
create or replace function public.start_shift()
returns public.shifts
language plpgsql security definer set search_path = public
as $$
declare
  v public.shifts;
begin
  if not exists (select 1 from public.employees where id = auth.uid() and active) then
    raise exception 'Tu cuenta no es de un empleado activo';
  end if;

  select * into v from public.shifts
   where employee_id = auth.uid() and ended_at is null;
  if found then
    return v;
  end if;

  begin
    insert into public.shifts (employee_id) values (auth.uid()) returning * into v;
  exception when unique_violation then
    select * into v from public.shifts
     where employee_id = auth.uid() and ended_at is null;
  end;
  return v;
end;
$$;

-- Termina el turno. El empleado cierra el suyo; un admin puede cerrar el de cualquiera.
create or replace function public.end_shift(p_employee uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  target uuid;
begin
  if p_employee is null or p_employee = auth.uid() then
    target := auth.uid();
  elsif public.is_admin() then
    target := p_employee;
  else
    raise exception 'No tienes permiso para cerrar el turno de otra persona';
  end if;

  update public.shifts
     set ended_at = now(), ended_by = auth.uid()
   where employee_id = target and ended_at is null;
end;
$$;

-- Vincula como empleado una cuenta que ya existe en Supabase Auth
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
  return v;
end;
$$;

-- Solo usuarios con sesión pueden llamar estas funciones
revoke all on function public.is_admin()                  from public, anon;
revoke all on function public.my_role()                   from public, anon;
revoke all on function public.start_shift()               from public, anon;
revoke all on function public.end_shift(uuid)             from public, anon;
revoke all on function public.link_employee(text, text)   from public, anon;
grant execute on function public.is_admin()               to authenticated;
grant execute on function public.my_role()                to authenticated;
grant execute on function public.start_shift()            to authenticated;
grant execute on function public.end_shift(uuid)          to authenticated;
grant execute on function public.link_employee(text, text) to authenticated;

-- ---------- Seguridad por filas (RLS) ----------
alter table public.admins    enable row level security;   -- sin políticas: nadie la lee desde el navegador
alter table public.employees enable row level security;
alter table public.shifts    enable row level security;

drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated
  using (public.is_admin() or id = auth.uid());

drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Los turnos solo se leen desde el navegador; se crean/cierran con las funciones de arriba
drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select to authenticated
  using (public.is_admin() or employee_id = auth.uid());

-- =====================================================================
-- OPCIONAL pero recomendado: que SOLO los administradores puedan
-- modificar el menú (categorías, productos, ingredientes, adiciones).
-- Hoy esas tablas probablemente aceptan a cualquier usuario con sesión,
-- y los empleados también tendrán sesión.
--
-- Eso lo hace el archivo 20261118_menu_rls.sql (léelo antes de ejecutarlo,
-- porque depende de cómo se conecta la app del kiosko). Plantilla por tabla:
--
--   drop policy "<nombre de la política actual>" on public.products;
--   create policy products_read  on public.products for select to authenticated using (true);
--   create policy products_write on public.products for all    to authenticated
--     using (public.is_admin()) with check (public.is_admin());
--
-- Antes de aplicarlo, confirma que la app del kiosko lee con la clave
-- anon o con una cuenta que esté en la tabla admins.
-- =====================================================================
