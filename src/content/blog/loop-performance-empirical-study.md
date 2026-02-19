---
title: "Loop Performance Anti-Patterns: A 40-Repository Scan and Six-Module Benchmark Study"
pubDate: "2026-02-20"
heroImage: "../../assets/loop-performance-empirical-study.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "We scanned 40 open-source repositories (20 JavaScript, 20 Python) for loop anti-patterns and benchmarked six common inefficiencies across five input sizes with 30 trials each. The surprise: V8's JIT optimizer neutralizes most textbook anti-patterns — regex hoisting and array method fusion showed negligible speedup. But replacing O(n²) nested loops with Map lookups delivered 64× improvement, and hoisting JSON.parse out of loops yielded 46×. This article presents the full data, scaling analysis, and an honest assessment of which loop optimizations actually matter."
excerpt: "Everyone knows you should hoist regex out of loops and avoid nested forEach. We benchmarked six anti-patterns, scanned 40 repos (59,728 files), and found that V8 makes most of them irrelevant — except the ones that change algorithmic complexity."
lastmod: "2026-02-20"
canonical_url: "https://stackinsight.dev/blog/loop-performance-empirical-study"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - javascript loop performance optimization
  - nested loop O(n²) Map lookup optimization
  - regex in loop V8 JIT caching
  - JSON.parse inside loop anti-pattern
  - sequential await Promise.all parallel
  - array filter map reduce single pass
  - nested forEach performance benchmark
  - loop anti-pattern static analysis AST
  - python loop anti-pattern detection
  - V8 JIT optimizer loop performance
  - power-law scaling analysis loops
  - javascript performance benchmark Node.js
  - loop optimization empirical study
  - real-world loop inefficiency prevalence
  - data structure substitution performance
  - babel AST traverse loop detector
  - python ast loop detector
  - Cohen's d effect size benchmark
  - loop hoisting constant extraction
  - chained array methods intermediate allocation

# AIEO (AI Engine Optimization)
ai_summary: "This empirical study combines controlled benchmarks of six loop anti-patterns with AST-based static analysis of 40 open-source repositories (20 JavaScript, 20 Python — 59,728 files total). The key finding contradicts conventional wisdom: V8's JIT optimizer neutralizes most textbook anti-patterns. Regex hoisting (BM-01) showed only 1.03× speedup at n=100,000 because V8 caches compiled regex internally. Nested array method flattening (BM-05) and chained method fusion (BM-06) showed identical scaling exponents (b≈1.09 and b≈0.52 respectively) between baseline and optimized variants. However, two patterns showed massive improvements: replacing O(n²) nested loops with Map-based O(n) lookups (BM-04) delivered 64× speedup at n=10,000 with scaling exponent dropping from 1.47 to 0.65; hoisting JSON.parse outside loops (BM-02) delivered 46× speedup at n=100,000 with scaling exponent dropping from 0.79 to 0.45. Static analysis found 7,105 anti-pattern instances across 59,728 files. Sequential await was the most prevalent JS pattern (895 instances, 40%) and nested loops dominated Python (3,224 instances, 66%). The study concludes that loop optimization effort should focus on algorithmic complexity changes (data structure substitution) and redundant computation elimination, not on micro-optimizations that modern JIT compilers already handle."
ai_key_facts:
  - "V8's JIT optimizer neutralizes most textbook loop anti-patterns — regex hoisting showed only 1.03× speedup"
  - "Replacing O(n²) nested loops with Map lookups delivered 64× speedup at n=10,000"
  - "Hoisting JSON.parse outside loops delivered 46× speedup at n=100,000"
  - "Nested array method flattening (BM-05) showed identical scaling: b=1.096 for baseline, b=1.032 for optimized"
  - "Chained array method fusion (BM-06) showed near-identical scaling: b=0.521 vs b=0.493"
  - "7,105 loop anti-pattern instances found across 59,728 files in 40 repositories"
  - "Sequential await was the most prevalent JS pattern: 895 instances (40.0%)"
  - "Nested loops were the most prevalent Python pattern: 3,224 instances (66.2%)"
  - "Build tooling repos had the highest anti-pattern density: 1,074 instances (48.0% of JS findings)"
  - "Power-law scaling analysis showed BM-04 baseline at b=1.47 (superlinear) vs optimized at b=0.65 (sublinear)"
  - "All R² values exceeded 0.87, confirming power-law model fits"
  - "30 trials per configuration with 50 warmup iterations and forced GC between trials"
ai_entities:
  - "V8 JIT"
  - "Node.js"
  - "TypeScript"
  - "Python"
  - "Babel Parser"
  - "AST Analysis"
  - "Map"
  - "JSON.parse"
  - "Promise.all"
  - "RegExp"
  - "forEach"
  - "filter"
  - "map"
  - "reduce"
  - "DocumentFragment"
  - "Cohen's d"
  - "Power-Law Regression"
  - "Apache Airflow"
  - "webpack"
  - "lodash"
  - "Express"

# Structured Data (Article Schema)
schema_type: "TechArticle"
schema_proficiency_level: "Advanced"
schema_dependencies: "Node.js v24+, TypeScript 5+, Python 3.12+, @babel/parser, @babel/traverse"
schema_time_required: "PT25M"

# Taxonomy
categories:
  - "Software Performance"
  - "Software Engineering Research"
  - "Web Development"
tags:
  - javascript
  - python
  - loops
  - performance
  - optimization
  - anti-patterns
  - benchmarking
  - static-analysis
  - empirical-study
  - v8-jit
  - typescript
  - ast-analysis
  - scaling-analysis
  - cohens-d
  - power-law
  - data-structures

# Related
related_posts:
  - "memory-leak-empirical-study"
  - "blocking-io-empirical-study"
series: "Software Performance Empirical Studies"
series_order: 4
---

# Loop Performance Anti-Patterns: A 40-Repository Scan and Six-Module Benchmark Study

You've seen the advice a hundred times. "Hoist your regex out of the loop." "Don't call `JSON.parse` inside a `for` loop." "Replace nested `forEach` with a flat loop." "Use `reduce` instead of `filter().map()`."

