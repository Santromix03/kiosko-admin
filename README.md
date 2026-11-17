# Kiosko · Panel de administración

HTML/CSS/JS puro + Supabase. Categorías, productos con foto, adiciones, ingredientes con stock y
recetas (con historial), reportes de ventas con PDF, y roles/turnos de empleados.

## Cómo correrlo
1. Copia tu URL y clave anon de Supabase en `js/config.js`.
2. En esta carpeta: `python serve.py` (servidor local sin caché, solo accesible desde tu equipo).
3. Abre http://localhost:5500

## Instalación en Supabase (en este orden)

> ¿No tienes acceso a Supabase? Pásale `supabase/LEEME_PARA_EL_DUENO.md` a quien lo administre: es la lista de lo que debe hacer y devolverte.
> Mientras tanto, para entrar al panel sin la migración de roles pon `ROLES_REQUIRED = false` en `js/config.js` (solo para pruebas; vuelve a `true` después).

### Paso 0 · Antes de tocar la base
1. **Cierra los registros públicos**: Authentication → Providers → Email → desactivar *Allow new users to sign up*.
   Hazlo **primero**: la migración 1 convierte en administrador a toda cuenta que exista al ejecutarla.
2. En Authentication → Users **borra las cuentas que no sean tuyas** (pruebas, registros viejos).
3. Corre `supabase/checks/00_antes_de_migrar.sql` (solo lectura, una consulta por vez) y revisa:
   - que `create_order` y `apply_direct_stock` sean `security definer` (`prosecdef = true`);
   - qué tablas no tienen RLS (`orders`, `order_items`, `empleados`… deben tenerlo);
   - si `menu_products` es `security_invoker`.

### Paso 1 · Migraciones
Todas se pegan en **Supabase → SQL Editor** y se pueden repetir sin problema.

| # | Archivo | Para qué |
|---|---------|----------|
| 1 | `supabase/migrations/20261112_recipe_history.sql` | Historial de recetas e ingredientes archivados *(este archivo no venía en el zip: usa el de tu repo)* |
| 2 | `supabase/migrations/20261116_roles_shifts.sql` | Tablas `admins`, `employees`, `shifts` y sus funciones |
| 3 | `supabase/migrations/20261117_roles_hardening.sql` | Ventas por turno en el servidor, cierre automático, desactivación real |
| 4 | `supabase/migrations/20261118_menu_rls.sql` | **Solo administradores** pueden modificar el menú y las fotos (**léelo antes**) |
| 5 | `supabase/migrations/20261119_security_fixes.sql` | Corrige lo que deja abierto la #4 y cierra reportes, stock y recetas a administradores |

**Ejecuta la #4 y la #5 seguidas.** La #5:
- hace que el público (kiosko) solo vea categorías y adiciones **activas**;
- cierra `ingredients` y `recipe_items` al público (solo si `menu_products` no es `security_invoker`);
- envuelve `get_daily_report`, `get_sales_range`, `adjust_*`, `set_product_recipe`, `archive_ingredient`,
  `restore_ingredient` y las consultas de historial con una comprobación `is_admin()`, **sin cambiar** sus nombres ni parámetros;
- protege la vista `v_daily_sales`, cierra las tablas de historial de recetas a administradores y crea un índice en `orders(created_at)`.

Si una función no se puede envolver (porque `create_order` o un trigger la usa por dentro, o tiene parámetros OUT), la #5 la **omite** y lo avisa en los mensajes (*Messages* del SQL Editor): revisa que no diga `OMITIDA`.

> **Antes de la #4**: confirma que la app del kiosko no escribe directo en las tablas. Hoy solo usa `create_order` y
> `verificar_empleado` con la clave anon; si `create_order`/`apply_direct_stock` no son `security definer`, el kiosko
> dejaría de descontar stock.

Después de migrar corre `supabase/checks/01_despues_de_migrar.sql` y haz la **prueba manual** que está al final de ese archivo.

### Paso 2 · Función que crea empleados
`supabase functions deploy create-employee`
Si al desplegar o invocar da 401 con las claves nuevas (`sb_publishable_…`), despliega con `--no-verify-jwt`:
es seguro aquí porque la función ya valida `is_admin()` con la sesión de quien llama.

### Paso 3 · Panel
En `js/config.js` deja `ROLES_REQUIRED = true` (si falta la migración de roles, nadie entra).

