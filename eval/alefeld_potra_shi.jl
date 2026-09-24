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
# @note-start id=mv9k4h color=purple
# ## AbstractAlefeldPotraShi: tipo abstracto de acorralamiento
# Tipo abstracto raíz de todos los métodos de acorralamiento (bracketing)
# de la familia Alefeld-Potra-Shi. No define campos propios: cada subtipo
# concreto (`A2425{K}`, `A57{K}`) es un struct vacío que solo sirve para
# el despacho de `calculateΔ`.
#
# **Campos**
#
# | Campo | Tipo | Descripción |
# |---|---|---|
# | — | — | No tiene campos; es un tipo marcador (los subtipos tampoco añaden campos). |
#
# **Invariante:** todo subtipo debe tener un método `calculateΔ(::Subtipo, F, c₀, ps)`
# que devuelva `(Δ, ps)`; `update_state` depende de ese contrato para funcionar
# con cualquier variante del algoritmo.
# @note-body-end
abstract type AbstractAlefeldPotraShi <: AbstractNonStrictBracketingMethod end
# @note-end

# @note-start id=kh05wb color=blue
# ## initial_fncalls: nº de evaluaciones de f para iniciar
# Devuelve cuántas llamadas a `f` exige el paso inicial de cualquier
# `AbstractAlefeldPotraShi` antes de la primera iteración (por defecto 3:
# `fx₀`, `fx₁` y `fc`).
#
# **API pública** (hook de contabilidad llamado por el bucle genérico de
# `solve` de Roots.jl, fuera de este archivo).
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `::AbstractAlefeldPotraShi` | tipo | Método en uso; solo se usa para el despacho. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `Int` | Número de evaluaciones de `f` contabilizadas antes de iterar. |
# @note-body-end
initial_fncalls(::AbstractAlefeldPotraShi) = 3 # worst case assuming fx₀, fx₁,fc must be computed
# @note-end

## initial step, needs to log a,b,d
# @note-start id=nt6tb2 color=blue
# ## log_step: registra el estado en el historial de Tracks
# Añade `a,b` (y en el paso inicial también `c`) al histórico de
# convergencia `l::Tracks`, para poder graficar o depurar el método.
#
# **API pública** (hook de trazado llamado por el bucle genérico de
# `solve` de Roots.jl, fuera de este archivo).
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `l` | `Tracks` | Registro donde se acumulan los pasos. |
# | `M` | `AbstractAlefeldPotraShi` | Método en uso; solo se usa su nombre de tipo. |
# | `state` | `AbstractAlefeldPotraShiState` (inferido) | Estado actual (usa `state.xn0`, `xn1`, `d`). |
# | `init` | `Bool` (por defecto `false`) | Si es `true`, registra el paso inicial (incluye `c`) en vez de un paso normal. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `Nothing` | No devuelve nada útil. |
#
# Modifica `l` como efecto lateral (añade una entrada vía `push!` y `log_iteration`).
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

