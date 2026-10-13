#!/usr/bin/env node
/*
  mqtc_scale.js: minimum quartet tree cost (Cilibrasi–Vitányi) beyond exact range.

  Usage:
    node mqtc_scale.js matrix.txt [--k 16] [--k0 10] [--runs R] [--seconds 8] [--stall 400] [--seed 1]
                                  [--threads N] [--bound] [--exact]

  matrix.txt: square distance matrix, whitespace/comma separated. Each row may start with a label;
  a first line holding only n (PHYLIP style) is skipped. Asymmetric input is averaged.

  Method (each piece is exact on its own neighbourhood):
    1. Subtree-DP move. Pick a connected core of k-2 internal nodes; k subtrees hang off it.
       Nodes outside the core see the same three leaf sets whatever happens inside it, so their
       quartet charges are unchanged, and re-arranging the k subtrees is an independent MQTC
       instance: the subset DP of mqtc_exact with leaves -> subtrees, d -> subtree distance sums,
       popcount -> leaf counts. It searches (2k-5)!! arrangements exactly (about 2e14 at k = 16).
    2. Several runs from random trees. Each climbs with k = k0, k0+2, ..., k in turn, at each until
       --stall moves in a row have not helped, all within --seconds. Small k is cheap (about 1 ms
       a move at k = 12 against 50 ms at k = 16) and does most of the work from a random start;
       --k0 16 gives the old fixed-k runs.
    3. Cluster fusion (the ASTRAL recursion): the exact optimum over every tree whose clusters,
       rooted at the last object, all occur among the runs' final trees. Then more moves.
  --exact  runs the full subset DP instead (n <= 26; about 3^(n-1)/2 steps and 18·2^n bytes).
  --bound  adds a certified upper bound on S from all 5-object subsets (O(n^5) time, O(n^2) memory).
  Measured, 1 / 2 threads: --exact n = 20 in 5.6 / 2.9 s; --bound n = 100 in 7.4 / 4.0 s.

  Threads (worker_threads; --threads defaults to all cores, --runs to max(8, threads)):
    runs     one climb per worker. Run r is seeded from (--seed, r) alone, so the runs give the
             same trees for any thread count, unless --seconds cuts them short.
    polish   each round takes up to N node-disjoint cores and solves their moves at once. By the
             argument in 1, a move changes only the charges at its own core's nodes, and a node
             outside a core sees the same leaf sets either way, so moves on disjoint cores do not
             interact: the gains add, and applying every improving one equals doing them in turn.
    --exact  the subset DP, one cluster size at a time (a cluster needs only smaller ones).
    --bound  the quintet sum, dealt out by its first two objects.
  --threads 1 starts no workers and runs everything on the main thread.

  Output: cost, S(T) = (M - C_T)/(M - m), the bound if asked, and a Newick string.
*/
'use strict';
const fs = require('fs'), os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

/* ---------- random numbers ---------- */
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const runSeed = (seed, r) => (Math.imul(seed | 0, 0x9E3779B1) ^ Math.imul(r + 1, 0x85EBCA77)) | 0;

