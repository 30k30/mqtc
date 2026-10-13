#!/usr/bin/env node
/*
  mqtc.js: minimum quartet tree cost (Cilibrasi–Vitányi) for n in the hundreds to low thousands.

  Objective. For an unrooted binary tree T on n objects, C_T = sum over the quartets uv|wx that T
  displays of d(u,v) + d(w,x). Two equivalent forms drive everything here (notes/derivations.md):
    node form   C_T = sum over internal nodes with leaf sets X,Y,Z of
                      C(|X|,2) S(Y,Z) + C(|Y|,2) S(X,Z) + C(|Z|,2) S(X,Y),   S(A,B) = sum of d over A x B
    pair form   C_T = sum over pairs u<v of d(u,v) * N_T(u,v), N_T(u,v) = sum over the internal nodes p
                      on the u–v path of C(g_p, 2), g_p = leaves hanging off the path at p.
  Every local quantity is a block sum between subtrees, so:
    - the cost of a tree is O(n^2) (one pass of subtree row sums),
    - moving a subtree P across one node changes the cost by an O(1) expression in block sums,
      hence the whole SPR neighbourhood (every subtree to every edge) costs O(n^2) to scan.

  Search (CLI): a population of local optima, each = start tree (quartet-join, possibly on a noisy copy
  of d, or random) -> SPR descent -> exact subtree-DP polish (re-arrange the k subtrees around a random
  connected core) -> SPR descent. Generations alternate new optima (one per worker thread: fresh starts
  and big kicks of population members) with fusion: the exact best tree over the population's
  clusters, polished and added back. Prints cost, and S(T) when bounds (from qbounds.c) are given.

  Usage: node mqtc.js matrix.txt [--seconds 60] [--threads N] [--pop 12] [--k 12] [--seed 1]
                                 [--bounds bounds.txt] [--json out.json] [--quiet]
*/
'use strict';
const fs = require('fs');

/* ---------------- random numbers ---------------- */
function rng32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

/* ---------------- matrices ---------------- */
function readMatrix(path) {
  const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (/^\d+$/.test(lines[0]) && lines.length > 1) lines.shift();
  const labels = [], rows = lines.map(l => { const t = l.split(/[\s,;]+/).filter(Boolean); labels.push(isFinite(Number(t[0])) ? null : t.shift()); return t.map(Number); });
  const n = rows.length;
  if (n < 4 || rows.some(r => r.length !== n || r.some(x => !isFinite(x)))) throw new Error(`expected a square numeric matrix, got ${n} rows`);
  const D = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) D[i * n + j] = i === j ? 0 : (rows[i][j] + rows[j][i]) / 2;
  return { D, n, labels: labels.every(Boolean) ? labels : labels.map((_, i) => String(i)) };
}

/* ---------------- trees ----------------
   Nodes 0..n-1 are the leaves (object i sits at node i), n..2n-3 internal. nb[3v+j] = neighbours, -1 = free. */
function newTree(n) { const V = 2 * n - 2; return { n, V, nb: new Int32Array(3 * V).fill(-1) }; }
function cloneTree(T) { return { n: T.n, V: T.V, nb: T.nb.slice() }; }
function addEdge(T, u, v) { const a = T.nb; let i = 3 * u; while (a[i] >= 0) i++; a[i] = v; i = 3 * v; while (a[i] >= 0) i++; a[i] = u; }
function replaceNb(T, v, old, nw) { const a = T.nb; for (let j = 3 * v; j < 3 * v + 3; j++) if (a[j] === old) { a[j] = nw; return; } throw new Error(`replaceNb: ${old} not adjacent to ${v}`); }
function randomTree(n, rng) {
  const T = newTree(n), order = shuffle([...Array(n).keys()], rng), E = []; let next = n;
  const c = next++; for (let i = 0; i < 3; i++) { addEdge(T, c, order[i]); E.push([c, order[i]]); }
  for (let k = 3; k < n; k++) { const e = Math.floor(rng() * E.length), [u, v] = E[e], w = next++, l = order[k];
    replaceNb(T, u, v, w); replaceNb(T, v, u, w); T.nb[3 * w] = u; T.nb[3 * w + 1] = v; T.nb[3 * w + 2] = l; T.nb[3 * l] = w; E[e] = [u, w]; E.push([w, v], [w, l]); }
  return T;
}
function checkTree(T) {   // binary, connected, every object a leaf
  const { n, V, nb } = T, seen = new Uint8Array(V), st = [0]; seen[0] = 1; let cnt = 1;
  for (let v = 0; v < V; v++) { let d = 0; for (let j = 0; j < 3; j++) if (nb[3 * v + j] >= 0) d++; if (d !== (v < n ? 1 : 3)) throw new Error(`node ${v} has degree ${d}`); }
  while (st.length) { const v = st.pop(); for (let j = 0; j < 3; j++) { const w = nb[3 * v + j]; if (w >= 0 && !seen[w]) { seen[w] = 1; cnt++; st.push(w); } } }
  if (cnt !== V) throw new Error('tree not connected');
  return true;
}

/* ---------------- subtree statistics, rooted at leaf 0 ----------------
   D(v): leaves below v; U(v): the rest. R[v*n+j] = sum over x in D(v) of d(x,j). D(v) is the slice
   leafOrder[lo[v] .. hi[v]) of the DFS leaf order. cut[v] = S(D(v), U(v)); S12[v] = S between the two
   child subtrees of internal v. cost = C_T. All O(V n). */
