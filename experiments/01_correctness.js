// 01_correctness.js — every fast formula in src/mqtc.js against brute force.
const M = require('../src/mqtc.js');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } };
const rng = M.rng32(2026);
const randD = (n, kind) => { const D = new Float64Array(n * n);
  if (kind === 'euc') { const X = Array.from({ length: n }, () => [rng(), rng(), rng()]); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) D[i * n + j] = Math.hypot(X[i][0] - X[j][0], X[i][1] - X[j][1], X[i][2] - X[j][2]); }
  else for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) D[i * n + j] = D[j * n + i] = rng();
  return D; };
// unit-length tree distances between leaves, by BFS
const leafDist = T => { const { n, V, nb } = T, out = []; for (let s = 0; s < n; s++) { const d = new Int32Array(V).fill(-1), q = [s]; d[s] = 0; for (let h = 0; h < q.length; h++) for (let j = 0; j < 3; j++) { const w = nb[3 * q[h] + j]; if (w >= 0 && d[w] < 0) { d[w] = d[q[h]] + 1; q.push(w); } } out.push(d); } return out; };
const bruteCost = (T, D) => { const n = T.n, L = leafDist(T); let c = 0;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let e = b + 1; e < n; e++) for (let f = e + 1; f < n; f++) {
    const t0 = L[a][b] + L[e][f], t1 = L[a][e] + L[b][f], t2 = L[a][f] + L[b][e];   // displayed split has the strictly smallest path sum
    c += t0 < t1 && t0 < t2 ? D[a * n + b] + D[e * n + f] : t1 < t2 ? D[a * n + e] + D[b * n + f] : D[a * n + f] + D[b * n + e]; }
  return c; };

// 1. node-form cost (stats) == brute-force quartet enumeration == pair form
{ let worst = 0, worstPair = 0;
  for (let t = 0; t < 40; t++) { const n = 5 + (t % 14), D = randD(n, t % 2 ? 'euc' : 'rand'), T = M.randomTree(n, rng), c = M.treeCost(T, D), b = bruteCost(T, D);
    worst = Math.max(worst, Math.abs(c - b) / b);
    // pair form: N(u,v) = sum over internal path nodes p of C(g_p, 2)
    const { nb } = T; let pc = 0;
    for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) {
      const par = new Int32Array(T.V).fill(-2), q = [u]; par[u] = -1; for (let h = 0; h < q.length; h++) for (let j = 0; j < 3; j++) { const w = nb[3 * q[h] + j]; if (w >= 0 && par[w] === -2) { par[w] = q[h]; q.push(w); } }
      const path = new Set(); for (let x = v; x >= 0; x = par[x]) path.add(x);
      let N = 0;
      for (const p of path) { if (p < n) continue; for (let j = 0; j < 3; j++) { const w = nb[3 * p + j]; if (path.has(w)) continue;
        let g = 0; const st = [w], seen = new Set([p, w]); while (st.length) { const x = st.pop(); if (x < n) g++; for (let i = 0; i < 3; i++) { const y = nb[3 * x + i]; if (y >= 0 && !seen.has(y)) { seen.add(y); st.push(y); } } }
        N += g * (g - 1) / 2; } }
      pc += D[u * n + v] * N; }
    worstPair = Math.max(worstPair, Math.abs(pc - b) / b); }
  console.log(`cost: node form vs brute force max rel err ${worst.toExponential(1)}; pair form vs brute force ${worstPair.toExponential(1)}`);
  ok(worst < 1e-12 && worstPair < 1e-12, 'cost forms'); }

// 2. every SPR delta from bestRegraft == recomputed cost difference
{ let worst = 0, cnt = 0, edgesOk = true;
  for (let t = 0; t < 12; t++) { const n = 8 + t, D = randD(n, t % 2 ? 'euc' : 'rand'), T = M.randomTree(n, rng), st = M.stats(T, D), c0 = st.cost;
    for (let a = n; a < T.V; a++) for (let j = 0; j < 3; j++) { const b = T.nb[3 * a + j], all = []; M.bestRegraft(T, st, a, b, all);
      // P's side has |P| leaves -> 2|P|-1 edges incl. a–b; T' has 2(n-|P|)-3 edges, minus the original one
      const sP = st.parent[b] === a ? st.size[b] : n - st.size[a]; if (all.length !== Math.max(0, 2 * (n - sP) - 4)) edgesOk = false;
      for (const [w, x, d] of all) { const C = M.cloneTree(T); M.applySPR(C, a, b, w, x); M.checkTree(C); worst = Math.max(worst, Math.abs(M.treeCost(C, D) - c0 - d) / c0); cnt++; } } }
  console.log(`SPR: ${cnt} regrafts checked, max |delta - recomputed|/C = ${worst.toExponential(1)}, candidate count = 2(n-|P|)-4 everywhere: ${edgesOk}`);
  ok(worst < 1e-12 && edgesOk, 'SPR deltas'); }

