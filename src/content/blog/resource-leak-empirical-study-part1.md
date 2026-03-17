---
title: "Connection Pool Exhaustion: A Five-Case Simulation Study of How 1% Leak Rates Kill Production Node.js Services"
pubDate: "2026-03-16"
heroImage: "../../assets/resource-leak-empirical-study-part1.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "We built a discrete-event connection pool simulator and ran five two-dimensional parameter grid experiments to measure how leak probability, concurrency, query time, pool size, burst patterns, error handling, and DB connection limits interact to cause production failures. A 1% leak rate at concurrency 10 causes 49% request failure. Without error-path cleanup, a 1% error rate exhausts a 20-connection pool in 3.4 seconds. This is Part 1 of our resource leak study, focusing on BM-01: database connection pool exhaustion."
excerpt: "A 1% connection leak rate sounds harmless. At concurrency 10, it causes 49% of requests to fail. At concurrency 20, 69%. We simulated five scenarios to map the exact thresholds where small leaks become production outages."
lastmod: "2026-03-16"
canonical_url: "https://stackinsight.dev/blog/resource-leak-empirical-study-part1"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - connection pool exhaustion nodejs
  - database connection leak
  - pool.connect without release
  - connection pool timeout
  - nodejs connection pool best practices
  - database connection leak detection
  - connection pool size tuning
  - pg pool exhaustion
  - knex pool exhaustion
  - typeorm connection leak
  - prisma connection pool timeout
  - nodejs resource leak simulation
  - connection pool monitoring
  - database connection limit
  - try finally connection release
  - connection leak error handling
  - pool exhaustion time to failure
  - nodejs database performance
  - connection pool burst traffic
  - acquire timeout connection pool

# AIEO (AI Engine Optimization)
ai_summary: "This empirical study uses a discrete-event connection pool simulator with seeded PRNG to run five two-dimensional parameter grid experiments measuring how connection leaks cause production failures. Case 1 (Leak Probability × Concurrency): A 1% leak rate at concurrency 10 causes 49% failure rate and pool exhaustion in 7.7 seconds; at concurrency 20, 69% failure in 345ms. Case 2 (Query Time × Pool Size): With 5% leak probability, a pool of 5 connections has 96.8% failure rate regardless of query time; pool of 100 still has 62.8% failure. Query time only matters above 500ms. Case 3 (Burst Size × Acquire Timeout): Failure rate depends on burst size, not timeout; but p95 latency scales dramatically with timeout — burst 20 + 5000ms timeout = 4060ms p95 latency. Case 4 (Error Rate × Leak-on-Error): With proper error cleanup, a 30% error rate still achieves 140 req/s throughput; without cleanup, the same error rate drops throughput to 0.87 req/s and exhausts the pool in 155ms. Case 5 (Leak Probability × DB Max Connections): A 200-connection pool with 5% leak survives 19.9 seconds; a 20-connection pool with the same leak exhausts in 1.5 seconds. Larger pools delay but never prevent exhaustion. All simulations use 30-second duration, pool sizes 5-200, and deterministic seeded random number generation for reproducibility."
ai_key_facts:
  - "1% connection leak rate at concurrency 10 causes 49% request failure rate"
  - "1% leak at concurrency 20 causes 69% failure rate with pool exhaustion in 345ms"
  - "At concurrency 50+, even 0% leak rate shows 60% failure when pool size is 20 (pool undersized)"
  - "With 5% leak probability, pool size 5 has 96.8% failure rate regardless of query time (5-1000ms)"
  - "Query time only affects failure rate above 500ms; below that, leak rate dominates"
  - "Burst size determines failure rate, not acquire timeout; timeout only affects latency"
  - "Burst 50 + 5000ms timeout = 4854ms p95 latency vs 59ms with burst 1"
  - "With proper error-path cleanup (try/finally), 0% connection leaks at ANY error rate"
  - "Without error cleanup, 1% error rate exhausts 20-connection pool in 3.4 seconds"
  - "Without error cleanup at 30% error rate: throughput drops from 200 to 0.87 req/s"
  - "200-connection pool with 5% leak survives 19.9s; 20-connection pool exhausts in 1.5s"
  - "Larger DB connection pools delay exhaustion but never prevent it — only fixing the leak does"
