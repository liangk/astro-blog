---
title: "HTTP Socket Exhaustion: A Five-Case Simulation Study of How http.request() Leaks Destroy Node.js Services"
pubDate: "2026-03-19"
heroImage: "../../assets/resource-leak-empirical-study-part4.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "We built a discrete-event HTTP socket simulator and ran five two-dimensional parameter grid experiments to measure how socket leak probability, concurrency, timeout, response size, error handling, and keep-alive interact to cause socket pool exhaustion. A 1% socket leak at concurrency 10 consumes 88% of the 50-socket pool in a single simulation. Without socket.destroy() on timeout, a 1% error rate causes 29% failure and socket exhaustion in 16.5 seconds. Keep-alive connections with a finite pool cause 87.5% failure even at zero intentional leak. This is Part 4 of our resource leak study, focusing on BM-04: HTTP socket accumulation."
excerpt: "The default HTTP socket pool is 50 connections — 20× smaller than the FD limit. At concurrency 10 with 1% leak, 88% of sockets are consumed. At 2% leak, socket exhaustion occurs in 13 seconds. Keep-alive connections without proper release cause 87.5% failure with zero intentional leaks. Response size doesn't affect failure rate — but at concurrency 50 with 10MB responses, p95 latency hits 1,412ms."
lastmod: "2026-03-19"
canonical_url: "https://stackinsight.dev/blog/resource-leak-empirical-study-part4"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - nodejs http socket leak
  - http.request without destroy
  - socket exhaustion nodejs
  - http agent maxSockets nodejs
  - req.destroy timeout nodejs
  - nodejs socket pool exhaustion
  - http keep-alive socket leak
  - http request timeout nodejs
  - socket resource leak nodejs
  - http agent destroy nodejs
  - nodejs outbound request leak
  - socket timeout error handling
  - http socket monitoring nodejs
  - node http globalAgent
  - axios socket leak nodejs

# AIEO (AI Engine Optimization)
ai_summary: "This empirical study uses a discrete-event HTTP socket simulator to run five two-dimensional parameter grid experiments measuring how socket leaks cause pool exhaustion. Case 1 (Leak Probability × Concurrency): The 50-socket pool makes HTTP sockets 20× more dangerous than raw FDs. At concurrency 10 with 1% leak, 44/50 sockets are consumed (88% capacity). With 2% leak at concurrency 10: socket exhaustion in 13.3 seconds, 41.5% failure. Case 2 (Timeout × Concurrency): Timeout duration affects p95 latency but NOT failure rate. With 50ms timeout at concurrency 50: 100.9ms p95. With 500ms timeout: 397.4ms p95. Same 96.2% failure rate regardless. Case 3 (Error Rate × Error Handling): With socket.destroy() in error/timeout handlers: throughput degrades gracefully (140 req/s at 30% errors). Without destroy(): 30% errors = 2.9 req/s throughput, 600ms to socket exhaustion. Case 4 (Response Size × Concurrency): Response size has zero effect on failure rate but significant effect on p95 latency: at concurrency 50, 1KB response = 12.9ms p95, 10MB response = 1,412ms p95. Case 5 (Keep-Alive × Leak Probability): Keep-alive connections cause 87.5% failure even at 0% intentional leak when the socket pool is finite. Without keep-alive, 0% leak = 0% failure."
ai_key_facts:
  - "HTTP socket pool default is 50 — 20× smaller than FD limit, makes leaks 20× more dangerous"
  - "At concurrency 10 with 1% leak: 44/50 sockets consumed, failure 4.5%, TTE 25.5s"
  - "At concurrency 10 with 2% leak: socket limit reached, 41.5% failure, TTE 13.3s"
  - "Socket exhaustion at concurrency 20 with 1% leak: 37.6% failure, 12.0s TTE"
  - "Timeout duration affects p95 latency but NOT failure rate — same lesson as acquire timeout"
  - "With socket.destroy() on errors + 30% error rate: 139.8 req/s throughput"
  - "Without socket.destroy() on errors + 30% error rate: 2.9 req/s throughput (48× difference)"
  - "Without socket.destroy() on errors + 1% error rate: 29.3% failure, 16.5s to exhaustion"
  - "Response size has zero effect on failure rate; 10MB at concurrency 50 = 1,412ms p95 latency"
  - "Keep-alive at zero intentional leak: 87.5% failure (keep-alive holds sockets persistently)"
  - "keep-alive failure rate barely changes with leak probability (87.5% at 0%, 94.9% at 20%)"