# @note-start id=85uzy2 color=purple
# ## AbstractAlefeldPotraShiState: estado del acorralamiento
# Guarda el intervalo de acorralamiento actual `[xn0,xn1] = [a,b]` más los
# dos puntos auxiliares `d`, `ee` usados por la interpolación (cuadrática o
# cúbica inversa), junto con sus valores de `f`.
#
# **Campos**
#
# | Campo | Tipo | Descripción |
# |---|---|---|
# | `xn1` | `T` | Extremo `b` del intervalo (el más reciente). |
# | `xn0` | `T` | Extremo `a` del intervalo. |
# | `d` | `T` | Punto auxiliar más reciente fuera de `[a,b]`, usado en la interpolación. |
# | `ee` | `T` | Punto auxiliar de la iteración anterior a `d`. |
# | `fxn1` | `S` | `f(xn1)`. |
# | `fxn0` | `S` | `f(xn0)`. |
# | `fd` | `S` | `f(d)`. |
# | `fee` | `S` | `f(ee)`. |
#
# **Invariante:** tras `init_state`/`update_state`, `fxn0` y `fxn1` tienen
# signos opuestos (o alguno es cero), de forma que la raíz queda acorralada
# en `[xn0,xn1]`.
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
# @note-start id=kbqcz2 color=blue
# ## init_state: crea el estado inicial desde x₀,x₁
# Ordena el intervalo `[x₀,x₁]` con `a<b`, calcula (o reutiliza) un tercer
# punto interior `c` —por secante, o por el punto medio si el intervalo
# cruza el cero— y usa `bracket` para obtener el estado inicial `(a,b,d)`
# que requiere `update_state`. Devuelve inmediatamente si algún extremo o
# `c` ya es una raíz (exacta o no finita).
#
# **API pública** (hook llamado por el bucle genérico de `solve` de
# Roots.jl, fuera de este archivo).
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `::AbstractAlefeldPotraShi` | tipo | Método en uso; solo se usa para el despacho. |
# | `F` | `Callable_Function` | Función envuelta a evaluar. |
# | `x₀`, `x₁` | (inferido) | Extremos del intervalo inicial. |
# | `fx₀`, `fx₁` | (inferido) | `f(x₀)`, `f(x₁)`. |
# | `c` | `Union{Nothing,Real}` (por defecto `nothing`) | Punto interior opcional; si es `nothing` se calcula. |
# | `fc` | `Union{Nothing,Real}` (por defecto `nothing`) | `f(c)`; se ignora y recalcula si `c` es `nothing`. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `AbstractAlefeldPotraShiState` | Estado inicial listo para la primera llamada a `update_state`. |
#
# **Errores:** `assert_bracket` lanza si `fa` y `fb` no acorralan una raíz
# (se comprueba antes y después de introducir `c`).
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
# @note-start id=k3o6pd color=green
# ## fncalls_per_step (por defecto): 1 llamada a f
# Valor por defecto del número de llamadas a `f` que hace `calculateΔ` en
# cada iteración; los métodos concretos lo sobrescriben cuando difiere
# (por ejemplo `A57{K}`, ver nota de `fncalls_per_step (A57{K})`).
#
# **Auxiliar interna**
# **Usada por:** `update_state`: necesita este valor exacto para contabilizar
# correctamente las evaluaciones de `f` mediante `incfn`.
# **Papel:** contabilidad del coste (nº de evaluaciones de `f`) del algoritmo.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `::AbstractAlefeldPotraShi` | tipo | Método en uso; solo se usa para el despacho. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `Int` | Siempre `1` en este método por defecto. |
# @note-body-end
fncalls_per_step(::AbstractAlefeldPotraShi) = 1
# @note-end