ai_entities:
  - "Node.js"
  - "Connection Pool"
  - "PostgreSQL"
  - "pg (node-postgres)"
  - "Knex.js"
  - "TypeORM"
  - "Prisma"
  - "Discrete-Event Simulation"
  - "Pool Exhaustion"
  - "Acquire Timeout"
  - "try/finally"
  - "Error Handling"
  - "Concurrency"
  - "Throughput"
  - "Time-to-Failure"
  - "Code Evolution Lab"

# Structured Data (Article Schema)
schema_type: "TechArticle"
schema_proficiency_level: "Advanced"
schema_dependencies: "Node.js v18+, TypeScript 5+, ts-node"
schema_time_required: "PT25M"

# Taxonomy
categories:
  - "Backend Performance"
  - "Software Engineering Research"
  - "Node.js"
tags:
  - nodejs
  - connection-pool
  - resource-leaks
  - database
  - performance
  - typescript
  - benchmarking
  - simulation
  - empirical-study
  - pool-exhaustion
  - error-handling
  - concurrency
  - postgresql
  - try-finally
  - acquire-timeout

# Related
related_posts:
  - "memory-leak-empirical-study"
  - "missing-index-empirical-study"
  - "blocking-io-empirical-study"
series: "Backend Performance Empirical Studies"
series_order: 6
---

# Connection Pool Exhaustion: How a 1% Leak Rate Kills Production Services

You've written the code a thousand times:

```typescript
const client = await pool.connect();
const result = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
client.release();
return result.rows[0];
```

It works. Tests pass. Code review approves. Production deploys. Then three weeks later, at 2 AM, the on-call gets paged: **"Connection pool exhausted — all requests timing out."**

The cause is almost always the same. Somewhere in the codebase, a `pool.connect()` doesn't have a matching `client.release()`. Not in the happy path — that's tested. In the error path. A query throws, the function returns early, and the connection stays checked out forever. Each leaked connection is invisible until the pool is full. Then every subsequent request hangs waiting for a connection that will never be returned.

I wanted to know exactly when "a small leak" becomes "production outage." Not in theory — with actual numbers. At what concurrency does a 1% leak rate matter? How fast does a 20-connection pool exhaust? Does a larger pool actually help, or does it just delay the inevitable?

So I built a discrete-event connection pool simulator and ran five two-dimensional parameter experiments. Each experiment varies two parameters across a grid — leak probability × concurrency, query time × pool size, burst size × acquire timeout, error rate × cleanup behavior, and leak probability × DB connection limit — and measures failure rate, time-to-exhaustion, throughput, and latency across every combination.

The results are more precise than I expected. Here's exactly where each parameter combination crosses the line from "fine" to "outage."

With a 20-connection pool and 1% leak rate, the service fails within 7.7 seconds at concurrency 10. At concurrency 20, it fails in 345 milliseconds. A 200-connection pool buys you 25 seconds — same destination. With proper `try/finally` cleanup, throughput holds at 140 req/s even at 30% error rate. Without cleanup at the same error rate: 0.87 req/s.

---

## The Pattern

Before the data, one clarification. A "1% leak rate" does not mean the runtime randomly fails to close connections. If your code has a `try/finally` block with `client.release()`, it will always release. Zero exceptions.

The leak rate models **code paths where cleanup is missing.** In real-world applications, this happens through several mechanisms:

**Missing `finally` on error paths** — the most common cause:

```typescript
async function getUser(id: number) {
  const client = await pool.connect();
  const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);
  // If the query above throws (bad SQL, timeout, constraint violation),
  // this line never executes:
  client.release();
  return result.rows[0];
}
```

If this query fails 5% of the time — due to timeouts, lock contention, or bad input — you have a 5% connection leak rate.

**Conditional early returns:**

```typescript
async function getActiveUser(id: number) {
  const client = await pool.connect();
  const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);
  if (!result.rows[0]?.isActive) {
    return null; // Connection leaked — release never called
  }
  client.release();
  return result.rows[0];
}
```

**Unhandled promise rejections:**

Complex async chains where an exception prevents cleanup from executing.

```typescript
async function processUserData(userId: number) {
  const client = await pool.connect();
  
  // Complex async chain
  const userData = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
  const enrichedData = await enrichWithExternalAPI(userData.rows[0]);
  
  // If enrichWithExternalAPI throws, client.release() never runs
  // Connection leaked — no error handler, no finally block
  
  client.release();
  return enrichedData;
}
```

