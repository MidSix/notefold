# Code Notes

Notas explicativas en Markdown ancladas a una línea o a un rango de código, **guardadas dentro del propio archivo como comentarios**. Es una alternativa minimalista a CodeTour: no hay tours, pasos ni orden, solo notas junto al código.

- Si insertas o borras líneas, la nota se mueve con su código.
- Las notas se commitean junto al código.
- Quien no tenga la extensión ve un bloque de comentarios normal.
- Funciona con cualquier lenguaje que tenga comentarios.

La extensión detecta los bloques y los pliega o atenúa. En cada línea de código anotado dibuja una barra vertical del color de la nota en el margen, sin sombrear el código. Al pasar el ratón por la línea `@note-start` se muestra la nota renderizada.

## Formato

```python
# @note-start id=k3x9qa
# Aquí calculamos la **media ponderada**.
# - `w` son los pesos
# @note-body-end
total = sum(w * x for w, x in zip(ws, xs))
normalized = total / sum(ws)
# @note-end
```

| Marcador | Significado |
|---|---|
| `@note-start [id=…] [color=…]` | Abre la nota. El `id` se genera al crearla y es opcional. `color` es `blue` (por defecto), `green`, `yellow`, `red` o `purple`. |
| líneas intermedias | Cuerpo en Markdown (se quita el prefijo de comentario y la indentación común). |
| `@note-body-end` | Fin del cuerpo. Lo que viene después es el código anotado. |
| `@note-end` | Fin del rango anotado. |

En lenguajes que solo tienen comentarios de bloque (CSS, HTML…):

```css
/* @note-start id=css7aa
Color principal del botón.
@note-body-end */
color: #3794ff;
/* @note-end */
```

Reglas del formato:

- **Sintaxis de comentario**: se lee del `language-configuration.json` del lenguaje. Si el lenguaje tiene comentario de línea se usa ese; si no, el de bloque. Si no tiene ninguno, se muestra un aviso y no se inserta nada.
- **Indentación y espacios**: se toleran. `#@note-start`, `##  texto` o una reindentación hecha por Black, Prettier o clang-format siguen funcionando.
- **Anidación**: no se permite. Si aparece un `@note-start` dentro del código anotado de otra nota, gana la exterior y la interior se marca con un warning. Si la exterior está incompleta, se descarta y la interior se recupera.
- **Bloques mal formados**: si falta `@note-start`, `@note-body-end` o `@note-end`, o el rango está vacío, el bloque se ignora y aparece un warning discreto en *Problemas*.
- **Ids duplicados** (por copiar y pegar una nota): ambas notas funcionan y se muestra un aviso con la acción rápida *Regenerar id*.

## Crear notas desde el margen

Al pasar el ratón por el margen de una línea de código aparece un botón **+**, como en CodeTour. Al pulsarlo se abre un pequeño formulario:

- un cuadro donde escribes la nota en Markdown;
- cinco puntos de color en la cabecera para elegir la categoría (el elegido aparece enmarcado; por defecto, azul). El significado lo decides tú: por ejemplo funciones, TODOs o *breaking changes*;
- los botones **Crear nota** y **Cancelar**.

Para forzar un salto de línea en Markdown puedes terminar la línea con dos espacios: la extensión los guarda como `\` al final de la línea, que es equivalente y no se pierde si el editor borra los espacios finales al guardar.

La extensión escribe el bloque encima de la primera línea elegida, con la sintaxis de comentario del lenguaje y la indentación del código. No tienes que escribir `#`, `//` ni los marcadores.

Cómo se decide el rango y dónde aparece el **+**:

- **Varias líneas**: selecciónalas (hacia arriba o hacia abajo) y pulsa el **+** de una de ellas, o arrastra por el margen. La nota se coloca siempre encima de la primera línea del rango, la de más arriba.
- **Dónde no aparece el +**: en líneas que forman parte de una nota (de `@note-start` a `@note-end`) ni en comentarios. Si el rango elegido incluye alguna de esas líneas, la nota no se crea y se muestra un aviso: no se pueden anidar notas.

El botón se desactiva con `codeNotes.gutterAddButton: false`.

## Comandos

| Comando | Atajo (Win/Linux · macOS) |
|---|---|
| Code Notes: Añadir nota a la selección | `Ctrl+Alt+N` · `Cmd+Alt+N` |
| Code Notes: Abrir nota (vista previa lateral) | `Ctrl+Alt+O` · `Cmd+Alt+O` |
| Code Notes: Siguiente nota | `Ctrl+Alt+↓` · `Cmd+Option+↓` |
| Code Notes: Nota anterior | `Ctrl+Alt+↑` · `Cmd+Option+↑` |
| Code Notes: Editar nota | — (también desde el hover) |
| Code Notes: Borrar nota | — (también desde el hover) |
| Code Notes: Borrar todas las notas del archivo | — (pide confirmación) |

