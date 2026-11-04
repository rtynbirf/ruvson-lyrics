# -*- coding: utf-8 -*-
"""ПРОПАГАТОР ДОМА — одно ядро для всех функций структуры графа задач.

Ядро одно:
    K(v) = nu_v( phi(v) ⊕ Σ_{u→v} eps_uv(K(u)) )
— одна проходка в порядке Кана (DAG) даёт ВСЕ функции структуры:
достижимость (BOOL), расписание и критический путь (MAXP), кратчайшую
цену (MINP), статсумму путей (COUNT), надёжность (VITER), узкое место
«слабейшее звено» (BOTT), производящую функцию путей (POLY ℝ[z]),
свободную энергию (LOGSUM) и — домену механику «Зелёный коридор»
(CORR, автомат-полукольцо).

Циклы живут в `pathsum` (Клейн-итерация до фикспойнта, расходимость
честно названа `converged=False`).

Универсальная теорема. Пусть K*(v) — множество всех путей s→v в свободном
полукольце. Для любого гомоморфизма h полуколец значение проходки
K(v) = h(K*(v)); обратно, всякая функция структуры, вычислимая одной
проходкой по DAG, — образ K* под единственным h (индукция по Кану).

Границы названы честно:
- полный крэшинг-контур, жанр GraphBLAS-матрицы и инкрементальные ячейки
  Radul/Sussman живут в организме commons (taskgraph/, SPEC-0011) — здесь
  не дублируются: дому достаточно sweep + pathsum + CORR;
- полукольцо вне реестра — ValueError (fail-closed, дух ADR-0014 commons).

Upstream-референсы (не скопировано ни строкой, идея названа):
- GraphBLAS Forum — semiring-API графалгоритмики;
- Mohri, «Semiring Frameworks and Algorithms for Shortest-Distance» (2002);
- Höfner, Möller, «Dijkstra, Floyd and Warshall meet Kleene»;
- классический CPM time-cost trade-off (PMI, «Crash with confidence»).
"""
from __future__ import annotations

import math
from collections import deque

INF = math.inf


# ---------------------------------------------------------------------------
# Граф задач
# ---------------------------------------------------------------------------

class TaskGraph:
    """Граф задач: dur ≥ 0 (fail-closed), вероятности, веса рёбер ≥ 0."""

    def __init__(self, name: str = "план"):
        self.name = name
        self.dur: dict[str, float] = {}
        self.prob: dict[str, float] = {}
        self.adj: dict[str, dict[str, float]] = {}
        self._radj: dict[str, dict[str, float]] | None = None

    def add(self, v: str, dur: float = 0.0, prob: float = 1.0) -> "TaskGraph":
        if v in self.dur:
            raise ValueError(f"вершина {v!r} уже есть")
        if dur < 0:
            raise ValueError(f"отрицательная длительность {v!r}: {dur}")
        if not (0.0 < prob <= 1.0):
            raise ValueError(f"вероятность {v!r} вне (0,1]: {prob}")
        self.dur[v] = float(dur)
        self.prob[v] = float(prob)
        self.adj[v] = {}
        self._radj = None
        return self

    def dep(self, u: str, v: str, w: float = 0.0) -> "TaskGraph":
        for x in (u, v):
            if x not in self.dur:
                raise ValueError(f"нет вершины {x!r}")
        if w < 0:
            raise ValueError(f"отрицательный вес ребра {u}→{v}: {w}")
        self.adj[u][v] = float(w)
        self._radj = None
        return self

    def preds(self, v: str) -> dict[str, float]:
        self._ensure_radj()
        return self._radj[v]

    def edges(self):
        for u in self.adj:
            for v, w in self.adj[u].items():
                yield u, v, w

    def _ensure_radj(self):
        if self._radj is None:
            r = {v: {} for v in self.dur}
            for u, v, w in self.edges():
                r[v][u] = w
            self._radj = r

    def flip(self) -> "TaskGraph":
        """Зеркало Gᵀ (для поздних сроков)."""
        h = TaskGraph(self.name + "·T")
        for v, d in self.dur.items():
            h.add(v, d, self.prob[v])
        for u, v, w in self.edges():
            h.dep(v, u, w)
        return h


