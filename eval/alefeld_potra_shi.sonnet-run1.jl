## --------------------------------------------------

## Algorithms of Alefeld, Potra, and Shi
## Main paper is
## [Algorithm 748: enclosing zeros of continuous functions](https://na.math.kit.edu/alefeld/download/1995_Algorithm_748_Enclosing_Zeros_of_Continuous_Functions.pdf) with supporting material at
## [Algorithm 748: enclosing zeros of continuous functions](https://doi.org/10.1145/210089.210111)

## --------------------------------------------------

#=
"""
    AbstractAlefeldPotraShi

An abstract type for Alefeld-Potra-Shi type bracketing problems, as discussed in  [*Algorithm 748: enclosing zeros of continuous functions*](https://na.math.kit.edu/alefeld/download/1995_Algorithm_748_Enclosing_Zeros_of_Continuous_Functions.pdf). These consist of an interpolation step, such as quadratic interpolation or inverse cubic interpolation along with a double-secant step. For a smooth function and finite bracketing interval, these methods should always converge.

The `update_step` method calls a `calculateΔ` method that can be customized to turn an algorithm based on interpolation into a bracketed algorithm. See [`Roots.BracketedHalley`](@ref) for an example.

This implementation deviates slightly from the printed algorithm, as it may use an initial call to `_middle` rather than a secant step, depending on the signs of ``a`` and ``b``.

!!! note
    These algorithms do not check the size of `f` for convergence, so the `atol` or `rtol` are not utilized.
"""
=#
# @note-start id=dt5j6c color=purple
# ## AbstractAlefeldPotraShi: familia de métodos de acotación con interpolación + secante doble
# Tipo abstracto raíz de todos los métodos de tipo Alefeld-Potra-Shi (algoritmo 748).
# Cada subtipo combina un paso de interpolación (cuadrática o cúbica inversa, vía
# `calculateΔ`) con un paso de secante doble de repliegue, manteniendo siempre un
# intervalo `[a, b]` que acota la raíz.
#
# No tiene campos: es un tipo "marcador" que solo sirve para el despacho múltiple
# sobre `init_state`, `update_state`, `calculateΔ`, etc.
#
# **Invariantes de la familia:**
# - Todo subtipo concreto debe implementar `calculateΔ(::Subtipo, F, c₀, ps)`.
# - Se asume `f` continua en `[a, b]` con `f(a)` y `f(b)` de signos opuestos; con
#   ello el método siempre converge, aunque no comprueba `|f(x)|` para decidir
#   convergencia (solo el tamaño del intervalo).
# @note-body-end
abstract type AbstractAlefeldPotraShi <: AbstractNonStrictBracketingMethod end
# @note-end

# @note-start id=z4mslf color=blue
# ## initial_fncalls: nº de evaluaciones de f que gasta la inicialización
# **API pública** (hook del framework de Roots.jl: lo invoca el bucle genérico de
# `find_zero` para reservar presupuesto de llamadas antes de arrancar).
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `::AbstractAlefeldPotraShi` | tipo | Solo se usa para el despacho; no se lee ningún valor. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `Int` | `3`: el peor caso, cuando `fx₀`, `fx₁` y el `fc` del punto medio/secante hay que calcularlos todos. |
# @note-body-end
initial_fncalls(::AbstractAlefeldPotraShi) = 3 # worst case assuming fx₀, fx₁,fc must be computed
# @note-end

## initial step, needs to log a,b,d
# @note-start id=pkxxo8 color=blue
# ## log_step: registra el paso actual en el histórico de seguimiento (`Tracks`)
# **API pública** (hook del framework: el bucle de `find_zero` lo llama tras cada
# paso cuando el usuario pide seguimiento con `Tracks`, para poder graficar o
# inspeccionar la convergencia después).
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `l` | `Tracks` | Acumulador de historial; esta función lo **modifica** con `push!`. |
# | `M` | `AbstractAlefeldPotraShi` | Método concreto; se usa para agrupar el historial por nombre de tipo. |
# | `state` | estado del iterador | Debe tener los campos `xn0`, `xn1` (extremos `a`, `b`) y `d`. |
# | `init` | `Bool` (por defecto `false`) | `true` solo en el primer registro, antes de la primera iteración real. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `Nothing` | No devuelve nada útil; el efecto es el `push!` sobre `l`. |
# @note-body-end
function log_step(l::Tracks, M::AbstractAlefeldPotraShi, state; init::Bool=false)
# @note-end
    h, 𝑀 = l.h, nameof(typeof(M))
    a, b, c = state.xn0, state.xn1, state.d
    init && push!(h, 𝑀, 1, extrema((a, b, c)))
    init && log_iteration(l, 1) # take an initial step
    n = haskey(h, 𝑀) ? length(h, 𝑀) : 1
    push!(h, 𝑀, n + 1, (a, b))
    !init && log_iteration(l, 1)
    nothing
end