# @note-start id=yjvv25 color=blue
# ## update_state: una iteración del método de acorralamiento
# Da un paso interpolatorio (vía `calculateΔ`), lo combina opcionalmente
# con un doble paso de secante (4.16–4.19 del paper) y devuelve el nuevo
# estado acorralado junto con un indicador de convergencia. Implementa el
# núcleo de los algoritmos 4.1/5.7 de Alefeld-Potra-Shi.
#
# **API pública** (hook llamado por el bucle genérico de `solve` de
# Roots.jl, fuera de este archivo).
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `M` | `AbstractAlefeldPotraShi` | Método concreto (`A2425{K}` o `A57{K}`); determina `calculateΔ` por despacho. |
# | `F` | `Callable_Function` | Función envuelta a evaluar. |
# | `o` | `AbstractAlefeldPotraShiState{T,S}` | Estado actual (`a,b,d,ee` y sus `f`). |
# | `options` | (inferido) | Opciones de parada: `options.xabstol`, `options.xreltol`. |
# | `l` | `Tracks`/`NullTracks` (por defecto `NullTracks()`) | Registro opcional de convergencia. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `(AbstractAlefeldPotraShiState, Bool)` | Nuevo estado y `true` si ha convergido, `false` si debe continuar. |
#
# Modifica `l` (vía `incfn`), contabilizando las llamadas a `f`.
#
# **Cómo funciona**
#
# ```mermaid
# flowchart TD
#     A["calculateΔ(M,F,c,ps)"] --> B{"¿fa=0 ó fb=0 ó b-a≤tolₑ?"}
#     B -- sí --> R1["converge: devuelve (a,b)"]
#     B -- no --> C["x = c-Δ; bracket(a,b,x,...)"]
#     C --> D{"¿b̄-ā≤tolₑ ó fx=0 ó no acorrala?"}
#     D -- sí --> R2["converge: devuelve (ā,b̄)"]
#     D -- no --> E["doble paso de secante 4.16-4.19"]
#     E --> F["bracket(â,b̂,...)"]
#     F --> R3["siguiente iteración: (a,b,d,ee)"]
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
# @note-start id=kob0c7 color=purple
# ## A2425{K}: método con K pasos de Newton cuadrático
# Struct vacío (tipo marcador) que selecciona, por despacho, la variante
# de `calculateΔ` basada en `K` pasos de `newton_quadratic` (algoritmos
# 2.4/2.5 del paper). Parametrizado por `K`, el número de iteraciones de
# Newton en la cuadrática interpolante.
#
# **Campos**
#
# | Campo | Tipo | Descripción |
# |---|---|---|
# | — | — | No tiene campos; solo sirve para el despacho de tipos. |
#
# **Invariante:** `K` debe ser un entero ≥ 1 (nº de pasos de
# `newton_quadratic` en cada llamada a `calculateΔ`).
# @note-body-end
struct A2425{K} <: AbstractAlefeldPotraShi end
# @note-end
# @note-start id=x4rzm1 color=green
# ## calculateΔ (A2425{K}): Δ por Newton cuadrático iterado
# Refina `c₀` aplicando hasta `K` veces `newton_quadratic`, actualizando el
# acorralamiento `(a,b,d)` tras cada paso salvo el último. Implementa los
# algoritmos 2.4/2.5 del paper.
#
# **Auxiliar interna**
# **Usada por:** `update_state` (llama a `calculateΔ(M,...)`, con `M::A2425{K}`,
# como paso de interpolación de cada iteración): decide el siguiente punto
# a probar.
# **Papel:** calcula el incremento `Δ = c₀ - c` que `update_state` usa para
# proponer el punto `x = c - Δ`.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `::A2425{K}` | tipo | Método en uso; `K` fija el número de iteraciones de Newton. |
# | `F` | `Callable_Function` | Función envuelta a evaluar. |
# | `c₀` | `T` | Punto de partida (el de `\|f\|` más pequeño entre `a` y `b`). |
# | `ps` | `NamedTuple` | Estado y tolerancias actuales: `a,b,d,ee,fa,fb,fd,fee,atol,rtol`. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `(T, NamedTuple)` | Diferencia `c₀ - c` y `ps` actualizado con el nuevo `(a,b,d,fa,fb,fd)`. |
#
# Evalúa `F` hasta `K-1` veces (la evaluación se contabiliza en el llamador
# vía `fncalls_per_step`).
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
# @note-start id=5m5vgo color=purple
# ## AlefeldPotraShi: alias público de A2425{2}
# Nombre público del método (ver el docstring justo encima: Algoritmo 4.1,
# DOI 10.1090/S0025-5718-1993-1192965-2). En tiempo de despacho es
# exactamente `A2425{2}`, por lo que `calculateΔ` usa la variante de
# interpolación cuadrática iterada con `K=2` pasos de Newton.
#
# **Campos**
#
# | Campo | Tipo | Descripción |
# |---|---|---|
# | — | — | No aplica: es un alias de tipo, no un struct nuevo. |
# @note-body-end
const AlefeldPotraShi = A2425{2}
# @note-end

