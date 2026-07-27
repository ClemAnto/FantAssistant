"""Least squares for the engine's rules - stdlib only, no numpy.

`synth` needed a single regressor and solved it in closed form (`_fit_line`); the presence and FM
rules need several, so this is the generalization: normal equations + Gaussian elimination with
partial pivoting. Dependency-free and written with explicit loops on purpose - the shippable engine
is TypeScript (`app/prediction-engine`) and this file is meant to be ported line by line.

Every fit is used CROSS-FITTED by `evaluate` (coefficients estimated on one window, scored on the
other): fitting and scoring on the same window is exactly what the project's gate forbids.
"""

from __future__ import annotations

from collections.abc import Sequence

# One observation: (features, target). The intercept is NOT part of `features`; ask for it instead.
Sample = tuple[Sequence[float], float]


def solve(matrix: list[list[float]], rhs: list[float]) -> list[float] | None:
    """Gaussian elimination with partial pivoting. None when the system is singular."""
    n = len(rhs)
    # work on copies: the caller's normal equations stay inspectable after a failed solve
    a = [row[:] + [rhs[i]] for i, row in enumerate(matrix)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(a[r][col]))
        if abs(a[pivot][col]) < 1e-12:
            return None
        a[col], a[pivot] = a[pivot], a[col]
        for row in range(col + 1, n):
            factor = a[row][col] / a[col][col]
            if factor:
                for k in range(col, n + 1):
                    a[row][k] -= factor * a[col][k]
    out = [0.0] * n
    for row in range(n - 1, -1, -1):
        total = a[row][n] - sum(a[row][k] * out[k] for k in range(row + 1, n))
        out[row] = total / a[row][row]
    return out


def fit_linear(samples: Sequence[Sample], *, intercept: bool = True) -> tuple[float, ...] | None:
    """OLS. Returns (a0, a1, ... ak), a0 = intercept when requested, else (a1, ... ak).

    None when there are fewer samples than parameters or the design is degenerate (a collinear
    feature, a constant column): the caller then falls back to the simpler model rather than
    trusting coefficients that the data does not identify.
    """
    if not samples:
        return None
    width = len(samples[0][0])
    if any(len(features) != width for features, _target in samples):
        raise ValueError("all samples must have the same number of features")
    size = width + (1 if intercept else 0)
    if len(samples) < size or size == 0:
        return None

    def row_of(features: Sequence[float]) -> list[float]:
        return ([1.0] + list(features)) if intercept else list(features)

    normal = [[0.0] * size for _ in range(size)]
    right = [0.0] * size
    for features, target in samples:
        row = row_of(features)
        for i in range(size):
            right[i] += row[i] * target
            for j in range(size):
                normal[i][j] += row[i] * row[j]
    solution = solve(normal, right)
    return tuple(solution) if solution is not None else None


def predict_linear(coefficients: Sequence[float], features: Sequence[float],
                   *, intercept: bool = True) -> float:
    """Apply what `fit_linear` returned to one feature row."""
    if intercept:
        return coefficients[0] + sum(c * x for c, x in zip(coefficients[1:], features, strict=True))
    return sum(c * x for c, x in zip(coefficients, features, strict=True))


def spearman(pairs: Sequence[tuple[float, float]]) -> float | None:
    """Rank correlation - the auction cares about the ORDER, not the absolute value.

    Ties get the average rank, so a batch of identical predictions (what an anchor-only fallback
    produces) is not silently rewarded.
    """
    if len(pairs) < 3:
        return None
    ranks_x = _ranks([x for x, _y in pairs])
    ranks_y = _ranks([y for _x, y in pairs])
    n = len(pairs)
    mean = (n + 1) / 2
    dx = [r - mean for r in ranks_x]
    dy = [r - mean for r in ranks_y]
    denominator = (sum(v * v for v in dx) * sum(v * v for v in dy)) ** 0.5
    if denominator < 1e-12:
        return None
    return sum(a * b for a, b in zip(dx, dy, strict=True)) / denominator


def _ranks(values: Sequence[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    out = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        average = (i + j) / 2 + 1
        for k in range(i, j + 1):
            out[order[k]] = average
        i = j + 1
    return out
