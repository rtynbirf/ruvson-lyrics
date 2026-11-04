# -*- coding: utf-8 -*-
"""ПРОБЫ ПРОПАГАТОРА ДОМА — факт только замером (канон G1 commons).

Жанр: каждый ответ ядра сверяется с НЕЗАВИСИМЫМ тупым вычислением —
перебор путей, прямая симуляция коридора, аналитика. Никакой алгоритм
не проверяется другим алгоритмом того же жанра.

Конвенции (названы, едины для ядра и перебора):
- MAXP/MINP/POLY/LOGSUM: длина пути = Σ лагов + Σ dur всех узлов пути
  (включая источник и сток);
- COUNT: единичные рёбра, phi(source)=1;
- VITER: произведение prob узлов пути; BOTT: минимум prob по пути
  («слабейшее звено»), максимум по путям.

Запуск: python3 engine/tests.py
"""
from __future__ import annotations

import itertools
import math
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import propagator
from propagator import (BOOL, BOTT, CORR, COUNT, MAXP, MINP, POLY, VITER,
                        TaskGraph, by_name, corridor_best, corridor_min_attempts,
                        criticality, free_energy, kahn, logsum_semiring,
                        makespan, pathsum, poly_paths, sweep, worldline)
import house_graph


# ---------------------------------------------------------------------------
# Эталон поставки (тот же, что в commons SPEC-0011: T=9, R(C)=0.5)
# ---------------------------------------------------------------------------

def etalon() -> TaskGraph:
    G = TaskGraph("эталон")
    for k, d in {"A": 1.0, "B": 2.0, "C": 1.0, "D": 3.0,
                 "E": 1.0, "F": 1.0, "G": 1.0}.items():
        G.add(k, dur=d)
    G.dep("A", "B"); G.dep("A", "C")
    G.dep("B", "D"); G.dep("C", "D", w=0.5); G.dep("C", "G")
    G.dep("D", "E"); G.dep("E", "F"); G.dep("F", "G")
    return G


def all_paths(G: TaskGraph, s: str, t: str) -> list:
    """Тупой перебор всех путей s→t (независимый эталон)."""
    out, stack = [], [(s, [s])]
    while stack:
        v, path = stack.pop()
        if v == t:
            out.append(path)
            continue
        for u in G.adj[v]:
            if u not in path:
                stack.append((u, path + [u]))
    return out


def path_len(G: TaskGraph, path) -> float:
    """Σ dur узлов пути + Σ лагов рёбер (конвенция докстринга)."""
    return (sum(G.dur[v] for v in path)
            + sum(G.adj[path[i]][path[i + 1]] for i in range(len(path) - 1)))