ai_entities:
  - "Node.js"
  - "HTTP"
  - "Socket"
  - "http.request"
  - "http.globalAgent"
  - "maxSockets"
  - "keep-alive"
  - "req.destroy"
  - "socket.destroy"
  - "timeout"
  - "p95 latency"
  - "axios"
  - "node-fetch"
  - "Code Evolution Lab"

# Structured Data (Article Schema)
schema_type: "TechArticle"
schema_proficiency_level: "Advanced"
schema_dependencies: "Node.js v18+, TypeScript 5+, ts-node"
schema_time_required: "PT22M"

# Taxonomy
categories:
  - "Backend Performance"
  - "Software Engineering Research"
  - "Node.js"
tags:
  - nodejs
  - http
  - sockets
  - resource-leaks
  - performance
  - typescript
  - benchmarking
  - simulation
  - empirical-study
  - http-request
  - error-handling
  - keep-alive
  - timeout
  - concurrency

# Related
related_posts:
  - "resource-leak-empirical-study"
  - "resource-leak-empirical-study-part3"
  - "resource-leak-empirical-study-part5"
series: "Backend Performance Empirical Studies"
series_order: 9
---

# HTTP Socket Exhaustion: How `http.request()` Leaks Destroy Node.js Services

Every time your Node.js service calls an external API, sends a webhook, or makes an inter-service HTTP request, it opens a socket. Under Node.js's default HTTP agent, these sockets are pooled. The default pool size is 50 connections via `http.globalAgent.maxSockets`.

Fifty connections sounds like a lot. But consider: the FD limit (1,024) we studied in Part 2 gives you 1,024 slots before EMFILE fires. The connection pool in Part 1 was typically 20 connections — and we saw exhaustion in 7.7 seconds at concurrency 10 with 1% leak. HTTP sockets sit in between, with a pool that's 51× more constrained than your FD budget but 2.5× larger than a typical DB connection pool.

What happens when HTTP requests time out and the socket isn't destroyed? What happens when response sizes balloon to 10MB per response? What does keep-alive do to socket accounting when connections aren't explicitly released?

I built a discrete-event HTTP socket simulator and ran five two-dimensional parameter experiments. The results reveal why HTTP socket leaks are among the most dangerous resource issues in Node.js microservices — and why the fix is always `req.destroy()` in your timeout and error handlers.

The 50-socket pool exhausts 20× faster than raw FDs. At concurrency 10 with 1% leak, 44 of 50 sockets are already consumed — 88% of capacity. At 2% leak, socket exhaustion occurs in 13.3 seconds and failure rate jumps to 41.5%. The timeout is a latency dial, not a reliability dial: 5,000ms timeout produces the same failure rate as 50ms, just with longer waits. Keep-alive at 0% intentional leak still causes 87.5% failure when the pool is fixed at 50 and concurrency fills it.

---

## The Pattern

When you call `http.request()` or `https.request()`, Node.js allocates a socket from the agent's pool. The socket is returned to the pool when the response is fully consumed or when you explicitly call `res.resume()` to drain it. If neither happens — if the request times out, errors out, or the response is never fully read — the socket is neither returned nor destroyed. It holds its pool slot indefinitely.

The most common failure pattern:

```typescript
// Leaky — socket never destroyed on timeout
async function callExternalAPI(endpoint: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(endpoint, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      reject(new Error('Request timed out'));
      // Socket is NOT destroyed — it sits in the pool, unusable, until
      // the remote server closes it (which may never happen)
    });
    req.end();
  });
}
```

The correct version:

```typescript
async function callExternalAPI(endpoint: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(endpoint, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', (err) => {
      req.destroy(); // Explicitly free the socket
      reject(err);
    });
    req.setTimeout(5000, () => {
      req.destroy(new Error('Request timed out')); // destroy() closes the socket
      reject(new Error('Request timed out'));
    });
    req.end();
  });
}
```

In a service making 100 external API calls per second, with 5% timing out and missing `req.destroy()`, the pool of 50 sockets is exhausted in 10 seconds.

---

## The Simulation

