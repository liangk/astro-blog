---
title: "Stream Leaks: A Four-Case Simulation Study of How createReadStream Without destroy() Causes Dual EMFILE and OOM Failures"
pubDate: "2026-03-19"
heroImage: "../../assets/resource-leak-empirical-study-part3.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "We built a discrete-event stream simulator and ran four two-dimensional parameter grid experiments to measure how stream leak probability, concurrency, file size, error handling, and stream type interact to cause EMFILE and OOM failures. Unlike raw file descriptor leaks, streams retain their read buffers in heap memory — 1,024 leaked read streams hold 64MB, transform streams hold 80MB. Without stream.destroy() on error paths, a 10% error rate at 20% base leak causes 68.8% request failure. This is Part 3 of our resource leak study, focusing on BM-03: Node.js stream leaks."
excerpt: "A leaked createReadStream is two bugs in one: a file descriptor that never closes, and a 64KB read buffer that never frees. At concurrency 50 with 5% leak, that's 1,024 leaked streams, 64MB heap growth, and EMFILE in 20 seconds. Transform streams are worse — 80KB per leaked instance. The fix is a single function: pipeline()."
lastmod: "2026-03-19"
canonical_url: "https://stackinsight.dev/blog/resource-leak-empirical-study-part3"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - nodejs stream leak
  - createReadStream without destroy
  - stream.destroy nodejs
  - nodejs EMFILE stream
  - stream pipeline nodejs
  - readable stream leak
  - nodejs OOM stream leak
  - createReadStream memory leak
  - stream error handling nodejs
  - nodejs pipeline error handling
  - stream highWaterMark memory
  - nodejs stream resource leak
  - writable stream leak
  - transform stream memory
  - stream cleanup nodejs

# AIEO (AI Engine Optimization)
ai_summary: "This empirical study uses a discrete-event stream simulator to run four two-dimensional parameter grid experiments measuring how Node.js stream leaks cause dual EMFILE and OOM failures. Case 1 (Leak Probability × Concurrency): Stream leaks have identical EMFILE timing to raw FD leaks, but additionally accumulate 64KB heap per leaked read stream. At concurrency 50 with 5% leak, 1,024 streams leak with 64MB heap growth. Case 2 (File Size × Leak Probability): File size has zero effect on either stream count or EMFILE timing. But heap growth caps at 64KB per read stream (the default highWaterMark), not file size — so even 50MB files only cost 64KB of retained heap per leaked stream. Case 3 (Error Rate × Error Handling): With stream.destroy() in catch blocks, zero additional FD leaks regardless of error rate. Without destroy(), a 10% error rate at 20% base leak causes 68.8% request failure and EMFILE in 13.6 seconds. Case 4 (Stream Type × Leak Probability): EMFILE timing is identical across read, write, and transform streams. But heap growth per leaked stream differs: read = 64KB, write = 16KB, transform = 80KB. Transform streams retain both a read buffer and write buffer, costing 25% more per leak."
ai_key_facts:
  - "Leaked streams have dual failure modes: EMFILE (FD exhaustion) and heap OOM (buffer retention)"
  - "At concurrency 50 with 5% leak: 1,024 leaked streams, 64MB heap growth, EMFILE in 20.3 seconds"
  - "File size has zero effect on EMFILE timing — only stream count determines FD exhaustion"
  - "Heap growth caps at highWaterMark per stream: read=64KB, write=16KB, transform=80KB"
  - "A 50MB file leaked as a stream costs only 64KB of heap — not 50MB (buffering stops at highWaterMark)"
  - "Transform streams cost 25% more heap per leaked instance than read streams"
  - "Without stream.destroy() on errors, 10% error rate + 20% base leak = 68.8% failure, EMFILE in 13.6s"
  - "Node.js pipeline() automatically calls destroy() on all streams on error — use it"
  - "stream.destroy() in catch block prevents all error-path FD leaks"
ai_entities:
  - "Node.js"
  - "ReadableStream"
  - "WritableStream"
  - "TransformStream"
  - "createReadStream"
  - "stream.pipeline"
  - "stream.destroy"
  - "highWaterMark"
  - "EMFILE"
  - "OOM"
  - "File Descriptor"
  - "try/catch"
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
  - streams
  - resource-leaks
  - EMFILE
  - performance
  - typescript
  - benchmarking
  - simulation
  - empirical-study
  - createReadStream
  - pipeline
  - error-handling
  - heap-memory
  - OOM