class TestKernelVsBruteForce(unittest.TestCase):
    """Мини-G1: sweep равен перебору путей на случайных планах."""

    def test_random_dags_five_semirings(self):
        rng = random.Random(20261104)
        checked = 0
        for trial in range(60):
            n = rng.randint(4, 9)
            names = [f"v{i}" for i in range(n)]
            G = TaskGraph(f"ран-{trial}")
            for v in names:
                G.add(v, dur=rng.choice([0, 0.5, 1, 2, 3.5]),
                      prob=rng.choice([0.6, 0.8, 0.95, 1.0]))
            for i in range(n):
                for j in range(i + 1, n):
                    if rng.random() < 0.35:
                        G.dep(names[i], names[j], w=rng.choice([0, 0.5]))
            s, t = names[0], names[-1]
            paths = all_paths(G, s, t)
            if not paths:
                continue
            checked += 1
            lens = [path_len(G, p) for p in paths]

            phi0 = {v: (G.dur[v] if v == s else -propagator.INF)
                    for v in G.dur}

            def eps_max(u, v, ku):
                return ku + G.adj[u][v] + G.dur[v] if ku != -propagator.INF \
                    else -propagator.INF

            # MAXP: длина длиннейшего пути
            K, _, _, _ = sweep(G, phi0, MAXP, eps=eps_max)
            self.assertAlmostEqual(K[t], max(lens), places=9)
            # MINP: кратчайший (phi: source = dur(s), остальные +∞)
            phi_i = {v: (G.dur[v] if v == s else propagator.INF)
                     for v in G.dur}

            def eps_min(u, v, ku):
                return ku + G.adj[u][v] + G.dur[v] if ku != propagator.INF \
                    else propagator.INF

            Km, _, _, _ = sweep(G, phi_i, MINP, eps=eps_min)
            self.assertAlmostEqual(Km[t], min(lens), places=9)
            # COUNT: число путей
            Kc, _, _, _ = sweep(G, {v: (1 if v == s else 0) for v in G.dur},
                                COUNT, eps=lambda u, v, ku: ku)
            self.assertEqual(Kc[t], len(paths))
            # VITER: лучшее произведение prob по пути (включая s и t)
            phi_p = {v: (G.prob[v] if v == s else 0.0) for v in G.dur}
            Kv, _, _, _ = sweep(G, phi_p, VITER,
                                eps=lambda u, v, ku: ku * G.prob[v])
            best = max(math.prod(G.prob[v] for v in p) for p in paths)
            self.assertAlmostEqual(Kv[t], best, places=9)
            # BOTT: слабейшее звено лучшего маршрута (plus=max → нейтраль −∞)
            phi_b = {v: (G.prob[v] if v == s else -propagator.INF)
                     for v in G.dur}
            Kb, _, _, _ = sweep(G, phi_b, BOTT,
                                eps=lambda u, v, ku: min(ku, G.prob[v]))
            worst = max(min(G.prob[v] for v in p) for p in paths)
            self.assertAlmostEqual(Kb[t], worst, places=9)
        self.assertGreater(checked, 40)

    def test_universal_theorem_poly(self):
        """POLY: P(z) = гистограмма длин путей из перебора."""
        rng = random.Random(7)
        for _ in range(15):
            n = rng.randint(5, 9)
            names = [f"x{i}" for i in range(n)]
            G = TaskGraph("poly")
            for v in names:
                G.add(v, dur=rng.choice([0, 1, 2]))
            for i in range(n):
                for j in range(i + 1, n):
                    if rng.random() < 0.3:
                        G.dep(names[i], names[j])
            s, t = names[0], names[-1]
            P = poly_paths(G, s, t)
            hist: dict = {}
            for p in all_paths(G, s, t):
                L = path_len(G, p)
                hist[L] = hist.get(L, 0) + 1
            self.assertEqual({k: v for k, v in P.items()},
                             {k: float(v) for k, v in hist.items()})


class TestEtalon(unittest.TestCase):
    """Эталон поставки: числа обязаны сойтись с commons SPEC-0011."""

    def test_makespan_and_reserve(self):
        G = etalon()
        T, Kp, Km, R, crit = makespan(G)
        self.assertAlmostEqual(T, 9.0, places=9)
        self.assertAlmostEqual(R["C"], 0.5, places=9)
        self.assertIn("A", crit)
        self.assertIn("G", crit)
        self.assertNotIn("C", crit)
        _, pred, _ = propagator.early(G)
        self.assertEqual(worldline("G", pred), ["A", "B", "D", "E", "F", "G"])

    def test_poly_of_etalon(self):
        P = poly_paths(etalon(), "A", "G")
        self.assertAlmostEqual(P[3.0], 1.0)   # A→C→G
        self.assertAlmostEqual(P[8.5], 1.0)   # A→C→D… (лаг 0.5)
        self.assertAlmostEqual(P[9.0], 1.0)   # A→B→D…
        self.assertEqual(len(P), 3)

    def test_free_energy_cools_to_T(self):
        G = etalon()
        f1 = free_energy(G, 1.0, "A", "G")
        f100 = free_energy(G, 100.0, "A", "G")
        self.assertAlmostEqual(f1, 9.475625, places=4)
        self.assertAlmostEqual(f100, 9.0, places=6)
        self.assertGreater(f1, f100)

    def test_criticality_counts_paths(self):
        c = criticality(etalon(), "A", "G")
        self.assertAlmostEqual(c["A"] + c["G"], 2.0)
        self.assertAlmostEqual(c["B"], 1 / 3, places=9)  # 1 путь из 3
        self.assertAlmostEqual(c["C"], 2 / 3, places=9)  # 2 пути из 3

    def test_viter_chooses_reliable_branch(self):
        G = TaskGraph("надёжность")
        for k, p in {"A": 0.99, "B": 0.90, "C": 0.98, "G": 0.99}.items():
            G.add(k, dur=1.0, prob=p)
        G.dep("A", "B"); G.dep("A", "C"); G.dep("B", "G"); G.dep("C", "G")
        phi = {v: (G.prob[v] if v == "A" else 0.0) for v in G.dur}
        K, pred, _, _ = sweep(G, phi, VITER,
                              eps=lambda u, v, ku: ku * G.prob[v])
        self.assertAlmostEqual(K["G"], 0.99 * 0.98 * 0.99, places=9)
        self.assertEqual(worldline("G", pred), ["A", "C", "G"])