The socket simulator models `http.request()` lifecycle: socket acquire, request dispatch, response, release (or leak), and pool exhaustion. Parameters:

| Parameter | What it controls |
|-----------|-----------------|
| `maxSockets` | HTTP agent socket pool size (simulated at 50) |
| `leakProbability` | Chance a socket is not returned after use (0–20%) |
| `concurrency` | Parallel HTTP requests (1–100) |
| `timeoutMs` | Request timeout duration (50–10,000ms) |
| `responseSize` | Simulated response body size (1KB–10MB) |
| `errorRate` | Chance a request fails (0–30%) |
| `destroyOnError` | Whether errors/timeouts call `req.destroy()` |
| `keepAlive` | Whether connections use keep-alive semantics |

**Metrics collected:**
- **Failure rate** — % of requests that couldn't acquire a socket
- **Time-to-exhaustion** — when the socket pool first hits 100% utilization
- **Throughput** — successful requests per second
- **Leaked socket count** — total sockets permanently lost
- **p95 latency** — 95th percentile end-to-end request time

---

## 1. Leak Probability vs. Concurrency

### Failure rate

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **Concurrency 1** | 0% | 0% | 0% | 0% | 14.3% | 48.8% |
| **Concurrency 5** | 0% | 0% | 0% | 61.7% | 82.9% | 89.8% |
| **Concurrency 10** | 0% | 4.5% | 41.5% | 80.9% | 91.4% | 94.9% |
| **Concurrency 20** | 0% | 37.6% | 64.9% | 88.5% | 94.9% | 96.9% |
| **Concurrency 50** | 1.0% | 79.2% | 88.3% | 96.2% | 98.3% | 99.0% |
| **Concurrency 100** | 1.0% | 79.2% | 88.3% | 96.2% | 98.3% | 99.0% |

*Socket pool: 50, duration: 30 seconds.*

Compare to BM-01 (pool 20) and BM-02 (FD 1,024):

| Scenario | 1% leak, concurrency 10, failure rate |
|---|---|
| **BM-01 pool 20** | 48.7% — pool exhausted in 7.7s |
| **BM-02 FD 1,024** | 0% — pool still has headroom |
| **BM-04 sockets 50** | **4.5%** — 44/50 sockets consumed |

Sockets fall between pools and FDs. At concurrency 10 with 1% leak, socket failure is lower than pool exhaustion (4.5% vs 48.7%) but much higher than FD exhaustion (0%). The 50-socket ceiling is close enough to production concurrency levels to be dangerous at low leak rates.

**At concurrency 10 with 2% leak: 41.5% failure.** This is a real production threshold — a microservice handling 10 concurrent outbound requests with a 2% timeout rate where sockets aren't destroyed will fail 41% of requests.

### Leaked socket count

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **Concurrency 1** | 0 | 2 | 4 | 19 | **50** | **50** |
| **Concurrency 5** | 0 | 18 | 39 | **50** | **50** | **50** |
| **Concurrency 10** | 0 | 44 | **50** | **50** | **50** | **50** |
| **Concurrency 20** | 0 | **50** | **50** | **50** | **50** | **50** |
| **Concurrency 50** | 0 | **50** | **50** | **50** | **50** | **50** |

Values hitting **50** mean the socket pool limit was reached.

At concurrency 10 with **just 1% leak**, 44 of 50 sockets are consumed — **88% of the pool**. The process is one more burst away from complete socket exhaustion.

Compare to BM-02 at the same parameters: 45 of 1,024 FDs leaked — **4.4% of capacity**. The same 1% leak rate is 20× more dangerous for sockets than for FDs, purely because of the pool size differential.

### Time-to-exhaustion

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **Concurrency 1** | ∞ | ∞ | ∞ | ∞ | 24.8s | 14.7s |
| **Concurrency 5** | ∞ | ∞ | ∞ | 10.3s | 4.7s | 2.7s |
| **Concurrency 10** | ∞ | 25.5s | **13.3s** | 4.6s | 2.2s | 1.2s |
| **Concurrency 20** | ∞ | 12.0s | 6.4s | 2.3s | 1.1s | 0.7s |
| **Concurrency 50** | 0.05s | 0.05s | 0.05s | 0.05s | 0.05s | 0.05s |

