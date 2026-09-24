---
name: code-notes
description: Documenta código con notas de la extensión NoteFold de VS Code (bloques @note-start / @note-body-end / @note-end escritos con la sintaxis de comentario del lenguaje), con Markdown, tablas, LaTeX y diagramas Mermaid. Usar cuando el usuario pida comentar, documentar, anotar o explicar código (funciones, métodos, clases, o líneas concretas), o pida generar código "comentado", "documentado" o "con notas". Por defecto se anota cada función, método y clase, nunca líneas sueltas salvo petición expresa.
---

# Notas de código con NoteFold

El usuario usa una extensión propia de VS Code, **NoteFold**. La extensión detecta bloques de comentario con marcadores `@note-…`, los pliega y dibuja una barra de color en el margen. Muestra la primera línea de la nota como texto tenue junto al código. Al abrir la nota (`Cmd+Alt+O`), la renderiza en la vista previa de Markdown de VS Code, que soporta **Markdown, tablas, LaTeX (KaTeX) y Mermaid**.

Las notas son comentarios normales del lenguaje: el código sigue compilando y quien no tenga la extensión ve un bloque de comentarios. Esta skill define **cuándo** anotar, **dónde** colocar cada nota, **qué** debe contener y **cómo** escribirla sin romper nada.

## 1. Qué se anota

- **Por defecto: cada función, método, constructor y clase/struct/tipo** dentro del alcance que pida el usuario (un archivo, una selección, o el código que acabas de generar). Todas, incluidas las triviales; en esas, la nota es breve.
- **Líneas o bloques concretos: solo si el usuario lo pide expresamente** ("explica esta línea", "anota el bucle de la línea 40").
- Si ya existe una nota para esa función, **actualízala**; no crees otra.
- No borres docstrings ni comentarios existentes salvo que el usuario lo pida. La nota los complementa; no copies su texto literalmente.
- Escribe las notas en el idioma de la conversación con el usuario, salvo que las notas existentes del proyecto usen otro.

## 2. Formato exacto

Con comentarios de línea (la inmensa mayoría de lenguajes: `#`, `//`, `--`…):

```python
# @note-start id=k3x9qa color=blue
# ## weighted_mean: media ponderada de xs con pesos ws
# ...cuerpo Markdown...
# @note-body-end
def weighted_mean(xs: list[float], ws: list[float]) -> float:
# @note-end
    total = sum(w * x for w, x in zip(ws, xs))
    return total / sum(ws)
```

- `@note-start id=<id> color=<color>`: abre la nota. Todas las líneas del cuerpo llevan el prefijo de comentario seguido de un espacio (`# texto`). Una línea en blanco del cuerpo se escribe como el prefijo solo (`#`).
- `@note-body-end`: fin del cuerpo. Lo que sigue es el **código anotado**.
- `@note-end`: fin del rango anotado.
- Los marcadores y el cuerpo van con **la misma indentación que la primera línea de código anotada**.
- Usa el comentario de línea del lenguaje. Solo en lenguajes sin comentario de línea (CSS, HTML, XML…) se usa el estilo bloque:

```css
/* @note-start id=css7aa color=blue
Color principal del botón.
@note-body-end */
color: #3794ff;
/* @note-end */
```

- **id**: 6 caracteres `[a-z0-9]`, único en el archivo. Genéralos todos de una vez: `python3 ~/.claude/skills/code-notes/scripts/check_notes.py --new-id -n <cuántos> <archivo>`.
- **color**: escríbelo siempre de forma explícita (ver sección 5).

## 3. Dónde colocar cada nota (el rango)

**Las notas no se pueden anidar ni solapar.** Por eso:

- **Función o método: el rango es solo la firma.** Incluye los decoradores o atributos que la preceden y todas las líneas de la firma, hasta la línea que abre el cuerpo (`:` en Python, `{` en C/C++/Java/JS/Rust/Go, la línea `function f(...)` en Julia o Lua). El cuerpo queda fuera, libre para notas de línea que el usuario pida después.
- **Clase, struct, interfaz o módulo: solo la línea (o líneas) de su declaración.** Así cada método puede tener su propia nota.
- **Función de una sola línea** (`f(x) = 2x` en Julia, lambdas con nombre, arrow functions de una línea): el rango es esa línea.
- **Líneas concretas (bajo petición)**: exactamente las líneas pedidas. Nunca pueden caer dentro del rango de otra nota; como las notas de función solo cubren la firma, el cuerpo siempre está libre.
- El rango empieza y termina en líneas de código, nunca en comentarios.

Esta forma de colocarlas mantiene el código válido en todos los lenguajes, porque solo se insertan líneas de comentario. Ejemplos:

```cpp
// @note-start id=c9v1re color=blue
// ## build_prefix: sumas de prefijos de un vector
// ...
// @note-body-end
std::vector<long long> build_prefix(const std::vector<int>& v) {
// @note-end
    std::vector<long long> prefix(v.size() + 1, 0);
    ...
}
```