def kahn(G: TaskGraph):
    """Развёртка Кана. Возвращает (order, циклические_рёбра)."""
    indeg = {v: len(G.preds(v)) for v in G.dur}
    q = deque(sorted(v for v in G.dur if indeg[v] == 0))
    order = []
    done = set()
    while q:
        v = q.popleft()
        order.append(v)
        done.add(v)
        for u in sorted(G.adj[v]):
            indeg[u] -= 1
            if indeg[u] == 0:
                q.append(u)
    cyc = [(u, v) for u, v, _ in G.edges() if v not in done or u not in done]
    return order, cyc


# ---------------------------------------------------------------------------
# Полукольца
# ---------------------------------------------------------------------------

class Semiring:
    """Полукольцо S = (S, ⊕, ⊗, 0, 1)."""

    def __init__(self, name, zero, one, plus, times, fmt=str):
        self.name, self.zero, self.one = name, zero, one
        self.plus, self.times, self.fmt = plus, times, fmt

    def __repr__(self):
        return f"Semiring({self.name})"


BOOL = Semiring("BOOL", False, True,
                lambda a, b: a or b, lambda a, b: a and b,
                lambda x: "да" if x else "нет")

MINP = Semiring("MINP", INF, 0.0, min, lambda a, b: a + b,
                lambda x: "∞" if x == INF else f"{x:g}")

MAXP = Semiring("MAXP", -INF, 0.0, max, lambda a, b: a + b,
                lambda x: "−∞" if x == -INF else f"{x:g}")

COUNT = Semiring("COUNT", 0, 1, lambda a, b: a + b, lambda a, b: a * b,
                 lambda x: f"{x:g}")

VITER = Semiring("VITER", 0.0, 1.0, max, lambda a, b: a * b,
                 lambda x: f"{x:.6g}")

BOTT = Semiring("BOTT", -INF, INF, max, min,
                lambda x: "−∞" if x == -INF else f"{x:.6g}")


def _pplus(p, q):
    r = dict(p)
    for k, v in q.items():
        r[k] = r.get(k, 0.0) + v
        if abs(r[k]) < 1e-12:
            del r[k]
    return r


def _ptimes(p, q):
    r: dict[float, float] = {}
    for a, x in p.items():
        for b, y in q.items():
            r[a + b] = r.get(a + b, 0.0) + x * y
    return r


def _pshift(p, delta):
    return {k + delta: v for k, v in p.items()}


POLY = Semiring("POLY", {}, {0.0: 1.0}, _pplus, _ptimes,
                lambda p: "+".join(
                    ("" if c == 1 else f"{c:g}·") +
                    (f"z^{k:g}" if k else f"{c:g}")
                    for k, c in sorted(p.items(), reverse=True)) or "0")


def logsum_semiring(beta: float) -> Semiring:
    """Лог-сумм-экспонента: K = ln Σ exp(β·длина). f(β) = K/β — свободная
    энергия ансамбля путей; β→∞ — тропический предел f → T (критический
    путь — основное состояние)."""
    if beta <= 0:
        raise ValueError("β обязан быть > 0 (fail-closed)")

    def plus(a, b):
        if a == -INF:
            return b
        if b == -INF:
            return a
        m = max(a, b)
        return m + math.log(math.exp(a - m) + math.exp(b - m))

    return Semiring(f"LOGSUM(β={beta:g})", -INF, 0.0, plus,
                    lambda a, b: a + b, lambda x: f"{x:.6g}")


# --- CORR: «Зелёный коридор» как автомат-полукольцо -------------------------
# Состояния: S0 — копилка пуста, S1 — в копилке полшага.
# Удача:   S0→S1 (+0), S1→S0 (+1 полутон — пара сложилась).
# Провал:  S0→S0 (+0), S1→S0 (+0 — копилка сгорела).
# Элемент — матрица 2×2 над (max,+); ⊕ — pointwise max, ⊗ — max-plus matmul.
# Одна попытка с выбором лучшего исхода = M_U ⊕ M_F; n попыток = степень.
# Макс. отвоёванных полутонов за n попыток = max((Mⁿ)[S0, S0], (Mⁿ)[S0, S1]).