# Related
related_posts:
  - "resource-leak-empirical-study"
  - "resource-leak-empirical-study-part2"
  - "resource-leak-empirical-study-part4"
series: "Backend Performance Empirical Studies"
series_order: 8
---

# Stream Leaks: How `createReadStream` Without `destroy()` Causes Dual EMFILE and OOM Failures

Node.js streams are the building block of file processing, HTTP responses, compression, encryption, and data transformation pipelines. They're elegant when used correctly, and a double liability when they leak.

Unlike raw file descriptor leaks — where the damage is limited to FD count — a leaked stream is two bugs in one: an **unclosed file descriptor** that counts against your `ulimit -n` limit, *and* an **unreleased read buffer** that holds data in heap memory until the process dies or GC (eventually, unreliably) collects it.

I wanted to know: how does the dual failure mode play out quantitatively? When does a stream leak cause EMFILE? When does it cause OOM? Does file size affect the memory impact? What's the cost difference between a leaked `ReadableStream` versus a `WritableStream` versus a `TransformStream`?

I built a discrete-event stream simulator and ran four two-dimensional parameter experiments. The results clarify when each failure mode dominates — and confirm that `stream.destroy()` is the non-negotiable fix.

A leaked `createReadStream` is two bugs in one: a file descriptor that never closes, and a buffer that never frees. At concurrency 50 with 5% leak rate, EMFILE hits in 20 seconds — identical to raw `fs.open()` leaks. But streams also retain 64KB per leaked instance (the `highWaterMark`), so at that same threshold: 1,024 leaked streams × 64KB = 64MB heap before EMFILE fires. File size doesn’t matter — a 50MB file still costs only 64KB retained. Transform streams cost 80KB each, 25% more.

---

## The Pattern

A `ReadableStream` in Node.js opens a file descriptor when created. It reads data in chunks (default 64KB) into an internal buffer. If you abandon the stream without calling `destroy()` or reading it to completion:

1. The underlying file descriptor remains open — counts against `ulimit -n`
2. The internal read buffer remains allocated in heap memory
3. Any `data` or `readable` event listeners remain attached

The most common leak pattern:

```typescript
// Leaky — abandoned on error
async function processUpload(filePath: string) {
  const stream = fs.createReadStream(filePath);
  const parser = new CSVParser();

  stream.pipe(parser);
  parser.on('data', async (row) => {
    await db.insert(row); // If this throws, stream is never destroyed
  });
  // No error handling — stream leaks on parser/db errors
}
```

The less obvious version with `for await`:

```typescript
async function hashFile(filePath: string): Promise<string> {
  const stream = fs.createReadStream(filePath);
  const hash = crypto.createHash('sha256');

  for await (const chunk of stream) {
    hash.update(chunk);
    // If update() throws (unlikely but possible), loop exits
    // Stream iterator does NOT auto-destroy on early exit in all Node versions
  }
  return hash.digest('hex');
}
```

In both cases, the stream object is abandoned mid-read. The FD stays open. The buffer stays allocated.

---

## The Simulation

The stream simulator models `createReadStream`/`createWriteStream`/`Transform` lifecycle: create, buffer fill, use, destroy (or leak). Parameters:

| Parameter | What it controls |
|-----------|-----------------|
| `fdLimit` | Maximum open streams/FDs (1,024 simulated) |
| `leakProbability` | Chance a stream is not destroyed after use (0–20%) |
| `concurrency` | Parallel stream operations (1–100) |
| `fileSize` | Simulated file size (1KB–50MB) |
| `highWaterMark` | Stream buffer size (64KB for read, 16KB for write, 80KB for transform) |
| `errorRate` | Chance a stream operation fails (0–30%) |
| `destroyOnError` | Whether errors call `stream.destroy()` |

**Metrics collected:**
- **Failure rate** — % of operations that received EMFILE
- **Time-to-exhaustion** — when FD limit is reached
- **Throughput** — successful stream operations per second
- **Leaked stream count** — total streams permanently abandoned
- **Heap growth** — retained buffer memory from leaked streams

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