```julia
# @note-start id=jl7bro color=purple
# ## axpb!: y ← a·x + b con broadcast fusionado
# ...
# @note-body-end
function axpb!(y::AbstractVector{T}, a::T, x::AbstractVector{T}, b::T) where {T<:Real}
# @note-end
    y .= a .* x .+ b
    return y
end
```

## 4. Contenido obligatorio de la nota de una función o método

Siempre, sin excepción, en este orden:

1. **Título (primera línea)**: `## nombre: qué hace en una frase`. Esta línea se muestra como texto fantasma junto al código, así que debe ser **texto plano de 60 caracteres como máximo, sin backticks ni LaTeX**. El validador lo comprueba. El detalle va en la descripción, no en el título.
2. **Descripción breve**: qué hace y, si no es obvio, cómo (1–3 frases).
3. **Tipo de función**:
   - `**API pública**` si está pensada para usarse desde fuera (exportada, `pub`, sin prefijo `_`, documentada en el módulo…).
   - `**Auxiliar interna**` si solo existe para que la llamen otras funciones. En ese caso añade:
     - **Usada por**: **todas** las funciones que la llaman, sacadas de `callers.py` (sección 8), nunca de un grep a ojo ni de memoria. Si un nombre tiene varios métodos (despacho múltiple, sobrecargas), identifica cuál con su firma: `calculateΔ(::A57)`.
     - **Por qué es importante para ellas**: qué necesitan de esta función.
     - **Papel en el conjunto**: qué parte del flujo global resuelve (por ejemplo "normaliza la entrada antes de la fase de reducción").
4. **Entradas**: tabla con cada parámetro, su tipo y qué representa, incluidas unidades, rangos válidos y valores por defecto.
5. **Salida**: tabla con el tipo de retorno y qué significa. Añade también:
   - los argumentos que la función **modifica** (por ejemplo las funciones `!` de Julia, o parámetros por referencia);
   - los efectos secundarios;
   - las excepciones o errores que puede lanzar.

Los tipos se indican **siempre**, también en lenguajes dinámicos. Si no están declarados en el código, dedúcelos del uso y márcalos como `(inferido)`.

Plantilla:

```
## nombre: qué hace en una frase
Descripción breve.

**API pública**   ← o bien:   **Auxiliar interna**
**Usada por:** `f`, `g`: por qué la necesitan.
**Papel:** qué parte del flujo resuelve.

**Entradas**

| Parámetro | Tipo | Descripción |
|---|---|---|
| `xs` | `list[float]` | Valores a promediar. No vacía. |

**Salida**

| Tipo | Descripción |
|---|---|
| `float` | Media ponderada. |

**Errores:** `ZeroDivisionError` si `sum(ws) == 0`.
```

Opcional, **cuando aporte comprensión**:

- **Cómo funciona**: la matemática que se implementa, con LaTeX.
- Un diagrama Mermaid del flujo, de la secuencia de llamadas o del estado.

Úsalos en funciones numéricas o algorítmicas, y en abstracciones que no se ven en el código: broadcasting, despacho múltiple, recursión, concurrencia, pipelines o máquinas de estado. No en funciones triviales.

**Clases y tipos**: título, qué modelan, sus campos o atributos en una tabla (nombre, tipo, significado) y sus invariantes.

**Notas de línea (bajo petición)**: título más una explicación de lo que hace esa línea y por qué. Añade LaTeX o Mermaid si ayuda.

## 5. Colores (categorías semánticas)

| Color | Uso |
|---|---|
| `blue` | Funciones y métodos de la **API pública** |
| `green` | Funciones y métodos **auxiliares internos** |
| `purple` | **Clases, structs, tipos y módulos** |
| `yellow` | **Líneas o bloques concretos** anotados bajo petición, y **TODOs** |
| `red` | **Breaking changes**, código peligroso, comportamiento sorprendente o advertencias importantes |

Si el usuario define otra convención de colores, usa la suya.

## 6. Anotaciones de tipo en el propio código

- **Al generar funciones nuevas**, usa siempre las anotaciones de tipo nativas del lenguaje cuando existan:
  - hints de Python (`def f(x: np.ndarray) -> float:`);
  - tipos de TypeScript;
  - tipos de argumentos y de retorno en Julia, prefiriendo tipos abstractos y paramétricos (`AbstractVector{<:Real}`) para no restringir el despacho sin necesidad;
  - firmas completas en Rust, Go, Java, C#, C y C++.

  En lenguajes sin anotaciones (JavaScript sin TS, Ruby, Lua, Shell), los tipos van en la nota. En JavaScript, usa JSDoc solo si el proyecto ya lo usa.
- **Al comentar código existente**, no cambies firmas salvo que el usuario lo pida. Añadir tipos puede cambiar el comportamiento (en Julia cambia el despacho) o romper la compilación en TypeScript. Los tipos van en la tabla de la nota.

## 7. Markdown, LaTeX y Mermaid dentro de comentarios

- **LaTeX**: usa `$…$` en línea y, para bloques, `$$` en su propia línea:
  ```
  # $$
  # y_i = a \, x_i + b \qquad \forall\, i \in 1,\dots,n
  # $$
  ```
  Solo se renderiza al abrir la nota; en el hover se ve como texto. Que la nota se entienda también sin renderizar.