function stats(T, D, st) {
  const { n, V, nb } = T;
  if (!st) { st = { parent: new Int32Array(V), order: new Int32Array(V), lo: new Int32Array(V), hi: new Int32Array(V), size: new Int32Array(V), leafOrder: new Int32Array(n),
    R: new Float64Array(V * n), tot: new Float64Array(V), W: new Float64Array(V), cut: new Float64Array(V), S12: new Float64Array(V), rowTot: new Float64Array(n), totAll: 0, pre: new Float64Array(n + 1), buf: new Float64Array(n) };
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += D[i * n + j]; st.rowTot[i] = s; st.totAll += s; } }
  const { parent, order, lo, hi, size, leafOrder, R, tot, W, cut, S12, rowTot } = st;
  // iterative DFS preorder from leaf 0
  const stack = [0]; parent[0] = -1; let k = 0, nl = 0;
  while (stack.length) { const v = stack.pop(); order[k++] = v; lo[v] = nl; if (v < n) leafOrder[nl++] = v;
    for (let j = 2; j >= 0; j--) { const w = nb[3 * v + j]; if (w >= 0 && w !== parent[v]) { parent[w] = v; stack.push(w); } } }
  let cost = 0;
  for (let i = V - 1; i >= 1; i--) {
    const v = order[i], b = v * n;
    if (v < n) { size[v] = 1; hi[v] = lo[v] + 1; R.set(D.subarray(v * n, v * n + n), b); tot[v] = rowTot[v]; W[v] = 0; cut[v] = tot[v]; continue; }
    let c1 = -1, c2 = -1; for (let j = 0; j < 3; j++) { const w = nb[3 * v + j]; if (w !== parent[v]) { if (c1 < 0) c1 = w; else c2 = w; } }
    const b1 = c1 * n, b2 = c2 * n; for (let j = 0; j < n; j++) R[b + j] = R[b1 + j] + R[b2 + j];
    let s12 = 0; for (let t = lo[c2]; t < hi[c2]; t++) s12 += R[b1 + leafOrder[t]];
    size[v] = size[c1] + size[c2]; hi[v] = lo[v] + size[v]; tot[v] = tot[c1] + tot[c2]; W[v] = W[c1] + W[c2] + s12; S12[v] = s12; cut[v] = tot[v] - 2 * W[v];
    const s1 = size[c1], s2 = size[c2], s3 = n - s1 - s2;
    cost += s1 * (s1 - 1) / 2 * (cut[c2] - s12) + s2 * (s2 - 1) / 2 * (cut[c1] - s12) + s3 * (s3 - 1) / 2 * s12;
  }
  size[0] = n; hi[0] = n; R.set(D.subarray(0, n), 0); st.cost = cost;
  return st;
}
const treeCost = (T, D) => stats(T, D).cost;

/* ---------------- SPR: best regraft of one subtree, O(n) ----------------
   P = the side of b seen from its attachment node a (a internal). Removing P and a joins a's other two
   neighbours y–z into one edge of T'. Moving P from an edge into a neighbouring edge at node w of T',
   where w's three sides (in T') are X1 (where P comes from), X2 (where it goes) and X3, changes only the
   quartets with one leaf in each of P, X1, X2, X3:
       delta = |X1||X3| S(P,X2) + |P||X2| S(X1,X3) - |X2||X3| S(P,X1) - |P||X1| S(X2,X3).
   Walking outward from y and z accumulates these, which prices every regraft edge in O(1). */
function bestRegraft(T, st, a, b, all) {   // all: optional array, receives [w, x, delta] for every edge
  const { n, nb } = T, { parent, size, cut, tot, S12, R, lo, hi, leafOrder, rowTot, pre, buf } = st;
  let sP, cutP, totP, RP, off;
  if (parent[b] === a) { sP = size[b]; cutP = cut[b]; totP = tot[b]; RP = R; off = b * n; }
  else { sP = n - size[a]; cutP = cut[a]; totP = st.totAll - tot[a]; const ba = a * n; for (let j = 0; j < n; j++) buf[j] = rowTot[j] - R[ba + j]; RP = buf; off = 0; }
  pre[0] = 0; for (let t = 0; t < n; t++) pre[t + 1] = pre[t] + RP[off + leafOrder[t]];
  let bestD = Infinity, bw = -1, bx = -1;
  const stk = [];
  for (let j = 0; j < 3; j++) { const y = nb[3 * a + j]; if (y !== b && y >= n) stk.push(y, a, 0); }
  while (stk.length) {
    const cum = stk.pop(), from = stk.pop(), w = stk.pop();
    let x2 = -1, x3 = -1; for (let j = 0; j < 3; j++) { const x = nb[3 * w + j]; if (x !== from) { if (x2 < 0) x2 = x; else x3 = x; } }
    let s2, sp2, c2, s3, sp3, c3, s23;
    if (parent[x2] === w) { s2 = size[x2]; sp2 = pre[hi[x2]] - pre[lo[x2]]; c2 = cut[x2]; } else { s2 = n - size[w]; sp2 = totP - (pre[hi[w]] - pre[lo[w]]); c2 = cut[w]; }
    if (parent[x3] === w) { s3 = size[x3]; sp3 = pre[hi[x3]] - pre[lo[x3]]; c3 = cut[x3]; } else { s3 = n - size[w]; sp3 = totP - (pre[hi[w]] - pre[lo[w]]); c3 = cut[w]; }
    if (parent[x2] === w && parent[x3] === w) s23 = S12[w]; else s23 = (parent[x2] === w ? cut[x2] : cut[x3]) - S12[w];
    const s1 = n - sP - s2 - s3, sp1 = cutP - sp2 - sp3, s13 = c3 - s23 - sp3, s12 = c2 - s23 - sp2;
    const d2 = cum + s1 * s3 * sp2 + sP * s2 * s13 - s2 * s3 * sp1 - sP * s1 * s23;
    const d3 = cum + s1 * s2 * sp3 + sP * s3 * s12 - s2 * s3 * sp1 - sP * s1 * s23;
    if (all) all.push([w, x2, d2], [w, x3, d3]);
    if (d2 < bestD) { bestD = d2; bw = w; bx = x2; }
    if (d3 < bestD) { bestD = d3; bw = w; bx = x3; }
    if (x2 >= n) stk.push(x2, w, d2);
    if (x3 >= n) stk.push(x3, w, d3);
  }
  return { delta: bestD, w: bw, x: bx };
}
function applySPR(T, a, b, w, x) {
  const nb = T.nb; let y = -1, z = -1;
  for (let j = 0; j < 3; j++) { const v = nb[3 * a + j]; if (v !== b) { if (y < 0) y = v; else z = v; } }
  replaceNb(T, y, a, z); replaceNb(T, z, a, y);
  nb[3 * a] = b; nb[3 * a + 1] = w; nb[3 * a + 2] = x;
  replaceNb(T, w, x, a); replaceNb(T, x, w, a);
}
const adjacent = (T, u, v) => T.nb[3 * u] === v || T.nb[3 * u + 1] === v || T.nb[3 * u + 2] === v;
/* Greedy SPR descent: visit every (attachment, subtree) pair in random order, take its best regraft if it
   improves, repeat until a full pass finds nothing. Returns the number of moves made. */