/* ---------- unrooted trees: adj[v] neighbours, tax[v] object index or -1 ---------- */
const clone = T => ({ adj: T.adj.map(a => a.slice()), tax: T.tax.slice() });
function addNode(T, t) { T.adj.push([]); T.tax.push(t); return T.adj.length - 1; }
function link(T, u, v) { T.adj[u].push(v); T.adj[v].push(u); }
function unlink(T, u, v) { T.adj[u].splice(T.adj[u].indexOf(v), 1); T.adj[v].splice(T.adj[v].indexOf(u), 1); }
function edges(T) { const E = []; T.adj.forEach((a, u) => a.forEach(v => { if (u < v) E.push([u, v]); })); return E; }
function randomTree(n, rng) {
  const T = { adj: [], tax: [] }, order = shuffle([...Array(n).keys()], rng), c = addNode(T, -1);
  for (const t of order.slice(0, 3)) link(T, c, addNode(T, t));
  for (let k = 3; k < n; k++) { const E = edges(T), [u, v] = E[Math.floor(rng() * E.length)]; unlink(T, u, v); const w = addNode(T, -1); link(T, u, w); link(T, w, v); link(T, w, addNode(T, order[k])); }
  return T;
}
function sideTaxa(T, from, to) {
  const seen = new Uint8Array(T.adj.length), st = [to], out = []; seen[to] = 1; seen[from] = 1;
  while (st.length) { const a = st.pop(); if (T.tax[a] >= 0) out.push(T.tax[a]); for (const b of T.adj[a]) if (!seen[b]) { seen[b] = 1; st.push(b); } }
  return out;
}
function rootAt(T, r) {
  const V = T.adj.length, parent = new Int32Array(V).fill(-2), order = [r]; parent[r] = -1;
  for (let h = 0; h < order.length; h++) for (const w of T.adj[order[h]]) if (parent[w] === -2) { parent[w] = order[h]; order.push(w); }
  return { parent, order };
}
/* flat form for passing trees between threads: [tax, nb0, nb1, nb2] per node, -1 = none */
function encodeTree(T) { const V = T.adj.length, b = new Int32Array(4 * V).fill(-1); for (let v = 0; v < V; v++) { b[4 * v] = T.tax[v]; T.adj[v].forEach((w, j) => { b[4 * v + 1 + j] = w; }); } return b; }
function decodeTree(b) { const V = b.length >> 2, T = { adj: [], tax: [] }; for (let v = 0; v < V; v++) { T.tax.push(b[4 * v]); const a = []; for (let j = 1; j < 4; j++) if (b[4 * v + j] >= 0) a.push(b[4 * v + j]); T.adj.push(a); } return T; }

/* ---------- quartet cost: sum over internal nodes of phi(X,Y,Z), O(n^2) ---------- */
function treeCost(T, D, n) {
  const V = T.adj.length, R = new Float64Array(V * n), W = new Float64Array(V), tot = new Float64Array(V), cnt = new Int32Array(V), lv = new Array(V);
  const r = T.tax.indexOf(0), { parent, order } = rootAt(T, r); let c = 0;
  for (let i = order.length - 1; i > 0; i--) {
    const u = order[i], b0 = u * n;
    if (T.tax[u] >= 0) { const t = T.tax[u]; let s = 0; for (let j = 0; j < n; j++) { R[b0 + j] = D[t * n + j]; s += D[t * n + j]; } tot[u] = s; cnt[u] = 1; lv[u] = [t]; continue; }
    let a = -1, b = -1; for (const w of T.adj[u]) if (w !== parent[u]) { if (a < 0) a = w; else b = w; }
    let s12 = 0; for (const j of lv[b]) s12 += R[a * n + j];
    for (let j = 0; j < n; j++) R[b0 + j] = R[a * n + j] + R[b * n + j];
    W[u] = W[a] + W[b] + s12; tot[u] = tot[a] + tot[b]; cnt[u] = cnt[a] + cnt[b]; lv[u] = lv[a].concat(lv[b]);
    const kx = cnt[a], ky = cnt[b], kz = n - kx - ky;
    c += kx * (kx - 1) / 2 * (tot[b] - 2 * W[b] - s12) + ky * (ky - 1) / 2 * (tot[a] - 2 * W[a] - s12) + kz * (kz - 1) / 2 * s12;
  }
  return c;
}
function quartetBounds(D, n) {
  let Mx = 0, mn = 0;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    const s0 = D[a*n+b] + D[c*n+d], s1 = D[a*n+c] + D[b*n+d], s2 = D[a*n+d] + D[b*n+c];
    Mx += Math.max(s0, s1, s2); mn += Math.min(s0, s1, s2);
  }
  return { Mx, mn };
}

/* ---------- subset DP over items with weights (leaves, or whole subtrees) ----------
   X[i*k+j] = distance sum between items i and j; sz[i] = leaves in item i; total = all leaves.
   Rooted at item k-1. W[m] = distance sum inside item set m, s[m] = its leaf count. */