# @note-start id=be86hi color=purple
# ## AbstractAlefeldPotraShiState: estado del iterador (bracket + puntos auxiliares)
# Guarda el intervalo que acota la raíz junto con los dos puntos extra (`d`, `ee`)
# que se reutilizan para construir interpolantes cuadráticos/cúbicos en el paso
# siguiente, evitando repetir evaluaciones de `f`.
#
# | Campo | Tipo | Significado |
# |---|---|---|
# | `xn1` | `T` | Extremo `b` del bracket actual. |
# | `xn0` | `T` | Extremo `a` del bracket actual. |
# | `d` | `T` | Punto descartado en el último `bracket` (tercer punto de interpolación). |
# | `ee` | `T` | Punto descartado un paso antes que `d` (para interpolación cúbica inversa); `NaN` al inicio. |
# | `fxn1` | `S` | `f(xn1)`. |
# | `fxn0` | `S` | `f(xn0)`. |
# | `fd` | `S` | `f(d)`. |
# | `fee` | `S` | `f(ee)`. |
#
# **Invariante:** `xn0` y `xn1` siempre acotan la raíz (`fxn0` y `fxn1` de signo
# opuesto, salvo que uno sea exactamente cero).
# @note-body-end
struct AbstractAlefeldPotraShiState{T,S} <: AbstractUnivariateZeroState{T,S}
# @note-end
    xn1::T
    xn0::T
    d::T
    ee::T
    fxn1::S
    fxn0::S
    fd::S
    fee::S
end

# basic init state is like bracketing state
# keep a < b
# set d, ee to a
# @note-start id=gbsfwq color=blue
# ## init_state: construye el estado inicial a partir del bracket `[x₀, x₁]`
# Ordena el bracket (`a < b`), calcula un tercer punto `c` (punto medio si `0`
# está entre `a` y `b`, paso de secante en otro caso) si no se ha dado ya, y
# estrecha el intervalo con `bracket` para obtener el estado inicial completo
# (`a`, `b`, `d`, `ee=NaN`).
#
# **API pública** (hook del framework: `find_zero` lo llama una única vez, al
# arrancar, para pasar del bracket de usuario al estado interno del método).
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `::AbstractAlefeldPotraShi` | tipo | Solo despacho. |
# | `F` | `Callable_Function` | Función objetivo envuelta (permite contar evaluaciones). |
# | `x₀`, `x₁` | `T` | Extremos iniciales del bracket, en cualquier orden. |
# | `fx₀`, `fx₁` | `S` | `F(x₀)`, `F(x₁)`. |
# | `c` | `T` o `nothing` (kw) | Tercer punto opcional ya conocido. |
# | `fc` | `S` o `nothing` (kw) | `F(c)`, si `c` se ha dado. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `AbstractAlefeldPotraShiState` | Estado inicial, con retorno anticipado si `fx₀`, `fx₁` o `fc` ya son cero (o `fc` no es finito). |
#
# **Errores:** `assert_bracket` lanza una excepción si `fa` y `fb` no tienen signos opuestos.
#
# ```mermaid
# flowchart TD
#     A["fa == 0 ó fb == 0?"] -->|sí| B["devolver estado degenerado en la raíz"]
#     A -->|no| C["assert_bracket(fa, fb)"]
#     C --> D["c, fc dados?"]
#     D -->|no| E["c = _middle ó secant_step; fc = F(c)"]
#     D -->|sí| F["fc == 0 ó no finito?"]
#     E --> F
#     F -->|sí| G["devolver estado degenerado en c"]
#     F -->|no| H["a,b,d,fa,fb,fd = bracket(a,b,c,fa,fb,fc)"]
#     H --> I["AbstractAlefeldPotraShiState(b,a,d,NaN,...)"]
# ```
# @note-body-end
function init_state(::AbstractAlefeldPotraShi, F, x₀, x₁, fx₀, fx₁; c=nothing, fc=nothing)
# @note-end
    a, b, fa, fb = x₀, x₁, fx₀, fx₁
    iszero(fa) && return AbstractAlefeldPotraShiState(
        promote(b, a, a, a)...,
        promote(fb, fa, fa, fa)...,
    )
    iszero(fb) && return AbstractAlefeldPotraShiState(
        promote(b, a, a, a)...,
        promote(fb, fa, fa, fa)...,
    )
    assert_bracket(fa, fb)

    if a > b
        a, b, fa, fb = b, a, fb, fa
    end

    if c === nothing # need c, fc to be defined if one is
        c = float(a < zero(a) < b ? _middle(a, b) : secant_step(a, b, fa, fb))
        fc = first(F(c))
    end

    (iszero(fc) || !isfinite(fc)) && return AbstractAlefeldPotraShiState(
        promote(c, a, a, a)...,
        promote(fc, fa, fa, fa)...,
    )

    a, b, d, fa, fb, fd = bracket(a, b, c, fa, fb, fc)
    assert_bracket(fa, fb)

    T = typeof(d)
    ee, fe = T(NaN) / oneunit(T(NaN)) * d, fd # use NaN for initial ee value

    AbstractAlefeldPotraShiState(promote(b, a, d, ee)..., promote(fb, fa, fd, fe)...)