**Lost references in promise chains:**

The connection variable goes out of scope before cleanup executes in callback-based code.

```typescript
function fetchAndProcess(id: number) {
  pool.connect().then(client => {
    return client.query('SELECT * FROM orders WHERE id = $1', [id])
      .then(result => {
        // Process result, but if this throws...
        const processed = complexTransform(result.rows);
        client.release(); // ...this never executes
        return processed;
      });
    // Missing .catch() — rejection leaves connection dangling
  });
}
```

In a service handling 1,000 requests per second, a code path that leaks on 1% of requests leaks 10 connections per second. A 20-connection pool is exhausted in 2 seconds.

---

## The Simulation

I built a configurable discrete-event pool simulator that models connection acquire, query execution, release, leak, error, and timeout behavior. No real async delays — the simulator advances a virtual clock, making each experiment complete in seconds while modeling 30 seconds of simulated workload.

**Key parameters:**

| Parameter | What it controls |
|-----------|-----------------|
| `maxConnections` | Pool size limit (5–200) |
| `acquireTimeoutMs` | How long a request waits for a connection before failing (50–5000ms) |
| `queryTimeMs` | Average query execution time (5–1000ms) |
| `leakProbability` | Chance a connection is not released after use (0–20%) |
| `concurrency` | Arrival rate / parallelism level (1–100) |
| `burstSize` | Requests arriving simultaneously (1–50) |
| `errorRate` | Chance a query fails (0–30%) |
| `leakOnError` | Whether errors also leak the connection (the missing `finally` scenario) |

**Metrics collected per simulation:**
- **Failure rate** — % of requests that couldn't acquire a connection
- **Time-to-exhaustion** — when the pool first hits 100% utilization with no returns
- **Throughput** — successful requests per second
- **Leaked connections** — total connections permanently lost
- **p95 latency** — 95th percentile end-to-end request time
- **Peak active connections** — high-water mark

Each experiment runs a 2D grid (6×6 to 8×7 cells), with a 30-second simulation per cell, seeded PRNG for full reproducibility. All code and data are open source.

---

## 1. Leak Probability vs. Concurrency

### Failure rate

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **Concurrency 1** | 0% | 0% | 0% | 0% | 67.8% | 77.8% |
| **Concurrency 5** | 0% | 9.8% | 49.0% | 79.7% | 93.6% | 95.6% |
| **Concurrency 10** | 0% | 48.7% | 74.5% | 89.9% | 96.8% | 97.8% |
| **Concurrency 20** | 0% | 68.8% | 84.7% | 93.9% | 98.1% | 98.7% |
| **Concurrency 50** | 60.4% | 89.6% | 94.9% | 98.0% | 99.4% | 99.6% |
| **Concurrency 100** | 60.4% | 89.6% | 94.9% | 98.0% | 99.4% | 99.6% |

*Pool size: 20, query time: 50ms, duration: 30 seconds.*

Read that table carefully. At **concurrency 1 with a 1% leak**, failure rate is 0% — the pool has 20 connections and only 1 is in use at a time, so leaking 1% of 1 connection over 30 seconds never fills the pool. The leak is completely invisible.

At **concurrency 10 with the same 1% leak**, failure rate jumps to **48.7%**. Nearly half of all requests fail. The system went from "works perfectly" to "half-broken" without changing a single line of code — only the traffic level changed.

At **concurrency 20 with 1% leak**, it's **68.8% failure**. Two thirds of requests can't get a connection.

**The concurrency 50/100 rows are identical** — at that concurrency, the pool (size 20) is undersized even without leaks. The 60.4% failure at 0% leak tells you the pool can't keep up with the arrival rate. Leaks make it worse, but the bottleneck is pool size.

### Time-to-exhaustion

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **Concurrency 1** | ∞ | ∞ | ∞ | 28.6s | 8.7s | 6.2s |
| **Concurrency 5** | ∞ | 19.3s | 11.3s | 5.3s | 1.4s | 1.2s |
| **Concurrency 10** | ∞ | 7.7s | 4.5s | 1.5s | 535ms | 420ms |
| **Concurrency 20** | 345ms | 345ms | 132ms | 132ms | 108ms | 87ms |
| **Concurrency 50** | 19ms | 19ms | 19ms | 19ms | 19ms | 19ms |
| **Concurrency 100** | 19ms | 19ms | 19ms | 19ms | 19ms | 19ms |