function dpTables(X, sz, k, W = new Float64Array(1 << k), s = new Int32Array(1 << k)) {
  for (let m = 1; m < 1 << k; m++) { const low = m & -m, i = 31 - Math.clz32(low), rest = m ^ low; let a = 0; for (let q = rest; q; q &= q - 1) a += X[i * k + (31 - Math.clz32(q & -q))]; W[m] = W[rest] + a; s[m] = s[rest] + sz[i]; }
  return { W, s };
}
/* best split of cluster Cc (needs best[] of all its proper subsets) */
function dpCell(Cc, W, s, best, arg, full, total) {
  const Z = full ^ Cc, kz = total - s[Cc], low = Cc & -Cc, rest = Cc ^ low, WZ = W[Z], WC = W[Cc], cz = kz * (kz - 1) / 2;
  let sub = rest, bv = Infinity, ba = 0;
  for (;;) {
    const C1 = low | sub, C2 = Cc ^ C1;
    if (C2) { const k1 = s[C1], k2 = s[C2], w1 = W[C1], w2 = W[C2];
      const v = best[C1] + best[C2] + k1 * (k1 - 1) / 2 * (W[C2 | Z] - w2 - WZ) + k2 * (k2 - 1) / 2 * (W[C1 | Z] - w1 - WZ) + cz * (WC - w1 - w2);
      if (v < bv) { bv = v; ba = C1; } }
    if (sub === 0) break; sub = (sub - 1) & rest;
  }
  best[Cc] = bv; arg[Cc] = ba;
}
function subsetDP(X, sz, k, total) {
  const { W, s } = dpTables(X, sz, k), full = (1 << k) - 1, Mh = 1 << (k - 1), best = new Float64Array(Mh), arg = new Int32Array(Mh);
  for (let Cc = 1; Cc < Mh; Cc++) if (Cc & (Cc - 1)) dpCell(Cc, W, s, best, arg, full, total);
  return { cost: best[Mh - 1], arg, Mh, W, s };
}
function exactFromArg(arg, n) {
  const T = { adj: [], tax: [] };
  const build = m => { if ((m & (m - 1)) === 0) return addNode(T, 31 - Math.clz32(m)); const u = addNode(T, -1); link(T, u, build(arg[m])); link(T, u, build(m ^ arg[m])); return u; };
  link(T, build((1 << (n - 1)) - 1), addNode(T, n - 1));
  return T;
}
function exactTree(D, n) { return exactFromArg(subsetDP(Float64Array.from(D), new Int32Array(n).fill(1), n, n).arg, n); }

/* ---------- subtree-DP move, split into propose (pure) and apply (mutates) ---------- */
function pickCores(T, size, count, rng) {   // up to `count` node-disjoint connected cores, each >= 2 nodes
  const inner = [], used = new Uint8Array(T.adj.length), out = []; T.tax.forEach((t, i) => { if (t < 0) inner.push(i); });
  for (let i = 0; i < count; i++) {
    const free = inner.filter(v => !used[v]); if (!free.length) break;
    const core = [free[Math.floor(rng() * free.length)]]; used[core[0]] = 1;
    while (core.length < size) { const fr = []; for (const c of core) for (const w of T.adj[c]) if (T.tax[w] < 0 && !used[w]) fr.push(w); if (!fr.length) break; const w = fr[Math.floor(rng() * fr.length)]; used[w] = 1; core.push(w); }
    if (core.length >= 2) out.push(core);
  }
  return out;
}
function coreBlocks(T, core) {   // subtrees hanging off the core; key = smallest object in the block
  const inCore = new Set(core), B = [];
  for (const c of core) for (const w of T.adj[c]) if (!inCore.has(w)) { const tax = sideTaxa(T, c, w); B.push({ c, a: w, tax, key: tax.reduce((m, x) => x < m ? x : m, Infinity) }); }
  return B;
}
/* Gain of the optimal re-arrangement of one core: current cost of its nodes minus the DP optimum.
   Returns the arrangement as block keys plus (mask, split) pairs, so it can be applied to a tree
   whose other parts have changed since (block leaf sets, hence keys, stay the same). */