*FD limit: 1,024, duration: 30 seconds.*

The failure rate pattern is **identical to BM-02 raw FD leaks**. This confirms that the EMFILE failure mode is driven purely by the file descriptor count — stream type and buffer size have no influence on *whether* or *when* EMFILE fires.

### Heap growth from leaked stream buffers

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **Concurrency 1** | 0 | 128 KB | 256 KB | 1.2 MB | 3.75 MB | 7.4 MB |
| **Concurrency 5** | 0 | 1.1 MB | 2.4 MB | 8.1 MB | 18.8 MB | 37.0 MB |
| **Concurrency 10** | 0 | 2.8 MB | 5.3 MB | 17.3 MB | 37.1 MB | **64 MB** |
| **Concurrency 20** | 0 | 6.2 MB | 10.8 MB | 29.5 MB | **62 MB** | **64 MB** |
| **Concurrency 50** | 0 | 19.4 MB | 37.9 MB | **64 MB** | **64 MB** | **64 MB** |

*Values hitting **64 MB** indicate the simulated OOM threshold was reached.*

This is where streams diverge from raw FD leaks. While EMFILE timing is the same, **heap memory accumulates proportionally to the number of leaked streams** — and that accumulation is capped by the stream's `highWaterMark` (64KB for read streams), not the file size.

At concurrency 50 with 5% leak: 1,024 leaked streams × 64KB = **64MB heap** — hitting OOM at the same point EMFILE fires. The two failure modes arrive simultaneously.

At concurrency 10 with 1% leak: only 45 leaked streams × 64KB = **2.8MB heap**. Invisible.

### Time-to-exhaustion

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **Concurrency 10** | ∞ | ∞ | ∞ | ∞ | ∞ | 25.7s |
| **Concurrency 20** | ∞ | ∞ | ∞ | ∞ | ∞ | 15.4s |
| **Concurrency 50** | ∞ | ∞ | ∞ | 20.3s | 10.3s | 5.1s |

Identical to BM-02 — FD count determines timing, not stream memory.

EMFILE timing is identical to raw FD leaks — one FD per stream, same arithmetic. But streams add a heap cost on top: at concurrency 10 with 2% leak, 85 leaked streams add 5.3MB heap; at concurrency 50 with 5% leak, 1,024 leaked streams push the process to 64MB — OOM and EMFILE arriving simultaneously. That's the double failure mode.

---

## 2. File Size vs. Leak Probability

### Heap growth by file size

| | 1KB | 10KB | 64KB | 512KB | 5MB | 50MB |
|---|---|---|---|---|---|---|
| **0% leak** | 0 | 0 | 0 | 0 | 0 | 0 |
| **1% leak** (45 streams) | 45 KB | 450 KB | **2.8 MB** | 2.8 MB | 2.8 MB | 2.8 MB |
| **2% leak** (85 streams) | 85 KB | 850 KB | **5.3 MB** | 5.3 MB | 5.3 MB | 5.3 MB |
| **5% leak** (276 streams) | 270 KB | 2.7 MB | **17.3 MB** | 17.3 MB | 17.3 MB | 17.3 MB |
| **10% leak** (594 streams) | 580 KB | 5.8 MB | **37.2 MB** | 37.2 MB | 37.2 MB | 37.2 MB |
| **20% leak** (1,024 streams) | 1.0 MB | 10.0 MB | **64 MB** | 64 MB | 64 MB | 64 MB |

*Fixed: concurrency 10.*

The table reveals a critical property of Node.js streams: **heap growth is capped at `highWaterMark` per leaked stream, not at file size.**

For files smaller than 64KB (the default `highWaterMark`), the full file is buffered — heap grows proportionally to file size. But at 64KB and above, the buffer is capped at exactly 64KB regardless of whether the file is 512KB, 5MB, or 50MB. The stream reads ahead only as far as its buffer allows, then pauses. A leaked stream holds only that 64KB window, not the whole file.

**This means a 50MB leaked stream and a 64KB leaked stream consume identical heap memory.** File size doesn't matter for heap impact above `highWaterMark`.

### Leaked stream count and time-to-exhaustion