# Algorithm 5.7 is parameterized by K
# 4.1 -> K=1; 4.2 -> K=2
# @note-start id=5c5ix8 color=purple
# ## A57{K}: método con interpolación cúbica inversa
# Struct vacío (tipo marcador) que selecciona la variante de `calculateΔ`
# que intenta primero interpolación cúbica inversa (`ipzero`) y recurre a
# `newton_quadratic` como respaldo (algoritmo 5.7 del paper, parametrizado
# por `K`).
#
# **Campos**
#
# | Campo | Tipo | Descripción |
# |---|---|---|
# | — | — | No tiene campos; solo sirve para el despacho de tipos. |
#
# **Invariante:** `K` debe ser un entero ≥ 1; además
# `fncalls_per_step(::A57{K}) = K - 1`, así que `K` debe ser coherente con
# el número de evaluaciones de `f` que `update_state` reserva para el paso.
# @note-body-end
struct A57{K} <: AbstractAlefeldPotraShi end
# @note-end
# @note-start id=l6lv2u color=green
# ## fncalls_per_step (A57{K}): reserva K-1 llamadas a f
# Sobrescribe el valor por defecto porque `calculateΔ(::A57{K},...)` evalúa
# `F` hasta `K-1` veces en su bucle interno (una vez menos que iteraciones,
# ya que la última no reevalúa).
#
# **Auxiliar interna**
# **Usada por:** `update_state`: necesita este valor exacto para `incfn`,
# de modo que el contador de llamadas a `f` coincida con las evaluaciones
# reales de `calculateΔ`.
# **Papel:** contabilidad del coste del algoritmo, análoga a la de
# `fncalls_per_step` por defecto pero específica de `A57{K}`.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `::A57{K}` | tipo | Método en uso; `K` se extrae por despacho. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `Int` | `K - 1`. |
# @note-body-end
fncalls_per_step(::A57{K}) where {K} = K - 1
# @note-end
# @note-start id=j98a6f color=green
# ## calculateΔ (A57{K}): Δ vía interpolación cúbica inversa
# En cada uno de los `K` pasos, intenta `ipzero` (interpolación cúbica
# inversa por diferencias divididas) y solo recurre a `newton_quadratic`
# si `ee` es `NaN`, los cuatro valores de `f` no son distintos entre sí
# (`_pairwise_prod = 0`) o el resultado cae fuera de `(a,b)`. Actualiza el
# acorralamiento tras cada paso salvo el último.
#
# **Auxiliar interna**
# **Usada por:** `update_state` (llama a `calculateΔ(M,...)`, con `M::A57{K}`,
# como paso de interpolación de cada iteración): mismo papel que la
# variante `A2425{K}`, calcula el `Δ` del siguiente punto a probar.
# **Papel:** paso de interpolación de mayor orden (cúbico) del algoritmo
# 5.7; el respaldo cuadrático garantiza que el paso avance incluso cuando
# la interpolación cúbica es numéricamente inestable.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `::A57{K}` | tipo | Método en uso; `K` fija el número de iteraciones. |
# | `F` | `Callable_Function` | Función envuelta a evaluar. |
# | `c₀` | `T` | Punto de partida (el de `\|f\|` más pequeño entre `a` y `b`). |
# | `ps` | `NamedTuple` | Estado y tolerancias actuales: `a,b,d,ee,fa,fb,fd,fee,atol,rtol`. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `(T, NamedTuple)` | Diferencia `c₀ - c` y `ps` actualizado con `(a,b,d,ee,fa,fb,fd,fee)`. |
#
# Evalúa `F` hasta `K-1` veces (contabilizado por `fncalls_per_step`).
#
# **Cómo funciona**
#
# ```mermaid
# flowchart TD
#     S{"¿ee es NaN ó _pairwise_prod=0?"} -- sí --> NQ["newton_quadratic"]
#     S -- no --> IP["ipzero(a,b,d,ee,...)"]
#     IP --> B{"¿c≤a ó c≥b?"}
#     B -- sí --> NQ
#     B -- no --> C["usar c de ipzero"]
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
# @note-start id=3aam8k color=purple
# ## A42: alias público de A57{2}
# Nombre público del método (ver el docstring justo encima: Algoritmo 4.2
# del paper). En tiempo de despacho es exactamente `A57{2}`, por lo que
# usa interpolación cúbica inversa con `newton_quadratic` como respaldo y
# `K=2`.
#
# **Campos**
#
# | Campo | Tipo | Descripción |
# |---|---|---|
# | — | — | No aplica: es un alias de tipo, no un struct nuevo. |
# @note-body-end
const A42 = A57{2}
# @note-end

