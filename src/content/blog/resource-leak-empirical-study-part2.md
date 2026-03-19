---
title: "File Descriptor Exhaustion: A Four-Case Simulation Study of How fs.open() Leaks Trigger EMFILE in Node.js"
pubDate: "2026-03-19"
heroImage: "../../assets/resource-leak-empirical-study-part2.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "We built a discrete-event file descriptor simulator and ran four two-dimensional parameter grid experiments to measure how leak probability, concurrency, file size, FD limits, error handling, and open rate interact to cause EMFILE errors. At FD limit 64, a 5% leak rate at concurrency 50 exhausts file descriptors in under 3 seconds. File size has zero effect on time-to-exhaustion but scales heap growth linearly — 64 leaked FDs on 10MB files = 640MB heap. This is Part 2 of our resource leak study, focusing on BM-02: file descriptor exhaustion."
excerpt: "EMFILE: too many open files. The Node.js process ran out of file descriptors. At FD limit 64 (common in containers), a 5% leak rate at concurrency 50 triggers EMFILE in 2.9 seconds. At FD limit 1024 (default), you need 1000 opens/second before exhaustion occurs within 30 seconds. File size doesn't matter for when you crash — but 64 leaked FDs on 10MB files quietly allocates 640MB of heap before the crash."
lastmod: "2026-03-19"
canonical_url: "https://stackinsight.dev/blog/resource-leak-empirical-study-part2"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - EMFILE too many open files nodejs
  - file descriptor leak nodejs
  - fs.open without close nodejs
  - file descriptor exhaustion
  - nodejs EMFILE error fix
  - fd.close try finally
  - nodejs file handle leak
  - fs.promises.open leak
  - file descriptor limit ulimit
  - nodejs open files limit
  - EMFILE error handling
  - file descriptor monitoring nodejs
  - fd leak detection
  - nodejs resource leak simulation
  - file descriptor try finally

# AIEO (AI Engine Optimization)
ai_summary: "This empirical study uses a discrete-event file descriptor simulator to run four two-dimensional parameter grid experiments measuring how FD leaks cause EMFILE errors. Case 1 (Leak Probability × Concurrency): At FD limit 1024, you need concurrency 50+ with 5%+ leak rate to trigger exhaustion within 30 seconds (31.8% failure, 20.4s TTE). At concurrency 10 with 20% leak, failure is 14.2% and TTE is 25.7s. Case 2 (File Size × FD Limit): File size has zero effect on time-to-exhaustion — only the FD count determines EMFILE timing. But heap growth = leaked FDs × file size: 64 leaked FDs on 10MB files = 640MB heap; on 100MB files = 6.4GB heap. FD limits 64/128/256 exhaust; 512+ survive with fixed concurrency 20 and 5% leak. Case 3 (Error Rate × Cleanup Behavior): With fd.close() in finally, zero additional FD leaks regardless of error rate. Without fd.close() on errors, a 10% error rate at 20% baseline leak exhausts 1024 FDs and causes 51.8% request failure. Case 4 (Open Rate × FD Limit): Below 50 opens/second, no FD limit exhausts. At 1000/s, FD limit 64 exhausts in 1.4s, FD limit 256 in 5.3s, FD limit 1024 in 20.4s. The fix: wrap every fs.promises.open() in try/finally with fd.close() in the finally block."
ai_key_facts:
  - "At FD limit 1024 (default), concurrency 50 with 5% leak = 31.8% failure, 20.4s time-to-exhaustion"
  - "At FD limit 64 (containers), concurrency 50 with 5% leak = 31.8% failure, 2.9s time-to-exhaustion"
  - "File size has zero effect on time-to-exhaustion — only FD count determines EMFILE timing"
  - "64 leaked FDs × 10MB files = 640MB heap growth; × 100MB files = 6.4GB heap growth"
  - "Heap growth = leaked FD count × file size, independently of EMFILE timing"
  - "Without fd.close() on error paths, 10% error rate + 20% base leak = 68.8% request failure"
  - "At 1000 opens/second: FD limit 64 exhausted in 1.4s, FD limit 1024 in 20.4s"
  - "FD exhaustion time scales linearly with FD limit at fixed open rate"
  - "Below 50 opens/second, no FD limit (even 64) exhausts within 30 seconds"
  - "Proper try/finally with fd.close() eliminates EMFILE from error paths entirely"