It sounds reasonable. Repeating work inside a loop is wasteful. Every blog post, every code review, every linting rule says so. But here's the thing nobody actually checks: **how much does it matter?**

I wanted real numbers. So I built six benchmark modules — each isolating one common loop anti-pattern — and ran them at five input sizes (n = 10 to 100,000) with 30 trials per configuration, 50 warmup iterations, and forced garbage collection between trials. Then I built AST-based detectors for JavaScript and Python, pointed them at 40 open-source repositories across five domains, and counted how often these patterns appear in production code.

**V8's JIT optimizer already handles most of the textbook anti-patterns.** Regex hoisting? 1.03× speedup — noise-floor territory. Flattening nested `forEach`? Identical scaling curves. Fusing `filter().map()` into `reduce()`? No measurable difference.

But two patterns showed massive, unambiguous improvement. Replacing a nested loop (O(n²)) with a `Map` lookup (O(n)) delivered **64× speedup** at n = 10,000. Hoisting `JSON.parse` out of a loop delivered **46× speedup** at n = 100,000.

## Executive Summary

**The premise:** Every developer knows that loops matter. We're taught to hoist regexes, avoid nested O(n²) scans, and parallelize I/O. But modern JavaScript (V8) and Python (CPython) runtimes have evolved differently. V8 includes an aggressive JIT compiler; CPython does not. Does "textbook" advice still hold up?

**The study:** We conducted a two-part empirical analysis:
1.  **Microbenchmarking:** Six controlled modules isolating common anti-patterns (regex-in-loop, nested loops, sequential I/O, etc.), run at n=10 to n=100,000 with 30 trials per configuration.
2.  **Static Analysis:** A scan of 40 popular open-source repositories (59,728 files) to measure how often these patterns appear in production code.

**Key Findings:**
*   **Algorithmic changes dominate:** Replacing a nested loop with a `Map` lookup yielded **64× speedup** in JS and **1,864×** in Python.
*   **JIT neutralizes syntax:** V8 optimization makes "regex hoisting" and "array method chaining" performance differences negligible (1.03×).
*   **Python is unforgiving:** Without a JIT, Python pays a heavy penalty for every iteration. Fixes that are optional in JS are mandatory in Python.
*   **Prevalence mismatch:** The most common anti-patterns in real code (e.g., sequential await) often have valid use cases, while the most critical performance killers (nested loops) are moderately common (38% of repos) and catastrophic at scale.

## TL;DR for Developers

If you only have 2 minutes, here is what you need to change in your code reviews:

| Pattern | In JavaScript (V8) | In Python (CPython) | Action |
| :--- | :--- | :--- | :--- |
| **Nested Loops** (O(n²)) | **CRITICAL** (64× speedup) | **CRITICAL** (1,864× speedup) | **Refactor to Map/Set lookup immediately.** |
| **Sequential Await** | **High** (up to 75×) | **High** (up to 75×) | Use `Promise.all` / `gather` if requests are independent. |
| **JSON.parse in loop** | **High** (46×) | **High** (Estimated) | Hoist it. V8 cannot optimize fresh object allocation. |
| **Regex in loop** | Low (1.03×) | **Medium** (2.02×) | JS: Ignore. Python: **Always hoist** `re.compile`. |
| **Array Chaining** | None (0.99×) | N/A | Ignore. `filter().map()` is fine; `reduce` is not faster. |
| **Nested forEach** | Low (6× constant) | N/A | Ignore unless n > 1M. `for` loops are only marginally faster. |

---

## Part 1: The benchmarks — what actually speeds up

### BM-01: Regex in loop — the anti-pattern that isn't

The textbook advice: don't compile a regex inside a loop body. Every iteration pays the compilation cost.

```typescript
// Baseline — regex literal inside loop
for (const str of strings) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) matches++;
}

// Optimized — hoisted outside
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
for (const str of strings) {
  if (dateRegex.test(str)) matches++;
}
```

**Result at n = 100,000 (30 trials):**

| Variant | Median | Speedup |
|---------|--------|---------|
| Baseline | 2.81 ms | — |
| Optimized | 2.69 ms | **1.03×** |

That's a 3% difference. Within measurement noise for most applications.

**Why?** V8 caches compiled regex patterns internally. A regex literal in a loop body is not recompiled on every iteration the way a textbook explanation suggests. The engine recognizes the pattern is constant and reuses the compiled NFA/DFA. Hoisting it yourself does save a trivial amount of overhead (pattern identity check), but V8 has already done the expensive work for you.

**Scaling analysis confirms this:** both variants have nearly identical power-law exponents (b = 0.59 baseline, b = 0.56 optimized, R² > 0.96). They scale the same way because they're doing the same work.

**CPython is a different story.** Our Python benchmark (`py-bench.py`, CPython 3.13.12, 30 trials) showed a consistent **2.02× speedup** from hoisting `re.compile()` at all n ≥ 1,000:

| n | Baseline (re.match) | Optimized (compiled) | Speedup |
|---|---|---|---|
| 1,000 | 0.486 ms | 0.241 ms | 2.02× |
| 10,000 | 4.872 ms | 2.424 ms | 2.01× |
| 100,000 | 48.791 ms | 24.119 ms | 2.02× |

CPython maintains a small internal regex cache (~512 entries), but calling `re.match(pattern_string, s)` with a pattern literal still involves a cache lookup and pattern object construction on each call. `re.compile()` returns a pre-compiled object that skips that entirely. The 2× speedup is consistent and real.

**Verdict by runtime:** In V8/Node.js, regex hoisting is a style choice (1.03× speedup, negligible). In CPython, it's a genuine optimization (2×). If you write Python, always use `re.compile()` outside the loop.

### BM-02: JSON.parse in loop — redundant computation matters

Parsing the same JSON string on every iteration of a loop. This one is clearly wasteful — `JSON.parse` does real work that produces the same result each time.

```typescript
// Baseline — parse every iteration
for (const key of keys) {
  const config = JSON.parse(jsonString);
  result.push(config[key]);
}

// Optimized — parse once
const config = JSON.parse(jsonString);
for (const key of keys) {
  result.push(config[key]);
}
```

**Result at n = 100,000 (30 trials):**