function proposeMove(T, core, D, n) {
  const blocks = coreBlocks(T, core), K = blocks.length, sz = Int32Array.from(blocks, b => b.tax.length), X = new Float64Array(K * K);
  for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) { let s = 0; for (const a of blocks[i].tax) for (const b of blocks[j].tax) s += D[a * n + b]; X[i * K + j] = X[j * K + i] = s; }
  const r = subsetDP(X, sz, K, n), { W, s } = r, full = (1 << K) - 1, V = T.adj.length, inCore = new Set(core), bit = new Map();
  blocks.forEach((b, i) => bit.set(b.c * V + b.a, 1 << i));
  const phi = (A, B) => { const Z = full ^ A ^ B, ka = s[A], kb = s[B], kz = n - ka - kb; return ka * (ka - 1) / 2 * (W[B | Z] - W[B] - W[Z]) + kb * (kb - 1) / 2 * (W[A | Z] - W[A] - W[Z]) + kz * (kz - 1) / 2 * (W[A | B] - W[A] - W[B]); };
  let cur = 0;
  const mask = (c, from) => { let A = 0, B = 0; for (const w of T.adj[c]) if (w !== from) { const m = inCore.has(w) ? mask(w, c) : bit.get(c * V + w); if (A) B = m; else A = m; } cur += phi(A, B); return A | B; };
  mask(blocks[K - 1].c, blocks[K - 1].a);
  const split = [], walk = m => { if (m & (m - 1)) { const a = r.arg[m]; split.push(m, a); walk(a); walk(m ^ a); } };
  walk(r.Mh - 1);
  return { delta: cur - r.cost, keys: Int32Array.from(blocks, b => b.key), split: Int32Array.from(split), blocks };
}
function applyMove(T, core, mv, blocks = coreBlocks(T, core)) {
  const anchor = new Map(blocks.map(b => [b.key, b.a])), A = Array.from(mv.keys, x => anchor.get(x)), sp = new Map(), inCore = new Set(core), pool = core.slice();
  if (A.some(x => x === undefined) || blocks.length !== A.length) throw new Error('applyMove: blocks changed under the move');
  for (let i = 0; i < mv.split.length; i += 2) sp.set(mv.split[i], mv.split[i + 1]);
  for (const c of core) { for (const w of T.adj[c]) if (!inCore.has(w)) T.adj[w].splice(T.adj[w].indexOf(c), 1); T.adj[c] = []; }
  const build = m => { if ((m & (m - 1)) === 0) return A[31 - Math.clz32(m)]; const u = pool.pop(), a = sp.get(m); link(T, u, build(a)); link(T, u, build(m ^ a)); return u; };
  link(T, build((1 << (A.length - 1)) - 1), A[A.length - 1]);
  return T;
}
function subtreeMove(T, D, n, k, rng) {   // one move on a copy (kept for the module interface)
  const T2 = clone(T), [core] = pickCores(T2, k - 2, 1, rng); if (!core) return T2;
  const mv = proposeMove(T2, core, D, n); return applyMove(T2, core, mv, mv.blocks);
}
function climb(T, D, n, k, rng, ms, stall) {
  T = clone(T); let c = treeCost(T, D, n), idle = 0; const t0 = Date.now(), tol = 1e-12 * Math.abs(c);
  while (Date.now() - t0 < ms && idle < stall) {
    const [core] = pickCores(T, k - 2, 1, rng); if (!core) break;
    const mv = proposeMove(T, core, D, n);
    if (mv.delta > tol) { applyMove(T, core, mv, mv.blocks); c -= mv.delta; idle = 0; } else idle++;
  }
  return { T, c: treeCost(T, D, n) };
}

