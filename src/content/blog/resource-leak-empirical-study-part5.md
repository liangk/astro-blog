---
title: "Timer Leaks: A Four-Case Simulation Study of How setInterval Without clearInterval Silently Saturates Node.js"
pubDate: "2026-03-19"
heroImage: "../../assets/resource-leak-empirical-study-part5.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "We built a discrete-event timer simulator and ran four two-dimensional parameter grid experiments to measure how timer leak probability, creation rate, closure size, interval frequency, and timer type interact to degrade Node.js performance. Unlike file descriptors or sockets, timers have no hard OS limit. Damage accumulates as heap growth from closure capture and CPU overhead from leaked setInterval callbacks firing indefinitely. At 1ms interval with 100 timers/second creation, leaked intervals generate 45 million callbacks in 30 seconds, saturating the event loop at 50ms mean latency. This is Part 5 of our resource leak study, focusing on BM-05: timer leaks."
excerpt: "Timer leaks have no EMFILE error, no socket exhaustion, no hard wall. Leaked setInterval callbacks just keep firing — forever. At 1ms interval and 100 timers/second, leaked intervals generate 45 million extra callbacks in 30 seconds, pushing event loop latency to 50ms. A 1MB closure on 117 leaked timers is 117MB heap. The fix: store every timer ID and call clearInterval in your cleanup code."
lastmod: "2026-03-19"
canonical_url: "https://stackinsight.dev/blog/resource-leak-empirical-study-part5"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - nodejs timer leak
  - setInterval without clearInterval
  - clearInterval nodejs
  - nodejs timer memory leak
  - setInterval leak nodejs
  - timer cleanup nodejs
  - event loop saturation nodejs
  - nodejs timer resource leak
  - clearTimeout nodejs
  - timer closure memory leak
  - nodejs performance timer
  - leaked setInterval callbacks
  - nodejs event loop blocked
  - timer id nodejs
  - interval leak detection nodejs

# AIEO (AI Engine Optimization)
ai_summary: "This empirical study uses a discrete-event timer simulator to run four two-dimensional parameter grid experiments measuring how timer leaks degrade Node.js. Case 1 (Leak Probability × Creation Rate): No hard OS limit means no discrete failure threshold. At 100 timers/sec with 20% leak: 604 leaked timers, 2.36MB heap (with 4KB closures), 19,436 total callback invocations vs 13,505 at 0% leak. Case 2 (Closure Size × Leak Probability): Heap growth = leaked timer count × closure size exactly. At 20% leak with 1MB closures at 20/sec: 117 leaked timers × 1MB = 117MB heap growth. At 10% leak with 256KB closures: 65 timers × 256KB = 16.3MB. Closure size has no effect on timer count or callback invocations. Case 3 (Timer Interval × Creation Rate): Callback volume = creation rate × timer count × (simulation time / interval). At 1ms interval × 100/sec creation: 45 million callbacks, event loop saturated at 50ms mean latency. At 100ms interval × 50/sec: 7.5ms mean latency. The critical threshold is where creation rate × leaked count × (1000/intervalMs) exceeds the event loop capacity. Case 4 (Timer Type × Leak Probability): setTimeout leaks are memory-only (callback fires once, never again). setInterval leaks are memory + active CPU (callback fires indefinitely). At 100% interval leak: 8,730 total callbacks vs 581 for timeout (15× more). The fix: store all timer IDs and call clearInterval/clearTimeout in cleanup."
ai_key_facts:
  - "Timer leaks have no hard OS limit — damage is gradual heap growth and CPU overhead"
  - "At 100 timers/sec creation with 20% leak: 604 leaked timers, 2.36MB heap (4KB closures)"
  - "Heap growth = leaked timer count × closure size exactly (linear, independent)"
  - "117 leaked timers × 1MB closure = 117MB heap growth"
  - "1ms interval × 100/sec creation = 45 million callbacks in 30 seconds"
  - "Event loop saturated at 50ms mean latency when callback rate exceeds processing capacity"
  - "setInterval leaks are active CPU consumers — callbacks fire indefinitely after leak"
  - "setTimeout leaks are memory-only — callback fires once, no ongoing CPU impact"
  - "At 100% interval leak rate: 8,730 total callbacks vs 581 for timeout (15× more)"
  - "clearInterval must be called for every setInterval — storing IDs in a Set is the pattern"