| Variant | Median | Speedup |
|---------|--------|---------|
| Baseline | 123.4 ms | — |
| Optimized | 2.53 ms | **46×** |

A 46× speedup. This is not a marginal improvement — it's the difference between "imperceptible" and "the user notices."

**Why does this one work when regex hoisting doesn't?** Because `JSON.parse` produces a *new object* every time. V8 can't memoize it — the output is a fresh heap allocation with fresh property slots. There's no internal caching mechanism. Each call does the full parse-allocate-populate cycle.

**Scaling:** Baseline exponent b = 0.79 (near-linear in parse count); optimized exponent b = 0.45 (sublinear — the single parse is amortized across iterations, and the per-iteration cost is just a property lookup).

### BM-03: Sequential await — where parallelism pays

Each iteration of a `for` loop `await`s an HTTP request sequentially. Total time = sum of all request latencies. The optimized version fires all requests simultaneously with `Promise.all()`.

```typescript
// Baseline — sequential
for (const id of ids) {
  results.push(await fetchItem(port, id));
}

// Optimized — parallel
return Promise.all(ids.map(id => fetchItem(port, id)));
```

**Result with mock server at 2ms fixed latency (10 trials each):**

| n requests | Sequential | Parallel | Speedup | Theoretical max |
|---|---|---|---|---|
| 10 | 151.9 ms | 16.6 ms | **9.1×** | 10× |
| 50 | 736.3 ms | 20.3 ms | **36.3×** | 50× |
| 100 | 1,531.6 ms | 20.4 ms | **75.3×** | 100× |

At n = 100, sequential `await` serializes 100 round-trips into 1.5 seconds. `Promise.all()` completes all of them in 20ms — the time of a single request plus Node.js scheduling overhead. The speedup scales near-proportionally with n because each request is independent and the bottleneck is purely latency serialization.

**Important caveats:** This benchmark uses a fixed 2ms mock server with no real network variability. Real-world speedup depends on:
- **Available concurrency.** OS and server connection limits cap actual parallelism. At n = 200, we hit Windows socket limits during testing.
- **Rate limits.** Many APIs throttle concurrent requests. Firing 100 requests simultaneously may trigger 429 responses.
- **Data dependencies.** Paginated requests where page N uses the cursor from page N-1 cannot be parallelized.

**When to use `Promise.all()`:** When fetching N independent resources (user profiles, product details, file chunks) with no cross-dependencies and no aggressive rate limiting. The speedup is proportional to n.

### BM-04: Nested loops — the one that actually matters

This is the classic. An outer loop iterates users; for each user, an inner loop scans all orders to find a match. O(n²) comparisons.

```typescript
// Baseline — nested linear scan
for (const user of users) {
  let found = null;
  for (const order of orders) {
    if (order.userId === user.id) { found = order; break; }
  }
  results.push(found);
}

// Optimized — Map lookup
const orderMap = new Map();
for (const o of orders) {
  if (!orderMap.has(o.userId)) orderMap.set(o.userId, o);
}
for (const user of users) {
  results.push(orderMap.get(user.id) ?? null);
}
```

**Result at n = 10,000 (30 trials):**

| Variant | Median | Speedup |
|---------|--------|---------|
| Baseline | 61.9 ms | — |
| Optimized | 0.95 ms | **64×** |

At n = 10,000 — not even a particularly large dataset — the nested loop takes 62 ms while the Map version finishes in under 1 ms. At n = 100,000, the gap widens dramatically further because the baseline is superlinear.

**Scaling:** This is where the power-law analysis tells the real story. Baseline exponent b = 1.47 (superlinear, approaching O(n²)); optimized exponent b = 0.65 (sublinear). The gap grows with every increase in input size. At small n, both are fast. At large n, one is unusable and the other is instant.

**This is the optimization that matters.** Not because it's syntactically clever, but because it changes the algorithm. A `Map` gives O(1) average-case lookup. The nested loop gives O(n) per outer iteration. The total work changes from O(n²) to O(n). No JIT compiler can bridge that gap.

> **Note on hypothesis H4:** The benchmark spec predicted ≥100× speedup at n = 10,000. We measured 64× in JavaScript. The shortfall is because the baseline uses a `break` on first match, so average inner-loop iterations ≈ n/2 rather than n — the effective complexity is ~O(n²/2), not O(n²). In **CPython**, the same pattern delivers 1,864× at n = 10,000 (see Python benchmarks below), where the interpreter overhead amplifies every extra iteration far more than V8.

### BM-05: Nested array methods — a constant-factor win, not algorithmic

Nested `forEach`-in-`forEach` on a 2D n×1,000 matrix. The optimized version uses explicit `for` loops.

```typescript
// Baseline — nested forEach
matrix.forEach(row => {
  row.forEach(val => { sum += val; });
});

// Optimized — flat for-loop
for (let i = 0; i < matrix.length; i++) {
  const row = matrix[i];
  for (let j = 0; j < row.length; j++) { sum += row[j]; }
}
```

**Result at n = 100,000 (30 trials):**

| Variant | Median | Speedup |
|---------|--------|---------|
| Baseline | 594.8 ms | — |
| Optimized | 100.0 ms | **6.00×** (d = 40.14) |

