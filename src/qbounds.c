/* qbounds.c: the two constants of S(T) = (M - C_T)/(M - m), exactly.
     M = sum over all quartets of the worst topology cost, m = of the best.
   O(n^4)/threads; the inner loop over the fourth object is three row loads, vectorised.
   Build: gcc -O3 -march=native -fopenmp -o qbounds qbounds.c
   Usage: ./qbounds matrix.txt > bounds.txt     (plain n x n numeric matrix)  */
#include <stdio.h>
#include <stdlib.h>
#include <omp.h>

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s matrix.txt\n", argv[0]); return 1; }
    FILE *f = fopen(argv[1], "r"); if (!f) { perror("matrix"); return 1; }
    size_t cap = 1 << 20, cnt = 0; double *v = malloc(cap * sizeof(double)), x;
    while (fscanf(f, "%lf", &x) == 1) { if (cnt == cap) v = realloc(v, (cap *= 2) * sizeof(double)); v[cnt++] = x; }
    fclose(f);
    int n = 0; while ((size_t)(n + 1) * (n + 1) <= cnt) n++;
    if ((size_t)n * n != cnt || n < 4) { fprintf(stderr, "not a square matrix (%zu numbers)\n", cnt); return 1; }
    double *D = v; for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) { double a = (D[i*n+j] + D[j*n+i]) / 2; D[i*n+j] = D[j*n+i] = a; }
    /* one partial sum per first object, added in order afterwards: the result does not depend on scheduling */
    double t0 = omp_get_wtime(), Mx = 0, mn = 0, *pM = calloc(n, sizeof(double)), *pm = calloc(n, sizeof(double));
    #pragma omp parallel for schedule(dynamic, 1)
    for (int a = 0; a < n; a++) {
        const double *Da = D + (size_t)a * n;
        double Mx = 0, mn = 0;
        for (int b = a + 1; b < n; b++) {
            const double *Db = D + (size_t)b * n, dab = Da[b];
            for (int c = b + 1; c < n; c++) {
                const double *Dc = D + (size_t)c * n, dac = Da[c], dbc = Db[c];
                double sx = 0, sn = 0;
                #pragma omp simd reduction(+:sx, sn)
                for (int d = c + 1; d < n; d++) {
                    double s0 = dab + Dc[d], s1 = dac + Db[d], s2 = dbc + Da[d];
                    double hi = s0 > s1 ? s0 : s1, lo = s0 < s1 ? s0 : s1;
                    sx += hi > s2 ? hi : s2; sn += lo < s2 ? lo : s2;
                }
                Mx += sx; mn += sn;
            }
        }
        pM[a] = Mx; pm[a] = mn;
    }
    for (int a = 0; a < n; a++) { Mx += pM[a]; mn += pm[a]; }
    printf("n = %d\nM = %.17g\nm = %.17g\n", n, Mx, mn);
    fprintf(stderr, "qbounds: n = %d, %.1f s on %d threads\n", n, omp_get_wtime() - t0, omp_get_max_threads());
    return 0;
}