end

# fn calls w/in calculateΔ
# 1 is default, but this should be adjusted for different methods
# @note-start id=tadx40 color=blue
# ## fncalls_per_step: nº de evaluaciones de f que gasta `calculateΔ` por defecto
# **API pública** (hook del framework, usado por `update_state` para llevar la
# cuenta de evaluaciones vía `incfn`). Cada subtipo puede sobrescribirlo si su
# `calculateΔ` evalúa `f` más de una vez (ver `A57`).
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `::AbstractAlefeldPotraShi` | tipo | Solo despacho. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `Int` | `1`, valor por defecto. |
# @note-body-end
fncalls_per_step(::AbstractAlefeldPotraShi) = 1
# @note-end

# @note-start id=ctzbtm color=blue
# ## update_state: da un paso del algoritmo y devuelve el nuevo estado
# Es el corazón del método: obtiene una corrección `Δ` interpolada vía
# `calculateΔ` para proponer `x = c - Δ`, reduce el bracket con `bracket`, y si
# aún no hay convergencia añade un paso de **secante doble** (ecuaciones 4.16–4.19
# del paper) con repliegue a bisección cuando el paso no reduce lo suficiente el
# intervalo.
#
# **API pública** (hook del framework: `find_zero` lo llama en cada iteración).
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `M` | `AbstractAlefeldPotraShi` | Variante concreta del algoritmo (define `calculateΔ`). |
# | `F` | `Callable_Function` | Función objetivo envuelta. |
# | `o` | `AbstractAlefeldPotraShiState{T,S}` | Estado actual (`a`, `b`, `d`, `ee` y sus imágenes). |
# | `options` | — | Debe tener `xabstol`, `xreltol` (tolerancias de parada). |
# | `l` | `AbstractTracks` (por defecto `NullTracks()`) | Registro opcional; se **modifica** vía `incfn` para contar llamadas a `F`. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `(AbstractAlefeldPotraShiState, Bool)` | Nuevo estado y `true` si ya ha convergido. |
#
# **Modifica:** `l` (contadores de evaluaciones de `F`).
#
# **Cómo funciona (resumen del paso 4.16–4.19):**
#
# $$
# \bar c = u - 2\,\frac{\bar b - \bar a}{f(\bar b) - f(\bar a)}\,f(u), \qquad
# u = \arg\min(|f(\bar a)|, |f(\bar b)|)
# $$
#
# Si $2|u - \bar c| > \bar b - \bar a$ el paso de secante doble se descarta y se
# usa el punto medio; si el bracket resultante no se ha reducido al menos un
# factor $\mu=0.5$ respecto al tamaño inicial, se añade un paso extra de
# bisección antes de aceptar el nuevo estado.
#
# ```mermaid
# flowchart TD
#     A["Δ, ps = calculateΔ(M,F,c,ps)"] --> B["x = c - Δ (con avoid_boundaries)"]
#     B --> C["ā,b̄,d,fā,fb̄,fd = bracket(a,b,x,...)"]
#     C --> D{"¿converge?"}
#     D -->|sí| E["devolver estado, true"]
#     D -->|no| F["c̄ = paso de secante doble 4.16"]
#     F --> G["â,b̂,d̂ = bracket(ā,b̄,c̄,...)"]
#     G --> H{"b̂-â < μ·δ₀ ?"}
#     H -->|sí| I["aceptar â,b̂,d̂"]
#     H -->|no| J["paso extra de bisección m=__middle(ā,b̄)"]
#     I --> K["devolver estado, false"]
#     J --> K
# ```
# @note-body-end
function update_state(
    M::AbstractAlefeldPotraShi,
    F::Callable_Function,
    o::AbstractAlefeldPotraShiState{T,S},
    options,
    l=NullTracks(),
) where {T,S}
# @note-end
    atol, rtol = options.xabstol, options.xreltol
    μ, λ = oftype(float(rtol), 0.5), oftype(float(rtol), 0.7)
    tols = (; λ=λ, atol=atol, rtol=rtol)

    a::T, b::T, d::T, ee::T = o.xn0, o.xn1, o.d, o.ee
    fa::S, fb::S, fd::S, fee::S = o.fxn0, o.fxn1, o.fd, o.fee

    δ₀ = b - a

    # use c to track smaller of |fa|, |fb|
    c, fc = abs(fa) < abs(fb) ? (a, fa) : (b, fb)

    ps = (; a=a, b=b, d=d, ee=ee, fa=fa, fb=fb, fd=fd, fee=fee, atol=atol, rtol=rtol)

    # (may modify ps) <<----
    Δ, ps = calculateΔ(M, F, c, ps)
    incfn(l, fncalls_per_step(M))

    a, b, d = ps.a, ps.b, ps.d
    fa, fb, fd = ps.fa, ps.fb, ps.fd

    if iszero(fa) || iszero(fb) || (b - a) <= tolₑ(a, b, fa, fb, atol, rtol)
        @reset o.xn0 = a
        @reset o.xn1 = b
        @reset o.fxn0 = fa
        @reset o.fxn1 = fb
        return o, true
    end

    x = c - Δ

    x = avoid_boundaries(a, x, b, fa, fb, tols)
    fx = first(F(x))
    incfn(l)

    ā, b̄, d, fā, fb̄, fd = bracket(a, b, x, fa, fb, fx)

    if ((b̄ - ā) <= tolₑ(ā, b̄, fā, fb̄, atol, rtol) ||
        iszero(fx) ||      # exact zero
        !isbracket(fā, fb̄)) # catch non bracket?, issue #453
        @reset o.xn0 = ā
        @reset o.xn1 = b̄
        @reset o.fxn0 = fā
        @reset o.fxn1 = fb̄
        return o, true
    end

    u, fu = abs(fā) < abs(fb̄) ? (ā, fā) : (b̄, fb̄)

    # 4.16 double secant step
    fab⁻¹ = (b̄ - ā) / (fb̄ - fā)
    c̄ = u - 2 * fab⁻¹ * fu                  # 4.16

    if 2abs(u - c̄) > b̄ - ā                  # 4.17
        c̄ = __middle(ā, b̄)
    end

    c̄ = avoid_boundaries(ā, c̄, b̄, fā, fb̄, tols)
    fc̄ = first(F(c̄))
    incfn(l)
    (iszero(fc̄) || !isfinite(fc̄)) && return (_set(o, (c̄, fc̄)), true)

    â, b̂, d̂, fâ, fb̂, fd̂ = bracket(ā, b̄, c̄, fā, fb̄, fc̄) # 4.18

    if (b̂ - â) < μ * δ₀                        # 4.19
        ee, fee = d, fd
        a, b, d, fa, fb, fd = â, b̂, d̂, fâ, fb̂, fd̂
    else
        m = __middle(ā, b̄)
        m = avoid_boundaries(â, m, b̂, fâ, fb̂, tols)

        fm = first(F(m))
        incfn(l)
        (iszero(fm) || !isfinite(fm)) && return (_set(o, (m, fm)), true)

        ee, fee = d̂, fd̂
        a, b, d, fa, fb, fd = bracket(â, b̂, m, fâ, fb̂, fm)
    end

    @reset o.xn0 = a
    @reset o.xn1 = b
    @reset o.d = d
    @reset o.ee = ee
    @reset o.fxn0 = fa
    @reset o.fxn1 = fb
    @reset o.fd = fd
    @reset o.fee = fee

    return o, false
