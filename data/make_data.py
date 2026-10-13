"""make_data.py: the benchmark matrices for the MQTC lab (deterministic, seed 2026).

  digits_N      sklearn digits (8x8, 16 grey levels), N drawn stratified by class; Euclidean on pixels.
  colors_N      N colours uniform in the sRGB cube; CIEDE2000 colour difference.
  treemetric_N  path lengths on a random binary tree (exp(1) branch lengths) with +-15% multiplicative
                noise; the true tree is stored, so recovery can be checked.
  euc_100       100 points uniform in [0,1]^5, Euclidean: a deliberately non-tree-like control.

  digits_1797   every sklearn digit (`make_data.py all`; separate seed, other files untouched).

Each writes NAME.txt (plain n x n matrix) and NAME.json (metadata for the demo / checks).
Usage: python3 make_data.py [sizes...]   (default 100 300 1000; all sets share one seeded stream,
       so a different size list gives different files)
       python3 make_data.py all
"""
import json, sys
import numpy as np

rng = np.random.default_rng(2026)
SIZES = [int(s) for s in sys.argv[1:] if s != "all"] or [100, 300, 1000]
ALL = "all" in sys.argv[1:]   # `make_data.py all`: only digits_1797 (every sklearn digit), own seed; leaves the others alone

def save(name, D, meta):
    D = (D + D.T) / 2
    np.fill_diagonal(D, 0)
    np.savetxt(f"{name}.txt", D, fmt="%.7g")
    with open(f"{name}.json", "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    print(name, D.shape)

def pdist_euclid(X):
    sq = (X * X).sum(1)
    return np.sqrt(np.maximum(sq[:, None] + sq[None, :] - 2 * X @ X.T, 0))

# ---- digits -----------------------------------------------------------------
from sklearn.datasets import load_digits
dg = load_digits()
if ALL:
    idx = np.random.default_rng(1797).permutation(len(dg.target))
    X = dg.data[idx].astype(float)
    pix = ["".join("%x" % min(15, int(v)) for v in row) for row in dg.data[idx]]
    save(f"digits_{len(idx)}", pdist_euclid(X), {"kind": "digits", "metric": "euclidean on 64 pixels (0..16)",
         "index": idx.tolist(), "label": dg.target[idx].tolist(), "pix": pix})
    sys.exit(0)
for N in SIZES:
    per = [rng.permutation(np.flatnonzero(dg.target == c)) for c in range(10)]
    idx = np.concatenate([p[: N // 10 + (1 if c < N % 10 else 0)] for c, p in enumerate(per)])
    idx = rng.permutation(idx)
    X = dg.data[idx].astype(float)
    pix = ["".join("%x" % min(15, int(v)) for v in row) for row in dg.data[idx]]
    save(f"digits_{N}", pdist_euclid(X), {"kind": "digits", "metric": "euclidean on 64 pixels (0..16)",
         "index": idx.tolist(), "label": dg.target[idx].tolist(), "pix": pix})

# ---- colours: sRGB -> CIELAB (D65) -> CIEDE2000 -------------------------------
def srgb_to_lab(rgb):
    c = rgb / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    e = (6 / 29) ** 3
    f = np.where(xyz > e, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)

def ciede2000(lab1, lab2):
    L1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    L2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    Cb7 = ((C1 + C2) / 2) ** 7
    G = 0.5 * (1 - np.sqrt(Cb7 / (Cb7 + 25.0 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dh = h2p - h1p
    zero = (C1p * C2p) == 0
    dhp = np.where(zero, 0, np.where(np.abs(dh) <= 180, dh, np.where(dh > 180, dh - 360, dh + 360)))
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dhp) / 2)
    Lbp, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    hs = h1p + h2p
    hbp = np.where(zero, hs, np.where(np.abs(h1p - h2p) <= 180, hs / 2, np.where(hs < 360, (hs + 360) / 2, (hs - 360) / 2)))
    T = 1 - 0.17 * np.cos(np.radians(hbp - 30)) + 0.24 * np.cos(np.radians(2 * hbp)) + 0.32 * np.cos(np.radians(3 * hbp + 6)) - 0.20 * np.cos(np.radians(4 * hbp - 63))
    dtheta = 30 * np.exp(-(((hbp - 275) / 25) ** 2))
    Cb7p = Cbp ** 7
    RC = 2 * np.sqrt(Cb7p / (Cb7p + 25.0 ** 7))
    SL = 1 + 0.015 * (Lbp - 50) ** 2 / np.sqrt(20 + (Lbp - 50) ** 2)
    SC, SH = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    RT = -np.sin(np.radians(2 * dtheta)) * RC
    return np.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH))

# two test pairs from Sharma, Wu & Dalal (2005), table 1
t1 = np.array([[50.0, 2.6772, -79.7751]]); t2 = np.array([[50.0, 0.0, -82.7485]])
t3 = np.array([[50.0, 2.5, 0.0]]); t4 = np.array([[73.0, 25.0, -18.0]])
assert abs(ciede2000(t1, t2)[0] - 2.0425) < 1e-4, ciede2000(t1, t2)
assert abs(ciede2000(t3, t4)[0] - 27.1492) < 1e-4, ciede2000(t3, t4)
for N in SIZES:
    rgb = rng.integers(0, 256, size=(N, 3))
    lab = srgb_to_lab(rgb.astype(float))
    D = ciede2000(lab[:, None, :], lab[None, :, :])
    save(f"colors_{N}", D, {"kind": "colors", "metric": "CIEDE2000 (sRGB, D65)", "hex": ["#%02x%02x%02x" % tuple(c) for c in rgb]})

# ---- noisy tree metrics --------------------------------------------------------
for N in SIZES:
    # random binary tree by random joins; leaves 0..N-1
    parent, length, nodes, nxt = {}, {}, list(range(N)), N
    while len(nodes) > 2:
        i, j = sorted(rng.choice(len(nodes), 2, replace=False))[::-1]
        u, v = nodes.pop(i), nodes.pop(j)
        for x in (u, v): parent[x] = nxt; length[x] = rng.exponential(1.0)
        nodes.append(nxt); nxt += 1
    u, v = nodes
    parent[u] = v; length[u] = rng.exponential(1.0)
    root = v
    depth, anc = {}, {}
    def chain(x):
        out = [x]
        while x in parent: x = parent[x]; out.append(x)
        return out
    ch = [chain(i) for i in range(N)]
    dist_to = [{} for _ in range(N)]
    for i in range(N):
        acc = 0.0
        for x in ch[i]:
            dist_to[i][x] = acc
            acc += length.get(x, 0.0)
    D = np.zeros((N, N))
    for i in range(N):
        for j in range(i + 1, N):
            for x in ch[j]:
                if x in dist_to[i]:
                    D[i, j] = D[j, i] = dist_to[i][x] + dist_to[j][x]
                    break
    noise = np.triu(rng.uniform(-0.15, 0.15, (N, N)), 1)
    D = D * (1 + noise + noise.T)
    edges = [[int(x), int(p)] for x, p in parent.items()]
    save(f"treemetric_{N}", D, {"kind": "treemetric", "metric": "tree path length x (1 +- 15%)", "true_edges": edges})

X = rng.random((100, 5))
save("euc_100", pdist_euclid(X), {"kind": "euclidean", "metric": "uniform [0,1]^5, euclidean"})