// 3. DP move: reported gain == recomputed decrease, and the move never makes things worse
{ let worst = 0, moves = 0;
  for (let t = 0; t < 60; t++) { const n = 12 + (t % 30), D = randD(n, 'euc'), T = M.randomTree(n, rng), st = M.stats(T, D), c0 = st.cost, core = M.pickCore(T, 2 + (t % 9), rng);
    const g = M.dpMove(T, D, st, core, 0); M.checkTree(T); const c1 = M.treeCost(T, D); if (g > 0) moves++;
    worst = Math.max(worst, Math.abs((c0 - c1) - (g > 0 ? g : 0)) / c0); ok(c1 <= c0 * (1 + 1e-12), 'dp worsened'); }
  console.log(`DP move: max |gain - recomputed|/C = ${worst.toExponential(1)} (${moves}/60 improved)`); ok(worst < 1e-12, 'DP gain'); }

// 4. additive (tree) metrics: S = 1 is attainable, and NJ / quartet-join should reach it
{ const res = { nj: 0, qj: 0, qja: 0 };
  for (let t = 0; t < 20; t++) { const n = 10 + 3 * t, G = M.randomTree(n, rng), len = new Float64Array(3 * G.V).map(() => 0.05 + rng());
    const D = new Float64Array(n * n); for (let s = 0; s < n; s++) { const d = new Float64Array(G.V).fill(-1), q = [s]; d[s] = 0; for (let h = 0; h < q.length; h++) for (let j = 0; j < 3; j++) { const w = G.nb[3 * q[h] + j]; if (w >= 0 && d[w] < 0) { d[w] = d[q[h]] + len[Math.min(q[h], w) * 3 + (Math.max(q[h], w) % 3)]; q.push(w); } } for (let v = 0; v < n; v++) D[s * n + v] = d[v]; }
    const truth = M.treeCost(G, D);
    for (const [name, T] of [['nj', M.nj(D, n)], ['qj', M.quartetJoin(D, n, 'sum')], ['qja', M.quartetJoin(D, n, 'avg')]]) { M.checkTree(T); if (Math.abs(M.treeCost(T, D) - truth) <= 1e-9 * truth) res[name]++; } }
  console.log(`additive metrics (20 trees, n = 10..67): exact recovery  NJ ${res.nj}/20  QJ-sum ${res.qj}/20  QJ-avg ${res.qja}/20`);
  ok(res.nj === 20, 'NJ on additive'); }

// 5. exact optimum (subset DP, n <= 16) vs NJ + SPR descent and vs NJ + SPR + DP polish
{ let hitSPR = 0, hitDP = 0, gapSPR = 0, N = 0;
  for (let t = 0; t < 30; t++) { const n = 10 + (t % 7), D = randD(n, t % 3 ? 'euc' : 'rand'), opt = M.subsetDP(D, new Int32Array(n).fill(1), n, n).cost;
    const T = M.nj(D, n); M.sprDescent(T, D, rng); const c1 = M.treeCost(T, D); M.dpPolish(T, D, rng, Math.min(10, n)); M.sprDescent(T, D, rng); const c2 = M.treeCost(T, D);
    ok(c2 >= opt * (1 - 1e-12), 'below exact optimum?!'); N++;
    if (c1 <= opt * (1 + 1e-12)) hitSPR++; if (c2 <= opt * (1 + 1e-12)) hitDP++; gapSPR = Math.max(gapSPR, (c1 - opt) / opt); }
  console.log(`exact optimum, ${N} instances n = 10..16: NJ+SPR hits ${hitSPR}, +DP(k=10) hits ${hitDP}; worst NJ+SPR cost gap ${(100 * gapSPR).toFixed(3)}%`); }
console.log(fails ? `${fails} FAILURES` : 'all checks passed');