end

## --- Methods
# algorithms 2.4 and 2.5 can be implemented this way:
# @note-start id=2dpri3 color=purple
# ## A2425: implementa los algoritmos 2.4 (`K=1`) y 2.5 (`K=2`) del paper
# Tipo sin campos, parametrizado por `K`: número de refinamientos de Newton que
# hace `newton_quadratic` en cada llamada a `calculateΔ`. `K=2` es el algoritmo
# público [`AlefeldPotraShi`](@ref).
#
# No tiene campos propios (subtipo vacío de `AbstractAlefeldPotraShi`).
#
# **Invariante:** `K` es un parámetro de tipo (conocido en tiempo de compilación),
# no un valor de campo.
# @note-body-end
struct A2425{K} <: AbstractAlefeldPotraShi end
# @note-end
# @note-start id=9z9rv9 color=green
# ## calculateΔ (A2425): corrección por interpolación cuadrática iterada
# Refina `K` veces el cero del interpolante cuadrático por `(a,fa)`, `(b,fb)`,
# `(d,fd)` con `newton_quadratic`, reestrechando el bracket entre refinamientos
# con `bracket`. Si en algún punto `f` da un valor no finito, se abandona y se
# devuelve el último `c₀` válido.
#
# **Auxiliar interna**
# **Usada por:** `update_state` (línea `Δ, ps = calculateΔ(M, F, c, ps)`), que
# necesita `Δ = c₀ - c` para proponer el siguiente punto `x = c - Δ`, y el `ps`
# actualizado (bracket ya estrechado) para no repetir evaluaciones de `f`.
# **Papel:** es el punto de personalización que distingue esta familia de
# algoritmos de otras (p.ej. `A57`); implementa la interpolación cuadrática pura.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `::A2425{K}` | tipo | `K`: nº de iteraciones de refinamiento. |
# | `F` | `Callable_Function` | Función objetivo. |
# | `c₀` | `T` | Punto de partida (el de menor `\|f\|` entre `a` y `b`). |
# | `ps` | `NamedTuple` | Debe contener `a,b,d,ee,fa,fb,fd,fee,atol,rtol`. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `(Δ, ps)` | `Δ = c₀ - c` (la corrección) y `ps` con `a,b,d,fa,fb,fd` actualizados. |
# @note-body-end
function calculateΔ(::A2425{K}, F::Callable_Function, c₀::T, ps) where {K,T}
# @note-end
    a, b, d, ee = ps.a, ps.b, ps.d, ps.ee
    fa, fb, fd, fee = ps.fa, ps.fb, ps.fd, ps.fee
    tols = (λ=oftype(float(ps.rtol), 0.7), atol=ps.atol, rtol=ps.rtol)

    c = a
    for k in 1:K
        c = newton_quadratic(a, b, d, fa, fb, fd, k + 1)

        k == K && break
        c = avoid_boundaries(a, c, b, fa, fb, tols)
        fc = first(F(c))
        a, b, d, fa, fb, fd = bracket(a, b, c, fa, fb, fc)

        iszero(fc) && break
        if (isnan(fc) || !isfinite(c))
            c = c₀
            break
        end
    end

    @reset ps.a = a
    @reset ps.fa = fa
    @reset ps.b = b
    @reset ps.fb = fb
    @reset ps.d = d
    @reset ps.fd = fd

    c₀ - c, ps