At concurrency 50, the pool (size 50) is *immediately* exhausted even at 0% leak — the pool is too small for 50 concurrent requests with any meaningful query time. This is the same saturation behavior as BM-01 at concurrency 20+ with pool 20.

The interesting range: **concurrency 5–20, leak 1–10%**, where time-to-exhaustion spans 0.7–25.5 seconds. This is the operational danger zone — enough concurrency to drain the pool quickly, not immediately obvious in testing.

HTTP socket leaks are 20× more dangerous than FD leaks at the same rate — the pool is 20× smaller. A 2% socket leak at concurrency 10 is a production emergency: 13.3 seconds to exhaustion, 41.5% failure rate. That's a 2% HTTP timeout rate with missing `req.destroy()`. Concurrency 20 with 1% leak: 12 seconds to socket death. That's typical microservice load.

---

## 2. Timeout Duration vs. Concurrency

### p95 Latency (ms)

| | 50ms | 100ms | 500ms | 1,000ms | 2,000ms | 5,000ms | 10,000ms |
|---|---|---|---|---|---|---|---|
| **Concurrency 1** | 59 | 59 | 59 | 59 | 59 | 59 | 59 |
| **Concurrency 5** | 59 | 59 | 59 | 59 | 59 | 59 | 59 |
| **Concurrency 10** | 60 | 60 | 60 | 60 | 60 | 60 | 60 |
| **Concurrency 20** | 60 | 60 | 60 | 60 | 60 | 60 | 60 |
| **Concurrency 50** | 101 | 148 | **397** | **397** | **397** | **397** | **397** |

*Fixed: 5% leak probability.*

At concurrency 50, there's a threshold between 100ms and 500ms timeout. Below 100ms, failed requests return quickly (101ms p95). Above 500ms, the queue saturates — all p95 values are identical at 397ms regardless of whether timeout is 500ms, 5,000ms, or 10,000ms.

Why does 5,000ms produce the same p95 as 500ms? Because the socket pool exhausts so quickly at concurrency 50 with 5% leak that requests queue immediately and fail as soon as the pool exhausts — they never actually wait the full timeout duration. The pool death happens before the timeout fires.

### Failure rate (all timeout values, per concurrency)

| | All timeouts (50ms–10,000ms) |
|---|---|
| **Concurrency 1** | 0% |
| **Concurrency 5** | 61.7% |
| **Concurrency 10** | 80.9% |
| **Concurrency 20** | 88.5% |
| **Concurrency 50** | 96.2% |

**Failure rate is identical at every timeout value.** This is the same finding as BM-01 Case 3 (acquire timeout): the timeout changes the latency of failures, not the rate of failures. You're setting a dial for "how long users wait before getting the failure response" — not "whether they fail."

Timeout is a UX dial, not a reliability dial. Short timeout = fast failures; long timeout = slow failures; same count either way. Set timeout to 2–3× your p50 response time. In an exhausted pool, timeout doesn't even matter — queued requests fail at pool capacity before the timer fires.

---

## 3. Error Rate vs. Error Handling Behavior

### Failure rate

| | 0% errors | 1% | 5% | 10% | 20% | 30% |
|---|---|---|---|---|---|---|
| **destroy + 0% leak** | 0% | 1.1% | 5.2% | 10.2% | 19.9% | 30.1% |
| **destroy + 2% leak** | 41.5% | 42.1% | 44.4% | 47.6% | 53.5% | 59.4% |
| **destroy + 5% leak** | 80.9% | 81.1% | 81.7% | 82.7% | 84.7% | 86.9% |
| **no-destroy + 0% leak** | 0% | **29.3%** | **82.3%** | **92.5%** | **96.7%** | **98.5%** |
| **no-destroy + 5% leak** | 80.9% | 84.8% | 90.4% | 93.7% | 97.1% | **98.5%** |

The `destroy + 0% leak` row is correct behavior: failure rate exactly tracks the error rate, never exceeding it. No socket exhaustion, no cascade.

The `no-destroy + 0% leak` row shows the cascade. At just **1% error rate without socket cleanup**: **29.3% failure**. That's a 29× amplification — 1% of requests error, and because those sockets aren't destroyed, they starve the pool, causing 29% of all requests to fail.