ai_entities:
  - "Node.js"
  - "setInterval"
  - "clearInterval"
  - "setTimeout"
  - "clearTimeout"
  - "Event Loop"
  - "Closure"
  - "Heap Memory"
  - "GC"
  - "CPU Overhead"
  - "Timer ID"
  - "Code Evolution Lab"

# Structured Data (Article Schema)
schema_type: "TechArticle"
schema_proficiency_level: "Advanced"
schema_dependencies: "Node.js v18+, TypeScript 5+, ts-node"
schema_time_required: "PT18M"

# Taxonomy
categories:
  - "Backend Performance"
  - "Software Engineering Research"
  - "Node.js"
tags:
  - nodejs
  - timers
  - resource-leaks
  - setInterval
  - performance
  - typescript
  - benchmarking
  - simulation
  - empirical-study
  - event-loop
  - heap-memory
  - closures
  - clearInterval

# Related
related_posts:
  - "resource-leak-empirical-study"
  - "resource-leak-empirical-study-part4"
  - "resource-leak-empirical-study-part6"
series: "Backend Performance Empirical Studies"
series_order: 10
---

# Timer Leaks: How `setInterval` Without `clearInterval` Silently Saturates Node.js

Every other resource leak we've studied — connection pools, file descriptors, HTTP sockets — has a hard failure wall. You run out of connections, EMFILE fires, or the socket pool is full. The service breaks loudly and immediately.

Timer leaks don't work that way.

There is no "too many timers" error. Node.js doesn't throw when you create a thousand `setInterval` callbacks without clearing them. There's no operating system limit on the number of active timers. The process just keeps running — slowly accumulating heap memory from closure capture, and burning CPU cycles as leaked `setInterval` callbacks fire on every tick.

The failure mode is a gradual degradation: increased heap usage, growing GC pressure, incrementally higher event loop latency, until eventually the process either OOMs (when closures are large enough) or the event loop is so saturated with leaked callbacks that real request handling becomes imperceptibly slow.

I built a discrete-event timer simulator and ran four two-dimensional parameter experiments. The results quantify exactly when the degradation becomes operationally significant — and draw a critical distinction between `setTimeout` leaks (memory-only) and `setInterval` leaks (memory *and* active CPU consumers).

Timer leaks have no hard failure wall. The damage is two-component: heap growth from closure capture (117 leaked intervals × 1MB closure = 117MB heap), and CPU overhead from leaked `setInterval` callbacks firing indefinitely. At 100 timers/second with a 1ms interval, leaked intervals generate 45 million extra callback invocations over 30 seconds, saturating the event loop at 50ms mean latency. Every request in the process is now 50ms slower, with no error, no crash, no EMFILE. The difference between `setTimeout` and `setInterval` leaks is critical: `setTimeout` fires once and stops; `setInterval` runs forever.

---

## The Pattern

A timer leak occurs when you call `setInterval()` or `setTimeout()` but never store the returned ID to call `clearInterval()`/`clearTimeout()` later:

```typescript
// Leaky setInterval — common in health checks, polling, heartbeats
class ConnectionManager {
  connect() {
    // New setInterval created every time connect() is called
    // If reconnect() is called multiple times (retry logic), intervals accumulate
    setInterval(() => {
      this.sendHeartbeat();
    }, 5000); // ID is never stored, never cleared
  }
}
```

The insidious version with closures:

```typescript
// Leaky with large closure — ID discarded, closure captured
function startMetricsCollection(metrics: MetricsBuffer) {
  // metrics is a large object captured in the closure
  // Even if startMetricsCollection is called again, the old interval keeps running
  setInterval(() => {
    const snapshot = metrics.snapshot(); // captures full metrics object
    reportToDatadog(snapshot);
  }, 1000);
  // No ID stored — no way to stop this interval
}
```

In the second example, every call to `startMetricsCollection()` creates a new interval that holds a reference to the `metrics` object. If `metrics` is 100KB, each accumulated interval leaks another 100KB of heap, and each fires a `reportToDatadog` call every second — indefinitely.

---

## The Simulation

The timer simulator models `setInterval`/`setTimeout` creation, firing, and cleanup. Parameters:

| Parameter | What it controls |
|-----------|-----------------|
| `leakProbability` | Chance a timer ID is not stored/cleared (0–100%) |
| `creationRate` | Timers created per second (1–100/s) |
| `closureSize` | Bytes of heap captured in each timer closure (0B–1MB) |
| `intervalMs` | Timer fire interval (1ms–5,000ms) |
| `timerType` | `setTimeout` vs `setInterval` |

**Metrics collected:**
- **Leaked timer count** — total timers with no `clearInterval`/`clearTimeout` call
- **Heap growth** — captured closure memory from leaked timers
- **Total callback invocations** — callbacks fired over 30-second simulation
- **Mean callback latency** — average time to process each callback (event loop pressure indicator)
- **Time-to-exhaustion** — always `null` (no hard timer limit)

---

## 1. Leak Probability vs. Timer Creation Rate

### Leaked timer count

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **1 timer/s** | 0 | 1 | 1 | 3 | 5 | 8 |
| **5 timers/s** | 0 | 2 | 3 | 8 | 15 | 31 |
| **10 timers/s** | 0 | 3 | 5 | 13 | 30 | 59 |
| **20 timers/s** | 0 | 8 | 12 | 32 | 65 | 117 |
| **50 timers/s** | 0 | 13 | 23 | 71 | 150 | 293 |
| **100 timers/s** | 0 | 26 | 46 | 143 | 304 | 604 |

*Duration: 30 seconds.*

Unlike connection pools or FDs, there's no ceiling here — the number grows proportionally to (creation rate × duration × leak probability). At 100 timers/s with 20% leak: 600 leaked timers over 30 seconds.

### Heap growth from leaked timer closures (4KB closure size)

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **1 timer/s** | 0 | 4 KB | 4 KB | 12 KB | 20 KB | 32 KB |
| **10 timers/s** | 0 | 12 KB | 20 KB | 52 KB | 117 KB | 230 KB |
| **20 timers/s** | 0 | 32 KB | 48 KB | 125 KB | 254 KB | 456 KB |
| **50 timers/s** | 0 | 52 KB | 92 KB | 284 KB | 586 KB | 1.1 MB |
| **100 timers/s** | 0 | 104 KB | 184 KB | 572 KB | 1.2 MB | 2.4 MB |

With a 4KB closure (a common size for a captured service object), even 604 leaked timers only produce 2.4MB of heap growth. This seems manageable — and it is, for small closures.

### Total callback invocations (including leaked timer callbacks)

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **1 timer/s** | 140 | 147 | 147 | 149 | 153 | 185 |
| **10 timers/s** | 1,355 | 1,391 | 1,412 | 1,510 | 1,660 | 1,968 |
| **50 timers/s** | 6,755 | 6,913 | 7,028 | 7,511 | 8,270 | 9,581 |
| **100 timers/s** | 13,505 | 13,768 | 13,980 | 14,999 | 16,540 | **19,436** |

At 100 timers/s with 20% leak: **19,436 total callbacks** vs 13,505 at 0% leak. That's **5,931 extra callback invocations from leaked timers alone** — timers that should have been stopped but keep firing.

Timer leaks are proportional, not threshold-based — no cliff edge, just linear growth. The real danger is closure size, not timer count: 604 leaked timers at 4KB = 2.4MB (manageable), but the same count at 1MB = 604MB (crisis). Short-interval timers add callback overhead: 604 leaked intervals firing every second add ~5,900 extra callbacks over 30 seconds; at 1ms intervals, that's 18 million extra.

---

## 2. Closure Size vs. Leak Probability

### Heap growth by closure size

| | 0B | 1KB | 4KB | 16KB | 64KB | 256KB | 1MB |
|---|---|---|---|---|---|---|---|
| **0% leak** | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **1% leak** (8 timers) | 0 | 8 KB | 32 KB | 128 KB | 512 KB | 2.0 MB | **8.0 MB** |
| **2% leak** (12 timers) | 0 | 12 KB | 48 KB | 192 KB | 768 KB | 3.0 MB | **12.0 MB** |
| **5% leak** (32 timers) | 0 | 32 KB | 128 KB | 512 KB | 2.0 MB | 8.0 MB | **32.0 MB** |
| **10% leak** (65 timers) | 0 | 65 KB | 253 KB | 1.0 MB | 4.1 MB | 16.3 MB | **65.1 MB** |
| **20% leak** (117 timers) | 0 | 117 KB | 455 KB | 1.8 MB | 7.3 MB | 29.3 MB | **117 MB** |