function sprDescent(T, D, rng, opt = {}) {
  const n = T.n; let st = stats(T, D), cost = st.cost, moves = 0, passes = 0;
  const tol = 1e-12 * Math.abs(cost) + 1e-12, t0 = Date.now(), ms = opt.ms ?? Infinity;
  const pairs = []; for (let a = n; a < T.V; a++) for (let j = 0; j < 3; j++) pairs.push(a, j);
  const idx = [...Array(pairs.length / 2).keys()];
  for (;;) {
    passes++; let made = 0; shuffle(idx, rng);
    for (const i of idx) {
      const a = pairs[2 * i], b = T.nb[3 * a + pairs[2 * i + 1]];
      const r = bestRegraft(T, st, a, b);
      if (r.delta < -tol) { applySPR(T, a, b, r.w, r.x); st = stats(T, D, st); cost = st.cost; moves++; made++; if (Date.now() - t0 > ms) return { moves, passes, cost }; }
    }
    if (!made || Date.now() - t0 > ms) return { moves, passes, cost };
  }
}

/* ---------------- constructive starts ---------------- */
/* Neighbour joining (Saitou–Nei, O(n^3)). */
function nj(D, n) {
  const T = newTree(n), m0 = n, d = new Float64Array(n * n); d.set(D);
  let act = [...Array(n).keys()], node = [...Array(n).keys()], next = n; const r = new Float64Array(n);
  while (act.length > 3) {
    const m = act.length; for (const i of act) { let s = 0; for (const j of act) s += d[i * m0 + j]; r[i] = s; }
    let best = Infinity, bi = -1, bj = -1;
    for (let p = 0; p < m; p++) { const i = act[p], ri = r[i], bi0 = i * m0; for (let q = p + 1; q < m; q++) { const j = act[q], v = (m - 2) * d[bi0 + j] - ri - r[j]; if (v < best) { best = v; bi = i; bj = j; } } }
    const u = next++; addEdge(T, u, node[bi]); addEdge(T, u, node[bj]);
    for (const k of act) if (k !== bi && k !== bj) { const v = (d[bi * m0 + k] + d[bj * m0 + k] - d[bi * m0 + bj]) / 2; d[bi * m0 + k] = d[k * m0 + bi] = v; }
    node[bi] = u; act = act.filter(k => k !== bj);
  }
  const c = next++; for (const k of act) addEdge(T, c, node[k]);
  return T;
}
/* Quartet-join (derived here). Keep a star of clusters, each already a resolved subtree. Joining A and B
   decides every quartet a,b,c,d with c, d in two other, distinct clusters, as ab|cd. Its support
       sup(A,B) = sum over those quartets of (d_ac + d_bd) + (d_ad + d_bc) - 2 (d_ab + d_cd)
   is a closed form in block sums S, cluster sizes s and per-cluster aggregates R_A = sum_k S_Ak,
   U_A = sum_k S_Ak s_k, so every candidate pair costs O(1) and the whole build O(n^3), like NJ.
   'sum' joins the pair with the largest total support; 'avg' divides by the number of quartets decided. */
