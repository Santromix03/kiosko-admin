# Kiosko · Panel de administración

Boceto funcional (HTML/CSS/JS puro + Supabase). Ver y editar categorías y productos con fotos.

## Cómo correrlo
1. Copia tu URL y clave anon de Supabase en `js/config.js`.
2. En esta carpeta: `python -m http.server 5500`
3. Abre http://localhost:5500

## Historial de recetas e ingredientes archivados

La app conserva la historia de qué ingredientes llevó cada producto, sin borrar
ingredientes ni periodos. Para activarlo hay que ejecutar **una vez** la migración:

1. Abre el proyecto en Supabase → **SQL Editor**.
2. Pega y ejecuta `supabase/migrations/20261112_recipe_history.sql`.
3. Recarga la página de la admin (si Supabase pide refrescar el esquema, espera unos segundos).

Qué cambia al aplicarla:

- Los ingredientes se **archivan** en lugar de borrarse. Desaparecen de las listas
  normales, no se pueden usar en recetas nuevas y se pueden restaurar con
  «Mostrar archivados».
- Cada ingrediente de una receta tiene un periodo (`valid_from` / `valid_to`).
  Quitar un ingrediente o cambiar su cantidad cierra el periodo anterior y abre
  uno nuevo, sin tocar las ventas pasadas.
- Al archivar un ingrediente que está en recetas activas, la app muestra qué
  productos lo usan y cierra esos periodos con la misma fecha y hora.
- En el detalle de cada producto aparece el historial de la receta, con filtros
  por rango de fechas/estado y una consulta de «receta exacta en una fecha».
- En cada ingrediente, el botón **Historial** muestra en qué productos se usó y
  en qué fechas.
- La tabla `recipe_items` se mantiene como espejo de la receta activa, así que
  `create_order` y la app de Python siguen funcionando sin cambios.

> La historia empieza a registrarse cuando se aplica la migración. Las recetas
> que ya existían quedan como su periodo inicial abierto desde ese momento.

Si la migración todavía no está aplicada, la admin sigue funcionando como antes
(guardando recetas por delete/insert), pero muestra un aviso y no permite
archivar ingredientes ni consultar fechas.

## Pendiente
- [x] Ingredientes, stock y recetas
- [x] Reportes por día (`v_daily_sales`, `get_daily_report`, `get_sales_range`) con descarga de PDF resumido por rango
- [x] Historial de recetas, archivado/reactivación de ingredientes y consultas por producto/ingrediente/fecha
- [ ] Mejorar estilos y vista en celular
- [ ] Validaciones y mensajes de error más claros
- [ ] Publicar en internet (Vercel, Netlify o GitHub Pages)

## Reglas
- Nunca poner la clave `service_role` en el código.
- Todo texto de la base de datos que se meta en HTML pasa por `esc()` (js/utils.js).

  ## Cómo correrlo
  Usa `python serve.py` en lugar de `python -m http.server` (desactiva la caché del navegador
  mientras desarrollan). Abre http://localhost:5500