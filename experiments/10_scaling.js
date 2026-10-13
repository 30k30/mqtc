// 10_scaling.js — how the pieces scale with n (single thread): cost refresh, one full SPR sweep (every subtree,
// every edge, priced but not applied), NJ and quartet-join builds, and one complete local optimum from quartet-join.
// usage: node 10_scaling.js data/digits_300 data/digits_1000 data/digits_1797
const M = require('../src/mqtc.js');
const ms = f => { const t = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - t) / 1e6, r]; };
console.log('n      refresh_ms  sweep_ms  candidates   nj_s   qja_s  optimum_s  spr_moves');
for (const path of process.argv.slice(2)) {
  const { D, n } = M.readMatrix(path + '.txt'), rng = M.rng32(1);
  const T = M.quartetJoin(D, n, 'avg'); let st = M.stats(T, D);
  const [tRef] = ms(() => { for (let i = 0; i < 5; i++) st = M.stats(T, D, st); });
  let cand = 0; const [tSweep] = ms(() => { for (let a = n; a < T.V; a++) for (let j = 0; j < 3; j++) { const all = []; M.bestRegraft(T, st, a, T.nb[3 * a + j], all); cand += all.length; } });
  const [tNJ] = ms(() => M.nj(D, n)), [tQJ] = ms(() => M.quartetJoin(D, n, 'avg'));
  let moves = 0; const [tOpt] = ms(() => { const U = M.quartetJoin(D, n, 'avg'); moves = M.sprDescent(U, D, rng).moves; M.dpPolish(U, D, rng, 12); M.sprDescent(U, D, rng); });
  console.log(`${String(n).padEnd(6)} ${(tRef / 5).toFixed(1).padStart(10)}  ${tSweep.toFixed(0).padStart(8)}  ${String(cand).padStart(10)}  ${(tNJ / 1e3).toFixed(2).padStart(5)}  ${(tQJ / 1e3).toFixed(2).padStart(6)}  ${(tOpt / 1e3).toFixed(1).padStart(9)}  ${String(moves).padStart(9)}`);
}