function quartetJoin(D, n, mode = 'avg') {
  const T = newTree(n), S = new Float64Array(n * n); S.set(D);
  const s = new Float64Array(n).fill(1), R = new Float64Array(n), U = new Float64Array(n);
  for (let i = 0; i < n; i++) { let a = 0; for (let j = 0; j < n; j++) a += S[i * n + j]; R[i] = a; U[i] = a; }
  let act = [...Array(n).keys()], node = [...Array(n).keys()], next = n, Qall = 0, ss = n;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) Qall += S[i * n + j];
  while (act.length > 3) {
    const m = act.length; let best = -Infinity, bi = -1, bj = -1;
    for (let p = 0; p < m; p++) { const A = act[p], sA = s[A], RA = R[A], UA = U[A];
      for (let q = p + 1; q < m; q++) { const B = act[q], sB = s[B], SAB = S[A * n + B];
        const Ts = n - sA - sB, P2 = (Ts * Ts - (ss - sA * sA - sB * sB)) / 2, Q = Qall - RA - R[B] + SAB;
        const alt = sB * (Ts * (RA - SAB) - (UA - SAB * sB)) + sA * (Ts * (R[B] - SAB) - (U[B] - SAB * sA));
        let v = alt - 2 * (SAB * P2 + sA * sB * Q);
        if (mode === 'avg') v /= sA * sB * P2 || 1;
        if (v > best) { best = v; bi = A; bj = B; } } }
    const A = bi, B = bj, u = next++; addEdge(T, u, node[A]); addEdge(T, u, node[B]);
    const SAB = S[A * n + B], sA = s[A], sB = s[B];
    for (const k of act) if (k !== A && k !== B) { const sAk = S[A * n + k], sBk = S[B * n + k]; U[k] += sAk * sB + sBk * sA; S[A * n + k] = S[k * n + A] = sAk + sBk; }
    U[A] = (U[A] - SAB * sB) + (U[B] - SAB * sA); R[A] = R[A] + R[B] - 2 * SAB; Qall -= SAB; ss += 2 * sA * sB; s[A] = sA + sB;
    node[A] = u; act = act.filter(k => k !== B);
  }
  const c = next++; for (const k of act) addEdge(T, c, node[k]);
  return T;
}

/* ---------------- exact subtree-DP move ----------------
   A connected core of k-2 internal nodes has k subtrees hanging off it. Nodes outside the core keep their
   three leaf sets whatever happens inside, so re-arranging the k subtrees is a k-leaf MQTC instance with
   leaves -> subtrees, d -> block sums, counts -> subtree sizes, solved exactly by the subset DP. */
function dpTables(X, sz, k) {
  const W = new Float64Array(1 << k), s = new Int32Array(1 << k);
  for (let m = 1; m < 1 << k; m++) { const low = m & -m, i = 31 - Math.clz32(low), rest = m ^ low; let a = 0; for (let q = rest; q; q &= q - 1) a += X[i * k + (31 - Math.clz32(q & -q))]; W[m] = W[rest] + a; s[m] = s[rest] + sz[i]; }
  return { W, s };
}
function subsetDP(X, sz, k, total) {
  const { W, s } = dpTables(X, sz, k), full = (1 << k) - 1, Mh = 1 << (k - 1), best = new Float64Array(Mh), arg = new Int32Array(Mh);
  for (let Cc = 1; Cc < Mh; Cc++) {
    if ((Cc & (Cc - 1)) === 0) continue;
    const Z = full ^ Cc, kz = total - s[Cc], low = Cc & -Cc, rest = Cc ^ low, WZ = W[Z], WC = W[Cc], cz = kz * (kz - 1) / 2;
    let sub = rest, bv = Infinity, ba = 0;
    for (;;) { const C1 = low | sub, C2 = Cc ^ C1;
      if (C2) { const k1 = s[C1], k2 = s[C2], w1 = W[C1], w2 = W[C2];
        const v = best[C1] + best[C2] + k1 * (k1 - 1) / 2 * (W[C2 | Z] - w2 - WZ) + k2 * (k2 - 1) / 2 * (W[C1 | Z] - w1 - WZ) + cz * (WC - w1 - w2);
        if (v < bv) { bv = v; ba = C1; } }
      if (sub === 0) break; sub = (sub - 1) & rest; }
    best[Cc] = bv; arg[Cc] = ba;
  }
  return { cost: best[Mh - 1], arg, W, s };
}
function pickCore(T, size, rng) {
  const { n, V, nb } = T, inCore = new Uint8Array(V), seed = n + Math.floor(rng() * (V - n)), core = [seed]; inCore[seed] = 1;
  while (core.length < size) { const fr = []; for (const c of core) for (let j = 0; j < 3; j++) { const w = nb[3 * c + j]; if (w >= n && !inCore[w]) fr.push(w); } if (!fr.length) break; const w = fr[Math.floor(rng() * fr.length)]; inCore[w] = 1; core.push(w); }
  return core;
}
/* Returns the gain (>= 0) and applies the optimal arrangement when it beats the current one by > tol. */
function dpMove(T, D, st, core, tol) {
  const { n, nb } = T, { parent, size, R, lo, hi, leafOrder, rowTot } = st, inCore = new Set(core), blocks = [];
  for (const c of core) for (let j = 0; j < 3; j++) { const x = nb[3 * c + j]; if (!inCore.has(x)) blocks.push({ c, x, down: parent[x] === c }); }
  const K = blocks.length, sz = new Int32Array(K), X = new Float64Array(K * K), Rb = new Float64Array(n);
  for (const b of blocks) b.s = b.down ? size[b.x] : n - size[b.c];
  blocks.forEach((b, i) => { sz[i] = b.s; });
  for (let i = 0; i < K; i++) {
    const bi = blocks[i]; if (bi.down) Rb.set(R.subarray(bi.x * n, bi.x * n + n)); else for (let j = 0; j < n; j++) Rb[j] = rowTot[j] - R[bi.c * n + j];
    for (let j = i + 1; j < K; j++) { const bj = blocks[j]; let s = 0;
      if (bj.down) { for (let t = lo[bj.x]; t < hi[bj.x]; t++) s += Rb[leafOrder[t]]; }
      else { for (let t = 0; t < lo[bj.c]; t++) s += Rb[leafOrder[t]]; for (let t = hi[bj.c]; t < n; t++) s += Rb[leafOrder[t]]; }
      X[i * K + j] = X[j * K + i] = s; }
  }
  const r = subsetDP(X, sz, K, n), { W, s } = r, full = (1 << K) - 1, key = new Map();
  blocks.forEach((b, i) => key.set(b.c * T.V + b.x, 1 << i));
  let cur = 0;
  const phi = (A, B) => { const Z = full ^ A ^ B, ka = s[A], kb = s[B], kz = n - ka - kb; return ka * (ka - 1) / 2 * (W[B | Z] - W[B] - W[Z]) + kb * (kb - 1) / 2 * (W[A | Z] - W[A] - W[Z]) + kz * (kz - 1) / 2 * (W[A | B] - W[A] - W[B]); };
  const mask = (c, from) => { let A = 0, B = 0; for (let j = 0; j < 3; j++) { const w = nb[3 * c + j]; if (w === from) continue; const m = inCore.has(w) ? mask(w, c) : key.get(c * T.V + w); if (A) B = m; else A = m; } cur += phi(A, B); return A | B; };
  const root = blocks[K - 1]; mask(root.c, root.x);
  const gain = cur - r.cost;
  if (gain > tol) {
    for (const c of core) { for (let j = 0; j < 3; j++) { const w = nb[3 * c + j]; if (!inCore.has(w)) replaceNb(T, w, c, -1); } nb[3 * c] = nb[3 * c + 1] = nb[3 * c + 2] = -1; }
    const pool = core.slice();
    const build = m => { if ((m & (m - 1)) === 0) return blocks[31 - Math.clz32(m)].x; const u = pool.pop(), a = r.arg[m]; addEdge(T, u, build(a)); addEdge(T, u, build(m ^ a)); return u; };
    addEdge(T, build((1 << (K - 1)) - 1), blocks[K - 1].x);
  }
  return gain;
}
function dpPolish(T, D, rng, k, opt = {}) {
  let st = stats(T, D), moves = 0, tries = 0, idle = 0; const tol = 1e-12 * Math.abs(st.cost) + 1e-12, t0 = Date.now(), ms = opt.ms ?? Infinity, stall = opt.stall ?? 2 * T.n;
  while (idle < stall && Date.now() - t0 < ms) {
    const core = pickCore(T, k - 2, rng); if (core.length < 2) break;
    tries++; const g = dpMove(T, D, st, core, tol);
    if (g > tol) { st = stats(T, D, st); moves++; idle = 0; } else idle++;
  }
  return { moves, tries, cost: st.cost };
}