end

"""
    Roots.AlefeldPotraShi()

Follows Algorithm 4.1 in "ON ENCLOSING SIMPLE ROOTS OF NONLINEAR
EQUATIONS", by Alefeld, Potra, Shi; DOI:
[10.1090/S0025-5718-1993-1192965-2](https://doi.org/10.1090/S0025-5718-1993-1192965-2).

The order of convergence is `2 + √5`; asymptotically there are 3 function evaluations per step.
Asymptotic efficiency index is ``(2+√5)^{1/3} ≈ 1.618...``. Less efficient, but can run faster than the related [`A42`](@ref) method.

Originally by John Travers.
"""
# @note-start id=yntduk color=purple
# ## AlefeldPotraShi: alias público que fija `A2425{K=2}`
# Es el nombre exportado del algoritmo 4.1 del paper de 1993 (documentado justo
# encima). Al fijar `K=2`, `calculateΔ` hace dos refinamientos de Newton por
# paso.
#
# No añade campos ni comportamiento propio: es exactamente `A2425{2}`.
# @note-body-end
const AlefeldPotraShi = A2425{2}
# @note-end

# Algorithm 5.7 is parameterized by K
# 4.1 -> K=1; 4.2 -> K=2
# @note-start id=4695kd color=purple
# ## A57: implementa el algoritmo 5.7 del paper, parametrizado por `K`
# Tipo sin campos. `K=1` da el algoritmo 4.1 y `K=2` el algoritmo 4.2 (= [`A42`](@ref)):
# combina interpolación cúbica inversa (`ipzero`) con repliegue a cuadrática
# (`newton_quadratic`) cuando la cúbica no es fiable o cae fuera del bracket.
#
# No tiene campos propios.
#
# **Invariante:** `K` es un parámetro de tipo, no un campo.
# @note-body-end
struct A57{K} <: AbstractAlefeldPotraShi end
# @note-end
# @note-start id=zqx3tu color=blue
# ## fncalls_per_step (A57): evaluaciones extra que gasta `calculateΔ`
# **API pública** (especialización del hook del framework para `A57`): a
# diferencia del valor por defecto (`1`), cada una de las `K-1` iteraciones
# internas de refinamiento evalúa `f` una vez más, aparte de la evaluación final
# que hace `update_state` sobre `x`.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `::A57{K}` | tipo | `K`: nº de iteraciones de `calculateΔ`. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `Int` | `K - 1`. |
# @note-body-end
fncalls_per_step(::A57{K}) where {K} = K - 1
# @note-end
# @note-start id=wfto2t color=green
# ## calculateΔ (A57): corrección por interpolación cúbica inversa con repliegue
# En cada una de las `K` iteraciones, usa `ipzero` (interpolación cúbica inversa
# por `a,b,d,ee`) cuando `ee` ya está definida y los cuatro valores de `f` son
# distintos entre sí (`_pairwise_prod ≠ 0`); si no, o si el resultado cae fuera de
# `(a,b)`, repliega a `newton_quadratic`. Reestrecha el bracket con `bracket`
# entre iteraciones, guardando el punto descartado como nuevo `ee`.
#
# **Auxiliar interna**
# **Usada por:** `update_state`, igual que la versión de `A2425`: aporta `Δ` y el
# `ps` con el bracket ya estrechado.
# **Papel:** punto de personalización de `A57`/[`A42`](@ref); es la parte que da
# a este método su orden de convergencia superior (interpolación cúbica cuando es
# segura).
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `::A57{K}` | tipo | `K`: nº de iteraciones. |
# | `F` | `Callable_Function` | Función objetivo. |
# | `c₀` | `T` | Punto de partida. |
# | `ps` | `NamedTuple` | `a,b,d,ee,fa,fb,fd,fee,atol,rtol`. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `(Δ, ps)` | `Δ = c₀ - c` y `ps` actualizado, incluyendo `ee,fee`. |
#
# ```mermaid
# flowchart TD
#     A["¿ee es NaN o fa,fb,fd,fee no son distintos?"] -->|sí| B["c = newton_quadratic(...)"]
#     A -->|no| C["c = ipzero(a,b,d,ee,...)"]
#     C --> D{"c ∉ (a,b)?"}
#     D -->|sí| B
#     D -->|no| E["usar c"]
# ```
# @note-body-end
function calculateΔ(::A57{K}, F::Callable_Function, c₀::T, ps) where {K,T}
# @note-end
    a, b, d, ee = ps.a, ps.b, ps.d, ps.ee
    fa, fb, fd, fee = ps.fa, ps.fb, ps.fd, ps.fee
    tols = (λ=oftype(float(ps.rtol), 0.7), atol=ps.atol, rtol=ps.rtol)
    c, fc = a, fa

    for k in 1:K
        if isnan(ee) || iszero(_pairwise_prod(fa, fb, fd, fee))
            c = newton_quadratic(a, b, d, fa, fb, fd, k + 1)
        else
            c = ipzero(a, b, d, ee, fa, fb, fd, fee)
            if (c <= a || b <= c)
                c = newton_quadratic(a, b, d, fa, fb, fd, k + 1)
            end
        end

        k == K && break

        ee, fee = d, fd
        c = avoid_boundaries(a, c, b, fa, fb, tols)
        fc = first(F(c))
        a, b, d, fa, fb, fd = bracket(a, b, c, fa, fb, fc)

        iszero(fc) && break # fa or fb is 0
        if (!isfinite(fc) || !isfinite(c))
            c = c₀
            break
        end
    end
    @reset ps.a = a
    @reset ps.fa = fa
    @reset ps.b = b
    @reset ps.fb = fb
    @reset ps.d = d
    @reset ps.fd = fd
    @reset ps.ee = ee
    @reset ps.fee = fee

    c₀ - c, ps
