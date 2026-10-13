// 04_ils.js — iterated local search with small kicks (n/50 random SPRs), quartet-join start, fixed time budget.
// The run logged in results/04_ils_*_1000.log was made with this procedure (then the CLI default) for 180 s:
//   node experiments/04_ils.js data/digits_1000 180
// Finding: improvements of ~1e-7 in S per accepted kick; it ends below a single random-start descent. Dead end.
const M = require('../src/mqtc.js'), path = process.argv[2], secs = +(process.argv[3] || 60);
const { D, n } = M.readMatrix(path + '.txt'), B = M.readBounds(path + '.bounds.txt');
const res = M.solveILS(D, n, { start: 'qja', seconds: secs, k: 12, seed: 1, log: s => console.error(s.replace(/cost ([-\d.e+]+)/, (_, c) => `S ${((B.M - c) / (B.M - B.m)).toFixed(7)}`)) });
console.log(`S = ${((B.M - res.cost) / (B.M - B.m)).toFixed(7)} after ${res.kicks} kicks (${res.wins} improved)`);
