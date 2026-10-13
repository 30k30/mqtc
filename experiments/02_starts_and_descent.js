// 02_starts_and_descent.js — start tree x local search, per dataset.
// For each start (random, NJ, quartet-join sum/avg): S after construction, after SPR descent, after DP(k=12)+SPR.
// usage: node 02_starts_and_descent.js data/NAME [starts...]
const M = require('../src/mqtc.js'), path = process.argv[2], starts = process.argv.slice(3);
const { D, n } = M.readMatrix(path + '.txt'), B = M.readBounds(path + '.bounds.txt'), S = c => ((B.M - c) / (B.M - B.m)).toFixed(6);
const t = () => process.hrtime.bigint(), sec = (a, b) => (Number(b - a) / 1e9).toFixed(2);
console.log(`# ${path}  n = ${n}`);
console.log('start    build_s  S_build    spr_s  moves passes  S_spr      dp_s  dpmoves  S_dp');
for (const start of starts.length ? starts : ['random', 'nj', 'qja', 'qj']) {
  const rng = M.rng32(7), t0 = t();
  const T = start === 'nj' ? M.nj(D, n) : start === 'qj' ? M.quartetJoin(D, n, 'sum') : start === 'qja' ? M.quartetJoin(D, n, 'avg') : M.randomTree(n, rng);
  const t1 = t(), c0 = M.treeCost(T, D), r = M.sprDescent(T, D, rng, { ms: 600000 }), t2 = t();
  const p = M.dpPolish(T, D, rng, 12, { ms: 300000 }), r2 = M.sprDescent(T, D, rng), t3 = t(), c3 = M.treeCost(T, D);
  console.log(`${start.padEnd(8)} ${sec(t0, t1).padStart(7)}  ${S(c0)}  ${sec(t1, t2).padStart(7)}  ${String(r.moves).padStart(5)} ${String(r.passes).padStart(6)}  ${S(r.cost)}  ${sec(t2, t3).padStart(7)}  ${String(p.moves + '+' + r2.moves).padStart(7)}  ${S(c3)}`);
}