## --- utilities

## Brent-style tole from paper
# @note-start id=zjuykm color=green
# ## tolₑ: tolerancia de parada al estilo Brent
# Calcula la tolerancia efectiva usada como criterio de convergencia
# (`b - a ≤ tolₑ`) y como referencia para `avoid_boundaries`.
#
# **Auxiliar interna**
# **Usada por:** `update_state` (dos veces: en el acorralamiento inicial y
# tras el paso de interpolación), `avoid_boundaries` (para calcular el
# margen `δ`): ambas necesitan una tolerancia consistente con la escala de
# `a,b`.
# **Papel:** criterio de convergencia común a `A2425{K}` y `A57{K}`.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `a`, `b` | (inferido) | Extremos actuales del intervalo. |
# | `fa`, `fb` | (inferido) | Sus valores de `f` (se usa el de menor `\|f\|` para fijar la escala). |
# | `atol`, `rtol` | (inferido) | Tolerancias absoluta y relativa. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | (inferido, mismo tipo tras promoción) | Tolerancia efectiva. |
#
# **Cómo funciona**
#
# $$
# tol_e = 2\,u\,rtol + atol, \qquad u = \begin{cases} |a| & |f_a| < |f_b| \\ |b| & \text{en otro caso} \end{cases}
# $$
# @note-body-end
function tolₑ(a, b, fa, fb, atol, rtol)
# @note-end
    u = abs(fa) < abs(fb) ? abs(a) : abs(b)
    return 2 * u * rtol + atol
end

