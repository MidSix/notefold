---
name: remove-code-notes
description: ⚠️ PELIGROSA / DESTRUCTIVA. Elimina las notas de la extensión NoteFold (bloques @note-start … @note-body-end … @note-end, de cualquier color o tipo) de archivos o carpetas, dejando el código intacto. Usar SOLO cuando el usuario pida explícitamente eliminar, borrar o quitar las notas de NoteFold ("elimina todas las notas", "quita los comentarios que creaste"). Nunca por iniciativa propia ni como parte de otra tarea (limpiar, refactorizar, formatear, preparar un commit). Exige siempre una confirmación Sí/No del usuario antes de borrar nada.
---

# ⚠️ Eliminar notas de NoteFold (operación peligrosa)

Esta skill borra las notas que la skill `code-notes` escribe en el código: los bloques `@note-start` … `@note-body-end` y la línea `@note-end`, de cualquier color o tipo. El código anotado queda exactamente igual.

Es una operación **destructiva**: se pierde documentación que costó tiempo escribir. Por eso tiene reglas estrictas que no se pueden saltar.

## Reglas obligatorias

1. **Solo con petición explícita.** El usuario tiene que haber pedido en su mensaje eliminar las notas o comentarios de NoteFold. No cuenta:
   - una petición ambigua ("limpia el archivo", "deja el código más corto");
   - otra tarea en curso (refactorizar, formatear, preparar un commit);
   - una decisión tuya.

   Si hay duda, pregunta; no ejecutes.
2. **Siempre una simulación antes** (`--dry-run`), para saber exactamente qué se va a borrar.
3. **Siempre confirmación Sí/No** con la herramienta `AskUserQuestion`, después de la simulación y antes de borrar. Esto aplica aunque el usuario ya haya dicho "sí" antes, aunque la petición sea muy clara y aunque sea en modo automático.
4. **Solo con el script.** Nunca borres notas a mano con el editor ni con `sed`: el script es el que verifica que no se pierde código.
5. **Solo notas de NoteFold.** No toques otros comentarios, docstrings ni código.

## Procedimiento

El script está en `~/.claude/skills/remove-code-notes/scripts/remove_notes.py` y solo necesita `python3`.

```bash
R="$HOME/.claude/skills/remove-code-notes/scripts/remove_notes.py"
```

### 1. Alcance

Usa exactamente los archivos o carpetas que nombre el usuario. Si no dice cuáles, pregúntale. No asumas "todo el proyecto" salvo que lo diga. Con carpetas, el script busca de forma recursiva e ignora `.git`, `node_modules` y las carpetas de compilación.

### 2. Simulación (no modifica nada)

```bash
python3 "$R" --dry-run <archivos o carpetas>
```

Lista cada nota que se borraría (archivo, líneas y título) y el total.

Si informa de **notas mal formadas** (falta un marcador), para: el paso 4 se negaría a ejecutar. Explícale al usuario qué nota está rota. Pregúntale si quiere que la corrijas primero (por ejemplo completándola con la skill `code-notes`) o que la dejes fuera del alcance.

Si no hay notas, díselo y termina.

### 3. Confirmación obligatoria

Llama a `AskUserQuestion` con una pregunta que diga exactamente qué se va a borrar, con los números reales de la simulación:

- **question**: `¿Seguro que quieres eliminar N notas de NoteFold (M líneas de comentario) en K archivos? El código no se modifica.`
- **header**: `Confirmar`
- **options**, exactamente dos, en este orden:
  1. label `No, cancelar`, descripción: `No se modifica ningún archivo.`
  2. label `Sí, eliminar`, descripción: `Se borran las notas; se guarda una copia de seguridad y se verifica que el código queda intacto.`

**Solo si la respuesta es `Sí, eliminar`, continúa.** Cualquier otra respuesta, incluidas un texto libre ambiguo, un "no" o no contestar, significa cancelar: dilo y termina sin tocar nada.

Si `AskUserQuestion` no está disponible (por ejemplo en modo no interactivo), **no borres nada**. Explica que la operación necesita confirmación interactiva y termina.

### 4. Eliminar, con copia de seguridad y verificación

```bash
python3 "$R" --apply <los mismos archivos o carpetas>
```

Para cada archivo, el script:

1. se niega a ejecutar entero, sin tocar ningún archivo, si hay alguna nota mal formada;
2. guarda una **copia de seguridad** del original;
3. borra exactamente las líneas de las notas, conservando byte a byte los finales de línea (LF/CRLF);
4. **verifica con un diff antes/después**, antes de escribir y otra vez después de escribir, que:
   - todas las líneas eliminadas eran de notas;
   - en las notas de estilo línea, todas eran comentarios;
   - no se ha añadido ni modificado ninguna línea;
   - no queda ningún marcador.

   Si algo falla, ese archivo no se modifica, o se restaura desde la copia;
5. guarda el diff de cada archivo junto a la copia de seguridad.

### 5. Informe al usuario

- Cuántas notas se han eliminado y en qué archivos, y el resultado de la verificación ("0 líneas de código eliminadas o modificadas").
- La carpeta de la copia de seguridad y de los diffs, que el script imprime al final.
- Cómo deshacerlo: `Cmd+Z` en el editor si el archivo está abierto, `git checkout -- <archivo>` si está en git y sin otros cambios, o copiar el archivo de vuelta desde la carpeta de copia de seguridad.
- Si algún archivo falló la verificación, dilo claramente: ese archivo no se ha modificado.