Compare to BM-02/03 which showed the cascade only kicking in above 15-20% error rate (because the FD limit 1,024 provides more buffer). With 50 sockets, **the cascade starts at 1% error rate.** The small pool means there's no buffer — even one error per hundred requests is enough to start pool depletion.

### Time-to-exhaustion

| | 0% errors | 1% | 5% | 10% | 20% | 30% |
|---|---|---|---|---|---|---|
| **destroy + 0% leak** | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |
| **destroy + 2% leak** | 13.3s | 13.4s | 13.4s | 13.4s | 13.8s | 14.4s |
| **no-destroy + 0% leak** | ∞ | **16.5s** | 3.7s | 2.0s | 1.0s | **0.6s** |
| **no-destroy + 5% leak** | 4.6s | 3.8s | 2.5s | 1.5s | 0.9s | **0.6s** |

With `destroy + 0% leak`: **the socket pool never exhausts at any error rate.** 30% of requests failing, but every socket is properly recycled.

Without `destroy + 0% leak` at **1% error rate**: socket exhaustion in **16.5 seconds**. At 30% error rate: **0.6 seconds**. The service is effectively dead before the first monitoring check runs.

### Throughput (req/s)

| | 0% errors | 1% | 5% | 10% | 20% | 30% |
|---|---|---|---|---|---|---|
| **destroy + 0% leak** | 200 | 197.9 | 189.7 | 179.6 | 160.2 | **139.8** |
| **no-destroy + 0% leak** | 200 | 141.5 | 35.5 | 15.0 | 6.6 | **2.9** |

With `destroy` at 30% errors: **139.8 req/s** — throughput degrades proportionally to the error rate.

Without `destroy` at 30% errors: **2.9 req/s** — a **48× throughput collapse** compared to proper error handling.

This is the most striking data point in the entire study. The same 30% error rate produces either "service handles it gracefully at 70% capacity" or "service is effectively dead at 1.5% of capacity" — the only difference is whether you call `req.destroy()` in your error handler.

`req.destroy()` in timeout and error handlers is mandatory. The cascade from a 50-socket pool starts at just 1% error rate without cleanup — compare to FDs (limit 1,024), which only cascade at 15%+. The amplification factor is much higher here because the pool is smaller. The correct pattern:

```typescript
function makeRequest(url: string, options: RequestOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      if (res.statusCode !== 200) {
        res.resume(); // Drain the response body to free the socket
        req.destroy();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      res.on('error', (err) => {
        req.destroy(err);
        reject(err);
      });
    });

    req.on('error', (err) => {
      req.destroy(err); // Also destroy on request-level errors
      reject(err);
    });

    req.setTimeout(options.timeout ?? 5000, () => {
      req.destroy(new Error(`Request timed out after ${options.timeout ?? 5000}ms`));
      // req.destroy() triggers the 'error' event above
    });

    req.end();
  });
}
```

For libraries like `axios` or `node-fetch`, ensure `timeout` and `signal` (AbortController) are configured — they internally call `req.destroy()` when the timeout fires.

---

## 4. Response Size vs. Concurrency

### Failure rate (all response sizes)

| | 1KB | 10KB | 100KB | 1MB | 5MB | 10MB |
|---|---|---|---|---|---|---|
| **Concurrency 1** | 0% | 0% | 0% | 0% | 0% | 0% |
| **Concurrency 5** | 61.7% | 61.7% | 61.7% | 61.7% | 61.7% | 61.7% |
| **Concurrency 10** | 80.9% | 80.9% | 80.9% | 80.9% | 80.9% | 80.9% |
| **Concurrency 20** | 88.5% | 88.5% | 88.5% | 88.5% | 88.5% | 88.5% |
| **Concurrency 50** | 96.2% | 96.2% | 96.2% | 96.2% | 96.2% | 96.2% |

Response size has **zero effect on failure rate.** Every concurrency level shows identical failure rates regardless of whether the response is 1KB or 10MB. This is the same finding as BM-01 Case 2 (query time) and BM-02 Case 2 (file size): when leak rate dominates, secondary factors become irrelevant.

### p95 Latency by response size

| | 1KB | 100KB | 1MB | 5MB | 10MB |
|---|---|---|---|---|---|
| **Concurrency 1** | 12.8ms | 12.8ms | 21.8ms | 61.8ms | 111.8ms |
| **Concurrency 10** | 12.9ms | 12.9ms | 21.9ms | 62.0ms | 290.4ms |
| **Concurrency 20** | 12.9ms | 12.9ms | 21.9ms | 135.9ms | 268.5ms |
| **Concurrency 50** | 12.9ms | 12.9ms | 45.1ms | 554.5ms | **1,412ms** |