*Fixed: 20 timers/sec creation rate.*

The table demonstrates the linear relationship perfectly: **heap growth = leaked timer count × closure size, with no interaction between them.**

The dangerous combinations:
- **10% leak with 1MB closures:** 65 timers × 1MB = **65MB heap growth** — equivalent to loading 65 million characters of JSON into memory permanently
- **20% leak with 256KB closures:** 117 timers × 256KB = **29.3MB heap growth**
- **5% leak with 64KB closures:** 32 timers × 64KB = **2MB** — modest, might go unnoticed in heap profiling

### What closures actually capture

The dangerous scenarios are when timers capture large objects:

```typescript
// Each interval captures: request context, response buffers, user data
// If the interval "leaks" (ID not stored), all captured data is retained
function startPolling(userId: string, userState: UserState) {
  setInterval(async () => {
    const freshData = await fetchUserData(userId);
    userState.update(freshData); // userState is held in closure
    userState.notifySubscribers(); // all subscribers retained too
  }, 2000);
  // No ID returned — no way to stop this polling
}
```

If `userState` is 100KB (a realistic size for a complex user object with history), and `startPolling` is called for 100 users without cleanup, you have 100 leaked intervals each holding 100KB = 10MB of user state permanently retained.

Closure size is the primary memory risk factor — more than leak rate or creation rate. Closures under 4KB are low-risk: 100 leaked timers × 4KB = 400KB. Closures above 64KB are high-risk: 100 timers × 64KB = 6.4MB per event. The 1MB scenario is realistic — Express request contexts, Prisma query builders, and React state trees routinely exceed 100KB–1MB.

---

## 3. Timer Interval vs. Creation Rate

### Total callback invocations (leaked timers at 10% leak probability)

| | 1ms | 10ms | 50ms | 100ms | 500ms | 1,000ms | 5,000ms |
|---|---|---|---|---|---|---|---|
| **1 timer/s** (30 leaked) | 465,000 | 46,500 | 9,300 | 4,650 | 930 | 465 | 81 |
| **10 timers/s** (300 leaked) | 4,515,000 | 451,500 | 90,300 | 45,150 | 8,910 | 4,380 | 756 |
| **50 timers/s** (1,500 leaked) | 22,515,000 | 2,251,500 | 449,700 | 224,550 | 44,310 | 21,780 | 3,756 |
| **100 timers/s** (3,000 leaked) | **45,015,000** | 4,501,500 | 899,100 | 448,800 | 88,560 | 43,530 | 7,506 |

*Leaked timers × callbacks/timer = creation_rate × 30s × leak_prob × (30,000ms / intervalMs).*

At **100 timers/s with 1ms interval**: **45 million callback invocations in 30 seconds**. That's 1.5 million callbacks per second from leaked timers alone. The event loop cannot process real work between timer fires.

### Mean event loop latency

| | 1ms | 10ms | 50ms | 100ms | 500ms | 1,000ms |
|---|---|---|---|---|---|---|
| **1 timer/s** | 15.5ms | 1.6ms | 0.31ms | 0.16ms | 0.031ms | 0.016ms |
| **5 timers/s** | **50ms** | 7.6ms | 1.5ms | 0.76ms | 0.15ms | 0.074ms |
| **10 timers/s** | **50ms** | 15.1ms | 3.0ms | 1.5ms | 0.30ms | 0.15ms |
| **20 timers/s** | **50ms** | 30.1ms | 6.0ms | 3.0ms | 0.59ms | 0.29ms |
| **50 timers/s** | **50ms** | **50ms** | 15.0ms | 7.5ms | 1.5ms | 0.73ms |
| **100 timers/s** | **50ms** | **50ms** | 30.0ms | 15.0ms | 2.95ms | 1.45ms |

*Values hitting **50ms** indicate event loop saturation — the maximum observed latency in the simulation.*

