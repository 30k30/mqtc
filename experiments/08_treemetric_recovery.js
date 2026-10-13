// 08_treemetric_recovery.js — noisy tree metrics: how does the MQTC tree relate to the true tree?
// Reports S of the true tree, S of NJ and of the searched tree, and Robinson–Foulds distances (non-trivial splits).
const M = require('../src/mqtc.js'), fs = require('fs');
const splits = (edges, n) => {   // set of non-trivial splits, each as the sorted side not containing leaf 0
  const adj = new Map(); for (const [u, v] of edges) { (adj.get(u) || adj.set(u, []).get(u)).push(v); (adj.get(v) || adj.set(v, []).get(v)).push(u); }
  const out = new Set();
  for (const [u, v] of edges) {
    const side = [], seen = new Set([u, v]), st = [v]; while (st.length) { const x = st.pop(); if (x < n) side.push(x); for (const y of adj.get(x)) if (!seen.has(y)) { seen.add(y); st.push(y); } }
    if (side.length < 2 || side.length > n - 2) continue;
    const s = side.includes(0) ? [...Array(n).keys()].filter(x => !side.includes(x)) : side; out.add(s.sort((a, b) => a - b).join(','));
  }
  return out;
};
const treeEdges = T => { const e = []; for (let v = 0; v < T.V; v++) for (let j = 0; j < 3; j++) { const w = T.nb[3 * v + j]; if (w > v) e.push([v, w]); } return e; };
const rf = (A, B) => { let x = 0; for (const s of A) if (!B.has(s)) x++; return x; };
for (const n of [100, 300, 1000]) {
  const name = `data/treemetric_${n}`, { D } = M.readMatrix(name + '.txt'), B = M.readBounds(name + '.bounds.txt'), S = c => ((B.M - c) / (B.M - B.m)).toFixed(6);
  const meta = JSON.parse(fs.readFileSync(name + '.json', 'utf8'));
  // true tree: relabel its internal nodes to n.., then measure with the solver's cost
  const ids = new Map(); let next = n; const map = x => x < n ? x : (ids.has(x) ? ids.get(x) : (ids.set(x, next++), next - 1));
  const Tt = M.newTree(n); for (const [x, p] of meta.true_edges) { const a = map(x), b = map(p); const nb = Tt.nb; let i = 3 * a; while (nb[i] >= 0) i++; nb[i] = b; i = 3 * b; while (nb[i] >= 0) i++; nb[i] = a; }
  M.checkTree(Tt);
  const rng = M.rng32(3), Tn = M.nj(D, n), Ts = M.nj(D, n); M.sprDescent(Ts, D, rng); M.dpPolish(Ts, D, rng, 12); M.sprDescent(Ts, D, rng);
  const st = splits(meta.true_edges, n), sn = splits(treeEdges(Tn), n), ss = splits(treeEdges(Ts), n);
  console.log(`n = ${n}: S(true tree) = ${S(M.treeCost(Tt, D))}  S(NJ) = ${S(M.treeCost(Tn, D))}  S(NJ+SPR+DP) = ${S(M.treeCost(Ts, D))}  | RF to truth (of ${st.size} splits): NJ ${rf(st, sn)}, MQTC ${rf(st, ss)}`);
}