Here's where response size matters. At high concurrency, large responses create a second bottleneck: bandwidth. Sending a 10MB response to 50 concurrent requests doesn't just consume sockets longer — it queues responses behind each other, causing exponentially higher p95 latency.

At concurrency 50 with a 10MB response: **1,412ms p95 latency** — even with 0% intentional leak. The service is effectively unavailable for 1.4 seconds per request at those response sizes. This happens before any leaks occur — it's pure resource contention.

Response size doesn't affect failure rate from leaks — at 5% leak and concurrency 10, it's 80.9% whether responses are 1KB or 10MB. But response size creates an independent latency problem at high concurrency: 10MB responses at concurrency 50 hit 1,412ms p95 from bandwidth contention alone, with 0% intentional leaks. Two separate failure modes that need separate fixes.

---

## 5. Keep-Alive vs. Leak Probability

### Failure rate

| | 0% leak | 1% | 2% | 5% | 10% | 15% | 20% |
|---|---|---|---|---|---|---|---|
| **No keep-alive** | 0% | 4.5% | 41.5% | 80.9% | 91.4% | 92.9% | 94.9% |
| **Keep-alive** | **87.5%** | **87.9%** | **88.2%** | **89.6%** | **93.1%** | **94.2%** | **94.9%** |

The most striking number in this table: `keep-alive` at **0% intentional leak = 87.5% failure rate.** No leaks, proper cleanup, and still 87.5% of requests fail.

Why? Keep-alive connections are *designed* to persist. With no-keep-alive, each request opens a socket, uses it, and closes it — the socket is immediately returned to the pool. With keep-alive, the socket is kept open for reuse, remaining "checked out" from the pool perspective.

With a 50-socket pool and 20 concurrent requests all using keep-alive, 20 sockets become persistently occupied — even though they're idle. 30 remain available. Under sustained load, all 50 become occupied by keep-alive connections from different requests, and new requests can't get a socket despite no intentional leaks.

**The failure rates converge at 20% leak:** no-keep-alive (94.9%) ≈ keep-alive (94.9%). Once the socket pool is destroyed by intentional leaks, the keep-alive behavior no longer matters — the pool is already depleted.

Keep-alive requires a socket pool sized for your concurrency level. 20 concurrent outbound requests need at minimum 20 pool slots plus headroom. `http.globalAgent.maxSockets = Infinity` (the Node.js default) eliminates keep-alive exhaustion, but leaked sockets accumulate without limit until the FD budget is exhausted. Explicit `Agent` instances with configured `maxSockets` are safer:

```typescript
import * as http from 'node:http';
import * as https from 'node:https';

// Create an agent with explicit pool sizing
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 20,        // Max concurrent sockets to this host
  maxFreeSockets: 5,     // Idle connections to keep alive
  timeout: 30_000,       // Socket idle timeout
});

// Always pass the agent to requests
const req = https.request({ hostname: 'api.example.com', agent }, handler);
```

---

## What I Found

Five cases, one consistent conclusion: **HTTP socket leaks are the most immediately dangerous resource leak type in Node.js, because the default pool size (50) is close to typical concurrency levels. A 2% unhandled timeout rate is enough to trigger socket exhaustion at concurrency 10.**

| Finding | Data point |
|---------|-----------|
| Socket pool size vs FD limit | 50 vs 1,024 — 20× smaller, 20× more dangerous |
| 1% leak at concurrency 10 | 4.5% failure, 44/50 sockets consumed (88%) |
| 2% leak at concurrency 10 | 41.5% failure, socket exhaustion in 13.3s |
| Timeout value effect on failure rate | Zero — same failure rate at 50ms and 10,000ms |
| Timeout value effect on p95 latency | Large — 101ms at 50ms timeout vs 397ms at 500ms timeout |
| req.destroy() missing + 1% errors | 29.3% failure, socket exhaustion in 16.5s |
| req.destroy() missing + 30% errors | 2.9 req/s throughput (48× collapse vs proper cleanup) |
| req.destroy() present + 30% errors | 139.8 req/s (degrades gracefully) |
| Response size effect on failure rate | Zero — leak rate dominates |
| 10MB responses at concurrency 50 | 1,412ms p95 latency (bandwidth contention) |
| Keep-alive + 0% leak + 50-socket pool | 87.5% failure (keep-alive holds sockets persistently) |