Los atajos se pueden cambiar en *Preferences: Open Keyboard Shortcuts*. Crear y borrar notas se deshace con un solo `Ctrl/Cmd+Z`.

Además, en el Explorador aparece la vista **Notas del archivo actual**, que lista las notas del archivo abierto; al hacer clic en una, el cursor salta a ella.

## Configuración

| Ajuste | Valores | Por defecto |
|---|---|---|
| `codeNotes.displayMode` | `fold` (pliega cabecera y cuerpo, atenúa los marcadores) · `dim` (atenúa todo el bloque) · `off` | `fold` |
| `codeNotes.gutterBar` | barra vertical del color de la nota en el margen de cada línea anotada | `true` |
| `codeNotes.gutterAddButton` | botón **+** en el margen para crear notas | `true` |
| `codeNotes.showNoteOnLineNumberClick` | al hacer clic en el número de una línea anotada se muestra la nota | `true` |

La marca de cada color en la regla de vista general (`codeNotes.<color>Ruler`, p. ej. `codeNotes.greenRuler`) se puede personalizar con `workbench.colorCustomizations`.

La extensión cambia el valor por defecto de `editor.foldingHighlight` a `false`, para que la línea `@note-start` plegada no salga sombreada. Esto afecta a todas las regiones plegadas; si prefieres el sombreado, pon `"editor.foldingHighlight": true` en tu configuración.

Al entrar con el cursor en una nota plegada, se despliega para editarla; al salir, se vuelve a plegar.

## Desarrollo

```bash
npm install
npm run compile          # typecheck + bundle con esbuild -> dist/extension.js
npm test                 # tests unitarios del parser (vitest)
npm run test:integration # tests dentro de un VS Code real (lo descarga la primera vez)
```

Para probarla a mano:

- `npm run try` abre una ventana de VS Code con la extensión cargada (sin depurador) y la carpeta `examples/` abierta (`demo.py`, `demo.cpp` y `demo.css` ya incluyen notas). Tras cambiar código, vuelve a ejecutarlo o usa *Developer: Reload Window* en esa ventana.
- `Ctrl+F5` (*Run Without Debugging*) hace lo mismo desde el editor.
- `F5` hace lo mismo con depurador (para breakpoints). Si aparece "Extension host did not start in 10 seconds", el depurador no ha llegado a conectarse: usa `npm run try` o `Ctrl+F5`.

En esa ventana las demás extensiones están deshabilitadas, para aislar la prueba y que arranque rápido.

## Empaquetar

```bash
npm run package          # = vsce package -> code-notes-0.1.0.vsix
code --install-extension code-notes-0.1.0.vsix
```

## Limitaciones conocidas

- **Las líneas plegadas no desaparecen del todo.** VS Code no permite ocultar líneas, así que la línea `@note-start` y la de `@note-end` siguen visibles, aunque atenuadas.
- **Plegado por indentación en archivos con notas.** En lenguajes sin proveedor de plegado propio (Ruby, Shell, Lua o Python sin Pylance), mientras el archivo tenga notas VS Code usa solo los rangos de esta extensión y se pierde su plegado por indentación. Los archivos sin notas no se ven afectados. Si esto te molesta, usa `displayMode: dim`.
- **`editor.foldingStrategy: "indentation"`** ignora a los proveedores de plegado, así que en ese caso las notas no se pliegan (el resto funciona igual).
- **Solo se pliega el editor activo.** VS Code solo ofrece comandos de plegado para el editor enfocado, así que un editor dividido en segundo plano se pliega cuando pasa a estar activo.
- **La barra del margen no responde al ratón.** VS Code no permite a las extensiones mostrar un hover, animaciones ni recibir clics sobre sus iconos del margen. Para ver la nota: pasa el ratón por la línea `@note-start`, haz clic en el **número de línea** de una línea anotada (justo al lado de la barra), usa la vista lateral (`Cmd+Alt+O`) o la vista del Explorador. Un triple clic sobre una línea anotada también selecciona la línea entera, así que también muestra la nota.
- **Fórmulas en el hover.** El hover de VS Code no renderiza fórmulas matemáticas (`$…$`); se muestran tal cual. La vista lateral (*Abrir*) sí las renderiza.
- **Posición del +.** El botón lo dibuja VS Code en la línea sobre la que pasa el ratón; la extensión solo decide en qué líneas se permite. Con una selección, la nota va siempre encima de su primera línea, aunque pulses el **+** de otra línea de la selección.
- **Detección de comentarios aproximada.** Se mira cada línea: comentarios de línea y bloques `/* … */`. Un delimitador de comentario dentro de un string puede confundirla.
- **Comentarios de bloque.** En el cuerpo de una nota en estilo bloque no se puede escribir el cierre del comentario (`*/`, `-->`).