/* ---------------- fusion: exact optimum over trees assembled from a pool of clusters ----------------
   Root every tree at leaf 0; a cluster is a set D(v). The DP (as in ASTRAL) gives the cheapest tree all of
   whose clusters are in the pool: best(C) = min over splits C = A + B (both in the pool) of
   best(A) + best(B) + phi(A, B, rest). A split needs only per-cluster size s, row total t, within sum W:
       S(A,B) = W(C) - W(A) - W(B),  S(A,rest) = t(A) - 2W(A) - S(A,B),
   so no O(n) vectors are stored. Clusters are keyed by an additive random hash (sum of 40-bit weights,
   exact in a double), so the complement C - A is one Map lookup. Candidate A's for C: every cluster of
   every input tree that lies inside C, found with one O(n) count per (C, tree). Every input tree is
   representable, so the result is never worse than the best input. */
function fusion(trees, D, rng) {
  const n = trees[0].n, h = new Float64Array(n); for (let i = 0; i < n; i++) h[i] = Math.floor(rng() * 2 ** 40);
  const pool = new Map(), per = [];   // hash -> {s, t, W, best, a, b}
  for (const T of trees) {
    const st = stats(T, D), { order, parent, size, tot, W, nb } = { ...st, nb: T.nb }, V = T.V, hs = new Float64Array(V), info = { T, order: st.order.slice(), parent: st.parent.slice(), size: st.size.slice(), hs };
    for (let i = V - 1; i >= 1; i--) { const v = order[i]; if (v < n) hs[v] = h[v]; else { let s = 0; for (let j = 0; j < 3; j++) { const w = nb[3 * v + j]; if (w !== parent[v]) s += hs[w]; } hs[v] = s; }
      if (!pool.has(hs[v])) pool.set(hs[v], { s: size[v], t: tot[v], W: W[v], best: size[v] === 1 ? 0 : Infinity, a: -1, b: -1, v, ti: per.length }); }
    per.push(info);
  }
  const cl = [...pool.entries()].sort((x, y) => x[1].s - y[1].s), cnt = new Int32Array(2 * n), inC = new Uint8Array(n);
  const leavesOf = (c) => { const { T, parent } = per[c.ti], out = [], st = [c.v]; while (st.length) { const v = st.pop(); if (v < n) out.push(v); else for (let j = 0; j < 3; j++) { const w = T.nb[3 * v + j]; if (w !== parent[v]) st.push(w); } } return out; };
  let splits = 0;
  for (const [hC, C] of cl) {
    if (C.s < 2) continue;
    const L = leavesOf(C); for (const x of L) inC[x] = 1;
    const WC = C.W, Z = n - C.s, cz = Z * (Z - 1) / 2;
    for (const info of per) {
      const { T, order, parent, size, hs } = info;
      for (let i = T.V - 1; i >= 1; i--) { const v = order[i]; if (v < n) cnt[v] = inC[v]; else { let s = 0; for (let j = 0; j < 3; j++) { const w = T.nb[3 * v + j]; if (w !== parent[v]) s += cnt[w]; } cnt[v] = s; }
        if (cnt[v] === size[v] && size[v] < C.s && size[v] * 2 <= C.s) {   // A inside C; take each unordered split once (|A| <= |B|)
          const A = pool.get(hs[v]), B = pool.get(hC - hs[v]);
          if (!B || B.s !== C.s - A.s || A.best === Infinity || B.best === Infinity) continue;
          splits++;
          const sAB = WC - A.W - B.W, sAZ = A.t - 2 * A.W - sAB, sBZ = B.t - 2 * B.W - sAB;
          const val = A.best + B.best + A.s * (A.s - 1) / 2 * sBZ + B.s * (B.s - 1) / 2 * sAZ + cz * sAB;
          if (val < C.best) { C.best = val; C.a = hs[v]; C.b = hC - hs[v]; } } }
    }
    for (const x of L) inC[x] = 0;
  }
  const top = cl[cl.length - 1][1], T = newTree(n); let next = n;
  const build = c => { if (c.s === 1) return leavesOf(c)[0]; const u = next++; addEdge(T, u, build(pool.get(c.a))); addEdge(T, u, build(pool.get(c.b))); return u; };
  const u = build(top); addEdge(T, u, 0);
  return { T, cost: top.best, clusters: cl.length, splits };
}