| | 1KB | 10KB | 64KB | 512KB | 5MB | 50MB |
|---|---|---|---|---|---|---|
| **Leaked streams (any leak %)** | same | same | same | same | same | same |
| **20% leak → TTE** | 25.7s | 25.7s | 25.7s | 25.7s | 25.7s | 25.7s |

File size affects neither stream count nor time-to-exhaustion. The FD count is independent of file content size.

Streams are safer than raw FDs for large files: a leaked `fs.open()` on a 50MB file holds 50MB of heap; a leaked `createReadStream` on the same file holds only 64KB. For files under 64KB, full content is retained. Tune `highWaterMark` with awareness — if you set it to 10MB, each leaked stream now holds 10MB, and 1,024 leaked streams = 10GB.

---

## 3. Error Rate vs. Error Handling Behavior

The Y-axis has 8 combinations: `destroy` (errors call `stream.destroy()`) or `no-destroy` (errors abandon the stream), combined with base leak probabilities of 0%, 2%, 5%, or 10%.

### Leaked stream count

| | 0% errors | 1% | 5% | 10% | 15% | 20% | 30% |
|---|---|---|---|---|---|---|---|
| **destroy + 0% leak** | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **destroy + 5% leak** | 276 | 276 | 276 | 276 | 276 | 276 | 276 |
| **no-destroy + 0% leak** | 0 | 64 | 310 | 613 | 905 | **1,024** | **1,024** |
| **no-destroy + 5% leak** | 276 | 340 | 574 | 859 | **1,024** | **1,024** | **1,024** |
| **no-destroy + 10% leak** | 594 | 653 | 871 | **1,024** | **1,024** | **1,024** | **1,024** |

With `destroy`, the stream count is fixed by the base leak probability — error rate adds zero streams. With `no-destroy`, each error adds another leaked stream: at 20% error rate with zero base leak, all 1,024 FDs are consumed by error-path streams that were never destroyed.

### Heap growth from leaked streams

| | 0% errors | 5% | 10% | 20% | 30% |
|---|---|---|---|---|---|
| **destroy + 0% leak** | 0 | 0 | 0 | 0 | 0 |
| **destroy + 5% leak** | 17.3 MB | 17.3 MB | 17.3 MB | 17.3 MB | 17.3 MB |
| **no-destroy + 0% leak** | 0 | 19.4 MB | 38.4 MB | **64 MB** | **64 MB** |
| **no-destroy + 5% leak** | 17.3 MB | 24.5 MB | 43.3 MB | **64 MB** | **64 MB** |
| **no-destroy + 10% leak** | 37.2 MB | 54.5 MB | **64 MB** | **64 MB** | **64 MB** |

At `no-destroy + 0% leak` with 20% error rate: **64MB heap** from streams that were opened, errored, and never destroyed. The code has zero intentional leaks — all damage comes from missing `stream.destroy()` on error paths.

### Failure rate

| | 0% errors | 1% | 5% | 10% | 20% | 30% |
|---|---|---|---|---|---|---|
| **destroy + 0% leak** | 0% | 1.1% | 5.2% | 10.2% | 19.9% | 30.1% |
| **destroy + 5% leak** | 0% | 1.1% | 5.2% | 10.2% | 19.9% | 30.1% |
| **no-destroy + 0% leak** | 0% | 1.1% | 5.2% | 10.2% | **32.1%** | **61.4%** |
| **no-destroy + 10% leak** | 0% | 1.1% | 5.2% | **18.9%** | **51.8%** | **68.8%** |

With `destroy` on all error paths, failure rate tracks exactly the error rate. At 30% errors, 30.1% of requests fail — no cascade, no EMFILE, no OOM. The pool is healthy; errors are isolated.

Without `destroy`, the cascade begins above ~15% error rate. At `no-destroy + 0% leak` with 30% errors: **61.4% failure** — more than twice the error rate, because EMFILE is causing secondary failures on top of the primary errors.

### Time-to-exhaustion

| | 0% errors | 5% | 10% | 15% | 20% | 30% |
|---|---|---|---|---|---|---|
| **destroy + any leak** | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |
| **no-destroy + 0% leak** | ∞ | ∞ | ∞ | ∞ | 25.5s | 16.7s |
| **no-destroy + 5% leak** | ∞ | ∞ | ∞ | 26.7s | 21.5s | 15.3s |
| **no-destroy + 10% leak** | ∞ | ∞ | 27.0s | 22.0s | 18.2s | 13.6s |