end

"""
    Roots.A42()

Bracketing method which finds the root of a continuous function within
a provided bracketing interval `[a, b]`, without requiring derivatives. It is based
on Algorithm 4.2 described in: G. E. Alefeld, F. A. Potra, and
Y. Shi, "Algorithm 748: enclosing zeros of continuous functions," ACM
Trans. Math. Softw. 21, 327–344 (1995), DOI: [10.1145/210089.210111](https://doi.org/10.1145/210089.210111).
The asymptotic efficiency index, ``q^{1/k}``, is ``(2 + 7^{1/2})^{1/3} = 1.6686...``.

Originally by John Travers.

!!! note

    The paper referenced above shows that for a continuously differentiable ``f`` over ``[a,b]`` with a simple root  the algorithm terminates at a zero or asymptotically the steps are of the inverse cubic type (Lemma 5.1). This is proved under an assumption that ``f`` is four-times continuously differentiable.

"""
# @note-start id=ppdc1v color=purple
# ## A42: alias público que fija `A57{K=2}`, algoritmo 4.2 del paper de 1995
# Documentado justo encima. Con `K=2`, `calculateΔ` hace hasta dos iteraciones de
# interpolación cúbica inversa / cuadrática por paso, dando el orden de
# convergencia $q^{1/k} = (2+\sqrt7)^{1/3} \approx 1.6686$.
#
# No añade campos ni comportamiento propio: es exactamente `A57{2}`.
# @note-body-end
const A42 = A57{2}
# @note-end

## --- utilities

## Brent-style tole from paper
# @note-start id=zy2ee9 color=green
# ## tolₑ: tolerancia efectiva de convergencia, estilo Brent
# Combina tolerancia relativa y absoluta, ponderada por la magnitud del extremo
# cuya imagen tiene menor valor absoluto (el que se considera "mejor" estimación
# de la raíz):
#
# $$
# \text{tol}_e = 2\,u\,\text{rtol} + \text{atol}, \qquad
# u = \begin{cases} |a| & \text{si } |f(a)| < |f(b)| \\ |b| & \text{en otro caso} \end{cases}
# $$
#
# **Auxiliar interna**
# **Usada por:** `update_state` (comprueba si `b - a ≤ tolₑ` para declarar
# convergencia) y `avoid_boundaries` (para decidir el margen `δ` cerca de los
# extremos).
# **Papel:** único criterio de parada del método; no se compara `|f(x)|` contra
# `atol`/`rtol`, solo el tamaño del intervalo.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `a`, `b` | `T` | Extremos del bracket actual. |
# | `fa`, `fb` | `S` | `f(a)`, `f(b)`. |
# | `atol`, `rtol` | `T`/`Real` | Tolerancias absoluta y relativa pedidas por el usuario. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `T` | Tolerancia efectiva `tolₑ`. |
# @note-body-end
function tolₑ(a, b, fa, fb, atol, rtol)
# @note-end
    u = abs(fa) < abs(fb) ? abs(a) : abs(b)
    return 2 * u * rtol + atol
end

