# Dead ends and weak leads

Each with the evidence. File names refer to results/.

## Quartet-join as a consistent tree builder (dead)
The natural "exact" agglomeration: join the pair of clusters whose decided quartets have the largest
total (or per-quartet) support, using exact block sums. Its first step is NJ's (identity verified to
0 error, 01_correctness.txt). After that it drifts. On additive metrics it recovers the true tree in
1/20 (sum) and 4/20 (per-quartet) cases, against NJ's 20/20. NJ's reduction formula
(d_ik + d_jk − d_ij)/2 keeps the reduced metric additive; exact block sums let big clusters dominate.
**Kept anyway** as a *start*: on non-additive data it builds much better trees than NJ (02_starts_*).

## Iterated local search with small kicks (dead at n = 1000)
Kick = n/50 random SPRs of 1–4 steps, then SPR + DP descent, accept if better. 180 s at n = 1000:
~230 kicks, gains of ~1e-7 in S per success, final S below one plain descent from a random tree
(digits 0.8440657 vs 0.844071; colours 0.9467291 vs 0.946863; the descents are in 02_starts_n1000.txt).
The kicks never leave the basin.
04_ils_*_1000.log.

## DP-only hill climbing from random trees (superseded)
Last round's mqtc_scale.js: random tree → exact k-subtree moves (k up to 16, ~50 ms each). At n = 100 it
reaches the same S as the new solver, but in 32–40 s against 0.06–2.8 s (03_*). SPR descent does the
bulk work 100–1000× faster; the DP move stays as a polish because it escapes SPR optima
(digits_300 from random: SPR 0.850771 → +DP 0.855021, 02_starts_n300.txt).

## NJ as the start on colour data (weak)
CIEDE2000 on random sRGB colours is far from additive; NJ builds S = 0.636 at n = 1000 (qja: 0.943).
Descent repairs it (0.94678), but from a worse basin than other starts.

## Small-kick diversity for the population (weak)
Kicked copies of good trees tend to fall back into known optima (population de-duplication by cost
catches them). Fresh starts from quartet-join on a ±10% noisy copy of d gave the best single optima
at n = 1000 (digits_1000: 0.8440728 vs 0.8440673 for the best of 8 unperturbed starts). At n = 1797
no kick set a record in 652 s; every record came from a fresh start or the fusion after one
(results/11b_search_digits_1797_600s.log).

## Certifying optimality at scale (open, nothing usable)
The quintet bound from the previous round is O(n⁵) and loose (S ≤ 0.98 against 0.82 achieved on
Euclidean n = 100). The trivial bound m gives S ≤ 1. No certificate exists here above n ≈ 22, where the
exact subset DP stops.

## Reading the backbone (a warning, not an algorithm)
Near-optimal trees from different seeds (ΔS = 2e-7) differ in 16% of splits, and in 25 of 27 splits
with more than 100 leaves on the smaller side (09_reproducibility_digits_1000.txt). The deep structure
of the MQTC tree on digits is not identified by the objective at this resolution.