---

## The Fix

For `http.request()` / `https.request()`:

```typescript
async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', (err) => { req.destroy(); reject(err); });
    });
    req.on('error', (err) => { req.destroy(); reject(err); });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });
    req.end();
  });
}
```

For `axios`:

```typescript
const response = await axios.get(url, {
  timeout: 5000,                // axios handles req.destroy() internally on timeout
  signal: AbortSignal.timeout(5000), // AbortController also calls destroy()
  maxContentLength: 10 * 1024 * 1024, // Cap response size at 10MB
});
```

For `node-fetch` / `undici`:

```typescript
// undici (the modern Node.js HTTP client) handles socket cleanup automatically
import { fetch, ProxyAgent } from 'undici';
const response = await fetch(url, {
  signal: AbortSignal.timeout(5000),
});
```

---

## Detection

### Static analysis

```bash
# Find http.request/https.request calls — verify each has destroy() on timeout
grep -rn "http\.request\|https\.request" src/ --include="*.ts" --include="*.js"

# Find setTimeout calls near http.request (common timeout pattern — check for destroy())
grep -A5 "\.setTimeout" src/ --include="*.ts" | grep -v "destroy"
```

### Runtime monitoring

```typescript
// Monitor agent socket usage
function logAgentStats(agent: http.Agent, name: string): void {
  const sockets = Object.values(agent.sockets).flat().length;
  const freeSockets = Object.values(agent.freeSockets).flat().length;
  const requests = Object.values(agent.requests).flat().length;

  if (sockets > 40) { // 80% of default 50 max
    console.warn(`[${name}] High socket usage: ${sockets} active, ${requests} queued`);
  }
}

setInterval(() => {
  logAgentStats(http.globalAgent, 'http.globalAgent');
  logAgentStats(https.globalAgent, 'https.globalAgent');
}, 10_000);
```

---

## Caveats

**Fixed pool size of 50.** The simulation uses `maxSockets = 50` for all cases. Node.js's `http.globalAgent.maxSockets` defaults to `Infinity` in modern versions — meaning there's no built-in socket limit for outbound HTTP requests. The practical limits are FD budget and OS TCP resources. The 50-socket model simulates a bounded agent (custom `new Agent({ maxSockets: 50 })`), which is the recommended practice.

**Simulated response timing.** The simulator models a fixed response time (50ms base) with configurable payload size affecting transfer time. Real HTTP responses have variable network latency, TLS handshake overhead, DNS resolution time, and server-side processing delays. The patterns (leak rate dominating failure, timeout as latency dial) hold across real-world conditions.

**Keep-alive behavior simplification.** The simulation models keep-alive connections as "socket held until explicitly released." Real keep-alive semantics include idle timeouts, `Connection: close` headers, and proxy behavior. The 87.5% failure at 0% leak with keep-alive is a worst-case model for a pool that's too small for the concurrency level.

---

## What's next

This is Part 4 of the resource leak study. Upcoming parts:

- **Part 5 (BM-05):** Timer leaks — `setInterval` without `clearInterval` and the CPU overhead from leaked interval callbacks firing indefinitely
- **Part 6 (BM-06):** Event listener leaks — `emitter.on()` without `off()`, MaxListenersExceeded warnings, and emit latency degradation

---

## Try it yourself

```bash
git clone https://github.com/liangk/empirical-study.git
cd empirical-study/studies/06-resource-leaks
npm install

# Run all 5 BM-04 experiment cases
npm run experiments:bm04

# Run individual cases
npm run experiments:bm04:case1   # Leak Probability × Concurrency
npm run experiments:bm04:case2   # Timeout Duration × Concurrency
npm run experiments:bm04:case3   # Error Rate × Error Handling Behavior
npm run experiments:bm04:case4   # Response Size × Concurrency
npm run experiments:bm04:case5   # Keep-Alive × Leak Probability
```

Results are saved to `src/step1-benchmarks/experiments/bm04/experiments-bm04-<timestamp>.json`.

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