*∞ = pool never fully exhausted during 30-second simulation.*

At **concurrency 10 with 1% leak**, the pool exhausts in **7.7 seconds**. That's not a slow degradation — that's a hard failure within the first few seconds of a traffic spike.

At **concurrency 20 even with 0% leak**, the pool exhausts in 345ms — the pool is simply too small for 20 concurrent requests with 50ms query time. But notice: at concurrency 5 with 0% leak, the pool never exhausts. Add a 1% leak and it exhausts in 19.3 seconds.

### Throughput

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **Concurrency 1** | 20 | 20 | 20 | 20 | 6.4 | 4.4 |
| **Concurrency 5** | 100 | 90 | 51 | 20 | 6.4 | 4.4 |
| **Concurrency 10** | 200 | 103 | 51 | 20 | 6.4 | 4.4 |
| **Concurrency 20** | 333 | 104 | 51 | 20 | 6.4 | 4.4 |
| **Concurrency 50** | 397 | 104 | 51 | 20 | 6.4 | 4.4 |

*Successful requests per second.*

At concurrency 10 with 0% leak: 200 req/s. With 1% leak: 103 req/s. **A 1% leak cuts throughput in half.** At 2% leak: 51 req/s — a 75% throughput drop. At 5% and above, throughput collapses to 20 req/s or less regardless of concurrency.

**The throughput convergence is striking.** At 10% or 20% leak, every concurrency level produces the same ~6.4 req/s. Once the pool is exhausted, it doesn't matter how many requests are arriving — only the trickle of connections that occasionally get released (by the non-leaking 80-90% of requests) determines throughput. The pool becomes the single bottleneck.

At low concurrency, leaks are invisible. Concurrency 1 with 5% leak shows 0% failure and 20 req/s — looks fine in development and staging. But the same 5% leak at concurrency 10 causes 89.9% failure. Traffic spikes don't just slow down a leaking service; they kill it. 1% is not negligible.

---

## 2. Query Time vs. Pool Size

### Throughput (req/s)

| | 5ms | 20ms | 50ms | 100ms | 200ms | 500ms | 1000ms |
|---|---|---|---|---|---|---|---|
| **Pool 5** | 6.4 | 6.4 | 6.4 | 6.4 | 6.4 | 5.7 | 4.1 |
| **Pool 10** | 12.6 | 12.6 | 12.6 | 12.6 | 12.6 | 10.1 | 7.4 |
| **Pool 20** | 20.3 | 20.3 | 20.3 | 20.3 | 20.3 | 19.6 | 14.2 |
| **Pool 50** | 38.3 | 38.3 | 38.3 | 38.3 | 38.3 | 36.5 | 30.7 |
| **Pool 100** | 74.5 | 74.5 | 74.5 | 74.5 | 74.5 | 70.0 | 57.7 |

*Fixed: 5% leak probability, concurrency 20, 30-second simulation.*

Two clear patterns emerge:

**Query time doesn't matter below 200ms.** With a 5% leak rate, the pool exhausts so quickly that whether each query takes 5ms or 200ms makes no difference — the leaked connections dominate. The pool fills up with leaked connections before query duration becomes relevant.

**Above 500ms, query time compounds with leaks.** At pool size 100, throughput drops from 74.5 at 200ms to 57.7 at 1000ms. Long queries hold connections longer, reducing the effective pool even for non-leaking requests.

### Failure rate

| | 5ms | 20ms | 50ms | 100ms | 200ms | 500ms | 1000ms |
|---|---|---|---|---|---|---|---|
| **Pool 5** | 96.8% | 96.8% | 96.8% | 96.8% | 96.8% | 97.2% | 98.0% |
| **Pool 10** | 93.7% | 93.7% | 93.7% | 93.7% | 93.7% | 95.0% | 96.3% |
| **Pool 20** | 89.9% | 89.9% | 89.9% | 89.9% | 89.9% | 90.2% | 92.9% |
| **Pool 50** | 80.9% | 80.9% | 80.9% | 80.9% | 80.9% | 81.8% | 84.7% |
| **Pool 100** | 62.8% | 62.8% | 62.8% | 62.8% | 62.8% | 65.0% | 71.1% |

Even with **100 connections and fast 5ms queries**, a 5% leak rate produces **62.8% failure**. Doubling the pool from 50 to 100 only reduces failure from 80.9% to 62.8%. You cannot pool-size your way out of a leak.