/* ---------- cluster fusion: exact optimum over trees built from a pool of clusters ---------- */
function fusion(trees, D, n) {
  const r = n - 1, Wd = Math.ceil(n / 32), key = m => Array.from(m).join('.'), X = new Map();
  const add = mem => { const m = new Uint32Array(Wd); for (const t of mem) m[t >> 5] |= 1 << (t & 31); const k = key(m); if (!X.has(k)) X.set(k, { m, mem: mem.slice().sort((a, b) => a - b) }); };
  for (let t = 0; t < n; t++) if (t !== r) add([t]);
  add([...Array(n).keys()].filter(t => t !== r));
  for (const T of trees) for (const [u, v] of edges(T)) { const s = sideTaxa(T, u, v); add(s.includes(r) ? sideTaxa(T, v, u) : s); }
  const cl = [...X.values()].sort((a, b) => a.mem.length - b.mem.length), rowTot = new Float64Array(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rowTot[i] += D[i * n + j];
  for (const c of cl) { c.R = new Float64Array(n); for (const a of c.mem) for (let j = 0; j < n; j++) c.R[j] += D[a * n + j]; let w = 0; for (const a of c.mem) w += c.R[a]; c.W = w / 2; c.tot = c.mem.reduce((s, a) => s + rowTot[a], 0); c.best = c.mem.length === 1 ? 0 : Infinity; }
  for (const c of cl) {
    const k = c.mem.length; if (k < 2) continue;
    for (const a of cl) {
      if (a.mem.length >= k) break; if (a.mem[0] !== c.mem[0]) continue;
      let sub = true; for (let w = 0; w < Wd; w++) if (a.m[w] & ~c.m[w]) { sub = false; break; } if (!sub) continue;
      const bm = new Uint32Array(Wd); for (let w = 0; w < Wd; w++) bm[w] = c.m[w] & ~a.m[w]; const b = X.get(key(bm));
      if (!b || a.best === Infinity || b.best === Infinity) continue;
      let sab = 0; for (const x of a.mem) sab += b.R[x];
      const ka = a.mem.length, kb = b.mem.length, kz = n - ka - kb;
      const v = a.best + b.best + ka * (ka - 1) / 2 * (b.tot - 2 * b.W - sab) + kb * (kb - 1) / 2 * (a.tot - 2 * a.W - sab) + kz * (kz - 1) / 2 * sab;
      if (v < c.best) { c.best = v; c.arg = [a, b]; }
    }
  }
  const top = cl[cl.length - 1], T = { adj: [], tax: [] };
  const build = c => { if (c.mem.length === 1) return addNode(T, c.mem[0]); const u = addNode(T, -1); link(T, u, build(c.arg[0])); link(T, u, build(c.arg[1])); return u; };
  const u = addNode(T, -1); link(T, u, build(top.arg[0])); link(T, u, build(top.arg[1])); link(T, u, addNode(T, r));
  return T;
}

/* ---------- certified bound from all 5-object subsets ----------
   C* >= m + (1/(n-4)) * sum over quintets of min over the 15 five-leaf trees of their summed quartet excess.
   Each quartet's excess is recomputed from D inside the quintet (10 distances), so no O(n^4) table. */
function quintetTrees() {   // 15 trees x 5 offsets: tree t, object i left out -> 3*i + topology of that quartet
  const TT = [];
  for (let x = 0; x < 5; x++) { const o = [0,1,2,3,4].filter(p => p !== x);
    for (const [[p, q], [r, s]] of [[[o[0],o[1]],[o[2],o[3]]], [[o[0],o[2]],[o[1],o[3]]], [[o[0],o[3]],[o[1],o[2]]]]) {
      for (let y = 0; y < 5; y++) { const rem = [0,1,2,3,4].filter(z => z !== y);
        const pairs = y === x ? [[p, q], [r, s]] : y === p ? [[q, x], [r, s]] : y === q ? [[p, x], [r, s]] : y === r ? [[s, x], [p, q]] : [[r, x], [p, q]];
        const mate = pairs.find(pr => pr.includes(rem[0])); TT.push(3 * y + rem.indexOf(mate[0] === rem[0] ? mate[1] : mate[0]) - 1); } } }
  return Int32Array.from(TT);
}
function quintetPrefix(D, n, TT, a, b, e) {   // sum over c < d < f (all > b) of the quintet minimum
  const ab = D[a * n + b]; let sum = 0;
  for (let c = b + 1; c < n; c++) { const ac = D[a * n + c], bc = D[b * n + c];
    for (let d = c + 1; d < n; d++) { const ad = D[a * n + d], bd = D[b * n + d], cd = D[c * n + d];
      for (let f = d + 1; f < n; f++) { const af = D[a * n + f], bf = D[b * n + f], cf = D[c * n + f], df = D[d * n + f];
        let s0, s1, s2, lo;
        s0 = bc + df; s1 = bd + cf; s2 = bf + cd; lo = Math.min(s0, s1, s2); e[0] = s0 - lo; e[1] = s1 - lo; e[2] = s2 - lo;      // without a
        s0 = ac + df; s1 = ad + cf; s2 = af + cd; lo = Math.min(s0, s1, s2); e[3] = s0 - lo; e[4] = s1 - lo; e[5] = s2 - lo;      // without b
        s0 = ab + df; s1 = ad + bf; s2 = af + bd; lo = Math.min(s0, s1, s2); e[6] = s0 - lo; e[7] = s1 - lo; e[8] = s2 - lo;      // without c
        s0 = ab + cf; s1 = ac + bf; s2 = af + bc; lo = Math.min(s0, s1, s2); e[9] = s0 - lo; e[10] = s1 - lo; e[11] = s2 - lo;    // without d
        s0 = ab + cd; s1 = ac + bd; s2 = ad + bc; lo = Math.min(s0, s1, s2); e[12] = s0 - lo; e[13] = s1 - lo; e[14] = s2 - lo;   // without f
        let best = Infinity;
        for (let t = 0; t < 75; t += 5) { const v = e[TT[t]] + e[TT[t + 1]] + e[TT[t + 2]] + e[TT[t + 3]] + e[TT[t + 4]]; if (v < best) best = v; }
        sum += best;
      } } }
  return sum;
}
function quintetBound(D, n, mn = quartetBounds(D, n).mn) {
  const TT = quintetTrees(), e = new Float64Array(15); let sum = 0;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) sum += quintetPrefix(D, n, TT, a, b, e);
  return mn + sum / (n - 4);
}