_M_INF = -INF
_M_ONE = ((0.0, _M_INF), (_M_INF, 0.0))
_M_ZERO = ((_M_INF, _M_INF), (_M_INF, _M_INF))

M_U = ((_M_INF, 0.0), (1.0, _M_INF))     # удача
M_F = ((0.0, _M_INF), (0.0, _M_INF))     # провал (сжигает копилку)


def _mpmax(a, b):
    return tuple(tuple(max(a[i][j], b[i][j]) for j in range(2)) for i in range(2))


def _mpmat(a, b):
    """max-plus произведение 2×2 матриц."""
    return tuple(
        tuple(max(a[i][k] + b[k][j] for k in range(2)) for j in range(2))
        for i in range(2)
    )


M_TRY = _mpmax(M_U, M_F)                 # одна попытка: лучший исход

CORR = Semiring("CORR", _M_ZERO, _M_ONE, _mpmax, _mpmat,
                lambda m: "[{} | {}]".format(
                    " ".join("·" if x == _M_INF else f"{x:g}" for x in m[0]),
                    " ".join("·" if x == _M_INF else f"{x:g}" for x in m[1])))

REGISTRY = {s.name.split("(")[0]: s
            for s in (BOOL, MINP, MAXP, COUNT, VITER, BOTT, POLY, CORR)}


def by_name(name: str) -> Semiring:
    if name not in REGISTRY:
        raise ValueError(f"полукольца {name!r} нет в реестре: {sorted(REGISTRY)}")
    return REGISTRY[name]


# ---------------------------------------------------------------------------
# Ядро: sweep (доменный контракт, смена сигнатуры ломает приёмки)
# ---------------------------------------------------------------------------

def sweep(G: TaskGraph, phi: dict, sr: Semiring, eps=None, nu=None):
    """K(v) = nu_v( phi(v) ⊕ Σ_{u→v} eps_uv(K(u)) ) в порядке Кана.

    Возвращает (K, pred, order, циклы). Граф с циклами — ValueError
    с поимёнными рёбрами; путь — pathsum.
    """
    order, cyc = kahn(G)
    if cyc:
        raise ValueError(f"граф цикличен, sweep запрещён; рёбра циклов: {cyc[:8]}")
    missing = [v for v in G.dur if v not in phi]
    if missing:
        raise ValueError(f"phi не покрывает вершины: {missing[:8]}")
    K, pred = {}, {}
    for v in order:
        acc, arg = phi[v], None
        for u, w in sorted(G.preds(v).items()):
            val = eps(u, v, K[u]) if eps else sr.times(K[u], w)
            acc = sr.plus(acc, val)
            if val == acc and val != sr.zero:
                arg = u
        K[v] = nu(v, acc) if nu else acc
        pred[v] = arg
    return K, pred, order, cyc


def pathsum(G: TaskGraph, phi: dict, sr: Semiring, eps=None, max_iter: int = 10000):
    """Клейн-итерация до фикспойнта на произвольном графе (циклы разрешены).

    Возвращает (K, converged). Расходимость (усиление петли ≥ 1 в (max,+),
    растущий ряд в COUNT) — честно converged=False, не тихий обрыв.
    """
    missing = [v for v in G.dur if v not in phi]
    if missing:
        raise ValueError(f"phi не покрывает вершины: {missing[:8]}")
    K = {v: phi[v] for v in G.dur}
    for _ in range(max_iter):
        changed = False
        for v in G.dur:
            acc = phi[v]
            for u, w in G.preds(v).items():
                acc = sr.plus(acc, eps(u, v, K[u]) if eps else sr.times(K[u], w))
            if acc != K[v]:
                K[v] = acc
                changed = True
        if not changed:
            return K, True
    return K, False


def worldline(v: str, pred: dict) -> list:
    """Обратная трасса по pred — мировая линия вершины."""
    line = []
    while v is not None:
        line.append(v)
        v = pred.get(v)
    return line[::-1]


# ---------------------------------------------------------------------------
# Расписание: ранние/поздние, резерв, критичность, свободная энергия
# ---------------------------------------------------------------------------