## adjustment before calling bracket
# @note-start id=wmaypm color=green
# ## avoid_boundaries: aleja c de los extremos a y b
# Desplaza el punto de prueba `c` para que quede al menos a `2δ` de `a` y
# de `b` (o lo sustituye por el punto medio si el intervalo ya es muy
# pequeño), evitando que `bracket` reciba un punto pegado al extremo, lo
# que degradaría la convergencia.
#
# **Auxiliar interna**
# **Usada por:** `update_state` (para `x` y para el doble paso de secante
# `c̄`, `m`), `calculateΔ` de `A2425{K}` y de `A57{K}` (para el `c` interno
# de cada iteración): todas necesitan sanear el punto antes de evaluar `F`
# en él.
# **Papel:** salvaguarda numérica común a los distintos pasos de
# interpolación del archivo.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `a`, `b` | (inferido) | Extremos del intervalo. |
# | `c` | (inferido) | Punto propuesto a corregir. |
# | `fa`, `fb` | (inferido) | Valores de `f` en `a,b` (se usan para `tolₑ`). |
# | `tols` | `NamedTuple` (`λ, atol, rtol`) | `λ` pondera cuánto margen `δ` se exige. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | (inferido) | `c` corregido, dentro de `[a+2δ, b-2δ]`, o el punto medio si `b-a ≤ 4δ`. |
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
# @note-start id=5z0gju color=green
# ## bracket: reduce [a,b] preservando el acorralamiento
# Dado un tercer punto `c` con `fc ≠ 0`, decide si la raíz está en `[a,c]`
# o en `[c,b]` comparando el signo de `fc` con el de `fa`, y devuelve el
# nuevo intervalo junto con el extremo descartado como punto auxiliar `d`.
#
# **Auxiliar interna**
# **Usada por:** `init_state` (para el estado inicial), `update_state`
# (tres veces: acorralamiento de `x`, del doble-secante `c̄` y del punto
# medio `m`), `calculateΔ` de `A2425{K}` y de `A57{K}` (para actualizar
# `(a,b,d)` tras cada `c` interno): todas dependen de este paso para
# mantener el invariante de acorralamiento.
# **Papel:** operación central que preserva la propiedad de acorralamiento
# (bracketing) tras cada evaluación de `f`.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `a`, `b`, `c` | (inferido) | Extremos actuales y el nuevo punto a incorporar. |
# | `fa`, `fb`, `fc` | (inferido) | Sus valores de `f` (se asume `fc ≠ 0`). |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | `(a₁,b₁,d,fa₁,fb₁,fd)` (inferido) | Nuevo intervalo `[a₁,b₁]` que acorrala la raíz, con `a < a₁ < ... < b₁ < b`; `d` es el extremo descartado, usado luego por la interpolación. |
#
# **Cómo funciona:** si `fa` y `fc` tienen signos opuestos
# (`isbracket(fa,fc)`), la raíz está en `[a,c]` y `b` pasa a ser `d`; si
# no, está en `[c,b]` y `a` pasa a ser `d`.
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
# @note-start id=g4ydc4 color=green
# ## f_ab: diferencia dividida de primer orden
# Pendiente de la secante entre `(a,fa)` y `(b,fb)`.
#
# **Auxiliar interna**
# **Usada por:** `f_abd` (para construir la diferencia dividida de segundo
# orden), `newton_quadratic` (como coeficiente `B` del polinomio cuadrático
# de Newton): ambas construyen su interpolación a partir de esta diferencia.
# **Papel:** bloque básico de las fórmulas de diferencias divididas usadas
# en toda la interpolación cuadrática/cúbica del archivo.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `a`, `b`, `fa`, `fb` | (inferido) | Puntos y sus valores de `f`. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | (inferido) | `f[a,b] = (fb - fa) / (b - a)`. |
#
# **Cómo funciona**
#
# $$
# f[a,b] = \frac{f_b - f_a}{b - a}
# $$
# @note-body-end
@inline f_ab(a, b, fa, fb) = (fb - fa) / (b - a)
# @note-end

# f[a,b,d]
# @note-start id=f38wgj color=green
# ## f_abd: diferencia dividida de segundo orden
# Combina `f[a,b]` y `f[b,d]` para obtener el coeficiente cuadrático del
# polinomio de interpolación de Newton por diferencias divididas.
#
# **Auxiliar interna**
# **Usada por:** `newton_quadratic` (como coeficiente `A` del polinomio
# cuadrático): lo necesita para evaluar y derivar `P(x)`.
# **Papel:** segundo bloque de las diferencias divididas que alimenta
# directamente al método de Newton cuadrático.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `a`, `b`, `d`, `fa`, `fb`, `fd` | (inferido) | Los tres puntos de interpolación y sus valores de `f`. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | (inferido) | `f[a,b,d]`. |
#
# **Cómo funciona**
#
# $$
# f[a,b,d] = \frac{f[b,d] - f[a,b]}{d - a}
# $$
# @note-body-end
@inline function f_abd(a, b, d, fa, fb, fd)
# @note-end
    fab, fbd = f_ab(a, b, fa, fb), f_ab(b, d, fb, fd)
    (fbd - fab) / (d - a)
end