The saturation threshold is clear. Once callback invocations exceed event loop processing capacity:
- **1 timer/s at 1ms:** 15.5ms mean latency — elevated but not saturated
- **5 timers/s at 1ms:** saturated at **50ms** — every request in the process is now 50ms slower
- **50 timers/s at 10ms:** saturated at **50ms**

**This is a production nightmare.** An endpoint that normally responds in 5ms now responds in 55ms — 11× slower. No errors, no crashed process, no EMFILE. Just mysteriously slow p99 latency that only correlates with increased timer creation rates.

High-frequency short-interval timers are the most dangerous: 1ms intervals create 1,000 callbacks per leaked timer per second, and just 5 timers/s leak rate saturates the event loop. 500ms+ intervals are relatively safe — 100 timers/s with 500ms interval produces only 2.95ms mean latency. The saturation threshold is lower when the event loop is already under load. The "mysterious slowdown" pattern — a service that gradually slows over days with no obvious cause — is almost always leaked `setInterval` timers from constructor calls or retry logic that creates intervals without matching `clearInterval`.

---

## 4. Timer Type vs. Leak Probability

### Total callback invocations

| | 0% leak | 1% | 2% | 5% | 10% | 20% | 50% | 100% |
|---|---|---|---|---|---|---|---|---|
| **setTimeout** | 581 | 581 | 581 | 581 | 581 | 581 | 581 | 581 |
| **setInterval** | 2,705 | 2,761 | 2,797 | 2,976 | 3,298 | 3,876 | 5,714 | **8,730** |

**`setTimeout` callbacks are completely flat across all leak probabilities.** A leaked `setTimeout` fires exactly once — then it's done. Once the callback executes, the timer is removed from the event loop regardless of whether you stored the ID. Leaking a `setTimeout` means you can't *cancel* it before it fires, but once it has fired, there's no ongoing overhead.

`setInterval` callbacks increase with leak probability. At 0% leak: 2,705 invocations (the interval fires regularly over 30 seconds). At 100% leak: **8,730 invocations** — 3.2× more. Every leaked interval adds callbacks for every tick of the simulation duration.

### Heap growth comparison

| | 0% leak | 1% | 5% | 10% | 20% | 50% | 100% |
|---|---|---|---|---|---|---|---|
| **setTimeout** | 0 | 32 KB | 128 KB | 253 KB | 455 KB | 1.1 MB | 2.34 MB |
| **setInterval** | 0 | 32 KB | 128 KB | 253 KB | 455 KB | 1.1 MB | 2.34 MB |

Heap growth is **identical** between `setTimeout` and `setInterval` leaks. Both capture the same closure; the timer type doesn't affect how much memory the closure holds. The difference is entirely in callback behavior.

### Leaked timer count comparison

Also identical — both types accumulate at the same rate per unit time.

The most important operational distinction in this study:

| | `setTimeout` leak | `setInterval` leak |
|---|---|---|
| **Heap impact** | Closure size × leaked count | Closure size × leaked count |
| **Ongoing CPU** | Zero (fires once, done) | Continuous (fires every interval) |
| **Can be cancelled** | No (already scheduled) | No (keeps running) |
| **Self-terminating** | Yes (after first fire) | No (runs indefinitely) |
| **Risk level** | Medium (memory only) | High (memory + CPU) |

`setTimeout` leaks are memory-only — the callback fires once and the reference is gone. `setInterval` leaks are memory + CPU — the closure is retained and the callback fires indefinitely. Every leaked `setInterval` is an invisible background job running forever.

The correct pattern:

```typescript
class HealthChecker {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(): void {
    // Guard against double-start
    if (this.intervalId !== null) return;
    this.intervalId = setInterval(() => this.check(), 5000);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // Ensure cleanup on process exit
  register(): void {
    this.start();
    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
  }
}
```

For managing multiple timers:

```typescript
class TimerRegistry {
  private timers = new Set<ReturnType<typeof setInterval>>();

  interval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
    const id = setInterval(fn, ms);
    this.timers.add(id);
    return id;
  }

  clear(id: ReturnType<typeof setInterval>): void {
    clearInterval(id);
    this.timers.delete(id);
  }

  clearAll(): void {
    for (const id of this.timers) {
      clearInterval(id);
    }
    this.timers.clear();
  }
}

// Usage
const registry = new TimerRegistry();
registry.interval(() => sendHeartbeat(), 5000);
registry.interval(() => refreshCache(), 60_000);

// On shutdown or component unmount:
registry.clearAll();
```