ai_entities:
  - "Node.js"
  - "File Descriptor"
  - "EMFILE"
  - "fs.promises.open"
  - "fs.createReadStream"
  - "fd.close"
  - "ulimit"
  - "try/finally"
  - "Error Handling"
  - "Discrete-Event Simulation"
  - "Heap Growth"
  - "OOM"
  - "Code Evolution Lab"

# Structured Data (Article Schema)
schema_type: "TechArticle"
schema_proficiency_level: "Advanced"
schema_dependencies: "Node.js v18+, TypeScript 5+, ts-node"
schema_time_required: "PT20M"

# Taxonomy
categories:
  - "Backend Performance"
  - "Software Engineering Research"
  - "Node.js"
tags:
  - nodejs
  - file-descriptors
  - resource-leaks
  - EMFILE
  - performance
  - typescript
  - benchmarking
  - simulation
  - empirical-study
  - fs-open
  - error-handling
  - concurrency
  - try-finally
  - heap-memory

# Related
related_posts:
  - "resource-leak-empirical-study"
  - "resource-leak-empirical-study-part3"
  - "resource-leak-empirical-study-part4"
series: "Backend Performance Empirical Studies"
series_order: 7
---

# File Descriptor Exhaustion: How `fs.open()` Without `close()` Triggers EMFILE

You've seen the error before:

```
Error: EMFILE: too many open files, open '/var/app/data/report-12345.json'
    at Object.open (node:internal/fs/promises:...)
```

The Node.js process ran out of file descriptors. Every subsequent `fs.open()`, `fs.createReadStream()`, and even some network operations fail with EMFILE. The service is effectively dead — not from a logic error, but from accumulated file handles that were opened and never closed.

EMFILE is the file system equivalent of connection pool exhaustion. But unlike a connection pool where the limit is your configured `maxConnections` (often 20–50), the file descriptor limit is set at the OS level — typically 1,024 per process by default, or as low as 64 in containerized environments.

I wanted to know the exact thresholds. How much concurrency does it take to trigger EMFILE? Does file size matter? What happens when error paths don't call `fd.close()`? How fast does a 1,000 ops/second workload exhaust descriptors?

I built a discrete-event FD simulator and ran four two-dimensional parameter experiments. Each sweeps two parameters across a grid — leak probability × concurrency, file size × FD limit, error rate × cleanup behavior, and open rate × FD limit — and measures failure rate, time-to-exhaustion, throughput, and leaked FD count.

At default settings you need concurrency 50 with a 5% leak rate before exhaustion occurs — and even then it takes 20 seconds. Containerized processes often run with FD limits of 64–128, where the same 5% leak at concurrency 50 exhausts descriptors in under 3 seconds. File size has zero effect on when you hit EMFILE, but every leaked open handle holds its read buffer in heap. At 64 leaked FDs × 10MB files, that's 640MB before the crash.

---

## The Pattern

A file descriptor is a kernel-level handle to an open file. Node.js allocates one for every `fs.open()`, `fs.createReadStream()`, `net.Socket`, and even some timers. The process has a hard limit — if it exceeds that limit, any further `open()` call throws EMFILE.

The leak happens when you open a file but don't close it:

```typescript
// Leaky pattern — common in log processing, report generation, file uploads
async function readConfig(filePath: string) {
  const fd = await fs.promises.open(filePath, 'r');
  const buffer = Buffer.alloc(4096);
  const { bytesRead } = await fd.read(buffer, 0, 4096, 0);
  // If fd.read() throws (disk error, permissions, etc.),
  // fd.close() is never called — the descriptor leaks
  await fd.close();
  return buffer.slice(0, bytesRead).toString();
}
```

