// 05_fusion.js — does recombining local optima beat the best of them?
// K local optima (qja, nj, qj, then random starts), each SPR + DP(k=12) + SPR; fuse; polish the fused tree.
// usage: node 05_fusion.js data/NAME K
const M = require('../src/mqtc.js'), path = process.argv[2], K = +(process.argv[3] || 8);
const { D, n } = M.readMatrix(path + '.txt'), B = M.readBounds(path + '.bounds.txt'), S = c => ((B.M - c) / (B.M - B.m)).toFixed(7);
const now = () => Date.now() / 1000, t0 = now(), rng = M.rng32(11);
console.log(`# ${path}  n = ${n}, ${K} local optima`);
const trees = [], starts = ['qja', 'nj', 'qj'];
for (let i = 0; i < K; i++) {
  const s = starts[i] || 'random', t1 = now();
  const T = s === 'nj' ? M.nj(D, n) : s === 'qj' ? M.quartetJoin(D, n, 'sum') : s === 'qja' ? M.quartetJoin(D, n, 'avg') : M.randomTree(n, rng);
  M.sprDescent(T, D, rng); M.dpPolish(T, D, rng, 12); M.sprDescent(T, D, rng);
  trees.push(T); console.log(`optimum ${String(i + 1).padStart(2)} (${s.padEnd(6)}) S = ${S(M.treeCost(T, D))}  ${(now() - t1).toFixed(1)} s`);
}
const best = Math.min(...trees.map(T => M.treeCost(T, D)));
const t2 = now(), F = M.fusion(trees, D, rng); M.checkTree(F.T);
const cF = M.treeCost(F.T, D);
console.log(`fusion: ${F.clusters} clusters, ${F.splits} candidate splits, S = ${S(cF)} (DP value ${S(F.cost)}), ${(now() - t2).toFixed(1)} s`);
const t3 = now(); M.sprDescent(F.T, D, rng); M.dpPolish(F.T, D, rng, 12); M.sprDescent(F.T, D, rng);
const cP = M.treeCost(F.T, D);
console.log(`fused + polish: S = ${S(cP)}  (${(now() - t3).toFixed(1)} s)`);
console.log(`best input S = ${S(best)};  gain from fusion+polish: ${((best - cP) / (B.M - B.m)).toExponential(2)} in S;  total ${(now() - t0).toFixed(1)} s`);
