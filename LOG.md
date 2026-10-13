# MQTC lab notebook — 2026-10-13

Goal for the milestone: an interactive demo of minimum-quartet-cost trees on sklearn digits and on
colours, n = 100–1000. Brief for this round: rethink the problem from first principles rather than extend
last round's code (subset DP for n ≤ 22; random tree + exact 16-subtree DP moves for n ≈ 100).

Machine: the sandbox had **2 cores** (AVX-512). Every timing below is on 2 cores unless it says
"1 thread". Seeds are fixed; every number can be regenerated with the scripts in experiments/.

---

## 0. Reading (notes/literature.md)
CV 2011 re-cost every candidate tree in full (O(n³) for distance data) and report "at least 300 objects",
with a 260-leaf tree taking ~3 h to S ≈ 0.98. Consoli et al. (GRASP/SA/VNS, exact enumeration) stay
small. Nothing I read prices *moves* incrementally. FastME does exactly that for balanced minimum
evolution, which suggested the plan: find MQTC's analogue of the FastME machinery.

## 1. Derivations (notes/derivations.md)
* Two cost forms: node form (tripartitions) and **pair form** C_T = Σ d(u,v)·N_T(u,v), with
  N_T = Σ C(g,2) over groups hanging off the u–v path. Linear in d, fixed total weight 2·C(n,4).
  Affine invariant. Additive d ⇒ S = 1 attainable and NJ attains it.
* **NNI/SPR deltas are O(1) block-sum expressions**, so a whole SPR neighbourhood is O(n²).
* **Quartet-join**: exact-support agglomeration, O(n³), first step identical to NJ.

## 2. Solver from scratch (src/mqtc.js, src/qbounds.c)
Array-based unrooted trees, O(n²) cost refresh, `bestRegraft` (all edges for one subtree in O(n)),
greedy SPR descent, NJ, quartet-join, last round's exact k-subtree DP move as a polish, fusion,
population search over worker threads. `qbounds.c`: exact M and m for S(T), OpenMP + SIMD.

## 3. Correctness — experiments/01_correctness.js → results/01_correctness.txt
* node form = pair form = brute-force quartet enumeration (4e-15);
* 6368 SPR deltas = recomputed cost differences (1.2e-15); candidate count 2(n − |P|) − 4 everywhere;
* DP-move gains = recomputed (4e-16); fusion = rebuilt cost, never worse than inputs, never below the
  exact optimum (n ≤ 18);
* additive metrics: NJ 20/20, quartet-join 1/20 (sum) and 4/20 (avg) → **dead end as a builder**;
* exact optimum (subset DP, n = 10–16, 30 instances): NJ+SPR hits 26, +DP polish 30;
* singleton quartet support = −(m−1)·Q_NJ − 2Σd, error 0.

## 4. Data — data/make_data.py
digits (stratified, Euclidean on 64 pixels), colours (uniform sRGB, CIEDE2000, checked against two
Sharma–Wu–Dalal reference pairs), noisy tree metrics (exp(1) branches, ±15%), Euclidean [0,1]⁵ control.
Exact bounds: 0.0 s at n = 100, 0.1 s at 300, **11 s at 1000**, 116 s at 1797 (3.3·10⁹ quartets/s).
At packaging time qbounds turned out to be nondeterministic in the 15th digit (OpenMP reduction order);
it now sums per-row partials in fixed order, all bounds files were recomputed, and no reported S moved
by more than 1.2e-12.

## 5. Starts × local search — 02_starts_and_descent.js → results/02_starts_n{100,300,1000}.txt
* SPR descent from a **random tree**: 0.05 s at n = 100, 0.4 s at 300, 13–17 s at 1000.
* Quartet-join (avg) is the best builder on non-tree data (colours_1000: 0.943 vs NJ 0.636), and its
  descents are 2–4× shorter. On tree metrics NJ starts within 3–36 SPR moves of the common endpoint.
* After descent the starts mostly agree, except NJ on digits_1000 (0.8411 vs ≈ 0.8440 for the others).
* DP polish matters when SPR stalls early (digits_300 random: 0.850771 → 0.855021).

## 6. Against last round — results/03_*
Same final S at n = 100 (euc 0.8246908, digits 0.8522569). Time to that tree: 0.06–2.8 s now, against
32–40 s for 8 ladder runs + fusion on 2 threads.

## 7. ILS with small kicks — experiments/04_ils.js → results/04_ils_*_1000.log  → **dead end**
180 s at n = 1000: ~230 kicks, ~1e-7 in S per success, ends *below* one random-start descent.

## 8. Fusion of local optima — 05_fusion.js → results/05_fusion_*_1000.txt
8 optima (qja, nj, qj, 5 random), fused in 0.7–1.2 s: digits 0.8440673 → 0.8440763, colours
0.9468734 → 0.9469076. In one second, ~300× the gain of three minutes of ILS. Recombination is the
lever at this size.