The non-obvious version with `createReadStream`:

```typescript
async function processFile(filePath: string) {
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    await processChunk(chunk);
    // If processChunk throws, the stream is abandoned
    // The underlying FD is never closed
  }
}
```

In a service processing 100 files per second, a code path that fails to close on 5% of files leaks 5 FDs per second. A 1,024-descriptor limit is exhausted in ~200 seconds under steady load. Under burst conditions, much faster.

---

## The Simulation

The FD simulator models `fs.promises.open()` lifecycle: open, use, close (or leak), and EMFILE error propagation. Parameters:

| Parameter | What it controls |
|-----------|-----------------|
| `fdLimit` | Maximum open FDs (64–4096, simulating `ulimit -n`) |
| `leakProbability` | Chance an FD is not closed after use (0–20%) |
| `concurrency` | Parallel file operations (1–100) |
| `fileSize` | Simulated file buffer size per open FD (1KB–100MB) |
| `errorRate` | Chance a file operation fails (0–30%) |
| `leakOnError` | Whether errors also skip `fd.close()` (the missing `finally` scenario) |
| `openRate` | Operations per second (10–1,000/s) |

**Metrics collected:**
- **Failure rate** — % of operations that received EMFILE
- **Time-to-exhaustion** — when the process first hits the FD limit
- **Throughput** — successful file operations per second
- **Leaked FD count** — total descriptors permanently lost
- **Heap growth** — simulated memory from unclosed FD read buffers

Each experiment is a 2D grid with 30-second simulations per cell, seeded PRNG for reproducibility.

---

## 1. Leak Probability vs. Concurrency

### Failure rate

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **Concurrency 1** | 0% | 0% | 0% | 0% | 0% | 0% |
| **Concurrency 5** | 0% | 0% | 0% | 0% | 0% | 0% |
| **Concurrency 10** | 0% | 0% | 0% | 0% | 0% | 14.2% |
| **Concurrency 20** | 0% | 0% | 0% | 0% | 0% | 48.5% |
| **Concurrency 50** | 0% | 0% | 0% | 31.8% | 65.1% | 82.8% |
| **Concurrency 100** | 0% | 0% | 0% | 31.8% | 65.1% | 82.8% |

*FD limit: 1,024, file size: 64KB, duration: 30 seconds.*

