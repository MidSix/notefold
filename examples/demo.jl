# Demo de NoteFold con LaTeX y Mermaid: coloca el cursor en la función y
# usa "NoteFold: Abrir nota" (Cmd+Alt+O) para ver la nota renderizada.

# @note-start id=jl7bro color=purple
# Broadcast fusionado (`.`)
# `y .= a .* x .+ b` no crea arrays temporales: Julia **fusiona** todos los
# operadores con punto en un único bucle que escribe directamente en `y`.
#
# $$
# y_i = a \, x_i + b \qquad \forall\, i \in 1,\dots,n
# $$
#
# Coste: $O(n)$ en tiempo y $O(1)$ en memoria extra.
#
# ```mermaid
# flowchart LR
#     A["y .= a .* x .+ b"] --> B["Broadcasted(+, Broadcasted(*, a, x), b)"]
#     B --> C["materialize!(y, bc)"]
#     C --> D["un solo bucle: y[i] = a*x[i] + b"]
# ```
# @note-body-end
function axpb!(y, a, x, b)
    y .= a .* x .+ b
    return y
end
# @note-end

# @note-start id=jl2dsp color=green
# Despacho múltiple
# Julia elige el método según el tipo de **todos** los argumentos:
#
# ```mermaid
# sequenceDiagram
#     participant U as Llamada
#     participant J as Julia
#     participant M as Método
#     U->>J: area(Circle(2.0))
#     J->>J: busca area(::Circle)
#     J->>M: area(c::Circle)
#     M-->>U: π · r² = 12.57
# ```
#
# La fórmula del círculo: $A = \pi r^2$.
# @note-body-end
struct Circle
    r::Float64
end
area(c::Circle) = π * c.r^2
# @note-end

x = collect(1.0:5.0)
y = similar(x)
axpb!(y, 2.0, x, 1.0)
println(y, " ", area(Circle(2.0)))