## Historial de recetas e ingredientes archivados
- Los ingredientes se **archivan** en lugar de borrarse; se restauran con «Mostrar archivados».
- Cada ingrediente de una receta tiene un periodo (`valid_from` / `valid_to`). Cambiar o quitar un
  ingrediente cierra el periodo anterior y abre uno nuevo, sin tocar ventas pasadas.
- Los periodos viven en `recipe_item_periods` (y los cambios en `recipe_change_log`); `recipe_items` solo guarda la receta vigente. Ambas tablas de historial son solo para administradores (migración 5).
- En cada producto: historial de la receta y «receta exacta en una fecha». En cada ingrediente: en qué productos se usó.
- Si la migración no está aplicada, la admin sigue funcionando (recetas por delete/insert, ahora con
  restauración si falla el guardado) y muestra un aviso.

## Roles y turnos
- **Administrador**: ve el panel completo y la pestaña **Roles** (en turno ahora, empleados, historial y ventas por empleado).
- **Empleado**: al iniciar sesión se abre su turno solo; ve su turno, sus pedidos y ventas, y «Terminar turno»
  (cierra el turno y la sesión). Solo recibe las ventas **de sus propios turnos**.
- Se crean desde **Roles → Nuevo empleado** (Edge Function), o con «solo vincular» una cuenta que ya existe.
- **Desactivar** a un empleado cierra su turno, bloquea la cuenta y borra sus sesiones.
  Un empleado con turnos **no se puede borrar** desde Authentication (los turnos lo impiden): usa «Desactivar».
- **Una sesión = un turno**: si el administrador (o el sistema) cierra un turno, recargar la página no abre otro;
  hay que iniciar sesión de nuevo. Los turnos abiertos más de **14 horas** se cierran solos (aparecen con la etiqueta «Auto»).
- Las ventas se asignan por **ventana de tiempo** (pedidos creados mientras el turno estuvo abierto). Si dos turnos se
  cruzan, el pedido aparece en ambos, pero en los totales generales cuenta **una sola vez**.
- Para dar permiso de administrador a otra persona:
  `insert into public.admins (user_id) select id from auth.users where email = 'correo@ejemplo.com';`

## Limitaciones conocidas (pendientes)
- **Los turnos no están conectados al login del kiosko.** El kiosko identifica al empleado con
  `verificar_empleado` y la tabla `empleados`; este panel usa Supabase Auth (`employees`). Son dos sistemas
  distintos, así que «ventas por empleado» mide quién tuvo el panel abierto, no quién cobró. La solución real es que
  `create_order` guarde el empleado o turno en cada pedido y que el kiosko use un solo login. Eso exige el código
  de `create_order`, que no venía en el proyecto.
- **`verificar_empleado` está abierta a la clave anon** y no limita intentos: se pueden probar contraseñas por fuerza
  bruta. Conviene añadir un límite de intentos o pasar el login del kiosko a Supabase Auth.
- **Sin CSP ni SRI.** Supabase y jsPDF se cargan desde la CDN (versiones fijas). No se añadió una Content-Security-Policy
  porque no se pudo probar aquí y podría romper la descarga de PDF; si quieres endurecerlo, aloja esas librerías tú.
- **El SQL de la migración 5 no se ejecutó contra una base real** (no había Postgres disponible al escribirlo).
  Pruébalo primero en un proyecto de prueba o con las verificaciones de `supabase/checks/`.

## Reglas
- Nunca poner la clave `service_role` en el código del navegador (solo existe dentro de la Edge Function).
- Todo texto de la base de datos que se meta en HTML pasa por `esc()` (js/utils.js).
- Al editar stock, la app no pisa cambios hechos mientras tanto (ventas/ajustes): si el stock cambió, pide recargar.
- Si el panel no arranca (sin internet o sin CDN), `js/boot-check.js` muestra un aviso con botón de recargar.

## Pendiente
- [x] Ingredientes, stock y recetas
- [x] Reportes por día con PDF por rango
- [x] Historial de recetas y archivado de ingredientes
- [x] Roles y turnos de empleados
- [x] Cerrar reportes, stock y recetas a administradores (migración 5)
- [ ] Conectar turnos con el login y los pedidos del kiosko
- [ ] Mejorar estilos y vista en celular
- [ ] Publicar en internet (Vercel, Netlify o GitHub Pages)
