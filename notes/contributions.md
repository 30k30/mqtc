# What this round adds

Claims are relative to the literature listed in notes/literature.md, which was a short scan. "Not found
there" means not found in what I read, not "new to the world".

1. **O(1) SPR deltas for distance-induced MQTC, O(n²) for the whole SPR neighbourhood.** Pruning a
   subtree P and walking it outward, each step's cost change is
   |X₁||X₃|S(P,X₂) + |P||X₂|S(X₁,X₃) − |X₂||X₃|S(P,X₁) − |P||X₁|S(X₂,X₃), with every block sum available in
   O(1) from subtree row sums plus one prefix pass per P. Verified on 6368 regrafts (1e-15). At
   n = 1797 one sweep prices 12.9M candidate trees in 0.46 s (10_scaling.txt). CV 2011 prices one
   candidate in O(n³). Not found there; the template is FastME's SPR for balanced minimum evolution.
2. **MQTC as minimum evolution with combinatorial weights.** C_T = Σ d(u,v)·N_T(u,v), with
   N_T(u,v) = Σ C(g,2) over the groups hanging off the u–v path, and Σ N_T = 2·C(n,4) for every tree
   (a fixed weight budget). Consoli et al. have the linear form; the min-evolution reading and the budget
   are this round's framing (notes/derivations.md §2).
3. **Quartet-join**, the exact-support agglomeration in O(n³), with the identity linking its first step
   to NJ's Q-criterion, and the negative result: it is not consistent on additive metrics. It is
   nevertheless the best constructor on non-tree-like data (notes/dead-ends.md).
4. **Fusion at n = 1000 without O(n) vectors per cluster.** The ASTRAL-style DP over the clusters of
   several trees, costing splits from (size, row total, within-sum) only, with additive random hashes for
   O(1) complement lookup. Fusing 8 local optima of digits_1000 takes 0.7 s and beats all of them.
5. **Population search with exact recombination**, parallel over worker threads. On n = 1000 it reaches
   in about 50 s what ILS does not reach in 180 s, and beats the best of 8 independent descents.
6. **Exact S at n = 1000–1800.** The O(n⁴) normaliser in vectorised C: 3.3·10⁹ quartets/s on 2 cores,
   11 s at n = 1000, 116 s at n = 1797. Sampling was unnecessary.
7. **Empirical findings about the objective.**
   - With 15% noise on a tree metric, the MQTC optimum is cheaper than the true tree yet slightly
     further from it in Robinson–Foulds (08_treemetric_recovery.txt). MQTC fits; it does not denoise.
   - Near-optimal trees are structurally degenerate at n = 1000: equal S to 2e-7 with 16% of splits
     different, concentrated in the backbone (25 of 27 splits above 100 leaves) while cherries are
     93% stable (09_reproducibility_digits_1000.txt).
   - On these instances the plateau is reached in about a minute on 2 cores and barely moves after
     (digits_1000: 0.8440775 at 48 s, 0.8440776 at 166 s; colours_1000: 0.9469174 at 47 s, flat to 198 s).
