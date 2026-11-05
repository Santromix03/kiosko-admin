# Kiosko · Panel de administración

Boceto funcional (HTML/CSS/JS puro + Supabase). Ver y editar categorías y productos con fotos.

## Cómo correrlo
1. Copia tu URL y clave anon de Supabase en `js/config.js`.
2. En esta carpeta: `python -m http.server 5500`
3. Abre http://localhost:5500

## Pendiente
- [ ] Ingredientes, stock y recetas
- [ ] Ventas del día (tablas `orders` y `order_items`)
- [ ] Mejorar estilos y vista en celular
- [ ] Validaciones y mensajes de error más claros
- [ ] Publicar en internet (Vercel, Netlify o GitHub Pages)

## Reglas
- Nunca poner la clave `service_role` en el código.
- Todo texto de la base de datos que se meta en HTML pasa por `esc()` (js/utils.js).