/* ---------------- iterated local search ---------------- */
function kick(T, rng, m, reach = 4) {   // m random SPR moves (random subtree to a random edge 1..reach steps away)
  const { n, V, nb } = T;
  for (let i = 0; i < m; i++) {
    const a = n + Math.floor(rng() * (V - n)), b = nb[3 * a + Math.floor(rng() * 3)];
    let y = -1; for (let j = 0; j < 3; j++) { const v = nb[3 * a + j]; if (v !== b) { y = v; break; } }
    let from = a, w = y, steps = 1 + Math.floor(rng() * reach);
    while (w >= n && steps-- > 0) { const opts = []; for (let j = 0; j < 3; j++) { const v = nb[3 * w + j]; if (v !== from) opts.push(v); } const nx = opts[Math.floor(rng() * opts.length)]; from = w; w = nx; }
    if (from === a) continue;   // y was a leaf: no edge beyond
    applySPR(T, a, b, from, w);
  }
}
function solveILS(D, n, opt = {}) {   // experiment 04 only: ILS with small kicks (a dead end at n = 1000)
  const rng = rng32(opt.seed ?? 1), log = opt.log || (() => {}), t0 = Date.now(), el = () => (Date.now() - t0) / 1000, k = opt.k ?? 12;
  const start = opt.start ?? 'nj';
  let T = start === 'nj' ? nj(D, n) : start === 'qj' ? quartetJoin(D, n, 'sum') : start === 'qja' ? quartetJoin(D, n, 'avg') : randomTree(n, rng);
  const trace = [];
  const note = (what) => { const c = treeCost(T, D); trace.push({ t: el(), what, cost: c }); log(`${el().toFixed(2)} s  ${what.padEnd(28)} cost ${c}`); return c; };
  note(`start (${start})`);
  let r = sprDescent(T, D, rng); note(`SPR descent (${r.moves} moves)`);
  if (k >= 6) { const p = dpPolish(T, D, rng, k, { stall: opt.stall }); r = sprDescent(T, D, rng); note(`DP k=${k} (${p.moves}/${p.tries}) + SPR (${r.moves})`); }
  let best = cloneTree(T), bestC = treeCost(T, D), kicks = 0, wins = 0;
  const ms = (opt.seconds ?? 0) * 1000;
  while (Date.now() - t0 < ms) {
    const C = cloneTree(best); kick(C, rng, opt.kick ?? Math.max(2, Math.round(n / 50)));
    sprDescent(C, D, rng); if (k >= 6) { dpPolish(C, D, rng, k, { stall: Math.max(20, n / 4) }); sprDescent(C, D, rng); }
    const c = treeCost(C, D); kicks++;
    if (c < bestC - 1e-12 * Math.abs(bestC)) { best = C; bestC = c; wins++; trace.push({ t: el(), what: `ILS kick ${kicks}`, cost: c }); log(`${el().toFixed(2)} s  ILS kick ${kicks} improved      cost ${c}`); }
  }
  if (kicks) log(`${el().toFixed(2)} s  ILS: ${kicks} kicks, ${wins} improved`);
  return { T: best, cost: bestC, trace, kicks, wins, seconds: el() };
}