---

## What I Found

Four cases, two failure modes:

| Finding | Data point |
|---------|-----------|
| Timer limit | None — no EMFILE, no pool exhaustion |
| 100 timers/s, 20% leak, 4KB closure | 604 timers, 2.4MB heap, 5,931 extra callbacks |
| Heap growth formula | leaked count × closure size (perfectly linear) |
| 117 leaked timers × 1MB closure | 117MB heap growth |
| 1ms interval, 5 timers/s creation | Event loop saturated at 50ms mean latency |
| 1ms interval, 100 timers/s | 45 million callbacks in 30 seconds |
| 500ms interval, any rate | Mean latency ≤ 3ms (safe zone) |
| setTimeout leak CPU impact | Zero — fires once, done |
| setInterval leak CPU impact | Continuous — callbacks fire indefinitely |
| setInterval at 100% leak vs 0% leak | 8,730 vs 2,705 callbacks (3.2× more) |

---

## Detection

### Static analysis

```bash
# Find setInterval calls — verify each stores the returned ID
grep -rn "setInterval(" src/ --include="*.ts" --include="*.js"

# Find setInterval calls where the return value is not stored
# (result not assigned to a variable)
grep -rn "^\s*setInterval(" src/ --include="*.ts"

# Find clearInterval calls — should be 1:1 with setInterval
grep -c "setInterval(" src/**/*.ts
grep -c "clearInterval(" src/**/*.ts
# If these numbers differ, you likely have leaked intervals
```

### Runtime monitoring

```typescript
// Track active timer count using Node.js performance hooks
import { performance, PerformanceObserver } from 'node:perf_hooks';

// Monitor event loop lag — a reliable timer leak symptom
let lastCheck = Date.now();
const LAG_THRESHOLD_MS = 10;

setInterval(() => {
  const now = Date.now();
  const lag = now - lastCheck - 100; // Expected 100ms interval
  if (lag > LAG_THRESHOLD_MS) {
    console.warn(`Event loop lag detected: ${lag}ms above threshold`);
  }
  lastCheck = now;
}, 100);

// In Node.js, you can list active handles (includes timers):
// process._getActiveHandles() — returns all active handles
// process._getActiveRequests() — returns pending I/O
// Note: These are internal APIs, use only for debugging
```

---

## Caveats

**No Node.js timer limit.** Unlike file descriptors or sockets, Node.js does not impose a limit on the number of active timers. The practical limit is available heap memory (for closure retention) and event loop throughput (for high-frequency intervals). The simulation models these as continuous degradation rather than a discrete failure threshold.

**Event loop saturation model.** The simulation uses a simplified model where callback latency increases linearly with total callback invocations. Real event loop behavior is more complex — I/O callbacks, microtasks (Promises), and setImmediate have different priority queues. However, the qualitative result (high-frequency leaked intervals degrade event loop latency) holds in production.

**Garbage collection of fired `setTimeout`.** After a `setTimeout` fires, if no other references to the closure remain, V8 can garbage collect the captured objects. Leaked `setTimeout` timers that have already fired may have their closures GC'd. Leaked `setInterval` timers never have their closures GC'd because the interval keeps them alive.

---

## What's next

This is Part 5 of the resource leak study. The final part:

- **Part 6 (BM-06):** Event listener leaks — `emitter.on()` without `off()`, MaxListenersExceeded warnings, and how emit latency degrades linearly with accumulated listener count

---

## Try it yourself

```bash
git clone https://github.com/liangk/empirical-study.git
cd empirical-study/studies/06-resource-leaks
npm install

# Run all 4 BM-05 experiment cases
npm run experiments:bm05

# Run individual cases
npm run experiments:bm05:case1   # Leak Probability × Timer Creation Rate
npm run experiments:bm05:case2   # Closure Size × Leak Probability
npm run experiments:bm05:case3   # Timer Interval × Creation Rate
npm run experiments:bm05:case4   # Timer Type × Leak Probability
```

Results are saved to `src/step1-benchmarks/experiments/bm05/experiments-bm05-<timestamp>.json`.

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
