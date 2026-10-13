#!/bin/sh
# 07_demo_trees.sh — the six trees shown in demo/index.html (n = 1000 reuses the 3-minute runs of experiment 06).
# Budgets: 20 s at n = 100, 60 s at n = 300; 2 threads (the sandbox had 2 cores).
cd "$(dirname "$0")/.." || exit 1
for kind in digits colors; do
  node src/mqtc.js data/${kind}_100.txt --seconds 20 --threads 2 --bounds data/${kind}_100.bounds.txt --json results/demo_${kind}_100.json --quiet
  node src/mqtc.js data/${kind}_300.txt --seconds 60 --threads 2 --bounds data/${kind}_300.bounds.txt --json results/demo_${kind}_300.json --quiet
  cp results/06_search_${kind}_1000.json results/demo_${kind}_1000.json
done
node demo/build.js
