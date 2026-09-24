"""Demo de NoteFold: pasa el ratón por el código marcado en azul."""


def weighted_mean(xs, ws):
    # @note-start id=k3x9qa
    # Aquí calculamos la **media ponderada**.
    # - `w` son los pesos
    # - se normaliza al final dividiendo por la suma de pesos
    # @note-body-end
    total = sum(w * x for w, x in zip(ws, xs))
    normalized = total / sum(ws)
    # @note-end
    return normalized


# @note-start id=m2p7zt color=green
# Punto de entrada. Nota de **una sola línea** de código.
# @note-body-end
if __name__ == "__main__":
    # @note-end
    print(weighted_mean([1, 2, 3], [0.2, 0.3, 0.5]))


def broken_example():
    # Esta nota está mal formada a propósito (falta @note-end):
    # debe aparecer un warning en la línea de @note-start y NO romper nada.
    # @note-start id=bad001
    # cuerpo
    # @note-body-end
    return 42
