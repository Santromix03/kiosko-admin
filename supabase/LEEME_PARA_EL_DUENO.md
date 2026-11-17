# Para quien administra el proyecto de Supabase

Este panel necesita cambios en la base de datos que **solo puede hacer quien tenga acceso a Supabase**
(Dashboard → SQL Editor). Quien desarrolló el panel no tiene ese acceso y no pudo probar nada contra la base.

## Antes de empezar
1. Haz un respaldo (Database → Backups) o prueba primero en un proyecto copia.
2. Authentication → Providers → Email → desactiva *Allow new users to sign up*.
3. Authentication → Users: borra las cuentas que no sean tuyas (la migración de roles hace administrador a todas las que existan).

## Paso 1 · Devuelve esta información (no modifica nada)
Corre en el SQL Editor y envía los resultados de `supabase/checks/00_antes_de_migrar.sql` (una consulta por vez) y, además, el código de estas funciones:

```sql
select pg_get_functiondef(oid) from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('create_order','apply_direct_stock','check_addon_category','verificar_empleado',
                  'get_daily_report','get_sales_range','set_product_recipe');

select pg_get_viewdef('public.menu_products'::regclass, true);
select pg_get_viewdef('public.v_daily_sales'::regclass, true);
```

Con eso se puede confirmar que el kiosko no se rompe y preparar que cada pedido guarde quién lo cobró.

## Paso 2 · Aplicar (solo si el Paso 1 salió bien)
En este orden, en el SQL Editor: `20261116`, `20261117`, `20261118` y `20261119` (en `supabase/migrations/`).
Después corre `supabase/checks/01_despues_de_migrar.sql` y haz la prueba manual del final de ese archivo
(menú del kiosko, un pedido con descuento de stock, panel como administrador y como empleado).
Revisa en *Messages* que no aparezca `OMITIDA`: significa que esa función no quedó protegida.

## Paso 3 · Edge Function
`supabase functions deploy create-employee` (si da 401, añade `--no-verify-jwt`).

## Además
- Confirma que `empleados.password` guarda un **hash** (debe empezar por `$2a$`/`$2b$`), no la contraseña real.
- Si algo del kiosko deja de funcionar tras la migración, la causa más probable es que `create_order` o
  `apply_direct_stock` no sean `security definer`: avisa antes de seguir.