- **Mermaid**: bloque con ```` ```mermaid ````, indentado dentro del comentario:
  ```
  # ```mermaid
  # flowchart LR
  #     A["y .= a .* x .+ b"] --> B["materialize!(y, bc)"]
  # ```
  ```
  - Pon entre comillas las etiquetas con caracteres especiales (`["..."]`).
  - Mantén los diagramas pequeños (≤ ~10 nodos).
  - Tipos útiles: `flowchart LR/TD`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram`.
- **Salto de línea duro**: termina la línea en `\`, nunca con dos espacios (se pierden al guardar).
- **Estilo bloque (CSS, HTML…)**: el cuerpo no puede contener el cierre del comentario (`*/`, `-->`, `]]`). En HTML, las flechas de Mermaid `-->` cerrarían el comentario: usa `==>` o `-.->`.
- En el cuerpo nunca escribas `@note-start`, `@note-body-end` ni `@note-end`, ni siquiera entre backticks.

## 8. Flujo de trabajo

Los scripts están en `~/.claude/skills/code-notes/scripts/`. Solo necesitan `python3`; la validación de LaTeX y Mermaid usa además `node`. Úsalos siempre: sustituyen comprobaciones a ojo que fallan.

```bash
S="$HOME/.claude/skills/code-notes/scripts"
```

1. **Instantánea antes de tocar nada** (guarda el código sin notas, para poder demostrar después que no ha cambiado):
   ```bash
   python3 $S/check_notes.py --snapshot <archivos>
   ```
2. **Quién llama a quién.** Hazlo antes de escribir ningún "Usada por". Lista cada llamada con la función que la contiene, distinguiendo métodos por su firma. Con `--root` busca también en el resto del proyecto:
   ```bash
   python3 $S/callers.py <archivo> --root <raíz del proyecto>
   ```
   - Una función que nadie llama en el proyecto es API pública, o un hook del framework que se llama desde fuera.
   - Una función que solo llaman otras funciones del proyecto es auxiliar interna. Su "Usada por" lista **todas** esas funciones.
3. **ids** (uno por nota):
   ```bash
   python3 $S/check_notes.py --new-id -n <cuántas> <archivo>
   ```
4. **Escribe las notas** con el editor, respetando la indentación. No cambies nada del código salvo lo indicado en la sección 6.
5. **Valida y corrige hasta que no haya errores.** El validador comprueba: estructura, ids, colores, títulos (≤ 60 caracteres, sin backticks) y que el LaTeX y el Mermaid se renderizan, con los mismos motores que VS Code:
   ```bash
   python3 $S/check_notes.py <archivos>
   ```
6. **Demuestra que el código no ha cambiado:**
   ```bash
   python3 $S/check_notes.py --verify-code <archivos>
   ```
   Si dice "EL CÓDIGO HA CAMBIADO", deshaz ese cambio: solo se pueden añadir líneas de comentario. Si el lenguaje tiene un comprobador barato, úsalo también (`python3 -m py_compile`, `node --check`, el compilador del proyecto).
7. Responde al usuario con un resumen breve: qué funciones y clases has anotado, qué notas llevan diagramas o fórmulas, y el resultado de los pasos 5 y 6. Recuérdale que `Cmd+Alt+O` abre la nota renderizada.

## 9. Ejemplo completo (Python)

```python
# @note-start id=h2k9df color=green
# ## _normalize: escala los pesos para que sumen 1
# Divide cada peso por la suma total.
#
# **Auxiliar interna**
# **Usada por:** `weighted_mean`: necesita pesos normalizados para que el
# resultado sea una media y no una suma ponderada.
# **Papel:** paso de preparación antes de la reducción.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `ws` | `list[float]` | Pesos no negativos; al menos uno > 0. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `list[float]` | Pesos $\hat w_i = w_i / \sum_j w_j$, que suman 1. |
#
# **Errores:** `ZeroDivisionError` si todos los pesos son 0.
# @note-body-end
def _normalize(ws: list[float]) -> list[float]:
# @note-end
    total = sum(ws)
    return [w / total for w in ws]


# @note-start id=p7x3qa color=blue
# ## weighted_mean: media ponderada de xs con pesos ws
# Calcula la media de `xs` ponderada por `ws`:
#
# $$
# \bar x_w = \sum_{i=1}^{n} \hat w_i \, x_i
# $$
#
# **API pública**
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `xs` | `list[float]` | Valores. Misma longitud que `ws`. |
# | `ws` | `list[float]` | Pesos no negativos (no hace falta normalizarlos). |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `float` | Media ponderada. |
#
# ```mermaid
# flowchart LR
#     A["xs, ws"] --> B["_normalize(ws)"] --> C["Σ ŵᵢ·xᵢ"] --> D["float"]
# ```
# @note-body-end
def weighted_mean(xs: list[float], ws: list[float]) -> float:
# @note-end
    return sum(w * x for w, x in zip(_normalize(ws), xs))
```