/* ---------------- population search: parallel local optima + exact recombination ----------------
   Experiments 04-05: small ILS kicks stay in one basin (gains ~1e-7 in S per kick at n = 1000), while
   fusing a handful of local optima from different starts gains ~1e-5 in about a second. So the search
   keeps a population of distinct local optima and alternates:
     generate  one new local optimum per thread: a fresh start (quartet-join on a noisy copy of d, or a
               random tree) or a big kick (n/10 random SPRs) of a population member, each followed by
               SPR descent + DP polish + SPR descent;
     recombine fuse the population (exact DP over its clusters), polish the result, add it back.
   The population keeps the best `pop` distinct trees. Workers share d through a SharedArrayBuffer. */
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
function noisy(D, n, eps, rng) { const E = new Float64Array(n * n); for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) E[i * n + j] = E[j * n + i] = D[i * n + j] * (1 + eps * (2 * rng() - 1)); return E; }
function startTree(D, n, start, rng, eps = 0) {
  const E = eps > 0 ? noisy(D, n, eps, rng) : D;
  return start === 'nj' ? nj(E, n) : start === 'qj' ? quartetJoin(E, n, 'sum') : start === 'qja' ? quartetJoin(E, n, 'avg') : randomTree(n, rng);
}
function localOptimum(D, n, job) {   // job: {start, eps} from scratch, or {nb, kick, reach} from a given tree; then descend
  const rng = rng32(job.seed), t0 = Date.now();
  let T; if (job.nb) { T = { n, V: 2 * n - 2, nb: Int32Array.from(job.nb) }; kick(T, rng, job.kick || 0, job.reach || 4); } else T = startTree(D, n, job.start, rng, job.eps);
  sprDescent(T, D, rng); dpPolish(T, D, rng, job.k); sprDescent(T, D, rng);
  return { nb: T.nb, cost: treeCost(T, D), ms: Date.now() - t0 };
}
class Pool {
  constructor(threads, D, n) {
    this.cx = { D, n }; this.ws = []; this.idle = []; this.q = []; this.cb = new Map(); this.id = 0;
    for (let i = 0; threads > 1 && i < threads; i++) {
      const w = new Worker(__filename, { workerData: { mqtc: 1, D: D.buffer, n } });
      w.on('message', ({ id, res, err }) => { const t = this.cb.get(id); this.cb.delete(id); this.idle.push(w); this.pump(); if (err) t.reject(new Error(err)); else t.resolve(res); });
      w.on('error', e => { for (const t of this.cb.values()) t.reject(e); this.cb.clear(); });
      this.ws.push(w); this.idle.push(w);
    }
  }
  get size() { return this.ws.length || 1; }
  run(job) {
    if (!this.ws.length) { try { return Promise.resolve(localOptimum(this.cx.D, this.cx.n, job)); } catch (e) { return Promise.reject(e); } }
    return new Promise((resolve, reject) => { this.q.push({ job, resolve, reject }); this.pump(); });
  }
  pump() { while (this.idle.length && this.q.length) { const w = this.idle.shift(), t = this.q.shift(), id = ++this.id; this.cb.set(id, t); w.postMessage({ id, job: t.job }); } }
  close() { return Promise.all(this.ws.map(w => w.terminate())); }
}
async function search(D0, n, opt = {}) {
  const threads = opt.threads ?? 1, k = opt.k ?? 12, popK = opt.pop ?? 12, ms = (opt.seconds ?? 60) * 1000, log = opt.log || (() => {}), rng = rng32(opt.seed ?? 1);
  const D = new Float64Array(new SharedArrayBuffer(8 * n * n)); D.set(D0);
  const pool = new Pool(threads, D, n), t0 = Date.now(), el = () => (Date.now() - t0) / 1000, trace = [], pop = [];
  let seed = Math.imul(opt.seed ?? 1, 1000003), best = Infinity, gens = 0, made = 0;
  const add = (r, origin) => { made++; if (pop.some(p => Math.abs(p.cost - r.cost) <= 1e-13 * r.cost)) return; pop.push({ nb: r.nb, cost: r.cost, origin }); pop.sort((a, b) => a.cost - b.cost); if (pop.length > popK) pop.length = popK; };
  const report = what => { if (pop[0].cost < best * (1 - 1e-15)) { best = pop[0].cost; trace.push({ t: el(), what, cost: best, origin: pop[0].origin }); log(`${el().toFixed(1).padStart(6)} s  ${what.padEnd(30)} best ${best}  (${pop[0].origin})`); } };
  const fresh = i => (i % 3 === 2 ? { start: 'random', eps: 0 } : { start: 'qja', eps: i === 0 ? 0 : 0.1 });
  try {
    const n0 = Math.max(pool.size, opt.init ?? 4);
    (await Promise.all(Array.from({ length: n0 }, (_, i) => pool.run({ ...fresh(i), k, seed: seed++ })))).forEach((r, i) => add(r, fresh(i).start + (fresh(i).eps ? '~' : '')));
    report(`${n0} starts`);
    while (el() * 1000 < ms) {
      gens++;
      if (pop.length >= 2) { const F = fusion(pop.map(p => ({ n, V: 2 * n - 2, nb: p.nb })), D, rng); add(await pool.run({ nb: F.T.nb, k, seed: seed++ }), 'fusion'); report(`gen ${gens}: fusion of ${pop.length}`); }
      if (el() * 1000 >= ms) break;
      const jobs = Array.from({ length: pool.size }, (_, i) => (i % 2 === 0 && pop.length
        ? { nb: pop[Math.floor(rng() * rng() * pop.length)].nb, kick: Math.max(4, Math.round(n / 10)), reach: 8, k, seed: seed++, origin: 'kick' }
        : { ...fresh(1 + Math.floor(rng() * 3)), k, seed: seed++ }));
      (await Promise.all(jobs.map(j => pool.run(j)))).forEach((r, i) => add(r, jobs[i].origin || jobs[i].start + (jobs[i].eps ? '~' : '')));
      report(`gen ${gens}: ${jobs.length} new optima`);
    }
  } finally { await pool.close(); }
  log(`${el().toFixed(1).padStart(6)} s  done: ${gens} generations, ${made} local optima, population ${pop.length} on ${pool.size} thread(s)`);
  return { T: { n, V: 2 * n - 2, nb: Int32Array.from(pop[0].nb) }, cost: pop[0].cost, trace, gens, made, seconds: el(), threads: pool.size };
}