def early(G: TaskGraph):
    """K⁺ (max,+): ранние финишы CPM.

    K(v) = d(v) + max_{u→v}(K(u) + лаг) — источник: вершины без входов.
    Возвращает (K, pred, order); pred — для мировой линии критпути."""
    phi = {v: (0.0 if not G.preds(v) else -INF) for v in G.dur}

    def nu(v, acc):
        return acc + G.dur[v] if acc != -INF else -INF

    K, pred, order, cyc = sweep(G, phi, MAXP, nu=nu)
    return K, pred, order


def makespan(G: TaskGraph):
    """T, K⁺, K⁻, резерв R = T − K⁺ − K⁻ + d (≥ 0), критические вершины."""
    Kp, _, _ = early(G)
    T = max(Kp.values()) if Kp else 0.0
    Gt = G.flip()                      # суффиксные высоты: тот же early на Gᵀ
    Km, _, _ = early(Gt)
    R = {v: max(0.0, T - Kp[v] - Km[v] + G.dur[v]) for v in G.dur}
    crit = [v for v in G.dur if abs(R[v]) < 1e-9]
    return T, Kp, Km, R, crit


def criticality(G: TaskGraph, source: str, sink: str) -> dict:
    """Плотность мировых линий c(v) = n⁺(v)·n⁻(v)/N двумя COUNT-проходками."""
    phi_f = {v: (1 if v == source else 0) for v in G.dur}
    n_f, _, _, _ = sweep(G, phi_f, COUNT, eps=lambda u, v, ku: ku)
    Gt = G.flip()
    phi_b = {v: (1 if v == sink else 0) for v in Gt.dur}
    n_b, _, _, _ = sweep(Gt, phi_b, COUNT, eps=lambda u, v, ku: ku)
    N = n_f[sink]
    if not N:
        raise ValueError("нет ни одного пути источник→сток")
    return {v: n_f[v] * n_b[v] / N for v in G.dur}


def free_energy(G: TaskGraph, beta: float, source: str, sink: str) -> float:
    """f(β) = (1/β)·ln Σ_путей exp(β·длина) без перечисления путей."""
    sr = logsum_semiring(beta)
    phi = {v: (beta * G.dur[v] if v == source else -INF) for v in G.dur}

    def eps(u, v, ku):
        return ku + beta * (G.adj[u][v] + G.dur[v]) if ku != -INF else -INF

    K, _, _, _ = sweep(G, phi, sr, eps=eps)
    if K[sink] == -INF:
        raise ValueError("нет пути источник→сток")
    return K[sink] / beta


def poly_paths(G: TaskGraph, source: str, sink: str) -> dict:
    """P(z) = Σ_путей z^длина — производящая функция путей (ℝ[z])."""
    phi = {v: ({G.dur[v]: 1.0} if v == source else {}) for v in G.dur}

    def eps(u, v, ku):
        return _pshift(ku, G.adj[u][v] + G.dur[v])

    K, _, _, _ = sweep(G, phi, POLY, eps=eps)
    return K[sink]


# ---------------------------------------------------------------------------
# CORR: стратегия коридора тем же ядром
# ---------------------------------------------------------------------------

def corridor_best(n: int) -> int:
    """Макс. полутонов за n попыток: max((M_TRYⁿ)[S0,S0], (M_TRYⁿ)[S0,S1]).

    Это тот же жанр pathsum: цикл «попытка → попытка → …», свёрнутый
    в матричную степень (Клейн-звезда цепочки попыток).
    """
    M = _M_ONE
    for _ in range(n):
        M = _mpmat(M, M_TRY)
    return int(max(M[0][0], M[0][1]))


def corridor_min_attempts(k: int) -> int:
    """Минимум попыток, чтобы отвоевать k полутонов (двоичный поиск по степени)."""
    if k <= 0:
        return 0
    lo, hi = 1, 2 * k
    while corridor_best(hi) < k:
        hi *= 2
    while lo < hi:
        mid = (lo + hi) // 2
        if corridor_best(mid) >= k:
            hi = mid
        else:
            lo = mid + 1
    return lo