A 6× constant-factor speedup. This is a real, statistically unambiguous improvement (Cohen's d = 40.14 is enormous). But note: the speedup is flat across all input sizes — it does not grow with n.

**Scaling result (updated with n×1,000 matrix):**

| Variant | Exponent (b) | R² | 95% CI |
|---------|-------------|-----|--------|
| Baseline | 1.096 | 0.981 | [0.936, 1.356] |
| Optimized | 1.032 | 0.984 | [0.891, 1.268] |

Both exponents are approximately 1.0 — linear scaling — and their 95% bootstrap confidence intervals fully overlap. **Neither version scales as O(n²)**; both are O(n) because total work = n rows × 1,000 cols = linear in n. The 6× speedup is therefore a constant multiplier: the JIT reduces but does not fully eliminate the per-call overhead of nested `forEach` callbacks at large scale.

**What this tells us:** V8 JIT-compiles hot `forEach` callbacks aggressively, but at very large data volumes (100M total iterations here), the callback dispatch mechanism still costs ~6× vs a raw `for` loop. If your loop body runs billions of times, the `for` syntax pays off. For typical data sizes (< 100k total iterations), the difference is sub-millisecond and not worth the readability tradeoff.

### BM-06: Chained array methods — also handled

`array.filter(pred).map(transform)` creates an intermediate array and makes two passes. The optimized version fuses into a single `reduce()`.

```typescript
// Baseline — two passes
const result = items.filter(x => x.active).map(x => ({ id: x.id, doubled: x.value * 2 }));

// Optimized — single pass
const result = items.reduce((acc, x) => {
  if (x.active) acc.push({ id: x.id, doubled: x.value * 2 });
  return acc;
}, []);
```

**Scaling result:**

| Variant | Exponent (b) | R² |
|---------|-------------|-----|
| Baseline | 0.521 | 0.906 |
| Optimized | 0.493 | 0.894 |

Near-identical exponents. The theoretical constant-factor improvement (2n → n) doesn't materialize because V8 optimizes the intermediate array allocation. Modern engines use inline caches and escape analysis to minimize the cost of short-lived intermediate arrays.

**Honest assessment:** The `reduce()` version is harder to read and no faster. Keep `filter().map()` — it's clearer and V8 doesn't penalize it.

---

## The full scaling picture

Power-law regression fits `time = a × n^b` on log-log scale. The exponent `b` determines asymptotic behavior.

| Module | Pattern | Exponent (b) | R² | Empirical | Theoretical |
|--------|---------|-------------|-----|-----------|-------------|
| BM-01 | Baseline | 0.590 | 0.976 | O(√n) | O(n) |
| BM-01 | Optimized | 0.564 | 0.968 | O(√n) | O(n) |
| BM-02 | Baseline | 0.792 | 0.985 | O(n) | O(n) |
| BM-02 | Optimized | 0.446 | 0.870 | O(√n) | O(n) |
| BM-04 | Baseline | **1.475** | 0.955 | **O(n^1.5)** | O(n²) |
| BM-04 | Optimized | 0.648 | 0.925 | O(√n) | O(n) |
| BM-05 | Baseline | **1.096** | 0.981 | O(n) | O(n²) |
| BM-05 | Optimized | **1.032** | 0.984 | O(n) | O(n²) |
| BM-06 | Baseline | 0.521 | 0.906 | O(√n) | O(n) |
| BM-06 | Optimized | 0.493 | 0.894 | O(√n) | O(n) |

Several observations:

1. **BM-04 is the only module where baseline and optimized have fundamentally different scaling.** Exponent 1.475 vs 0.648 — the gap widens with every increase in input size. This is the signature of an actual algorithmic improvement.

2. **BM-02 shows a meaningful exponent difference** (0.792 vs 0.446) — the per-iteration parse cost drives the baseline curve steeper than the optimized single-parse version.

3. **BM-01 and BM-06 show nearly identical exponents** between baseline and optimized. V8's JIT optimizer has already eliminated the theoretical difference.

4. **BM-05 shows identical *scaling* but a 6× absolute speedup.** Both exponents are ~1.0 (linear), with fully overlapping 95% bootstrap CIs ([0.936, 1.356] vs [0.891, 1.268]). The `for` loop is consistently faster by a constant factor at large n, but the gap doesn't widen with scale. This is a JIT reduction of callback overhead, not an elimination of it.

5. **Most empirical exponents are below theoretical predictions.** This is consistent across all modules and reflects V8's aggressive optimization: JIT compilation, inline caching, hidden classes, and escape analysis all compress observed running times below naive complexity estimates.

### Why empirical complexity diverges from theory

The textbook says `for (const x of arr) { regex.test(x) }` is O(n). But we measured b ≈ 0.59 — closer to O(√n). This doesn't mean the algorithm is sublinear. It means:

- **JIT warmup effects:** V8 compiles hot loops to optimized machine code after a few iterations. Early iterations are slower (interpreted); later iterations are faster (compiled). This compresses the time-vs-n curve.
- **CPU cache hierarchy:** Small n fits in L1 cache; large n spills to L2/L3/RAM. The cache penalty at large n is partially offset by better JIT optimization at large n.
- **Branch prediction:** Modern CPUs predict loop branches nearly perfectly after a few iterations. The prediction cost is amortized over n.

The practical implication: **theoretical complexity analysis overestimates real-world performance differences for constant-factor optimizations.** Only changes that alter the asymptotic class (like BM-04's O(n²) → O(n)) produce speedups that scale with input size.

---

## Part 2: How common are these patterns in real code?

### Corpus

40 open-source repositories, evenly split: 20 JavaScript/TypeScript and 20 Python. Stratified across five domains (8 repos per domain): Data Transformation, Web Serving, Build Tooling, UI/Rendering, Developer Utilities. Selection criteria: ≥500 GitHub stars, active maintenance, test suite present.

Includes projects like lodash, Express, webpack, ESLint, Prettier, Apache Airflow, FastAPI, Django REST Framework, pytest, and Black.

### Repo selection methodology

We selected 40 repositories using a stratified sampling approach to ensure the results represent diverse real-world workloads, not just one type of application.

1.  **Search & Filter:** We queried GitHub for high-popularity repositories (stars > 500) across five predefined domains.
2.  **Verification:** We programmatically verified that each candidate met all three criteria (see `verify_repos.py`): active maintenance (commits in last 12 months), a functioning test suite, and primary language match. All 40 repositories passed 100% across all three criteria.
3.  **Stratification:** We selected exactly 8 repositories per domain — verified programmatically: 8 repos in each of the 5 domains.

**The Domains:**
*   **Data Transformation:** Libraries that manipulate structures (lodash, ajv). High expected loop density.
*   **Web Serving:** HTTP frameworks (Express, FastAPI). I/O heavy.
*   **Build Tooling:** Bundlers/compilers (webpack, Vite, Rollup, Parcel). Complex file processing loops.
*   **UI / Rendering:** Graphics/DOM libraries (three.js, p5.js). Performance-critical tight loops.
*   **Developer Utilities:** CLI tools, testing frameworks (Jest, pytest). Mixed workloads.

**Included projects:**
*   **JS/TS:** lodash, Express, webpack, Vite, Rollup, Parcel, ESLint, Prettier, three.js, p5.js, Jest, etc.
*   **Python:** Apache Airflow, FastAPI, Django, Flask, pytest, Black, Celery, Scrapy, pandas, numpy, etc.

Two AST-based detectors:

- **JS/TS detector** (`js-loop-detector.ts`): Uses Babel parser + traverse. Detects regex-in-loop, json-parse-in-loop, nested-loops, sequential-await-in-loop, nested-array-methods. Scope tracking disabled (`noScope: true`) for robustness on complex bundles; `try/catch` wraps traversal to skip malformed files.
- **Python detector** (`py-loop-detector.py`): Uses Python's `ast` module. Detects the same patterns via `ast.NodeVisitor` with loop-depth tracking.

Both detectors are structural pattern matchers — they identify syntactic anti-patterns, not runtime performance issues. A finding means "this code *structurally* matches an anti-pattern," not "this code is slow." The benchmark data tells us which structural patterns actually correlate with performance impact.

### JavaScript/TypeScript findings

**38,495 files scanned. 2,238 anti-pattern instances found.**

| Anti-Pattern | Count | Share |
|---|---|---|
| Sequential await in loop | 895 | 40.0% |
| Regex in loop | 723 | 32.3% |
| Nested loops | 343 | 15.3% |
| Nested array methods | 241 | 10.8% |
| JSON.parse in loop | 36 | 1.6% |

**Distribution by Domain:**

We categorized repositories to test the hypothesis that "computational" domains (Data Transformation, Rendering) would have cleaner loops than "glue code" domains (Web Serving, Dev Utils). The data shows a clear outlier:

| Domain | Instances | Share | Context |
|---|---|---|---|
| **Build Tooling** | 1,074 | 48.0% | AST transformations and file processing often require deep nesting. |
| **UI / Rendering** | 610 | 27.3% | Graphics engines (three.js) use nested loops for matrix/vertex operations. |
| **Developer Utilities** | 394 | 17.6% | Test runners and CLI tools (Jest, Prettier). |
| **Web Serving** | 86 | 3.8% | Request handlers tend to be shallow and I/O bound. |
| **Data Transformation** | 74 | 3.3% | Libraries like `lodash` are heavily optimized by hand. |

Build tooling (webpack, bundlers) dominates the findings, primarily because they traverse complex graph structures (ASTs, dependency trees) where nested recursion is often necessary.

**Top repositories by finding count:**

| Rank | Repository | Domain | Total | nested | seq-await | regex | json | nested-arr |
|---|---|---|---|---|---|---|---|---|
| 1 | webpack/webpack | Build Tooling | 403 | 95 | 86 | 175 | 4 | 43 |
| 2 | mrdoob/three.js | UI / Rendering | 374 | 188 | 27 | 132 | 2 | 25 |
| 3 | parcel-bundler/parcel | Build Tooling | 340 | 7 | 275 | 46 | 6 | 6 |
| 4 | vitejs/vite | Build Tooling | 232 | 8 | 119 | 62 | 7 | 36 |
| 5 | jestjs/jest | Developer Utilities | 161 | 1 | 90 | 37 | 7 | 26 |
| 6 | prettier/prettier | Developer Utilities | 147 | 2 | 75 | 46 | 2 | 22 |
| 7 | processing/p5.js | UI / Rendering | 146 | 27 | 16 | 93 | 0 | 10 |
| 8 | rollup/rollup | Build Tooling | 99 | 12 | 53 | 21 | 3 | 10 |
| 9 | lodash/lodash | Data Transformation | 28 | 1 | 0 | 26 | 0 | 1 |
| 10 | ajv-validator/ajv | Data Transformation | 24 | 0 | 5 | 11 | 3 | 5 |

three.js is the dominant source of high-impact nested loops (188 instances) — a geometry/rendering engine that legitimately processes meshes with nested vertex iteration. webpack leads overall (403) but its findings are spread across all pattern types, with regex-in-loop dominating (175) — most are in source-map processing code. The new addition `vitejs/vite` (replacing `esbuild`) contributes 232 findings, dominated by sequential-await-in-loop (119) from its plugin hook system.

### Python findings

**21,233 files scanned. 4,867 anti-pattern instances found.**

| Anti-Pattern | Count | Share |
|---|---|---|
| Nested loops | 3,224 | 66.2% |
| Nested comprehension | 910 | 18.7% |
| Sequential await in loop | 457 | 9.4% |
| Regex in loop | 209 | 4.3% |
| JSON.parse in loop | 67 | 1.4% |

Nested loops dominate Python findings by a wide margin — CPython's lack of JIT means every extra iteration is costly, and the detector correctly flags the pattern at high volume. Apache Airflow (1,206 findings) and Django (798) are the top contributors. Apache Airflow's large async codebase also contributes the bulk of sequential-await findings.

**Python benchmark results (CPython 3.13.12, 30 trials):**

We benchmarked the two patterns most likely to differ from V8 behavior:

*BM-01 equivalent — regex hoisting:*

| n | `re.match(pattern, s)` | `compiled.match(s)` | Speedup |
|---|---|---|---|
| 1,000 | 0.486 ms | 0.241 ms | 2.02× |
| 10,000 | 4.872 ms | 2.424 ms | 2.01× |
| 100,000 | 48.791 ms | 24.119 ms | 2.02× |

*BM-04 equivalent — nested loop vs dict lookup:*

| n | Nested loop | Dict lookup | Speedup |
|---|---|---|---|
| 100 | 0.285 ms | 0.018 ms | 15.65× |
| 1,000 | 27.820 ms | 0.154 ms | **181×** |
| 10,000 | 2,678.985 ms | 1.437 ms | **1,864×** |

These numbers are dramatically different from V8. **CPython does not JIT-compile loops**, so every interpreted iteration pays full bytecode dispatch overhead. The dict lookup improvement is 1,864× in Python vs 64× in JavaScript — the same algorithmic change, but CPython amplifies the per-iteration cost ~29× more. If you're writing Python with nested loops over large collections, this is the single highest-priority fix in your codebase.

### Combined prevalence

| Metric | Value |
|---|---|
| **Total files scanned** | 59,728 |
| **Total findings** | 7,105 |
| **Findings per 1,000 files** | 119.0 |

**Prevalence rate by pattern (% of JS repos containing at least one instance):**

| Pattern | Repo Prevalence |
|---|---|
| Sequential await in loop | 42.5% |
| Regex in loop | 42.5% |
| Nested loops | 27.5% |
| Nested array methods | 40.0% |
| JSON.parse in loop | 22.5% |

Nearly every pattern appears in at least 20% of repos. These aren't rare edge cases — they're common code idioms.

### Cross-referencing prevalence with benchmark impact

This is where the data gets interesting. The most prevalent patterns in real code are *not* the ones with the biggest benchmark impact:

| Pattern | Prevalence (JS) | Benchmark Speedup | Verdict |
|---|---|---|---|
| Sequential await | 895 (40.0%) | **9–75× (latency-dependent)** | Fix independent fetches |
| Regex in loop | 723 (32.3%) | 1.03× JS / **2× Python** | JS: style only; Python: fix it |
| Nested loops | 343 (15.3%) | **64× JS / 1,864× Python** | **Fix these** |
| Nested array methods | 241 (10.8%) | 6× at large n (constant) | Fix if > 100k iterations |
| JSON.parse in loop | 36 (1.6%) | **46× at n=100k** | Fix these (but rare) |

**The most impactful anti-pattern (nested loops, 64× speedup) is moderately prevalent (15.3% of JS findings, 66.2% of Python findings).** Optimization effort is well-targeted — nested loops are both impactful and detectable.

**The second most impactful pattern (JSON.parse in loop, 46× speedup) is extremely rare** (1.6% of findings). In practice, developers rarely call `JSON.parse` inside a tight loop on the same string. When they do, it's usually obvious and gets caught in review.

**Regex hoisting and `forEach`→`for` rewriting are V8-only non-issues.** In Python, regex hoisting delivers a consistent 2× speedup. Array method rewriting shows a 6× constant-factor improvement at very large n (100M+ total iterations), which matters for rendering engines and bulk data processors.

**Sequential await is the most prevalent JS pattern and one of the most impactful** — up to 75× speedup at n=100 with 2ms latency. But it requires dependency analysis before fixing.

---

## Part 3: What this means for real-world code

### When nested loops actually hurt

Not every nested loop is a performance problem. The key factors:

**Dangerous:**
- **Large inner collections.** A nested loop over two arrays of 10,000 items each does 100 million comparisons. A Map lookup does 10,000.
- **Hot paths.** API request handlers, render loops, event processors — code that runs on every user action.
- **Growing data.** If `n` increases over time (user base, log volume, product catalog), a quadratic loop becomes a ticking time bomb.

**Probably fine:**
- **Small fixed-size inputs.** Nested loop over 5 fields × 3 options = 15 iterations. A Map would be overkill.
- **Cold paths.** Startup configuration, migration scripts, one-time setup. Nobody cares if it takes 70ms instead of 1ms once.
- **External I/O dominates.** If the loop body makes a database call that takes 5ms, the iteration overhead is irrelevant.

### When sequential await matters

Sequential `await` is context-dependent. Our scan found 895 JS instances and 457 Python instances — the most prevalent JS pattern overall. But not all of them are bugs:

**1. Intentionally Sequential (Good):**
When the next iteration depends on the result of the previous one. Parallelization here would break correctness.

```typescript
// Example: Paginated API where cursor depends on previous page
let cursor = null;
while (true) {
  const page = await fetchPage(cursor); // MUST wait
  if (!page.nextCursor) break;
  cursor = page.nextCursor;
}
```

**2. Unintentionally Sequential (Bad):**
When iterations are independent. This pattern serializes latency unnecessarily.

```typescript
// Anti-pattern: Serial fetching
for (const userId of userIds) {
  const profile = await fetchProfile(userId); // Blocks next iteration
  profiles.push(profile);
}

// Fix: Parallelize with Promise.all
const profiles = await Promise.all(userIds.map(id => fetchProfile(id)));
```

**Distinguishing rule:** If you can shuffle the input array and the code still works, it should be parallelized.

Without analyzing data dependencies, static analysis can't distinguish these. Our detector flags the structural pattern; a human must assess the intent.

### The false positive problem

Our JS detector found 723 regex-in-loop instances. Our benchmark shows regex hoisting produces 1.03× speedup — effectively zero. **That means 723 findings are, from a performance perspective, false positives.**

Similarly, 241 nested-array-method findings and an unknown portion of the 895 sequential-await findings are false positives for performance (though they may have readability value).

This is a fundamental limitation of structural static analysis for performance: **the tool detects code shape, not runtime cost.** A `forEach` inside a `forEach` on a 5-element array costs nothing. The same pattern on a 10,000-element array costs 100 million operations. The AST looks identical.

---

## Caveats and limitations

**Node.js environment, not browser.** All benchmarks ran in Node.js with V8. Browser environments share V8 (Chrome, Edge) but add DOM overhead, compositor scheduling, and memory pressure from the rendering pipeline. SpiderMonkey (Firefox) and JavaScriptCore (Safari) may have different JIT behaviors — a regex pattern that V8 caches might not be cached by other engines.

**Synthetic workloads.** Benchmark inputs are generated from seeded PRNGs — uniform distributions, controlled sizes, no I/O. Real-world loops often involve heterogeneous data, I/O interleaving, and memory pressure from concurrent operations. The synthetic setup isolates the loop pattern but doesn't capture system-level interactions.

**BM-03 timing is partial.** We measured sequential vs `Promise.all()` at 2ms mock latency for n = 10, 50, 100. At n = 200, Windows socket limits (connection backlog exhaustion) caused failures during parallel warmup. The collected data (9.1× to 75.3× speedup) covers the most practically relevant range. BM-07 (DOM batching) requires a real browser with DevTools and was not included.

**BM-03 results do not include real network variance.** The mock server uses a fixed 2ms delay with no jitter. Real HTTP latency has high variance (p50 vs p99 can differ 10×), which affects both sequential and parallel completion times differently.

**Single platform.** All data from one machine (Windows x64, Node.js v24.11.0). JIT behavior, cache sizes, and scheduling vary across hardware and OS. The relative rankings should hold, but absolute timings will differ.

**Python benchmarks are limited to two patterns.** We validated regex hoisting (2× consistent) and nested loops (1,864× at n=10,000) in CPython. The remaining patterns — sequential await (`asyncio.gather()`), dict comprehension inside loops, and nested comprehensions — lack Python benchmark data. Given CPython's lack of JIT, it's reasonable to expect these also show larger speedups than their V8 equivalents.

**Power-law fit limitations.** The scaling analysis uses log-log OLS regression with 5 data points (n = 10 to 100,000). Five points provide limited statistical power for distinguishing between, say, O(n log n) and O(n^1.3). The R² values (0.87–0.99) indicate good fits, but the exponent estimates have meaningful confidence intervals that we haven't reported. The qualitative conclusion (BM-04 is superlinear, others are not) is robust; the exact exponent values should be interpreted loosely.

**Static analysis precision not formally evaluated.** The detectors use structural pattern matching without ground-truth labeling. Formal precision/recall measurement would require manually labeling hundreds of findings as true/false positives — feasible but not completed. Based on spot-checking: regex-in-loop and json-parse-in-loop have high structural precision (the code literally does what the detector says); nested-loops has moderate precision (many are on small fixed-size collections); sequential-await has low precision for *performance* impact (many are intentionally sequential).

---

## Practical recommendations

Based on the combined benchmark and prevalence data:

1. **Prioritize nested loop → Map/Set refactoring.** 343 JS instances (15.3%), 3,224 Python instances (66.2%), 64× JS / 1,864× Python benchmark speedup. Look for patterns where an inner loop scans a collection for a matching key. Replace with a pre-built `Map` or `Set`. This is the single highest-impact optimization available.

2. **Hoist repeated parsing outside loops.** JSON.parse, XML parsing, YAML parsing — any operation that produces the same result on the same input. Rare (36 JS instances) but impactful (46×) when found.

3. **`forEach` → `for` rewriting in JavaScript: only at massive scale.** The 6× speedup only appears at n = 100,000 rows × 1,000 cols = 100M total iterations. For typical loops (< 1M total iterations), the difference is sub-millisecond. Write whichever is clearer. In Python, this distinction doesn't apply — CPython pays full overhead either way.

4. **Don't rewrite `filter().map()` to `reduce()`.** No measurable benefit, and `reduce()` is harder to read. The intermediate array allocation that theory warns about is optimized away in practice.

5. **Evaluate sequential `await` case by case.** The static count is high (895 JS, 457 Python) but many are intentionally sequential. Focus on loops that fetch independent resources — those are genuine candidates for `Promise.all()` or `asyncio.gather()`. Our benchmark shows up to 75× speedup at n=100 with modest latency.

6. **In Python, always use `re.compile()` outside loops.** Unlike V8, CPython does not fully eliminate the pattern-construction cost at call time. The 2× speedup is consistent and free — one line change. In JavaScript, hoisting is a style choice only.

---

## What we didn't test (and should)

Several gaps remain that would strengthen or qualify these findings:

- **Cross-engine comparison.** V8 dominates our JS results. SpiderMonkey (Firefox) and JavaScriptCore (Safari) may not cache regex the same way. BM-01's "1.03× — don't bother" conclusion is V8-specific.
- **BM-03 at higher n and varying latency.** We hit Windows socket limits at n = 200 parallel. Testing at n = 500–1,000 with concurrency throttling (`p-limit`, worker pools) would show where parallelization hits diminishing returns.
- **Python async benchmarks.** `asyncio.gather()` vs sequential `await` in Python — the most prevalent Python pattern — has no benchmark data yet.
- **BM-07 DOM batching in real browsers.** Layout recalculation cost grows with DOM tree size. Chrome DevTools measurements with varying tree sizes would validate the DocumentFragment optimization.
- **Memory impact.** Our benchmarks measured wall-clock time. Map-based replacements trade time for space (the Map uses additional memory). For memory-constrained environments, the tradeoff analysis matters.
- **Larger corpus.** 40 repos provide a starting point but limit statistical power for per-domain analysis. A 200+ repo scan would enable more robust prevalence estimates.

### Additional loop anti-patterns not covered

This study focused on six structurally distinct patterns. Production-grade static analysis tools detect a broader set worth benchmarking in future work:

- **`Array.includes()` / `indexOf()` inside a loop.** Structurally equivalent to nested loops — each call is an O(n) linear scan, making the outer loop O(n²). Replacing with a pre-built `Set` gives O(1) membership checks. Tools like [Code Evolution Lab](https://codeevolutionlab.com) flag this as `array_lookup_in_loop` and auto-generate the `Set` conversion. Prevalence in real codebases is likely higher than explicit nested `for` loops because the O(n) cost is hidden behind a method call.

- **`Object.keys()` with array lookups in a loop.** Iterating `Object.keys(obj)` and then calling `.includes()` or `.find()` on the result inside the loop creates the same O(n²) pattern. Direct property access (`obj[key]`) or a `Map` eliminates the inner scan entirely.

- **String concatenation in a loop (`str +=`).** Each `+=` on a string allocates a new string object. At large n, this creates significant GC pressure. The fix — `parts.push(x); parts.join('')` — is a single allocation. V8 has some string rope optimizations, but they don't fully eliminate the allocation cost at high iteration counts.

- **Synchronous file I/O in a loop (`readFileSync`, `writeFileSync`).** Each call blocks the Node.js event loop for the full disk latency. Replacing with `await Promise.all(files.map(f => fs.readFile(f)))` parallelizes I/O and unblocks the event loop between reads. Expected speedup is proportional to the number of files and disk concurrency.

- **ReDoS-vulnerable regex patterns.** Patterns with nested quantifiers like `(a+)+` or `(.*)+` exhibit exponential backtracking on adversarial input. This is a correctness/security issue as much as a performance one — a single malicious string can stall the event loop for seconds. Static analysis can flag structurally dangerous patterns without running them; tools like [Code Evolution Lab](https://codeevolutionlab.com) include a dedicated ReDoS detector that scores regex complexity and flags dangerous constructs.

These patterns share the same root cause as the ones we benchmarked — redundant work per iteration — but differ in whether the fix is algorithmic (data structure substitution), I/O-structural (parallelization), or security-driven (regex redesign).

---

## Appendix A: Benchmark Environment & Methodology

**Hardware & Runtime:**
*   **OS:** Windows x64
*   **Runtime:** Node.js v24.11.0 (V8 12.x), Python 3.13.12 (CPython)
*   **Timing:** `process.hrtime.bigint()` (JS) / `time.perf_counter_ns()` (Python)

**Protocol:**
*   **Trials:** 30 independent runs per (module, pattern, n) configuration.
*   **Warmup:** 50 iterations discarded before measurement to stabilize JIT/cache.
*   **Isolation:** Forced garbage collection (`global.gc()` / `gc.collect()`) and 200ms sleep between trials to minimize thermal throttling and heap fragmentation.
*   **Validation:** Strict correctness gate — baseline and optimized implementations must produce bit-identical output for all inputs before timing begins.

## Appendix B: Source code and data reference

All code, data, and results are in the [empirical-study](https://github.com/liangk/empirical-study) repository under `studies/04-loop-performance/`.

### Benchmarks (Step 1)

| File | What it does |
|------|-------------|
| [`src/step1-benchmarks/modules/bm01-regex/`](https://github.com/liangk/empirical-study/tree/main/studies/04-loop-performance/src/step1-benchmarks/modules/bm01-regex) | BM-01: Regex compilation inside loop |
| [`src/step1-benchmarks/modules/bm02-json/`](https://github.com/liangk/empirical-study/tree/main/studies/04-loop-performance/src/step1-benchmarks/modules/bm02-json) | BM-02: JSON.parse inside loop |
| [`src/step1-benchmarks/modules/bm03-async-io/`](https://github.com/liangk/empirical-study/tree/main/studies/04-loop-performance/src/step1-benchmarks/modules/bm03-async-io) | BM-03: Sequential await (mock HTTP server) |
| [`src/step1-benchmarks/modules/bm04-nested-loops/`](https://github.com/liangk/empirical-study/tree/main/studies/04-loop-performance/src/step1-benchmarks/modules/bm04-nested-loops) | BM-04: Nested loop → Map lookup |
| [`src/step1-benchmarks/modules/bm05-nested-array/`](https://github.com/liangk/empirical-study/tree/main/studies/04-loop-performance/src/step1-benchmarks/modules/bm05-nested-array) | BM-05: Nested forEach → flat loop |
| [`src/step1-benchmarks/modules/bm06-chained-array/`](https://github.com/liangk/empirical-study/tree/main/studies/04-loop-performance/src/step1-benchmarks/modules/bm06-chained-array) | BM-06: filter().map() → reduce() |
| [`src/step1-benchmarks/harness/`](https://github.com/liangk/empirical-study/tree/main/studies/04-loop-performance/src/step1-benchmarks/harness) | Trial runner, stats (mean/median/std/t-test/Cohen's d), data generators |
| [`src/step1-benchmarks/correctness/verify-all.ts`](https://github.com/liangk/empirical-study/blob/main/studies/04-loop-performance/src/step1-benchmarks/correctness/verify-all.ts) | Correctness gate — baseline vs optimized output comparison |
| [`src/step1-benchmarks/run-all.ts`](https://github.com/liangk/empirical-study/blob/main/studies/04-loop-performance/src/step1-benchmarks/run-all.ts) | Orchestrator with `--module` and `--n` filters |

### Scaling analysis (Step 2)

| File | What it does |
|------|-------------|
| [`src/step2-scaling/fit-curves.ts`](https://github.com/liangk/empirical-study/blob/main/studies/04-loop-performance/src/step2-scaling/fit-curves.ts) | Power-law regression (log-log OLS), R², complexity labels |

### Real-world scanning (Steps 3–4)

| File | What it does |
|------|-------------|
| [`src/step3-realworld/corpus.ts`](https://github.com/liangk/empirical-study/blob/main/studies/04-loop-performance/src/step3-realworld/corpus.ts) | Parses corpus.md, clones repos |
| [`src/step3-realworld/profiler.ts`](https://github.com/liangk/empirical-study/blob/main/studies/04-loop-performance/src/step3-realworld/profiler.ts) | Runs JS detector on cloned repos, outputs findings JSON |
| [`src/step4-static-analysis/detector/js-loop-detector.ts`](https://github.com/liangk/empirical-study/blob/main/studies/04-loop-performance/src/step4-static-analysis/detector/js-loop-detector.ts) | Babel AST detector — 5 anti-patterns, noScope traversal |
| [`src/step4-static-analysis/detector/py-loop-detector.py`](https://github.com/liangk/empirical-study/blob/main/studies/04-loop-performance/src/step4-static-analysis/detector/py-loop-detector.py) | Python AST detector — 5 anti-patterns, loop-depth visitor |
| [`src/step4-static-analysis/evaluate-tools.ts`](https://github.com/liangk/empirical-study/blob/main/studies/04-loop-performance/src/step4-static-analysis/evaluate-tools.ts) | Scan orchestrator, precision/recall/F1 framework |

### Result data

| File | Contents |
|------|----------|
| `results/bench-*.json` | Raw trial data: wallTimeNs, cpuTimeMs, heapBefore/After per (module, pattern, n, trial) |
| `results/scaling-*.json` | Power-law fits: a, b, R², empirical/theoretical complexity per module |
| `results/findings-*.json` | JS detector output: 2,238 findings across 38,495 files |
| `results/py-findings-<repo>.json` | Python detector output: 4,867 findings across 21,233 files (per-repo JSON files) |
| `results/prevalence-*.json` | Per-pattern prevalence rates and density per KLOC |
| `results/realworld-*.json` | Per-repo profiles with git blame and patch tracking fields |
| `data/corpus.md` | 40-repo corpus with domain stratification |

---

*Built at [StackInsight](https://stackinsight.dev).*