/* ---------------- reporting ---------------- */
/* Balanced (BME) edge lengths from average block distances, for drawing: internal edge AB|CD gets
   (dAC + dAD + dBC + dBD)/4 - (dAB + dCD)/2, pendant edge i|BC gets (diB + diC - dBC)/2. Clamped at 0. */
function edgeLengths(T, D) {
  const st = stats(T, D), { n, nb } = T, { parent, size, cut, S12, R, lo, hi, leafOrder } = st, out = [];
  const Sdown = (u, v) => { let s = 0; for (let t = lo[v]; t < hi[v]; t++) s += R[u * n + leafOrder[t]]; return s; };   // S(D(u), D(v)), disjoint
  const kids = v => { const c = []; for (let j = 0; j < 3; j++) { const w = nb[3 * v + j]; if (w !== parent[v]) c.push(w); } return c; };
  for (let v = 1; v < T.V; v++) {
    const u = parent[v]; let len;
    if (u === 0) { const [c1, c2] = kids(v), s1 = size[c1], s2 = size[c2], A = Sdown(0, c1) / s1, B = Sdown(0, c2) / s2, C = S12[v] / (s1 * s2); len = (A + B - C) / 2; }
    else {
      const sib = kids(u).find(w => w !== v), sC = size[sib], sD = n - size[u], SCD = cut[sib] - S12[u];
      if (v < n) { const SvC = Sdown(v, sib), SvD = cut[v] - S12[u]; len = (SvC / sC + SvD / sD - SCD / (sC * sD)) / 2; }
      else { const [a, b] = kids(v), sA = size[a], sB = size[b], SAC = Sdown(a, sib), SBC = Sdown(b, sib), SAD = cut[a] - S12[v] - SAC, SBD = cut[b] - S12[v] - SBC;
        len = (SAC / (sA * sC) + SAD / (sA * sD) + SBC / (sB * sC) + SBD / (sB * sD)) / 4 - (S12[v] / (sA * sB) + SCD / (sC * sD)) / 2; }
    }
    out.push([u, v, Math.max(0, len)]);
  }
  return out;
}
function newick(T, labels) {
  const { n, nb } = T, q = s => /[\s(),:;'\[\]]/.test(s) ? `'${s.replace(/'/g, "''")}'` : s;
  const rec = (u, p) => u < n ? q(labels[u]) : '(' + [0, 1, 2].map(j => nb[3 * u + j]).filter(w => w !== p).map(w => rec(w, u)).join(',') + ')';
  return rec(n, -1) + ';';
}
function readBounds(path) { const t = fs.readFileSync(path, 'utf8'), M = +(/M\s*=\s*([-\d.eE+]+)/.exec(t) || [])[1], m = +(/m\s*=\s*([-\d.eE+]+)/.exec(t) || [])[1]; return isFinite(M) && isFinite(m) ? { M, m } : null; }

async function main() {
  const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1]); };
  if (!argv[0] || argv[0].startsWith('--')) { console.error('usage: node mqtc.js matrix.txt [--seconds 60] [--threads N] [--pop 12] [--k 12] [--seed 1] [--bounds bounds.txt] [--json out.json] [--quiet]'); process.exit(1); }
  const { D, n, labels } = readMatrix(argv[0]), quiet = opt('quiet', false), B = opt('bounds', null) ? readBounds(opt('bounds')) : null;
  const os = require('os'), cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const fmt = B ? c => `S = ${((B.M - c) / (B.M - B.m)).toFixed(7)}` : c => `cost ${c}`;
  const res = await search(D, n, { seconds: +opt('seconds', 60), threads: +opt('threads', cores), pop: +opt('pop', 12), k: +opt('k', 12), seed: +opt('seed', 1),
    log: quiet ? null : s => console.error(B ? s.replace(/best ([-\d.e+]+)/, (_, c) => fmt(+c)) : s) });
  checkTree(res.T);
  console.log(`n = ${n}\ncost = ${res.cost}` + (B ? `\n${fmt(res.cost)}` : ''));
  if (opt('json', null)) fs.writeFileSync(opt('json'), JSON.stringify({ n, labels, cost: res.cost, S: B ? (B.M - res.cost) / (B.M - B.m) : null, seconds: res.seconds, threads: res.threads, optima: res.made,
    edges: edgeLengths(res.T, D), trace: res.trace.map(t => ({ ...t, S: B ? (B.M - t.cost) / (B.M - B.m) : null })), newick: newick(res.T, labels) }));
  else console.log(newick(res.T, labels));
}
if (!isMainThread && workerData && workerData.mqtc) {
  const D = new Float64Array(workerData.D), n = workerData.n;
  parentPort.on('message', ({ id, job }) => { let res, err; try { res = localOptimum(D, n, job); } catch (e) { err = e.stack || String(e); } parentPort.postMessage({ id, res, err }); });
} else if (require.main === module) main().catch(e => { console.error(e.stack || e); process.exit(1); });

module.exports = { rng32, shuffle, readMatrix, newTree, cloneTree, randomTree, checkTree, stats, treeCost, bestRegraft, applySPR, adjacent, sprDescent, nj, quartetJoin,
  subsetDP, pickCore, dpMove, dpPolish, fusion, kick, solveILS, startTree, localOptimum, Pool, search, edgeLengths, newick, readBounds };