## adjustment before calling bracket
# @note-start id=klay3f color=green
# ## avoid_boundaries: aleja el candidato `c` de los extremos del bracket
# Si el intervalo `[a,b]` ya es más pequeño que `4δ` (con `δ = λ·tolₑ`), fuerza
# `c` al punto medio; si `c` cae a menos de `2δ` de `a` o de `b`, lo desplaza a
# `a + 2δ` o `b - 2δ`. Evita pasos de interpolación degenerados demasiado
# pegados al borde del bracket.
#
# **Auxiliar interna**
# **Usada por:** `update_state` (antes de evaluar `F` en el punto propuesto por
# la interpolación o la secante doble) y `calculateΔ` (`A2425` y `A57`, antes de
# cada evaluación interna de `f`).
# **Papel:** salvaguarda numérica compartida por todo el método: garantiza que
# nunca se evalúa `f` arbitrariamente cerca de un extremo ya conocido.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `a`, `b` | `T` | Extremos del bracket. |
# | `c` | `T` | Punto candidato a ajustar. |
# | `fa`, `fb` | `S` | `f(a)`, `f(b)` (para calcular `tolₑ`). |
# | `tols` | `NamedTuple` | `(λ, atol, rtol)`. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `T` | `c` ajustado (o el original, si ya estaba lejos de los bordes). |
# @note-body-end
function avoid_boundaries(a, c, b, fa, fb, tols)
# @note-end
    δ = tols.λ * tolₑ(a, b, fa, fb, tols.atol, tols.rtol)

    if (b - a) ≤ 4δ
        c = a / 2 + b / 2
    elseif c ≤ a + 2δ
        c = a + 2δ
    elseif c ≥ b - 2δ
        c = b - 2δ
    end
    c
end

# assume fc != 0
## return a1,b1,d with a < a1 <  < b1 < b, d not there
# @note-start id=odm5ld color=green
# ## bracket: estrecha `[a,b]` usando un tercer punto `c` con `fc ≠ 0`
# Comprueba en qué mitad del intervalo cambia de signo `f` (`isbracket(fa,fc)`) y
# devuelve esa mitad como nuevo bracket; el extremo descartado se devuelve como
# `d`, para reutilizarlo luego en interpolación.
#
# **Auxiliar interna**
# **Usada por:** `init_state`, `update_state` (tres veces: tras el primer paso,
# tras la secante doble y tras el paso extra de bisección) y ambas versiones de
# `calculateΔ`.
# **Papel:** primitiva de acotación compartida por todo el método; es la que
# mantiene la invariante de que `[a,b]` siempre acota la raíz.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `a`, `b` | `T` | Bracket actual (`a < b`). |
# | `c` | `T` | Punto interior, con `fc` distinto de cero. |
# | `fa`, `fb`, `fc` | `S` | Imágenes de `a`, `b`, `c`. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `(a₁, b₁, d, fa₁, fb₁, fd)` | Nuevo bracket `a₁ < ... < b₁` (con `c` como uno de los dos extremos) y `d` = extremo descartado, con sus imágenes. |
# @note-body-end
@inline function bracket(a, b, c, fa, fb, fc)
# @note-end
    if isbracket(fa, fc)
        # switch b,c
        return (a, c, b, fa, fc, fb)
    else
        # switch a,c
        return (c, b, a, fc, fb, fa)
    end
end

# f[a, b] divided differences
# @note-start id=14pxlw color=green
# ## f_ab: diferencia dividida de primer orden $f[a,b]$
# $$
# f[a,b] = \frac{f(b) - f(a)}{b - a}
# $$
#
# **Auxiliar interna**
# **Usada por:** `f_abd` y `newton_quadratic`: ambas necesitan la pendiente de la
# secante como coeficiente del interpolante (cuadrático o lineal de repliegue).
# **Papel:** bloque básico de todos los interpolantes polinómicos del archivo.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `a`, `b` | `T` | Dos puntos distintos. |
# | `fa`, `fb` | `S` | `f(a)`, `f(b)`. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `S/T` | Diferencia dividida $f[a,b]$. |
# @note-body-end
@inline f_ab(a, b, fa, fb) = (fb - fa) / (b - a)
# @note-end

# f[a,b,d]
# @note-start id=ttftn8 color=green
# ## f_abd: diferencia dividida de segundo orden $f[a,b,d]$
# $$
# f[a,b,d] = \frac{f[b,d] - f[a,b]}{d - a}
# $$
#
# **Auxiliar interna**
# **Usada por:** `newton_quadratic`, como coeficiente cuadrático `A` del
# interpolante $P(x) = f_a + f[a,b](x-a) + f[a,b,d](x-a)(x-b)$.
# **Papel:** segundo peldaño de las diferencias divididas de Newton usadas por
# la interpolación cuadrática.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `a`, `b`, `d` | `T` | Tres puntos distintos. |
# | `fa`, `fb`, `fd` | `S` | Sus imágenes. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `S/T` | Diferencia dividida $f[a,b,d]$. |
# @note-body-end
@inline function f_abd(a, b, d, fa, fb, fd)
# @note-end
    fab, fbd = f_ab(a, b, fa, fb), f_ab(b, d, fb, fd)
    (fbd - fab) / (d - a)
end