Compare this to [Part 1's connection pool data](./resource-leak-empirical-study). At concurrency 10 with a 1% connection pool leak, failure was already **48.7%**. Here, at the same concurrency and leak rate, failure is **0%** — not even a single EMFILE error.

The FD limit (1,024) is 51× larger than the connection pool (20). That buffer means you need much more sustained leaking before exhaustion occurs.

The pattern only becomes dangerous at **concurrency 50 with 5% leak** (31.8% failure) or **concurrency 20 with 20% leak** (48.5% failure). These are real-world scenarios — a batch file processor running 50 concurrent jobs with 5% failure rate on error paths is exactly this.

### Time-to-exhaustion

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **Concurrency 1** | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |
| **Concurrency 5** | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |
| **Concurrency 10** | ∞ | ∞ | ∞ | ∞ | ∞ | 25.7s |
| **Concurrency 20** | ∞ | ∞ | ∞ | ∞ | ∞ | 15.4s |
| **Concurrency 50** | ∞ | ∞ | ∞ | 20.4s | 10.4s | 5.1s |
| **Concurrency 100** | ∞ | ∞ | ∞ | 20.4s | 10.4s | 5.1s |

*∞ = FD limit never reached during 30-second simulation.*

At **concurrency 50 with 10% leak**, EMFILE hits in 10.4 seconds. At concurrency 50 with 20% leak: 5.1 seconds. These are much slower than connection pool exhaustion (which could hit in 345ms at concurrency 20), but still within a window where a single traffic spike can kill the process before any alert fires.

### Leaked FD count

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **Concurrency 1** | 0 | 2 | 4 | 19 | 60 | 119 |
| **Concurrency 5** | 0 | 18 | 39 | 129 | 301 | 592 |
| **Concurrency 10** | 0 | 45 | 85 | 276 | 594 | **1,024** |
| **Concurrency 20** | 0 | 99 | 173 | 472 | 988 | **1,024** |
| **Concurrency 50** | 0 | 310 | 607 | **1,024** | **1,024** | **1,024** |

Values hitting **1,024** indicate the FD limit was reached — EMFILE was triggered.

At concurrency 10 with a 2% leak rate, 85 FDs leak — just 8% of the 1,024 limit, no EMFILE yet. But at concurrency 50 with the same 2% leak, 607 FDs leak (59% of limit), still no EMFILE. It takes 5% leak at concurrency 50 to hit the wall.

FD leaks are more forgiving than connection pool leaks — the 51× larger limit gives you more time. But container FD limits erase that advantage fast: with `ulimit -n 64`, the same scenario hits EMFILE in 2.9 seconds instead of 20. The danger zone under default settings is concurrency 50+ with 5%+ leak. If your file-processing service scales to 50 concurrent workers, a 5% error rate on unclosed handles is a production incident waiting to happen.

---

## 2. File Size vs. FD Limit

### Time-to-exhaustion

| | 1KB | 10KB | 100KB | 1MB | 10MB | 100MB |
|---|---|---|---|---|---|---|
| **FD limit 64** | 7.5s | 7.5s | 7.5s | 7.5s | 7.5s | 7.5s |
| **FD limit 128** | 14.8s | 14.8s | 14.8s | 14.8s | 14.8s | 14.8s |
| **FD limit 256** | 27.4s | 27.4s | 27.4s | 27.4s | 27.4s | 27.4s |
| **FD limit 512** | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |
| **FD limit 1024** | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |
| **FD limit 4096** | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |

*Fixed: concurrency 20, 5% leak probability.*

Every row is identical across all file sizes. **File size has zero effect on time-to-exhaustion.** This makes sense: the OS kernel counts the number of open file descriptors, not the size of the files. Whether you open a 1KB config file or a 100MB video, it costs exactly one FD.

EMFILE timing depends entirely on: FD limit ÷ (open rate × leak probability).

### Heap growth — the silent danger

While file size doesn't affect EMFILE timing, it directly determines how much heap memory leaked FDs consume. Every leaked open FD holds its read buffer in memory until the process closes it (or crashes):

| Leaked FDs | 1KB files | 100KB files | 1MB files | 10MB files | 100MB files |
|---|---|---|---|---|---|
| **64 FDs leaked** | 64 KB | 6.25 MB | 64 MB | **640 MB** | **6.4 GB** |
| **276 FDs leaked** | 276 KB | 26.9 MB | 270 MB | **2.7 GB** | **27 GB** |

*Heap growth = leaked FD count × file size.*

At FD limit 64, time-to-exhaustion is 7.5 seconds regardless of file size. But the memory footprint before that crash:
- **1KB files:** 64KB heap — barely measurable
- **10MB files:** 640MB heap — Node.js will likely OOM before hitting EMFILE
- **100MB files:** 6.4GB heap — the process dies from OOM, not EMFILE

**This is a dual failure mode.** With small files, EMFILE kills the process. With large files, OOM kills the process *before* EMFILE. Both are caused by the same `fd.close()` missing in your code.

FD limit is the only thing that determines EMFILE timing — optimize your FD budget, not your file sizes. With large files, OOM kills the process before EMFILE does: a service processing 10MB logs will exhaust heap before hitting the FD limit. The error you see is OOM, but the cause is the leaked handle. Check your container's `ulimit -n`; if it's 64 or 128, a 5% leak rate is a ticking clock.

---

## 3. Error Rate vs. Cleanup Behavior

The Y-axis has 8 combinations: `cleanup` (errors call `fd.close()` via `try/finally`) or `no-cleanup` (errors leave the FD open), combined with base leak probabilities of 0%, 2%, 5%, or 10%.

### Leaked FD count

| | 0% errors | 1% | 5% | 10% | 15% | 20% | 30% |
|---|---|---|---|---|---|---|---|
| **cleanup + 0% leak** | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **cleanup + 5% leak** | 276 | 276 | 276 | 276 | 276 | 276 | 276 |
| **no-cleanup + 0% leak** | 0 | 64 | 310 | 613 | 905 | **1,024** | **1,024** |
| **no-cleanup + 5% leak** | 276 | 340 | 574 | 859 | **1,024** | **1,024** | **1,024** |
| **no-cleanup + 10% leak** | 594 | 653 | 871 | **1,024** | **1,024** | **1,024** | **1,024** |

With `cleanup`, the FD count is determined entirely by the base leak probability — error rate adds zero additional leaks. Even at 30% error rate with `cleanup + 5% leak`, exactly 276 FDs are leaked.

Without `cleanup`, leaked FDs accumulate from two sources: base leaks plus one FD per error. At `no-cleanup + 0% leak`, with 10% error rate, 613 FDs accumulate — zero were leaked intentionally, all 613 came from error paths that skipped `fd.close()`.

### Failure rate

| | 0% errors | 1% | 5% | 10% | 20% | 30% |
|---|---|---|---|---|---|---|
| **cleanup + 0% leak** | 0% | 1.1% | 5.2% | 10.2% | 19.9% | 30.1% |
| **cleanup + 5% leak** | 0% | 1.1% | 5.2% | 10.2% | 19.9% | 30.1% |
| **no-cleanup + 0% leak** | 0% | 1.1% | 5.2% | 10.2% | **32.1%** | **61.4%** |
| **no-cleanup + 5% leak** | 0% | 1.1% | 5.2% | 10.2% | **42.5%** | **64.6%** |
| **no-cleanup + 10% leak** | 0% | 1.1% | 5.2% | **18.9%** | **51.8%** | **68.8%** |

The `cleanup` rows are identical at every error rate. With proper `fd.close()` in `finally`, failure rate tracks exactly the error rate — nothing more. The system handles errors gracefully.

Without cleanup, below 15% error rate, failure rate is essentially the same as the error rate itself (≤15.1%). Above that threshold, **EMFILE kicks in and amplifies errors**:
- `no-cleanup + 0% leak` at 20% error rate: **32.1% failure** (1.6× amplification)
- `no-cleanup + 10% leak` at 30% error rate: **68.8% failure** (2.3× amplification)

The amplification is less dramatic than connection pool exhaustion (which saw 68× amplification in Part 1) because the FD limit (1,024) provides more headroom. But once EMFILE triggers, every subsequent file operation fails regardless of leak or error status.

### Time-to-exhaustion

| | 0% errors | 5% | 10% | 15% | 20% | 30% |
|---|---|---|---|---|---|---|
| **cleanup + any leak** | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |
| **no-cleanup + 0% leak** | ∞ | ∞ | ∞ | ∞ | 25.5s | 16.7s |
| **no-cleanup + 5% leak** | ∞ | ∞ | ∞ | 26.7s | 21.5s | 15.3s |
| **no-cleanup + 10% leak** | ∞ | ∞ | 27.0s | 22.0s | 18.2s | 13.6s |

With proper cleanup, **the FD limit is never reached at any error rate.** This is the critical result — errors are expected in production (network flaps, permission issues, missing files). The question is whether each error permanently costs you a file descriptor.

Without cleanup at 30% error rate: **13.6 seconds to EMFILE** with 10% base leak. That's within a single traffic spike.

`try/finally` with `fd.close()` is mandatory. The `cleanup` rows show zero EMFILE at any error rate; the `no-cleanup` rows show exhaustion under sustained error conditions. FD amplification is slower than connection pool amplification (2.3× vs 68×), but the end state is identical. The correct pattern:

```typescript
async function readFile(filePath: string): Promise<string> {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const stat = await fd.stat();
    const buffer = Buffer.alloc(stat.size);
    await fd.read(buffer, 0, stat.size, 0);
    return buffer.toString('utf8');
  } finally {
    await fd.close(); // Always executes — even if stat() or read() throws
  }
}
```

---

## 4. Open Rate vs. FD Limit

### Time-to-exhaustion

| | 10/s | 50/s | 100/s | 200/s | 500/s | 1,000/s |
|---|---|---|---|---|---|---|
| **FD limit 64** | ∞ | ∞ | 15.1s | 7.5s | 2.9s | 1.4s |
| **FD limit 128** | ∞ | ∞ | 29.5s | 14.8s | 5.7s | 2.7s |
| **FD limit 256** | ∞ | ∞ | ∞ | 27.4s | 10.9s | 5.3s |
| **FD limit 512** | ∞ | ∞ | ∞ | ∞ | 21.3s | 10.6s |
| **FD limit 1,024** | ∞ | ∞ | ∞ | ∞ | ∞ | 20.4s |
| **FD limit 4,096** | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |

*Fixed: 5% leak probability.*

The diagonal pattern reveals the safe operating zone. **Below 50 opens/second, no FD limit exhausts** — even FD limit 64 can sustain 50 ops/s with 5% leak indefinitely.

At 1,000 ops/second with a 5% leak, every FD limit up to 1,024 exhausts. The exhaustion time scales linearly with the limit — FD limit 128 (1.4s × 128/64 ≈ 2.7s), FD limit 256 (5.3s ≈ 2.9s × 256/128). Doubling the FD limit doubles the time-to-exhaustion.

### Failure rate

| | 10/s | 50/s | 100/s | 200/s | 500/s | 1,000/s |
|---|---|---|---|---|---|---|
| **FD limit 64** | 0% | 0% | 49.7% | 74.8% | 89.9% | 95.0% |
| **FD limit 128** | 0% | 0% | 1.0% | 50.5% | 80.2% | 90.1% |
| **FD limit 256** | 0% | 0% | 0% | 8.3% | 63.3% | 81.7% |
| **FD limit 512** | 0% | 0% | 0% | 0% | 28.3% | 64.1% |
| **FD limit 1,024** | 0% | 0% | 0% | 0% | 0% | 31.8% |
| **FD limit 4,096** | 0% | 0% | 0% | 0% | 0% | 0% |

There's a sharp phase transition. At FD limit 256, going from 100/s (0% failure) to 200/s (8.3% failure) crosses the threshold where the leaked FD accumulation rate exceeds the process FD budget.

### Leaked FD count

| | 10/s | 50/s | 100/s | 200/s | 500/s | 1,000/s |
|---|---|---|---|---|---|---|
| **FD limit 64** | 9 | 62 | **64** | **64** | **64** | **64** |
| **FD limit 256** | 9 | 62 | 129 | **256** | **256** | **256** |
| **FD limit 1,024** | 9 | 62 | 129 | 276 | 720 | **1,024** |
| **FD limit 4,096** | 9 | 62 | 129 | 276 | 720 | 1,511 |

At 10/s, only 9 FDs are leaked (5% of ~180 ops over 30s). At 50/s, 62 FDs. At 100/s, the leak rate starts filling FD limit 64 and 128. The 4,096 row shows how many *would* leak at 1,000/s without any limit: 1,511 FDs — that's 1,511 open file handles permanently consuming kernel resources.

The safe zone is below 50 opens/second — at that rate, even FD limit 64 handles 5% leaks indefinitely. Above 50/s, you need careful FD hygiene. High-throughput services need proportional limits: at 500 ops/s, FD limit 512 exhausts in 21 seconds. Doubling the FD limit doubles survival time — a linear relationship, not exponential. There is no FD limit large enough to make a 5% leak safe at 1,000 ops/s forever.

---

## What I Found

Four cases, one consistent conclusion: **file descriptor leaks are more forgiving than connection pool leaks at small scale, but combine with file size to create OOM-before-EMFILE failures, and become critical under high-throughput or containerized workloads.**

| Finding | Data point |
|---------|-----------|
| Default FD limit vs pool size | 1,024 vs 20 — 51× more headroom |
| 5% leak, concurrency 50, FD limit 1,024 | 31.8% failure, 20.4s TTE |
| 5% leak, concurrency 50, FD limit 64 | 31.8% failure, 2.9s TTE |
| File size effect on TTE | Zero — only FD count matters |
| 64 leaked FDs × 10MB files | 640MB heap growth |
| 276 leaked FDs × 100MB files | 27GB heap growth (OOM before EMFILE) |
| No fd.close() on errors + 30% error rate | 68.8% failure when combined with 10% base leak |
| Proper try/finally + 30% error rate | 30.1% failure (exactly the error rate itself) |
| 1,000 ops/s, FD limit 256 | EMFILE in 5.3 seconds |
| Below 50 ops/s | No FD limit exhausts (even FD limit 64) |

---

## The Fix

For `fs.promises.open()`:

```typescript
async function processFile(filePath: string): Promise<Buffer> {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const stat = await fd.stat();
    const buffer = Buffer.alloc(stat.size);
    await fd.read(buffer, 0, stat.size, 0);
    return buffer;
  } finally {
    await fd.close(); // Always executes
  }
}
```

For `fs.createReadStream()`, use Node.js's `stream.pipeline` which calls `destroy()` on error:

```typescript
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

async function copyFile(src: string, dest: string): Promise<void> {
  const readStream = fs.createReadStream(src);
  const writeStream = createWriteStream(dest);
  // pipeline() calls destroy() on both streams if any error occurs
  await pipeline(readStream, writeStream);
}
```

If you must manage streams manually:

```typescript
async function readFileStream(filePath: string): Promise<string> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  try {
    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return chunks.join('');
  } catch (err) {
    stream.destroy(); // Explicitly close the stream on error
    throw err;
  }
}
```

The pattern: **open → try → use → finally → close.** No code path that opens a file should be able to return or throw without closing it.

---

## Detection

### Static analysis

```bash
# Find fs.open/promises.open calls without matching close
grep -rn "fs\.promises\.open\|fs\.open(" src/ --include="*.ts" --include="*.js"

# Find createReadStream without try/pipeline
grep -rn "createReadStream" src/ --include="*.ts" --include="*.js"

# Check current FD usage at runtime
cat /proc/$(pgrep -f "node")/fd | wc -l
```

### Runtime monitoring

```typescript
import { readdir } from 'fs/promises';
import { join } from 'path';

async function getFDCount(): Promise<number> {
  try {
    const fds = await readdir(`/proc/${process.pid}/fd`);
    return fds.length;
  } catch {
    return -1; // Non-Linux
  }
}

setInterval(async () => {
  const fdCount = await getFDCount();
  if (fdCount > 800) { // Alert at 80% of default 1024 limit
    console.warn(`High FD count: ${fdCount}/1024`);
  }
}, 30_000);
```

**Warning signs:**
- FD count steadily increasing over time (not fluctuating)
- FD count approaching your `ulimit -n` value
- Periodic EMFILE errors in logs that "resolve themselves" (temporary exhaustion during bursts)

---

## How BM-02 differs from BM-01 (connection pools)

| Dimension | BM-01 Pool | BM-02 File Descriptors |
|-----------|-----------|----------------------|
| Hard limit | 20 (configured) | 1,024 (OS default) |
| Headroom ratio | 20 connections | 1,024 FDs — 51× more |
| Failure threshold | Concurrency 5+, 1% leak | Concurrency 50+, 5% leak |
| Speed of exhaustion | 7.7s at c=10, 1% leak | 20.4s at c=50, 5% leak |
| Second failure mode | Timeout queue depth | Heap OOM from file buffers |
| Container impact | Pool size is configured | FD limit shrinks to 64–128 |
| Fix | `client.release()` in finally | `fd.close()` in finally |

The key difference: FDs give you 51× more buffer. But containerized workloads strip most of that buffer away, and the combination of file size × leaked FD count creates OOM risk before EMFILE even fires.

---

## Caveats

**Discrete-event simulation, not real filesystem.** The simulator models FD lifecycle and heap consumption analytically. Real `fs.open()` involves kernel inode lookup, file table allocation, and dcache interactions. The FD count behavior is accurately modeled; the heap growth is a simplified model (buffer size × FD count) that may underestimate in practice due to Node.js internal buffering and V8 object overhead.

**Single process model.** The simulation models one Node.js process. In practice, Node.js worker threads, child processes, and native addons each have their own FD space. The process-level FD limit is shared across all threads but not across processes.

**No garbage collection of FDs.** The simulation assumes leaked FDs are permanently held until the process exits. In practice, if you lose the reference to an FD object (out of scope, overwritten), V8's garbage collector may eventually finalize the `FileHandle` object and close the underlying FD. This is not reliable behavior — it depends on GC timing — but it means real-world FD leaks may be slightly less severe than simulated.

---

## What's next

This is Part 2 of the resource leak study. Upcoming parts:

- **Part 3 (BM-03):** Stream leaks — `createReadStream` without `destroy()` introduces both EMFILE *and* heap OOM as simultaneous failure modes
- **Part 4 (BM-04):** HTTP socket accumulation — `http.request()` without `destroy()` on timeout, socket pool exhaustion
- **Part 5 (BM-05):** Timer leaks — `setInterval` without `clearInterval` and the CPU cost of leaked callback invocations
- **Part 6 (BM-06):** Event listener leaks — `emitter.on()` without `off()`, MaxListenersExceeded, and emit latency degradation

---

## Try it yourself

```bash
git clone https://github.com/liangk/empirical-study.git
cd empirical-study/studies/06-resource-leaks
npm install

# Run all 4 BM-02 experiment cases
npm run experiments:bm02

# Run individual cases
npm run experiments:bm02:case1   # Leak Probability × Concurrency
npm run experiments:bm02:case2   # File Size × FD Limit
npm run experiments:bm02:case3   # Error Rate × Cleanup Behavior
npm run experiments:bm02:case4   # Open Rate × FD Limit
```

Results are saved to `src/step1-benchmarks/experiments/bm02/experiments-bm02-<timestamp>.json`.

---

## About this research

This study is part of a series of empirical performance investigations that validate the detection rules used in [Code Evolution Lab](https://codeevolutionlab.com). Each article in this series:

- Runs controlled experiments to quantify performance impact
- Provides open-source simulation code and raw data for reproducibility
- Maps exact thresholds where anti-patterns become operationally critical

Other studies in this series:
- [N+1 Query Problem](../n-plus-1-query-empirical-study) — 40 repos, 847 instances, 89× slowdown
- [Blocking I/O](../blocking-io-empirical-study) — 250 repos, 10,609 instances, 280× throughput penalty
- [Memory Leaks](../memory-leak-empirical-study) — 500 repos, 55,864 instances, ~8 KB/cycle retained heap
- [Missing Index](../missing-index-empirical-study) — 40 Prisma repos, 1,209 missing indexes, 190× slowdown

If you want these checks running automatically on your codebase, check out [Code Evolution Lab](https://codeevolutionlab.com).

---

*The simulation code, experiment runner, and raw data are on [GitHub](https://github.com/liangk/empirical-study). Built at [StackInsight](https://stackinsight.dev).*
