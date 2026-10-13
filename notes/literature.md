# Literature consulted (2026-10-13)

What was read, and what was taken from each. Short scan, not a survey.

* **Cilibrasi & Vitányi, "A Fast Quartet Tree Heuristic for Hierarchical Clustering"**, Pattern
  Recognition 44 (2011); arXiv:1409.4276 (https://arxiv.org/abs/1409.4276). Also the earlier "A New
  Quartet Tree Heuristic for Hierarchical Clustering" (arXiv:cs/0606048).
  - MQTC definition, S(T) = (M − C_T)/(M − m), NP-hardness and no PTAS unless P = NP.
  - Search: randomized hill climbing with k-mutations (leaf swap, subtree swap, subtree transfer), k
    heavy-tailed. Each candidate tree is re-costed in full: O(n³) for distance input (their §V,
    "sum of sibling distances" per node), Ω(n⁴) in general.
  - Scale reported: "at least 300 objects"; a 260-node tree took about 3 hours to reach S ≈ 0.98. On
    32-object natural data MQTC beat NJ/BioNJ in S (0.99487 vs 0.99244).
* **Consoli, Korst, Geleijnse, Pauws**: exact-enumeration notes (arXiv:1807.00566) write the cost as
  C(t) = ½ Cᵀ D, linear in D, the same object as our pair form; "Improved variable neighbourhood search
  heuristic for quartet clustering" (LNCS 2019, https://publications.jrc.ec.europa.eu/repository/handle/JRC113173),
  and earlier GRASP / SA / VNS metaheuristics. No incremental move costing found in what was readable.
* **FastME 2.0** (Lefort, Desper, Gascuel, MBE 2015; https://academic.oup.com/mbe/article/32/10/2798/1212138)
  and the BME/SPR line: the idea of pricing whole SPR neighbourhoods with subtree aggregates comes from
  here. MQTC needed its own delta (weights N_T(u,v) instead of 2^{1−p}).
* **Gascuel & Steel, "Neighbor-joining revealed"** (MBE 2006): NJ as greedy balanced minimum evolution.
  The MQTC analogue (NJ's first join is the greedy quartet join) is in notes/derivations.md §4.
* ASTRAL (Mirarab et al.): the cluster-restricted DP used by `fusion`, here on distance-induced quartet
  weights, where a tripartition costs O(1) from cluster sizes, totals and within-sums.