/* ---------- work run on worker threads (or inline when --threads 1) ---------- */
const OPS = {
  climb(cx, m) {   // one run: climb to a stall at each k of the ladder, all inside one time budget
    const rng = mulberry32(m.seed), t0 = Date.now(); let r = { T: m.tree ? decodeTree(m.tree) : randomTree(cx.n, rng) };
    for (const k of m.ks) r = climb(r.T, cx.D, cx.n, k, rng, Math.max(0, m.ms - (Date.now() - t0)), m.stall);
    return { tree: encodeTree(r.T), c: r.c };
  },
  move(cx, m) { const mv = proposeMove(decodeTree(m.tree), Array.from(m.core), cx.D, cx.n); return { delta: mv.delta, keys: mv.keys, split: mv.split }; },
  dpLayer(cx, m) {   // every cluster with p members whose rank among them is w mod P (Gosper's enumeration)
    const W = new Float64Array(m.W), s = new Int32Array(m.s), best = new Float64Array(m.best), arg = new Int32Array(m.arg), sync = new Int32Array(m.sync);
    Atomics.load(sync, 0);   // acquire: see the previous layer's writes from other threads
    const full = (1 << m.k) - 1, Mh = 1 << (m.k - 1);
    for (let C = (1 << m.p) - 1, i = 0; C < Mh; i++) { if (i % m.P === m.w) dpCell(C, W, s, best, arg, full, m.total); const lo = C & -C, r = C + lo; C = r | (((r ^ C) >>> 2) >>> (31 - Math.clz32(lo))); }
    Atomics.add(sync, 0, 1);   // release
    return 0;
  },
  quintet(cx, m) {   // pull (a, b) prefixes off a shared counter; one partial sum per prefix keeps the total order-independent
    const part = new Float64Array(m.part), ctr = new Int32Array(m.ctr), n = cx.n, TT = quintetTrees(), e = new Float64Array(15);
    for (let t; (t = Atomics.add(ctr, 0, 1)) < n * n; ) { const a = (t / n) | 0, b = t % n; if (b > a) part[t] = quintetPrefix(cx.D, n, TT, a, b, e); }
    Atomics.add(ctr, 1, 1);
    return 0;
  },
};

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
  run(op, msg) {
    if (!this.ws.length) { try { return Promise.resolve(OPS[op](this.cx, msg)); } catch (e) { return Promise.reject(e); } }
    return new Promise((resolve, reject) => { this.q.push({ op, msg, resolve, reject }); this.pump(); });
  }
  pump() { while (this.idle.length && this.q.length) { const w = this.idle.shift(), t = this.q.shift(), id = ++this.id; this.cb.set(id, t); w.postMessage({ id, op: t.op, msg: t.msg }); } }
  close() { return Promise.all(this.ws.map(w => w.terminate())); }
}
const shared = (Type, len) => new Type(new SharedArrayBuffer(Type.BYTES_PER_ELEMENT * len));

