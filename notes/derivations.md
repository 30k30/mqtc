# MQTC from first principles

Notation: n objects, distance d (symmetric, zero diagonal), T an unrooted binary tree with the objects
as leaves. For leaf sets A, B: S(A,B) = Σ_{a∈A, b∈B} d(a,b). A quartet topology uv|wx is *displayed*
by T when the u–v and w–x paths are vertex-disjoint; a binary tree displays exactly one topology of
every 4-set. Cost C_T = Σ_{displayed uv|wx} d(u,v) + d(w,x). Fitness S(T) = (M − C_T)/(M − m), with
M, m the sums of the worst and best topology cost over all C(n,4) quartets (Cilibrasi–Vitányi).

## 1. Invariances and the easy case

* **Affine invariance.** d → αd + β (α > 0) adds 2β to every topology of every quartet, so the argmin
  and S(T) are unchanged. Only the *shape* of d matters; d need not be a metric (CIEDE2000 is not).
* **Tree metrics.** If d is additive on some tree G (path lengths, positive edges), the four-point
  condition makes G's topology the strict minimum on every quartet, so C_G = m and S(G) = 1, the
  global optimum. NJ is consistent for additive d, so NJ alone solves this case (verified: 20/20,
  experiments/01). MQTC is a *robust* version of "recover the tree": optimal for exact tree data,
  and still defined, with a graded answer, for anything else.

## 2. Two forms of the cost

**Node form.** Each displayed quartet uv|wx is charged at two internal nodes: d(u,v) at the node where
the u–v path meets the rest, d(w,x) likewise. For a node splitting the leaves into X, Y, Z:

    C_T = Σ_nodes  C(|X|,2) S(Y,Z) + C(|Y|,2) S(X,Z) + C(|Z|,2) S(X,Y).

With subtree row sums R_v[j] = Σ_{x∈D(v)} d(x,j) built bottom-up, every term is O(1) after O(n) per
node: **C_T in O(n²)** (CV 2011 Lemma 5.1 is O(n²) per node, O(n³) per tree).

**Pair form.** Fix u, v. Removing the internal nodes p₁…p_L of the u–v path leaves the other n−2 leaves
in groups g₁…g_L (what hangs off each p_i). A pair {w,x} is disjoint from the path iff it lies in one
group, so

    C_T = Σ_{u<v} d(u,v) · N_T(u,v),    N_T(u,v) = Σ_i C(g_i, 2).

Consequences:
* C_T is **linear in d** with combinatorial weights; Consoli et al. write the same thing as ½ Cᵀ D.
  The structure is that of *minimum evolution*: balanced ME (FastME, the criterion NJ greedily
  optimises) is Σ d(u,v)·2^{1−p(u,v)}. MQTC swaps the weights 2^{1−p} for N_T(u,v).
* Σ_{u<v} N_T(u,v) = 2·C(n,4) for every binary T (each quartet contributes two pairs). MQTC therefore
  spends a **fixed budget of weight** across pairs, as tree shape allows, and wants it on small d.
  A cherry gets the maximum C(n−2,2); the two ends of a caterpillar get 0.
* N_T depends on the path *and the sizes hanging off it*, not only on path length. That is the
  difference from BME, and the reason imported BME machinery (below) needs new delta formulas.

(Both forms checked against brute-force quartet enumeration to 4e-15, experiments/01.)

## 3. Local moves are block-sum expressions

**NNI.** Across an internal edge AB|CD, the NNI to AC|BD changes only quartets with one leaf in each of
A, B, C, D (any quartet with two leaves in one subtree keeps its topology):

    Δ = |B||D| S(A,C) + |A||C| S(B,D) − |C||D| S(A,B) − |A||B| S(C,D).

**SPR as a walk of NNIs.** Prune subtree P (attached at node a; a's other neighbours y, z become one
edge of T′). Moving P from one edge of T′ into a neighbouring one at node w, where w's three sides
in T′ are X₁ (behind), X₂ (ahead), X₃:

    Δ = |X₁||X₃| S(P,X₂) + |P||X₂| S(X₁,X₃) − |X₂||X₃| S(P,X₁) − |P||X₁| S(X₂,X₃).

Every term is available in O(1):
* sizes and cut sums S(X, complement) per directed subtree, from the rooted pass;
* S(X₂,X₃) for the two forward sides at w: the sibling sum S12[w], or cut − S12[w] when one side
  is the parent side;
* S(P, X) for every subtree X away from P: prefix sums of R_P over the DFS leaf order, O(n) once
  per P;
* everything on the X₁ side by complement (|X₁| = n − |P| − |X₂| − |X₃|, etc.).

Accumulating Δ along a DFS outward from y and z prices **all** 2(n − |P|) − 4 regraft edges of P in
O(n), so **the full SPR neighbourhood (≈3n subtrees × 2n edges) costs O(n²)** per sweep, and an
accepted move costs O(n²) to refresh the row sums. CV 2011 spends O(n³) on *one* candidate. At
n = 1000 that is the difference between ~6·10⁶ candidates per sweep and one candidate per ~10⁹ ops.
(Every delta checked against recomputation, 6368 regrafts, 1.2e-15, experiments/01.)

**Exact k-subtree move** (from the previous round, kept). A connected core of k−2 internal nodes with k
subtrees hanging off it: nodes outside the core see the same three leaf sets whatever happens
inside, so the best arrangement is a k-leaf MQTC instance on block sums. The subset DP solves it
exactly over (2k−5)!! arrangements in O(3^k). It reaches moves SPR cannot: re-wiring many
subtrees at once.

## 4. Constructive starts

**NJ** minimises Q(i,j) = (m−2)d(i,j) − r_i − r_j. Summing quartet *support* (cost of the two
alternatives minus twice the chosen one) over all quartets that joining i, j decides gives exactly

    sup(i,j) = −(m−1)·Q(i,j) − 2·Σ_{k<l} d(k,l),

so NJ's first join is the greedy quartet join. After that NJ replaces i, j by a new taxon with
reduced distances (d_ik + d_jk − d_ij)/2. That keeps an additive metric additive, which is why NJ is
consistent.

**Quartet-join** (derived here; first notes, no claim of novelty) keeps the *exact* MQTC bookkeeping
instead. With a star of resolved clusters, joining A and B decides every quartet a, b, c, d with c, d
in two other, distinct clusters. Its total support is a closed form in block sums S, sizes s, and
per-cluster aggregates R_A = Σ_k S_Ak and U_A = Σ_k S_Ak s_k. Every candidate pair is O(1), the build
O(n³). Variants: total support ("qj") or support per decided quartet ("qja").

Findings (experiments/01–02):
* **Not consistent.** On additive metrics, qj recovers 1/20 trees and qja 4/20, against NJ's 20/20.
  Exact block sums let large clusters dominate the support. NJ's averaging is a feature, not an
  approximation.
* **Better starting points where d is not tree-like.** qja builds S = 0.943 on colours_1000 against
  NJ's 0.636, and 0.831 against 0.786 on digits_1000. Starting closer, the SPR descent is 2–4× shorter.
  After local search the start matters little, though not nothing.

## 5. What is left hard

The problem is NP-hard, and has no PTAS unless P = NP (CV 2011, by reduction from maximum quartet
consistency). Our local optima at n = 100
match the previous round's best everywhere, and NJ+SPR+DP hits the exact optimum on 30/30 instances
at n = 10..16. At n = 1000 different starts end at different local optima (ΔS ≈ 0.003 on digits),
so the open question is search, not evaluation: how to spend a time budget across kicks, restarts,
and recombination of local optima.
