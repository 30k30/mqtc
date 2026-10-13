/* Exact minimum quartet tree cost + S(T*) by subset DP (root at leaf n-1).
   Usage: ./mqtc_exact n matrix.txt   (whitespace-separated n x n distance matrix)
   Build: gcc -O3 -march=native -o mqtc_exact mqtc_exact.c -lm
   Timing seen: n=20 ~2.5 s, n=22 ~35 s. Tree reconstruction: see mqtc_exact.py. */
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include <time.h>
#define C2(k) ((k) * ((k) - 1) * 0.5)
#define S2(A, B) (W[(A) | (B)] - W[A] - W[B])

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: %s n matrix.txt\n", argv[0]); return 1; }
    int n = atoi(argv[1]);
    if (n < 4 || n > 30) { fprintf(stderr, "n must be in 4..30\n"); return 1; }
    FILE *f = fopen(argv[2], "r");
    if (!f) { perror("matrix"); return 1; }
    static double d[32][32];
    for (int i = 0; i < n; i++) for (int j = 0; j < n; j++)
        if (fscanf(f, "%lf", &d[i][j]) != 1) { fprintf(stderr, "bad matrix\n"); return 1; }
    fclose(f);
    clock_t t0 = clock();
    unsigned N = 1u << n, full = N - 1, M = 1u << (n - 1);
    double *W = malloc(sizeof(double) * N), *best = malloc(sizeof(double) * M);
    if (!W || !best) { fprintf(stderr, "out of memory\n"); return 1; }
    W[0] = 0;
    for (unsigned m = 1; m < N; m++) {
        unsigned low = m & -m, r = m ^ low; int i = __builtin_ctz(m); double s = 0;
        for (unsigned q = r; q; q &= q - 1) s += d[i][__builtin_ctz(q)];
        W[m] = W[r] + s;
    }
    for (unsigned C = 1; C < M; C++) {
        int k = __builtin_popcount(C);
        if (k < 2) { best[C] = 0; continue; }
        unsigned Z = full ^ C, low = C & -C, rest = C ^ low, sub = rest;
        int kz = n - k; double bv = INFINITY;
        for (;;) {
            unsigned C1 = low | sub, Cb = C ^ C1;
            if (Cb) {
                int k1 = __builtin_popcount(C1), k2 = k - k1;
                double v = best[C1] + best[Cb] + C2(k1) * S2(Cb, Z) + C2(k2) * S2(C1, Z) + C2(kz) * S2(C1, Cb);
                if (v < bv) bv = v;
            }
            if (!sub) break;
            sub = (sub - 1) & rest;
        }
        best[C] = bv;
    }
    double secs = (double)(clock() - t0) / CLOCKS_PER_SEC, Mx = 0, mn = 0;
    for (int a = 0; a < n; a++) for (int b = a + 1; b < n; b++)
    for (int c = b + 1; c < n; c++) for (int e = c + 1; e < n; e++) {
        double s1 = d[a][b] + d[c][e], s2 = d[a][c] + d[b][e], s3 = d[a][e] + d[b][c];
        Mx += fmax(s1, fmax(s2, s3)); mn += fmin(s1, fmin(s2, s3));
    }
    printf("n=%d  optimal cost=%.6f  S(T*)=%.6f  (%.2fs)\n", n, best[M - 1], (Mx - best[M - 1]) / (Mx - mn), secs);
    free(W); free(best);
    return 0;
}