### Mean latency (ms)

| | 5ms | 50ms | 100ms | 500ms | 1000ms |
|---|---|---|---|---|---|
| **Pool 5** | 5.0 | 105.1 | 137.8 | 512.1 | 1012.0 |
| **Pool 20** | 5.0 | 69.6 | 166.0 | 527.7 | 1015.2 |
| **Pool 100** | 5.0 | 57.0 | 106.7 | 573.8 | 1075.7 |

Mean latency scales linearly with query time — as expected, since successful requests complete in approximately the query duration. Larger pools show slightly *higher* latency at long query times because more connections remain available, allowing more requests to proceed (and wait).

Pool size buys linear improvement, not exponential relief. Going from 5 to 100 connections reduces failure from 96.8% to 62.8% — still catastrophic. Fast queries don't save you: at 5% leak, failure rate is identical from 5ms to 200ms. The leak rate dominates. Query time only matters above 500ms with pools of 100+, a narrow range most production services never reach.

---

## 3. Burst Size vs. Acquire Timeout

### p95 latency (ms)

| | Burst 1 | Burst 5 | Burst 10 | Burst 20 | Burst 30 | Burst 50 |
|---|---|---|---|---|---|---|
| **Timeout 50ms** | 59 | 59 | 59 | 59 | 59 | 59 |
| **Timeout 100ms** | 59 | 59 | 59 | 59 | 59 | 59 |
| **Timeout 500ms** | 59 | 60 | 450 | 458 | 459 | 459 |
| **Timeout 1000ms** | 59 | 60 | 845 | 858 | 859 | 859 |
| **Timeout 2000ms** | 59 | 60 | 1,052 | 1,856 | 1,858 | 1,858 |
| **Timeout 5000ms** | 59 | 60 | 1,052 | 4,060 | 4,850 | 4,854 |

*Pool size: 20, 5% leak rate, bursts every 200ms.*

This table reveals a critical trade-off between **fail-fast** and **wait-and-hope**.

With a **50ms timeout**, p95 latency stays at 59ms regardless of burst size. Requests that can't get a connection fail immediately — the user gets a quick error rather than a slow one.

