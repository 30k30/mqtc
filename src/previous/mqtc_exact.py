"""
Exact Minimum Quartet Tree Cost (Cilibrasi-Vitanyi objective) for small n.

Key identity: for an unrooted binary tree T, the quartet cost
    C_T = sum over displayed quartets uv|wx of d(u,v) + d(w,x)
decomposes over internal nodes. If node p splits the leaves into parts X, Y, Z:
    phi(X,Y,Z) = C(|X|,2) S(Y,Z) + C(|Y|,2) S(X,Z) + C(|Z|,2) S(X,Y),
with S(A,B) = sum of d(a,b) over a in A, b in B. (Each displayed quartet uv|wx is
counted at exactly two nodes: the junction of u,v contributes d(u,v), the junction
of w,x contributes d(w,x).) Rooting at one leaf turns the search into a subset DP
over clusters: ~3^(n-1)/2 steps. Pure Python is fine to n~16; with numba (or the
C version) n=20 takes seconds, n=22 under a minute.

Tree fitness S(T) = (M - C_T) / (M - m), M/m = sums of max/min quartet costs.
"""
import itertools
import numpy as np

try:
    from numba import njit          # optional; the core below is written numba-style
except ImportError:                  # (not tested under numba in the sandbox this was written in)
    def njit(f=None, **kw):
        return f if f is not None else (lambda g: g)


@njit(cache=True)
def _dp(d, n):
    N = 1 << n
    full = N - 1
    M = 1 << (n - 1)                 # clusters are subsets of leaves 0..n-2; leaf n-1 is the root
    W = np.zeros(N)                  # W[mask] = within-set distance sum
    pc = np.zeros(N, np.int64)       # popcount
    for m in range(1, N):
        low = m & -m
        i = 0
        while (low >> i) != 1:
            i += 1
        rest = m ^ low
        s = 0.0
        q = rest
        while q:
            lb = q & -q
            j = 0
            while (lb >> j) != 1:
                j += 1
            s += d[i, j]
            q ^= lb
        W[m] = W[rest] + s
        pc[m] = pc[rest] + 1
    best = np.zeros(M)
    arg = np.zeros(M, np.int64)
    for C in range(1, M):
        k = pc[C]
        if k < 2:
            continue
        Z = full ^ C
        kz = n - k
        low = C & -C
        rest = C ^ low
        sub = rest
        bv = np.inf
        ba = 0
        while True:
            C1 = low | sub
            C2 = C ^ C1
            if C2:
                k1 = pc[C1]
                k2 = k - k1
                s12 = W[C1 | C2] - W[C1] - W[C2]
                s1z = W[C1 | Z] - W[C1] - W[Z]
                s2z = W[C2 | Z] - W[C2] - W[Z]
                v = (best[C1] + best[C2] + 0.5 * k1 * (k1 - 1) * s2z
                     + 0.5 * k2 * (k2 - 1) * s1z + 0.5 * kz * (kz - 1) * s12)
                if v < bv:
                    bv = v
                    ba = C1
            if sub == 0:
                break
            sub = (sub - 1) & rest
        best[C] = bv
        arg[C] = ba
    return best[M - 1], arg


def quartet_bounds(d):
    """M (sum of worst) and m (sum of best) quartet topology costs."""
    Mx = mn = 0.0
    for a, b, c, e in itertools.combinations(range(len(d)), 4):
        s = (d[a, b] + d[c, e], d[a, c] + d[b, e], d[a, e] + d[b, c])
        Mx += max(s); mn += min(s)
    return Mx, mn


def mqtc_exact(d, labels=None):
    """Globally optimal quartet tree. Returns (cost, S(T), newick)."""
    d = np.asarray(d, dtype=float)
    n = len(d)
    labels = labels or [str(i) for i in range(n)]
    cost, arg = _dp(d, n)

    def nwk(C):
        if C & (C - 1) == 0:
            return labels[C.bit_length() - 1]
        C1 = int(arg[C])
        return f"({nwk(C1)},{nwk(C ^ C1)})"

    top = (1 << (n - 1)) - 1
    C1 = int(arg[top])
    newick = f"({nwk(C1)},{nwk(top ^ C1)},{labels[n - 1]});"
    Mx, mn = quartet_bounds(d)
    return float(cost), float((Mx - cost) / (Mx - mn)), newick


def nni_delta(d, A, B, C, D):
    """Cost change of the NNI AB|CD -> AC|BD across an internal edge; O(1) given
    precomputed subtree-pair sums (here computed directly for clarity)."""
    S = lambda P, Q: d[np.ix_(P, Q)].sum()
    return (len(B) * len(D) * S(A, C) + len(A) * len(C) * S(B, D)
            - len(C) * len(D) * S(A, B) - len(A) * len(B) * S(C, D))


if __name__ == "__main__":
    rng = np.random.default_rng(0)
    X = rng.random((8, 5))
    d = np.sqrt(((X[:, None] - X[None]) ** 2).sum(-1))
    print(mqtc_exact(d, list("ABCDEFGH")))