class TestCycles(unittest.TestCase):
    """pathsum: циклы разрешены, расходимость/сходимость честно названы."""

    def test_geometric_series_count(self):
        """Кольцо с затуханием ρ=0.5 в COUNT: ряд сходится к 1/(1−ρ²)."""
        G = TaskGraph("кольцо")
        G.add("a"); G.add("b")
        G.dep("a", "b", w=0.5); G.dep("b", "a", w=0.5)
        K, ok = pathsum(G, {"a": 1, "b": 0}, COUNT)
        self.assertTrue(ok)
        self.assertAlmostEqual(K["a"], 1 / (1 - 0.25), places=9)  # 4/3
        self.assertAlmostEqual(K["b"], 0.5 * K["a"], places=9)

    def test_damped_loop_gain_named(self):
        """3-цикл в COUNT: усиление петли β³, стоячая волна β/(1−β³)."""
        G = TaskGraph("петля")
        for v in "xyz":
            G.add(v)
        beta = 0.5
        G.dep("x", "y", w=beta); G.dep("y", "z", w=beta); G.dep("z", "x", w=beta)
        K, ok = pathsum(G, {"x": beta, "y": 0, "z": 0}, COUNT)
        self.assertTrue(ok)
        self.assertAlmostEqual(K["x"], beta / (1 - beta ** 3), places=9)

    def test_divergence_honest(self):
        """Усиление петли ≥ 1 в COUNT — ряд расходится, converged=False."""
        G = TaskGraph("расходимость")
        G.add("a"); G.add("b")
        G.dep("a", "b", w=2.0); G.dep("b", "a", w=2.0)
        K, ok = pathsum(G, {"a": 1, "b": 0}, COUNT, max_iter=500)
        self.assertFalse(ok)

    def test_sweep_forbids_cycles(self):
        G = TaskGraph("цикл")
        G.add("a"); G.add("b")
        G.dep("a", "b"); G.dep("b", "a")
        with self.assertRaises(ValueError) as ctx:
            sweep(G, {"a": 0, "b": 0}, BOOL)
        self.assertIn("a", str(ctx.exception))


class TestCorridor(unittest.TestCase):
    """CORR против прямой симуляции механики «Зелёного коридора»."""

    @staticmethod
    def sim(seqs):
        """Тупая симуляция: копилка 0.5, пара удачных = полутон,
        провал сжигает копилку."""
        pot, gain = 0.0, 0
        for a in seqs:
            if a:                       # удача
                if pot >= 0.5:
                    gain += 1
                    pot = 0.0
                else:
                    pot = 0.5
            else:                       # провал
                pot = 0.0
        return gain

    def test_best_matches_simulation(self):
        for n in range(1, 11):
            best_sim = max(self.sim(seq) for seq in
                           itertools.product((False, True), repeat=n))
            self.assertEqual(corridor_best(n), best_sim,
                             f"n={n}: ядро {corridor_best(n)} ≠ симуляция "
                             f"{best_sim}")

    def test_known_values(self):
        self.assertEqual(corridor_best(1), 0)
        self.assertEqual(corridor_best(2), 1)           # УУ → полутон
        self.assertEqual(corridor_best(4), 2)           # УУУУ → два
        self.assertEqual(corridor_best(5), 2)           # два + копилка
        self.assertEqual(corridor_min_attempts(1), 2)
        self.assertEqual(corridor_min_attempts(5), 10)  # пять пар подряд

    def test_corr_semiring_laws(self):
        M = propagator.M_TRY
        self.assertEqual(M[0][1], 0.0)   # S0 → S1 удачей (+0)
        self.assertEqual(M[1][0], 1.0)   # S1 → S0 кэшем пары (+1)
        # CORR.one — единица по ⊗
        self.assertEqual(propagator._mpmat(propagator._M_ONE, M), M)
        self.assertEqual(propagator._mpmat(M, propagator._M_ONE), M)
        # ⊕ идемпотентен и коммутативен на паре
        self.assertEqual(CORR.plus(M, M), M)
        self.assertEqual(CORR.plus(M, CORR.zero), M)