With a **5000ms timeout** and burst size 50, p95 latency hits **4,854ms** — almost 5 seconds. The requests aren't failing; they're waiting in the queue for connections that will never be returned (because they're leaked). The user sees a spinner for 5 seconds before getting the same failure.

### Failure rate

| | Burst 1 | Burst 5 | Burst 10 | Burst 20 | Burst 30 | Burst 50 |
|---|---|---|---|---|---|---|
| **All timeouts** | 79.7% | 18.9% | 59.5% | 79.7% | 86.5% | 91.9% |

**Failure rate is identical across all timeout values** — timeout doesn't prevent failures, it only delays them. Whether you wait 50ms or 5000ms, the same requests eventually fail because the pool is exhausted by leaks.

The burst size 5 anomaly (18.9% vs 79.7% at burst 1) deserves explanation: with 5 requests every 200ms, the effective arrival rate gives the pool more time between bursts to recycle non-leaked connections. At burst 1 with 5% leak probability, the steady stream quickly fills the pool. At burst 5, the interleaved idle periods allow some connections to be released.

Acquire timeout is a latency dial, not a reliability dial. It changes when failures happen, not whether they happen. A 50ms timeout returns an error in 59ms. A 5000ms timeout returns the same error in 4,854ms — the user waited 80× longer for the identical outcome. Set acquire timeout to 2–3× your expected query time and don't expect it to rescue you from a leaking pool.

---

## 4. Error Rate vs. Cleanup Behavior

### The setup

The Y-axis has 8 combinations: `cleanup` (errors release the connection via `try/finally`) or `no-cleanup` (errors leave the connection checked out), combined with a base leak probability of 0%, 2%, 5%, or 10%.

### Failure rate

| | 0% err | 1% err | 5% err | 10% err | 15% err | 20% err | 30% err |
|---|---|---|---|---|---|---|---|
| **cleanup + 0% leak** | 0% | 1.1% | 5.2% | 10.2% | 15.1% | 19.9% | 30.1% |
| **cleanup + 5% leak** | 89.9% | 90.0% | 90.4% | 90.8% | 91.4% | 92.0% | 93.2% |
| **no-cleanup + 0% leak** | 0% | 68.5% | 95.1% | 97.1% | 98.2% | 98.9% | 99.6% |
| **no-cleanup + 5% leak** | 89.9% | 91.4% | 96.5% | 97.4% | 98.3% | 98.9% | 99.6% |

*Pool size: 20, concurrency: 20.*

The `cleanup + 0% leak` row is the proof that **proper error handling eliminates pool exhaustion entirely**. Even at 30% error rate — nearly one in three queries failing — the failure rate is exactly 30.1%. That's just the errors themselves. No cascade, no pool exhaustion, no secondary failures. Every connection is returned after use, regardless of whether the query succeeded or failed.

Now compare the `no-cleanup + 0% leak` row. At 0% error rate: 0% failure, everything's perfect. At just 1% error rate: **68.5% failure**. One percent of queries fail, and because each failure leaks a connection, the pool exhausts rapidly, causing 68.5% of *all* requests to fail — not just the 1% with errors.

**That's a 68× amplification.** A 1% error rate becomes a 68.5% failure rate because of missing cleanup.

### Time-to-exhaustion

| | 0% err | 1% err | 5% err | 10% err | 20% err | 30% err |
|---|---|---|---|---|---|---|
| **cleanup + 0% leak** | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |
| **no-cleanup + 0% leak** | ∞ | 3,365ms | 765ms | 440ms | 260ms | 155ms |
| **no-cleanup + 5% leak** | 1,520ms | 1,290ms | 535ms | 385ms | 260ms | 155ms |

With proper cleanup and no base leak: **the pool never exhausts, regardless of error rate.** The `cleanup + 0% leak` row shows ∞ at every error rate. This is the correct behavior — errors are expected, connections are always returned.

Without cleanup at 1% error rate: exhaustion in **3.4 seconds**. At 30% error rate: **155 milliseconds**. The pool is dead before the first monitoring alert could fire.

### Throughput (req/s)

| | 0% err | 1% err | 5% err | 10% err | 20% err | 30% err |
|---|---|---|---|---|---|---|
| **cleanup + 0% leak** | 200 | 198 | 190 | 180 | 160 | 140 |
| **no-cleanup + 0% leak** | 200 | 63 | 9.7 | 5.8 | 2.2 | 0.87 |

With cleanup: throughput degrades gracefully with error rate. At 30% errors, you still serve 140 req/s — the errors reduce throughput proportionally, but the pool stays healthy.

Without cleanup: throughput cliff-edges. At 1% errors: 63 req/s (68% drop). At 5% errors: 9.7 req/s (95% drop). At 30% errors: **0.87 req/s**. Effectively dead.

This is the most important result in the study. `try/finally` is not a best practice — it's a survival requirement. The difference between cleanup and no-cleanup is the difference between "service handles errors gracefully" and "service is dead in 3 seconds." A 1% error rate without cleanup amplifies to 68× more failures, because each error permanently claims a connection. The fix:

```typescript
async function getUser(id: number) {
  const client = await pool.connect();
  try {
    return await client.query('SELECT * FROM users WHERE id = $1', [id]);
  } finally {
    client.release(); // Always executes, even if query throws
  }
}
```

---

## 5. Leak Probability vs. DB Connection Limit

### Time-to-exhaustion

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **5 conns** | 20ms | 20ms | 20ms | 20ms | 20ms | 20ms |
| **10 conns** | 45ms | 45ms | 45ms | 45ms | 45ms | 45ms |
| **20 conns** | ∞ | 7.7s | 4.5s | 1.5s | 535ms | 420ms |
| **50 conns** | ∞ | 25.5s | 13.3s | 4.6s | 2.2s | 1.2s |
| **100 conns** | ∞ | ∞ | ∞ | 9.8s | 4.3s | 2.4s |
| **200 conns** | ∞ | ∞ | ∞ | 19.9s | 9.7s | 4.5s |

*Concurrency: 20, query time: 50ms.*

The small pools (5, 10) exhaust immediately at any leak rate — they're undersized for concurrency 20 even without leaks.

For the interesting range (20–200 connections):

**A 200-connection pool with 1% leak never exhausts in 30 seconds.** The leak rate is slow enough that the 30-second simulation ends before enough connections accumulate. But that doesn't mean safety — it means the exhaustion happens in minutes instead of seconds.

**At 5% leak, pool size buys proportional time.** Pool 20: 1.5s. Pool 50: 4.6s. Pool 100: 9.8s. Pool 200: 19.9s. Roughly linear — doubling the pool doubles the time-to-exhaustion, but the destination is the same.

### Failure rate

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **20 conns** | 0% | 48.7% | 74.5% | 89.9% | 96.8% | 97.8% |
| **50 conns** | 0% | 4.5% | 41.5% | 80.9% | 91.4% | 94.9% |
| **100 conns** | 0% | 0% | 0% | 62.8% | 83.7% | 91.5% |
| **200 conns** | 0% | 0% | 0% | 30.5% | 66.5% | 83.6% |

At 0% leak: all pool sizes above the concurrency threshold work perfectly. At 5% leak: even 200 connections show 30.5% failure. At 20% leak: 200 connections show 83.6% failure — only marginally better than 20 connections at 97.8%.

### Throughput (req/s)

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **20 conns** | 200 | 103 | 51 | 20 | 6.4 | 4.4 |
| **50 conns** | 200 | 191 | 117 | 38 | 17 | 10 |
| **100 conns** | 200 | 200 | 200 | 75 | 33 | 17 |
| **200 conns** | 200 | 200 | 200 | 139 | 67 | 33 |

At 0% leak, every pool delivers full 200 req/s throughput. The moment leaks start, throughput degrades — more pool buys more throughput, but with steep diminishing returns.

**The 200-connection pool at 5% leak: 139 req/s.** That's 30% throughput loss despite having 10× the connections needed for the workload. You're burning 200 database connections — potentially the entire shared budget for multiple services — and still losing a third of your traffic.

Larger pools delay exhaustion linearly: doubling pool size doubles time-to-exhaustion. It's a timer, not a fix. In shared environments, one leaking service starves the rest — a 5% leak on 200 allocated connections exhausts them in 20 seconds, impacting every other service sharing that PostgreSQL instance. Counterintuitively, small pools may be better: a 20-connection pool failing in 7.7 seconds triggers alerts immediately, while a 200-connection pool leaks silently for 25+ seconds before anyone notices.

---

## What I Found

Five cases, one consistent conclusion: **connection leaks interact multiplicatively with workload parameters, and the only reliable mitigation is eliminating the leak.**

| Finding | Data point |
|---------|-----------|
| 1% leak at concurrency 10 | 48.7% failure rate |
| 1% leak at concurrency 20 | 68.8% failure rate |
| 5% leak with pool 100 | 62.8% failure (pool size doesn't help) |
| Missing error cleanup + 1% errors | 68.5% failure (68× amplification) |
| Missing error cleanup + 30% errors | 99.6% failure, 0.87 req/s |
| Proper error cleanup + 30% errors | 30.1% failure (only the errors themselves), 140 req/s |
| 200-conn pool with 5% leak | Exhausts in 19.9 seconds (delays, doesn't prevent) |
| Burst 50 + 5s timeout | 4,854ms p95 latency (same failure rate as 50ms timeout) |

---

## The Fix

Every case in this study points to the same solution. For `pg` (node-postgres):

```typescript
async function query(sql: string, params: any[]) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}
```

For Knex:

```typescript
const result = await knex.transaction(async (trx) => {
  return trx('users').where({ id }).first();
});
// Knex automatically releases on transaction commit/rollback
```

For Prisma:

```typescript
// Prisma manages its own connection pool — but if you're using $queryRaw
// with manual connection handling, the same try/finally applies
const result = await prisma.$transaction(async (tx) => {
  return tx.user.findUnique({ where: { id } });
});
```

For TypeORM:

```typescript
const queryRunner = dataSource.createQueryRunner();
await queryRunner.connect();
try {
  return await queryRunner.query('SELECT * FROM users WHERE id = $1', [id]);
} finally {
  await queryRunner.release();
}
```

The pattern is universal: **acquire → try → use → finally → release.** No exceptions. Every code path that touches `pool.connect()`, `createQueryRunner()`, or any manual connection acquisition must have a `finally` block.

---

## Detection

### Static analysis

Search for connection acquisition without `finally`:

```bash
# Find pool.connect() calls — then check each for try/finally
grep -rn "pool\.connect\(\)" src/ --include="*.ts" --include="*.js"
grep -rn "getConnection\(\)" src/ --include="*.ts" --include="*.js"
grep -rn "createQueryRunner\(\)" src/ --include="*.ts" --include="*.js"
```

For comprehensive detection, [Code Evolution Lab](https://codeevolutionlab.com) uses Babel AST analysis to match `connect()`/`acquire()` calls against `release()`/`close()` in the same scope, with severity classification.

### Runtime monitoring

Add pool metrics to your monitoring:

```typescript
// pg pool monitoring
setInterval(() => {
  console.log({
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  });
}, 10_000);
```

**Warning signs:**
- `totalCount` steadily increasing toward `max`
- `idleCount` decreasing toward 0
- `waitingCount` increasing over time

If `totalCount === max && idleCount === 0 && waitingCount > 0` for more than a few seconds, you have an active leak.

---

## Caveats

**Discrete-event simulation, not real database.** The simulator models connection lifecycle with virtual time. Real PostgreSQL connection pools have additional factors: TCP handshake overhead, prepared statement caching, connection validation (`SELECT 1` before checkout), idle connection reaping, and OS-level socket limits. These affect absolute numbers but not the qualitative patterns — the interaction between leak rate, concurrency, and pool size follows the same dynamics.

**Deterministic PRNG, single seed.** All simulations use seed 42 via a mulberry32 PRNG. Different seeds would produce slightly different numbers, but the patterns are robust to seed variation because the grid explores a wide parameter range. The trends (multiplicative interaction, linear pool-size scaling, cleanup-eliminates-exhaustion) hold across seeds.

**Steady-state arrival model.** Requests arrive at fixed intervals or in fixed-size bursts. Real production traffic has long-tail distributions, autocorrelation, and diurnal patterns. The simulation shows steady-state behavior; real systems would show more variance in time-to-exhaustion but the same failure modes.

**No connection validation or reaping.** Some pool implementations (HikariCP, pgBouncer) periodically validate idle connections and reap those that have been idle too long. This can partially mitigate leaks by reclaiming connections that were leaked but are no longer held by application code. The simulation assumes leaked connections are permanently lost — a worst-case model. In practice, connection reaping may extend time-to-exhaustion but cannot prevent it if the leak rate exceeds the reaping rate.

**BM-01 only.** This study covers database connection pool exhaustion. Resource leaks in file descriptors (BM-02), streams (BM-03), HTTP sockets (BM-04), timers (BM-05), and event listeners (BM-06) have different failure modes and thresholds. Those will be covered in subsequent parts of this series.

---

## What's next

This is Part 1 of the resource leak study, focused on connection pool exhaustion. Upcoming parts will cover:

- **Part 2 (BM-02):** File descriptor exhaustion — how many `fs.open()` without `close()` before EMFILE?
- **Part 3 (BM-03):** Stream leaks — `createReadStream` without `destroy()` on error paths
- **Part 4 (BM-04):** HTTP socket accumulation — `http.request()` without `destroy()` on timeout
- **Part 5 (BM-05):** Timer leaks — `setInterval` without `clearInterval` and closure-retained memory
- **Part 6 (BM-06):** Event listener leaks — `emitter.on()` without `off()` and MaxListenersExceeded

Each part will use the same two-dimensional experiment methodology to map the exact parameter thresholds where each leak type becomes operationally critical.

---

## Try it yourself

```bash
git clone https://github.com/liangk/empirical-study.git
cd empirical-study/studies/06-resource-leaks
npm install

# Run all 5 experiment cases
npm run experiments

# Run a single case
npm run experiments:case1   # Leak Probability × Concurrency
npm run experiments:case2   # Query Time × Pool Size
npm run experiments:case3   # Burst Size × Acquire Timeout
npm run experiments:case4   # Error Rate × Leak-on-Error
npm run experiments:case5   # Leak Probability × DB Max Connections
```

Results are saved to `results/experiments-<timestamp>.json` with full grid data for every metric.

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
- [Loop Performance](../loop-performance-empirical-study) — for...of vs forEach vs for(;;) across 6 engines
- [Missing Index](../missing-index-empirical-study) — 40 Prisma repos, 1,209 missing indexes, 190× slowdown

If you want these checks running automatically on your codebase, check out [Code Evolution Lab](https://codeevolutionlab.com).

---

*The simulation code, experiment runner, and raw data are on [GitHub](https://github.com/liangk/empirical-study). Built at [StackInsight](https://stackinsight.dev).*
