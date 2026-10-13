// build.js — pack solver results into demo/index.html (one self-contained page; d3 from cdnjs).
// usage: node demo/build.js        (expects results/demo_<kind>_<n>.json from experiments/07_demo_trees.sh)
const fs = require('fs'), path = require('path'), M = require('../src/mqtc.js');
const root = path.join(__dirname, '..'), out = [];
const C4 = n => (BigInt(n) * BigInt(n - 1) * BigInt(n - 2) * BigInt(n - 3) / 24n).toLocaleString('en-US');
for (const kind of ['digits', 'colors']) for (const n of [100, 300, 1000]) {
  const resFile = path.join(root, `results/demo_${kind}_${n}.json`); if (!fs.existsSync(resFile)) { console.error('missing', resFile); continue; }
  const res = JSON.parse(fs.readFileSync(resFile, 'utf8')), meta = JSON.parse(fs.readFileSync(path.join(root, `data/${kind}_${n}.json`), 'utf8'));
  const { D } = M.readMatrix(path.join(root, `data/${kind}_${n}.txt`)), B = M.readBounds(path.join(root, `data/${kind}_${n}.bounds.txt`)), S = c => (B.M - c) / (B.M - B.m);
  const Snj = S(M.treeCost(M.nj(D, n), D));
  const rec = { kind, n, S: res.S, Snj, seconds: res.seconds, threads: res.threads, optima: res.optima, quartets: C4(n), metric: kind === 'digits' ? 'Euclidean, pixels' : 'CIEDE2000',
    edges: res.edges.flatMap(([u, v, l]) => [u, v, +l.toPrecision(4)]), newick: res.newick };
  if (kind === 'digits') {
    rec.pix = meta.pix; rec.label = meta.label; rec.index = meta.index;
    // nearest leaf in the tree (fewest edges; ties shared) vs nearest object by pixel distance
    const V = 2 * n - 2, adj = Array.from({ length: V }, () => []); for (const [u, v] of res.edges) { adj[u].push(v); adj[v].push(u); }
    let tree = 0, metric = 0; const dist = new Int32Array(V);
    for (let s = 0; s < n; s++) {
      dist.fill(-1); dist[s] = 0; const q = [s]; let best = Infinity, same = 0, tot = 0;
      for (let h = 0; h < q.length; h++) { const v = q[h]; if (dist[v] > best) break; if (v < n && v !== s) { best = dist[v]; tot++; if (meta.label[v] === meta.label[s]) same++; } for (const w of adj[v]) if (dist[w] < 0) { dist[w] = dist[v] + 1; q.push(w); } }
      tree += same / tot;
      let bj = -1, bd = Infinity; for (let j = 0; j < n; j++) if (j !== s && D[s * n + j] < bd) { bd = D[s * n + j]; bj = j; } if (meta.label[bj] === meta.label[s]) metric++;
    }
    rec.nnTree = tree / n; rec.nnMetric = metric / n;
  } else rec.hex = meta.hex;
  out.push(rec);
  console.log(`${kind}_${n}: S = ${rec.S.toFixed(5)}  NJ ${Snj.toFixed(5)}` + (rec.nnTree !== undefined ? `  nearest-leaf agreement ${(100 * rec.nnTree).toFixed(1)}% (pixels ${(100 * rec.nnMetric).toFixed(1)}%)` : ''));
}
const html = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8').replace('/*__DATA__*/null', JSON.stringify(out));
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`demo/index.html: ${(html.length / 1024).toFixed(0)} KB`);