With `destroy`, the FD limit is **never reached at any error rate.** Without `destroy` at 30% error rate plus 10% base leak: **EMFILE in 13.6 seconds**.

`stream.destroy()` is the stream equivalent of `client.release()`. Missing it on error paths turns errors into cascading EMFILE + OOM events. The fix depends on how you use streams:

For `stream.pipeline()` — **the preferred approach:**

```typescript
import { pipeline } from 'node:stream/promises';

async function processFile(inputPath: string, outputPath: string): Promise<void> {
  // pipeline() calls destroy() on ALL streams if ANY error occurs
  await pipeline(
    fs.createReadStream(inputPath),
    new TransformStream(),
    fs.createWriteStream(outputPath)
  );
}
```

For manual stream handling:

```typescript
async function streamToBuffer(filePath: string): Promise<Buffer> {
  const stream = fs.createReadStream(filePath);
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    stream.destroy(); // Explicitly close on any error
    throw err;
  }
}
```

For event-based streams:

```typescript
function processStream(stream: Readable): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => { /* process */ });
    stream.on('end', resolve);
    stream.on('error', (err) => {
      stream.destroy(); // Prevent FD leak
      reject(err);
    });
  });
}
```

---

## 4. Stream Type vs. Leak Probability

### Heap growth by stream type

| | 0% leak | 1% (45 streams) | 2% (85 streams) | 5% (276 streams) | 10% (594 streams) | 20% (1,024 streams) |
|---|---|---|---|---|---|---|
| **ReadableStream** | 0 | 2.8 MB | 5.3 MB | 17.3 MB | 37.2 MB | **64 MB** |
| **WritableStream** | 0 | 720 KB | 1.3 MB | 4.3 MB | 9.3 MB | 16.0 MB |
| **TransformStream** | 0 | 3.5 MB | 6.6 MB | 21.6 MB | 46.4 MB | **80 MB** |

Stream types carry different memory footprints because of their internal buffer architecture:

- **ReadableStream:** One 64KB read buffer (`highWaterMark: 65536`)
- **WritableStream:** One 16KB write buffer (`highWaterMark: 16384`) — 4× smaller
- **TransformStream:** One 64KB read buffer + one 16KB write buffer = 80KB total — 25% larger than a ReadableStream

At 20% leak with 1,024 leaked streams:
- ReadableStream: 64MB — 64KB/stream
- WritableStream: 16MB — 16KB/stream
- TransformStream: 80MB — 80KB/stream (the most expensive)

### FD count and EMFILE timing

| | 0% leak | 1% | 2% | 5% | 10% | 20% |
|---|---|---|---|---|---|---|
| **Leaked streams (all types)** | 0 | 45 | 85 | 276 | 594 | **1,024** |
| **TTE (all types)** | ∞ | ∞ | ∞ | ∞ | ∞ | 25.7s |

EMFILE timing is **identical across all stream types.** Each stream type consumes exactly one FD. The 64KB vs 16KB vs 80KB buffer difference only affects heap — not descriptor count.

WritableStream leaks are 4× cheaper on heap than ReadableStream leaks, but consume one FD each — EMFILE timing is the same. TransformStream leaks are the most expensive: 80KB heap per instance. When debugging, OOM before EMFILE points to ReadableStream or TransformStream. EMFILE before OOM points to WritableStream (small buffers per instance, but FD pressure builds faster).

---

## What I Found

Four cases, one consistent conclusion: **stream leaks are FD leaks plus a heap multiplier, and `stream.destroy()` is the mandatory cleanup function on all error paths.**

| Finding | Data point |
|---------|-----------|
| EMFILE timing vs raw FD leaks | Identical — one FD per stream |
| 5% leak at concurrency 50 | 1,024 leaked streams, 64MB heap growth, TTE 20.3s |
| File size effect on heap | Caps at highWaterMark (64KB) — 50MB file = 64KB heap per leak |
| File size effect on TTE | Zero — only FD count matters |
| Transform vs ReadableStream heap | 80KB vs 64KB per leaked stream (25% more) |
| WritableStream heap | 16KB per leaked stream (4× cheaper) |
| No destroy() + 30% errors | 61.4% failure, EMFILE in 13.6s |
| With destroy() + 30% errors | 30.1% failure (only the errors themselves) |
| pipeline() | Auto-destroys all streams on error — use it |