# iterative quadratic solution to P(x) = 0 where P=f(a) + f[a,b]*(x-a) + f[a,b,d]*(x-a)*(x-b)
# @note-start id=6yyttz color=green
# ## newton_quadratic: refina con Newton el cero del interpolante cuadrático
# Construye $P(x) = f_a + f[a,b]\,(x-a) + f[a,b,d]\,(x-a)(x-b)$ y aplica `k`
# pasos de Newton partiendo de `a` o `b` (el extremo cuyo signo de `f` coincide
# con el signo del coeficiente cuadrático `A`). Si `A` es cero o no finito,
# repliega directamente a un paso de secante `a - fa/B`.
#
# **Auxiliar interna**
# **Usada por:** `calculateΔ` de `A2425` y de `A57` (esta última como repliegue
# cuando la interpolación cúbica inversa no es aplicable o cae fuera del
# bracket).
# **Papel:** paso de interpolación "seguro" del método: siempre produce un valor
# finito cuando `A` degenera.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `a`, `b`, `d` | `T` | Los tres puntos del interpolante. |
# | `fa`, `fb`, `fd` | `S` | Sus imágenes. |
# | `k` | `Int` | Nº de iteraciones de Newton sobre `P`. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `T` | Estimación de la raíz de `P` (o de la secante, si `A` degenera). |
# @note-body-end
function newton_quadratic(a, b, d, fa, fb, fd, k::Int)
# @note-end
    A = f_abd(a, b, d, fa, fb, fd)
    B = f_ab(a, b, fa, fb)

    (iszero(A) || !isfinite(A)) && return a - fa / B

    r = sign(A) * sign(fa) > 0 ? a : b

    for i in 1:k
        P = fa + B * (r - a) + A * (r - a) * (r - b)
        P′ = (B + A * (2r - a - b))
        r -= P / P′
    end

    return r
end

# zero of inverse interpolation polynomial through (a,fa), (b,fb), (c,fc), (d, fd)
# may not lie in [a,b], though asymptotically will under smoothness assumptions
# @note-start id=8jegte color=green
# ## ipzero: interpolación cúbica inversa (algoritmo de Neville) por 4 puntos
# Calcula la raíz aproximada mediante interpolación inversa (interpola `x` como
# función de `f`) sobre la tabla de diferencias divididas de Neville construida
# con `(a,fa)`, `(b,fb)`, `(c,fc)`, `(d,fd)`. El resultado puede caer fuera de
# `[a,b]`; asintóticamente, para `f` suave, cae dentro (por eso quien la llama
# comprueba `c ∉ (a,b)` y repliega a `newton_quadratic` si es necesario).
#
# **Auxiliar interna**
# **Usada por:** `calculateΔ` de `A57`, con la llamada
# `ipzero(a, b, d, ee, fa, fb, fd, fee)`: el 3er y 4º punto de esta función
# (`c`, `d` en su firma) son en realidad los puntos `d` y `ee` del estado del
# iterador, no letras nuevas.
# **Papel:** es el paso que da al método `A57`/[`A42`](@ref) su orden de
# convergencia superior al de la interpolación cuadrática pura.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `a`, `b`, `c`, `d` | `T` | Cuatro puntos distintos (en la llamada real: `a`, `b`, `d`, `ee`). |
# | `fa`, `fb`, `fc`, `fd` | `S` | Sus imágenes. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `T` | Estimación de la raíz por interpolación cúbica inversa. |
# @note-body-end
function ipzero(a, b, c, d, fa, fb, fc, fd)
# @note-end
    Q11 = (c - d) * fc / (fd - fc)
    Q21 = (b - c) * fb / (fc - fb)
    Q31 = (a - b) * fa / (fb - fa)
    D21 = (b - c) * fc / (fc - fb)
    D31 = (a - b) * fb / (fb - fa)
    Q22 = (D21 - Q11) * fb / (fd - fb)
    Q32 = (D31 - Q21) * fa / (fc - fa)
    D32 = (D31 - Q21) * fc / (fc - fa)
    Q33 = (D32 - Q22) * fa / (fd - fa)
    a + (Q31 + Q32 + Q33)
end

# check if fa,fb,fc,fd are distinct
# @note-start id=jingb5 color=green
# ## _pairwise_prod: producto de todas las diferencias por pares
# $$
# \prod_{i<j} (a_i - a_j)
# $$
# Da cero si y solo si al menos dos de los valores de entrada coinciden.
#
# **Auxiliar interna**
# **Usada por:** `calculateΔ` de `A57`, para comprobar que `fa`, `fb`, `fd`,
# `fee` son distintos entre sí antes de intentar `ipzero`.
# **Papel:** guarda numérica que evita divisiones por cero dentro de la
# interpolación cúbica inversa (`ipzero` divide por diferencias `fx - fy`).
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `as...` | `S...` (varargs) | Valores a comparar por pares (en la práctica, `fa,fb,fd,fee`). |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `S` | Producto de todas las diferencias `aᵢ - aⱼ` con `i<j`; `0` si hay repetidos. |
# @note-body-end
function _pairwise_prod(as...)
# @note-end
    t = one(first(as))
    n = length(as)
    for i in 1:(n - 1)
        for j in (i + 1):n
            t *= (as[i] - as[j])
        end
    end
    t
end