/* ---------- parallel drivers ---------- */
async function climbPar(T, D, n, k, rng, ms, stall, pool) {
  T = clone(T); let c = treeCost(T, D, n), idle = 0, rounds = 0, gains = 0; const t0 = Date.now(), tol = 1e-12 * Math.abs(c);
  while (Date.now() - t0 < ms && idle < stall) {
    const cores = pickCores(T, k - 2, pool.size, rng); if (!cores.length) break;
    const tree = encodeTree(T), res = await Promise.all(cores.map(core => pool.run('move', { tree, core: Int32Array.from(core) })));
    let hit = 0;
    res.forEach((mv, i) => { if (mv.delta > tol) { applyMove(T, cores[i], mv); c -= mv.delta; hit++; } });
    idle = hit ? 0 : idle + cores.length; rounds++; gains += hit;
  }
  return { T, c: treeCost(T, D, n), rounds, gains };
}
async function exactTreePar(D, n, pool) {
  const N = 1 << n, Mh = N >> 1, W = shared(Float64Array, N), s = shared(Int32Array, N), best = shared(Float64Array, Mh), arg = shared(Int32Array, Mh), sync = shared(Int32Array, 1);
  dpTables(D, new Int32Array(n).fill(1), n, W, s);
  const P = pool.size, msg = { W: W.buffer, s: s.buffer, best: best.buffer, arg: arg.buffer, sync: sync.buffer, k: n, total: n, P };
  for (let p = 2; p < n; p++) await Promise.all(Array.from({ length: P }, (_, w) => pool.run('dpLayer', { ...msg, p, w })));
  Atomics.load(sync, 0);
  return { T: exactFromArg(arg, n), cost: best[Mh - 1] };
}
async function quintetBoundPar(D, n, mn, pool) {
  const part = shared(Float64Array, n * n), ctr = shared(Int32Array, 2);
  await Promise.all(Array.from({ length: pool.size }, () => pool.run('quintet', { part: part.buffer, ctr: ctr.buffer })));
  Atomics.load(ctr, 1); let sum = 0; for (const x of part) sum += x;
  return mn + sum / (n - 4);
}

