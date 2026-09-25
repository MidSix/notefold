# Changelog

## 0.2.0

- **Editar** abre el mismo formulario que al crear una nota, relleno con su texto y su color, con los botones **Guardar** y **Cancelar**, en lugar de llevar el cursor al comentario. Guardar conserva el `id` y la sintaxis de comentario de la nota y se deshace con un solo `Ctrl/Cmd+Z`.

## 0.1.0

Primera versión.

- Notas en Markdown ancladas a una línea o rango, guardadas en el propio archivo como comentarios (`@note-start` / `@note-body-end` / `@note-end`), en cualquier lenguaje con comentarios.
- Plegado automático, marcadores ocultos, barra de color en el margen y título de la nota como texto tenue junto al código.
- Hover con la nota y enlaces Abrir · Editar · Borrar; vista lateral con Markdown, LaTeX y Mermaid.
- Botón **+** en el margen con formulario para escribir la nota y elegir su color (5 categorías).
- Navegación entre notas, vista "Notas del archivo actual" en el Explorador y diagnósticos para bloques mal formados.