class TestFailClosed(unittest.TestCase):
    """Опечатка не значит молча «unknown» (дух ADR-0014)."""

    def test_unknown_semiring(self):
        with self.assertRaises(ValueError):
            by_name("НЕТ-ТАКОГО")

    def test_negative_duration(self):
        with self.assertRaises(ValueError):
            TaskGraph("минус-время").add("a", dur=-1.0)

    def test_prob_out_of_range(self):
        with self.assertRaises(ValueError):
            TaskGraph("вероятность").add("a", prob=1.5)

    def test_phi_must_cover(self):
        G = TaskGraph("дыра-phi")
        G.add("a"); G.add("b")
        G.dep("a", "b")
        with self.assertRaises(ValueError):
            sweep(G, {"a": 1}, BOOL)

    def test_beta_must_be_positive(self):
        with self.assertRaises(ValueError):
            logsum_semiring(0.0)

    def test_criticality_needs_a_path(self):
        G = TaskGraph("нет-пути")
        G.add("s"); G.add("t"); G.add("o")
        G.dep("s", "o")
        with self.assertRaises(ValueError):
            criticality(G, "s", "t")


class TestHouse(unittest.TestCase):
    """Живой дом: факт замером, граф корпуса строится и считается."""

    @classmethod
    def setUpClass(cls):
        cls.tracks = house_graph.load_tracks()
        cls.meta = house_graph.load_meta()
        cls.done = house_graph.load_done()

    def test_corpus_facts(self):
        self.assertEqual(len(self.tracks), 65)
        self.assertEqual(len(self.meta), 63)
        self.assertNotIn(26, self.meta)
        self.assertNotIn(38, self.meta)
        # волна №33 «все чистовиками»: весь корпус с текстами — в караоке;
        # вне корпуса только №26/№38 (в доме нет своих субтитров)
        polny = [n for n in range(1, 66) if n not in (26, 38)]
        self.assertEqual(self.done["clean"], polny)
        self.assertEqual(self.done["lrc"], polny)
        self.assertEqual(self.done["songs"], polny)

    def test_graph_builds_and_schedules(self):
        GA = house_graph.build_graph(self.meta, self.tracks, "A")
        GB = house_graph.build_graph(self.meta, self.tracks, "Б")
        order, cyc = kahn(GA)
        self.assertFalse(cyc)
        self.assertEqual(len(order), len(GA.dur))
        TA, _, _, RA, _ = makespan(GA)
        TB, _, _, _, _ = makespan(GB)
        self.assertGreater(TA, 0)
        self.assertLessEqual(TB, TA)      # выравнивание не хуже тап-синхро
        # ухо — последовательная машина юзера: ВСЕ сверки критичны
        ears = [RA[v] for v in RA if v.startswith("ухо:")]
        self.assertEqual(len(ears), 65)
        self.assertTrue(all(r == 0 for r in ears))

    def test_report_is_text_nerve(self):
        text = house_graph.report()
        for marker in ("ПРОПАГАТОР ДОМА", "ЗЕЛЁНЫЙ КОРИДОР", "СВОБОДНАЯ",
                       "ДОСТИЖИМОСТЬ"):
            self.assertIn(marker, text)
        self.assertNotIn("nan", text.lower())
        self.assertNotIn("None", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