---

## Detection

### Static analysis

```bash
# Find createReadStream/createWriteStream without pipeline or destroy
grep -rn "createReadStream\|createWriteStream" src/ --include="*.ts"

# Find stream.pipe() calls (manual piping without pipeline — verify error handling)
grep -rn "\.pipe(" src/ --include="*.ts" --include="*.js"

# Find for-await-of on streams (check for destroy in catch)
grep -rn "for await" src/ --include="*.ts" | grep -v "destroy"
```

### Runtime monitoring

```typescript
// Track active stream count via process FD monitoring
import { readdir } from 'fs/promises';

async function getOpenFDCount(): Promise<number> {
  try {
    const fds = await readdir(`/proc/${process.pid}/fd`);
    return fds.length;
  } catch {
    return -1;
  }
}

// Alert if FD count grows monotonically (leak signature)
let lastFDCount = 0;
setInterval(async () => {
  const current = await getOpenFDCount();
  if (current > lastFDCount + 50) {
    console.warn(`FD count grew from ${lastFDCount} to ${current} — possible stream leak`);
  }
  lastFDCount = current;
}, 10_000);
```

---

## How BM-03 differs from BM-02 (raw FDs)

| Dimension | BM-02 Raw FDs | BM-03 Streams |
|-----------|--------------|---------------|
| FD cost per leak | 1 FD | 1 FD (identical) |
| EMFILE timing | Same | Same |
| Heap cost per leak | Buffer size (file content) | highWaterMark (64/16/80 KB) |
| Large file heap impact | Full file size | Capped at highWaterMark |
| Second failure mode | OOM if large files | OOM from buffer retention |
| Fix | fd.close() in finally | stream.destroy() or pipeline() |
| Preferred pattern | try/finally | pipeline() |

The key difference: raw FD leaks with large files can consume unbounded heap (the entire file content). Stream leaks cap at `highWaterMark` per instance, making them memory-safer for large-file workloads — but they still accumulate, and transform streams at 80KB per instance can still OOM a service under sustained high concurrency.

---

## Caveats

**highWaterMark simplification.** The simulation models fixed buffer sizes per stream type (64KB read, 16KB write, 80KB transform). Real Node.js streams may have partially-filled buffers, multiple internal queues, and object-mode buffers that work differently. The heap growth numbers represent steady-state buffer fills.

**`for await` and auto-cleanup.** In Node.js v16+, iterating a stream with `for await` and breaking early (or the generator throwing) does call the stream's `return()` method, which typically destroys the stream. However, this behavior is not guaranteed for all stream implementations and was not available in earlier versions. Don't rely on it.

**`pipeline()` is not `pipe()`.** The `stream.pipe()` method does NOT call `destroy()` on error — it's the legacy API. Always use `stream.pipeline()` (the promisified version from `node:stream/promises`) or its callback form for proper cleanup.

---

## What's next

This is Part 3 of the resource leak study. Upcoming parts:

- **Part 4 (BM-04):** HTTP socket accumulation — `http.request()` without `destroy()` on timeout, socket pool exhaustion
- **Part 5 (BM-05):** Timer leaks — `setInterval` without `clearInterval` and the CPU cost of leaked callback invocations
- **Part 6 (BM-06):** Event listener leaks — `emitter.on()` without `off()`, MaxListenersExceeded, and emit latency degradation

---

## Try it yourself

```bash
git clone https://github.com/liangk/empirical-study.git
cd empirical-study/studies/06-resource-leaks
npm install

# Run all 4 BM-03 experiment cases
npm run experiments:bm03

# Run individual cases
npm run experiments:bm03:case1   # Leak Probability × Concurrency
npm run experiments:bm03:case2   # File Size × Leak Probability
npm run experiments:bm03:case3   # Error Rate × Error Handling Behavior
npm run experiments:bm03:case4   # Stream Type × Leak Probability
```

Results are saved to `src/step1-benchmarks/experiments/bm03/experiments-bm03-<timestamp>.json`.

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