/* ---------- I/O ---------- */
function readMatrix(path) {
  const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (/^\d+$/.test(lines[0]) && lines.length > 1) lines.shift();
  const labels = [], rows = lines.map(l => { const t = l.split(/[\s,;]+/).filter(Boolean); labels.push(isFinite(Number(t[0])) ? null : t.shift()); return t.map(Number); });
  const n = rows.length;
  if (n < 5 || n > 2000 || rows.some(r => r.length !== n || r.some(x => !isFinite(x)))) throw new Error(`expected a square numeric matrix, got ${n} rows`);
  const D = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) D[i * n + j] = i === j ? 0 : (rows[i][j] + rows[j][i]) / 2;
  return { D, n, labels: labels.every(Boolean) ? labels : labels.map((_, i) => 'o' + i) };
}
function newick(T, labels) {
  const q = s => /[\s(),:;'\[\]]/.test(s) ? `'${s.replace(/'/g, "''")}'` : s;
  const start = T.tax.indexOf(-1);
  const rec = (u, p) => T.tax[u] >= 0 ? q(labels[T.tax[u]]) : '(' + T.adj[u].filter(w => w !== p).map(w => rec(w, u)).join(',') + ')';
  return rec(start, -1) + ';';
}

async function main() {
  const argv = process.argv.slice(2), opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i < 0 ? dflt : (argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[i + 1]); };
  if (!argv[0] || argv[0].startsWith('--')) { console.error('usage: node mqtc_scale.js matrix.txt [--k 16] [--k0 10] [--runs R] [--seconds 8] [--stall 400] [--seed 1] [--threads N] [--bound] [--exact]'); process.exit(1); }
  const m0 = readMatrix(argv[0]), n = m0.n, labels = m0.labels, D = shared(Float64Array, n * n); D.set(m0.D);
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const threads = Math.max(1, +opt('threads', cores) | 0), k = Math.min(+opt('k', 16), n), runs = +opt('runs', Math.max(8, threads)), secs = +opt('seconds', 8), seed = +opt('seed', 1);
  const stall = +opt('stall', 400), k0 = Math.min(+opt('k0', 10), k), ks = []; for (let j = k0; j < k; j += 2) ks.push(j); ks.push(k);
  const exact = opt('exact', false) || (k >= n && n <= 22);
  if (exact && n > 26) throw new Error('--exact is limited to n <= 26');
  const pool = new Pool(threads, D, n), t0 = Date.now(), el = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`, th = `${pool.size} thread${pool.size > 1 ? 's' : ''}`;
  try {
    const { Mx, mn } = quartetBounds(D, n), S = c => (Mx - c) / (Mx - mn);
    let T;
    if (exact) { T = (await exactTreePar(D, n, pool)).T; console.error(`exact DP: ${el()} on ${th}`); }
    else {
      const res = await Promise.all(Array.from({ length: runs }, (_, r) => pool.run('climb', { seed: runSeed(seed, r), ks, ms: secs * 1000, stall })));
      res.forEach((x, r) => console.error(`run ${r + 1}/${runs}: S = ${S(x.c).toFixed(7)}`));
      console.error(`runs done (k = ${ks.join(', ')}): ${el()} on ${th}`);
      const fused = fusion(res.map(x => decodeTree(x.tree)), D, n), pol = await climbPar(fused, D, n, k, mulberry32(seed), secs * 1000, stall, pool);
      console.error(`fusion: S = ${S(treeCost(fused, D, n)).toFixed(7)}, after more moves S = ${S(pol.c).toFixed(7)}  (${pol.rounds} rounds of up to ${pool.size} moves, ${pol.gains} improving; ${el()} total)`);
      T = pol.T;
    }
    const c = treeCost(T, D, n);
    console.log(`n = ${n}\ncost = ${c}\nS = ${S(c).toFixed(7)}`);
    if (opt('bound', false)) { const tb = Date.now(), lb = await quintetBoundPar(D, n, mn, pool); console.log(`certified: S* <= ${S(lb).toFixed(7)} (all 5-object subsets)`); console.error(`bound: ${((Date.now() - tb) / 1000).toFixed(1)} s on ${th}`); }
    console.log(newick(T, labels));
  } finally { await pool.close(); }
}

if (!isMainThread && workerData && workerData.mqtc) {
  const cx = { D: new Float64Array(workerData.D), n: workerData.n };
  parentPort.on('message', ({ id, op, msg }) => { let res, err; try { res = OPS[op](cx, msg); } catch (e) { err = e.stack || String(e); } parentPort.postMessage({ id, res, err }); });
} else if (require.main === module) main().catch(e => { console.error(e.stack || e); process.exit(1); });

module.exports = { treeCost, quartetBounds, subsetDP, exactTree, subtreeMove, climb, fusion, quintetBound, randomTree, newick, readMatrix,
  pickCores, proposeMove, applyMove, encodeTree, decodeTree, Pool, climbPar, exactTreePar, quintetBoundPar, mulberry32, runSeed };