## 9. Population search (the CLI now) — results/06_search_*_1000.{log,json}
One new local optimum per thread per generation (fresh quartet-join on a ±10% noisy copy of d, random
trees, or n/10-SPR kicks of members), then fuse the population and polish. 180 s, 2 threads:
digits_1000 **0.8440776** (0.8440775 at 48 s), colours_1000 **0.9469174** (at 47 s).

## 10. Demo trees — 07_demo_trees.sh → results/demo_*.json, demo/index.html
n = 100 (20 s), 300 (60 s), 1000 (the runs of §9). NJ for comparison: digits 0.8163 / 0.8181 / 0.7861,
colours 0.8557 / 0.8612 / 0.6360. Nearest leaf in the tree has the same digit 84.9 / 85.7 / 93.9% of
the time (nearest by pixels: 91.0 / 92.7 / 98.7%).

## 11. Ground truth under noise — 08_treemetric_recovery.js
S(true tree) 0.928536 / 0.950691 / 0.911981; S(MQTC) 0.930048 / 0.950710 / 0.911986, so the MQTC tree
is *cheaper* than the truth. Robinson–Foulds to truth: NJ 9 / 27 / 81, MQTC 10 / 32 / 82 (of 97 / 297 /
997 splits). Under noise MQTC fits a little of the noise.

## 12. Reproducibility and threads — results/09_*
Seed 2 (120 s): 0.8440774, seed 1 (180 s): 0.8440776. One thread, 120 s: 0.8440763.
**The two seeds' trees differ in 164 of 997 splits**: 23/323 cherries, 36/289 of size 3–5, 37/217 of
6–20, 43/141 of 21–100, and **25/27 of 101–500**. The backbone is not determined by the objective at
this resolution. The demo text says so.

## 13. Scaling — 10_scaling.js → results/10_scaling.txt (1 thread)
| n | cost refresh | full SPR sweep (candidates) | NJ | quartet-join | one local optimum |
|---|---|---|---|---|---|
| 300 | 0.6 ms | 22 ms (354k) | 0.06 s | 0.03 s | 0.9 s |
| 1000 | 2.5 ms | 132 ms (4.0M) | 1.4 s | 1.4 s | 7.9 s |
| 1797 | 9.3 ms | 464 ms (12.9M) | 7.7 s | 5.8 s | 38.7 s |

## 14. All 1797 digits — results/11_search_digits_1797.*, results/11b_search_digits_1797_600s.*
Bounds: 116 s. One local optimum: ~40 s (qja) to ~90 s (random). Search, seed 1, 2 threads:
* 300 s: the four starts plateau at 0.8396231 after fusion. Then, in the last generation, one random
  start lands at **0.8405906**, 1e-3 higher, and the budget ends before it is fused.
* 600 s (same seed, so identical up to 315 s): records 0.8405906 (random) → 0.8405926 (fusion) →
  0.8406023 (noisy qja) → 0.8406066 (fusion) → **0.8407828 (random)** → 0.8407863 (fusion, at 467 s).
  Final 0.8407863 after 652 s and 28 local optima.
* Every record came from a fresh start or from the fusion right after one; kicks set none.
  At this size basins differ by ~1e-3 in S, SPR+DP cannot move between them (the backbone again,
  §12), and the search is **throughput-bound on fresh starts**. Not converged. This is the run to
  repeat on 16 cores.
* Weak lead (two samples): random starts reach better basins than quartet-join starts at n = 1797,
  the reverse of n ≤ 1000. If it holds, the start mix should shift towards random trees as n grows.

---

## Where this leaves the milestone
The demo exists (demo/index.html; force, unrooted equal-angle and radial layouts; clade inspection;
Newick export). For n ≤ 1000 the solver is no longer the bottleneck: a minute on 2 cores reaches a
plateau that more time barely moves. At n = 1797 it is: ten minutes on 2 cores are not enough, and the
limiting resource is fresh starts per minute (§14).

## Next (ordered by what I would do first)
1. **Split support.** Keep the population's distinct near-optimal trees and report, per split, the
   share that contain it; draw it as edge weight in the demo. §12 says this is the honest picture.
2. **Faster refresh.** A move changes subtree sums only on two root paths; incremental updates would
   make accepted moves O(n·depth) instead of O(n²). Port `bestRegraft` and `stats` to C/WASM.
3. **Many cores.** Generation is embarrassingly parallel, but each one waits for its slowest job (a
   random start, ~17–20 s at n = 1000) and then runs fusion + polish serially (~3 s). On 16 cores that
   is ~17 optima per ~23 s against 3 per ~20 s here: roughly 5× the rate, not 8×. A steady-state
   population (fuse whenever a job lands, no generation barrier) would recover most of the rest.
4. **Start mix by size.** Test the §14 lead properly (say 16 random vs 16 noisy-qja local optima at
   n = 1797, one per core) and let the population favour whichever start family is setting records.
5. **Distances.** NCD on the digit bitmaps (the CompLearn tradition), ΔE76 vs CIEDE2000.
6. **Bounds.** Anything certifiable above n ≈ 22 would be new; the quintet bound is too weak.