# iterative quadratic solution to P(x) = 0 where P=f(a) + f[a,b]*(x-a) + f[a,b,d]*(x-a)*(x-b)
# @note-start id=x5sa2i color=green
# ## newton_quadratic: raíz de la cuadrática interpolante
# Construye el polinomio cuadrático `P` que interpola `(a,fa),(b,fb),(d,fd)`
# mediante diferencias divididas y aplica `k` pasos del método de Newton,
# partiendo de `a` o `b` (el que tenga el mismo signo que `A·fa`), para
# aproximar su raíz. Si el coeficiente cuadrático `A` es (numéricamente)
# cero o no finito, degenera en un paso de secante.
#
# **Auxiliar interna**
# **Usada por:** `calculateΔ(::A2425{K})` (en cada uno de sus `K` pasos),
# `calculateΔ(::A57{K})` (como valor principal si `ee` es `NaN` o los `f`
# no son distintos, o como respaldo si `ipzero` falla): ambas lo usan como
# generador del siguiente punto de prueba.
# **Papel:** paso de interpolación de referencia (orden cuadrático) de
# todo el archivo; `A57{K}` lo usa además como respaldo de la
# interpolación cúbica.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `a`, `b`, `d`, `fa`, `fb`, `fd` | (inferido) | Los tres puntos de interpolación y sus valores de `f`. |
# | `k` | `Int` | Número de iteraciones de Newton a aplicar. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | (inferido) | Aproximación `r` de la raíz de `P` tras `k` pasos de Newton (o `a - fa/B` si `A` degenera). |
#
# **Cómo funciona**
#
# $$
# P(x) = f_a + f[a,b]\,(x-a) + f[a,b,d]\,(x-a)(x-b), \qquad r_{i+1} = r_i - \frac{P(r_i)}{P'(r_i)}
# $$
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
# @note-start id=45aw68 color=green
# ## ipzero: raíz por interpolación cúbica inversa (Neville)
# Interpola la función inversa `x(f)` mediante el algoritmo de Neville de
# diferencias divididas, a través de los cuatro puntos `(a,fa),(b,fb),
# (c,fc),(d,fd)`, y evalúa esa interpolante en `f=0`. `Qij`/`Dij` son los
# términos intermedios de la tabla triangular. El resultado puede caer
# fuera de `[a,b]` si `f` no es suave; el llamador debe comprobarlo.
#
# **Auxiliar interna**
# **Usada por:** `calculateΔ(::A57{K})`: intento principal en cada paso,
# antes de recurrir a `newton_quadratic`.
# **Papel:** paso de interpolación de orden superior (cúbico inverso) que
# da la convergencia superlineal del algoritmo 5.7 cuando funciona.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `a`, `b`, `c`, `d`, `fa`, `fb`, `fc`, `fd` | (inferido) | Cuatro puntos y sus valores de `f`, usados en la tabla de Neville. |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | (inferido) | Aproximación de la raíz; no está garantizado que quede dentro de `[a,b]`. |
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
# @note-start id=32hx2x color=green
# ## _pairwise_prod: producto de todas las diferencias por pares
# Calcula el producto de `(aᵢ - aⱼ)` para todo `i<j`; se usa para detectar
# si algún par de valores de `f` coincide (producto cero), lo que
# invalidaría la interpolación cúbica inversa por división entre cero.
#
# **Auxiliar interna**
# **Usada por:** `calculateΔ(::A57{K})`: comprueba
# `iszero(_pairwise_prod(fa,fb,fd,fee))` antes de intentar `ipzero`.
# **Papel:** guarda numérica que decide si merece la pena calcular la
# interpolación cúbica inversa.
#
# **Entradas**
#
# | Parámetro | Tipo | Descripción |
# |---|---|---|
# | `as...` | `Vararg` (inferido) | Valores a comparar (en este archivo, siempre `fa,fb,fd,fee`). |
#
# **Salida**
#
# | Tipo | Descripción |
# |---|---|
# | (inferido, mismo tipo que los elementos de `as`) | Producto `∏ᵢ<ⱼ(aᵢ - aⱼ)`; es cero si dos elementos coinciden. |
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
