---
title: "We Scanned 368 Production Node.js Repos for Resource Leaks. 87.8% Had Them."
pubDate: "2026-03-24"
heroImage: "../../assets/resource-leaks-corpus-detector.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "After measuring how fast six resource leak types kill a Node.js service in controlled experiments, we turned the same detection engine on 368 real production repositories across 8 domains. 323 of them — 87.8% — had at least one suspicious resource leak pattern. Event listener leaks were the most common by far at 57.7% of all 33,625 findings. But here's the twist: the leak types that fail fastest in controlled experiments are the least common in production code. The patterns that dominate real repositories — listeners and streams — are the ones that degrade slowly and stay hidden. This article presents the corpus findings, explains how the static analysis detector works, and connects the controlled failure data back to what we actually see in the wild."
excerpt: "The patterns that kill a service in under a second are actually the rarest in production code. The patterns you'll find in nearly every Node.js repo are the ones that degrade slowly, silently, and in ways your standard monitoring won't catch."
lastmod: "2026-03-24"
ai_summary: "This article presents the results of Phase 3 (real-world corpus profiling) and Phase 4 (static analysis) from a six-module Node.js resource leak empirical study. 368 repositories across 8 domains were scanned using a Babel AST detector with 6 detection rules. 323 repositories (87.8%) had at least one finding, producing 33,625 total leak pattern instances. The dominant pattern was unclosed_event_listener (19,385, 57.7%), followed by unclosed_stream (6,950, 20.7%), unclosed_timer (4,835, 14.4%), unclosed_connection (2,225, 6.6%), resource_without_cleanup (197, 0.6%), and unclosed_file_handle (33, 0.1%). The most notable finding is a pattern inversion: the leak types that fail fastest in controlled experiments (connections at 132ms, HTTP sockets at 245ms) are the least common in production code. The leak types that dominate production code (listeners, streams) cause slower degradation, are harder to detect on standard monitoring, and are present in well-maintained repositories including rxjs, cypress, mongodb, playwright, and nestjs. The detector uses Babel AST traversal with per-function-scope analysis cached via WeakMap to avoid redundant traversal."
key_takeaways:
  - "87.8% of 368 scanned Node.js repositories had at least one resource leak pattern."
  - "Event listener leaks were the most common at 57.7% of all 33,625 findings — three times more common than stream leaks."
  - "Connection pool leaks — the fastest-failing type in controlled experiments at 132ms median TTF — appeared in only 6.6% of findings."
  - "Well-maintained production repos including rxjs (2,988 findings), cypress (2,649), and mongodb driver (3,629) all contained suspicious patterns."
  - "The static detector uses Babel AST traversal with function-scope caching to check all 6 leak patterns in a single pass."
  - "Patterns in production code skew heavily toward the 'slow degradation' failure class — the type least likely to be caught by heap monitoring."
keywords:
  - "Node.js"
  - "Resource Leaks"
  - "Static Analysis"
  - "AST"
  - "Event Listeners"
  - "Streams"
  - "Connection Pool"
  - "Software Reliability"
  - "TypeScript"
  - "Corpus Study"
  - "Babel"
schema_type: "TechArticle"
schema_proficiency_level: "Advanced"
schema_dependencies: "Node.js v18+, TypeScript 5+, @babel/parser, @babel/traverse"
schema_time_required: "PT18M"
categories:
  - "Software Performance"
  - "Software Reliability"
  - "Web Development"
series: "Software Reliability Empirical Studies"
---

The previous article in this series measured how fast each of six Node.js resource leak types kills a simulated service under load. Connection pool leaks: 132 milliseconds. HTTP socket leaks: 245 milliseconds. File descriptor leaks: 10–25 seconds. Timer and event listener leaks: somewhere in the 600ms–25 second range depending on how you define failure.

Those numbers came from controlled discrete-event simulations — parameterized, reproducible, no real OS handles involved. Good for understanding the mechanism. Less useful for answering the question I actually wanted to answer: **how common are these patterns in real production code?**

So I built a static analysis detector and pointed it at 368 Node.js repositories.

The result: 87.8% of them had at least one suspicious resource leak pattern. 33,625 total findings across repositories you almost certainly have in your dependency tree.

But that's not the interesting part. The interesting part is which patterns dominated — and how they map back to the failure data.

## The corpus and what we scanned

The study corpus spans 400 repositories across 8 domains: Web APIs, CLI tools, Database/ORM libraries, File processing and build tools, Real-time/WebSocket, DevOps infrastructure, Testing tools, and Data processing/messaging. All selected for Node.js or TypeScript as the primary language, at least 100 GitHub stars, and active maintenance in the last 18 months.

Of the 400, 368 completed successfully with zero scan errors in the final run. The remaining 32 were skipped during scanning — mostly because they were monorepo-scale codebases with tens of thousands of source files that pushed memory limits even after optimization. `googleapis/google-cloud-node` showed up as a notable example with over 14,000 source files. It made it through the final scan (contributing 1,030 findings), but was among those that triggered OOM errors in earlier runs before we added a 1 MB per-file size guard and per-function analysis caching.

For each repository, the scanner:
1. Clones a shallow copy (`--depth 1`)
2. Finds all `.ts`, `.js`, `.mts`, `.mjs`, `.cts`, `.cjs` files — excluding `node_modules`, `dist`, `build`, `coverage`, `.d.ts` files, and test directories
3. Parses each file with `@babel/parser` (TypeScript + JSX plugins, `errorRecovery: true`)
4. Runs the detector across all 6 pattern rules in a single AST traversal
5. Streams findings incrementally to disk as they're produced

That last step matters for large repos. Earlier versions of the scanner accumulated all findings in memory, which is fine for small repositories but quietly catastrophic at `mongodb/node-mongodb-native` scale (3,629 findings from a single repo).

## 87.8%. Let that sink in.

323 of 368 repositories had at least one resource leak pattern. That's not a data artifact from a loose detector with too many false positives — we'll get to how strict the rules are shortly. That's just what production Node.js code looks like.

Here's the full pattern breakdown across all 33,625 findings:

| Pattern | Findings | Share | Benchmark | Controlled TTF |
|---|---:|---:|---|---|
| `unclosed_event_listener` | 19,385 | **57.7%** | BM-06 | 600 ms – 6.0 s |
| `unclosed_stream` | 6,950 | **20.7%** | BM-03 | 12.9 s – 25.7 s |
| `unclosed_timer` | 4,835 | **14.4%** | BM-05 | 1.25 s – 25.6 s |
| `unclosed_connection` | 2,225 | **6.6%** | BM-01 | 132 ms – 880 ms |
| `resource_without_cleanup` | 197 | **0.6%** | BM-04 | 245 ms – 3.1 s |
| `unclosed_file_handle` | 33 | **0.1%** | BM-02 | 10.8 s – 21.5 s |

Read that table again, specifically the relationship between "Share" and "Controlled TTF."

Connection pool leaks and HTTP socket leaks — the two fastest-killing categories in the simulation study, the ones that fail in under a second — together make up just 7.2% of all real-world findings. Meanwhile, event listener leaks, which degrade services through dispatch amplification rather than hitting a hard capacity ceiling, account for 57.7% of everything we found.

This is not a coincidence or an artifact of corpus selection. It reflects something real about the failure modes.

## Why the dangerous ones are rarer

When your connection pool leaks, it fails loudly and fast. Requests start timing out. Error rates spike. Your alerting fires. The bug gets noticed, investigated, and fixed — usually within a deployment cycle or two. It *has* to be, because the service becomes completely unusable in under a second of simulation time.

Event listener leaks don't work that way. You add a listener and forget to remove it. Nothing breaks immediately. The emitter gets a bit louder over time. Memory grows slowly. Emit latency creeps up — from microseconds, to fractions of a millisecond, to a few milliseconds, to tens of milliseconds. Throughput dips maybe 5%. Then 10%. No single alert threshold gets crossed. Weeks pass. The service slowly gets worse and nobody knows why.

That survivability is exactly what makes listener and stream leaks so prevalent. They don't demand to be fixed. They sit in the codebase for months or years, gently degrading the service, until someone finally instruments things carefully enough to notice the pattern.

The controlled experiments put a number on "how bad is 'gently degrading.'" At the failure point — 1,000 accumulated listeners, event frequency of 50 Hz — emit latency hits 30 ms per event. That means every event dispatch takes 30x longer than it should. Your event-driven architecture is now as slow as synchronous polling. The service hasn't crashed. It's just become unusably slow at a task it used to handle instantly.

## The repositories

The top 10 repositories by finding count tell an interesting story:

| Repository | Findings | Domain |
|---|---:|---|
| mongodb/node-mongodb-native | 3,629 | Database/ORM |
| ReactiveX/rxjs | 2,988 | Data Processing |
| cypress-io/cypress | 2,649 | Testing Tools |
| bitwarden/clients | 2,640 | DevOps |
| googleapis/google-cloud-node | 1,030 | Web APIs |
| microsoft/playwright | 969 | Testing Tools |
| NodeBB/NodeBB | 717 | Real-time |
| pouchdb/pouchdb | 640 | Database/ORM |
| RocketChat/Rocket.Chat | 630 | Real-time |
| amark/gun | 488 | Data Processing |

These aren't obscure repos from abandoned side projects. They're among the most widely-used Node.js libraries in the world. The MongoDB Node.js driver alone is downloaded hundreds of millions of times a month.

A few things worth noting before over-interpreting these numbers.

First, the detector is looking at static code patterns, not runtime behavior. Many of these findings are in code paths that are intentionally long-lived — for example, `rxjs`'s internal scheduler using `setInterval` without a corresponding `clearInterval` in the same function scope is a detection hit, but the cleanup may happen through an observable unsubscription at a higher level that the AST detector can't see. The finding count is an upper bound on actual bugs, not a precise count.

Second, finding count correlates with codebase size. `mongodb/node-mongodb-native` has a very large driver codebase with extensive stream and connection handling — exactly the patterns the detector looks for. That explains why it tops the list despite being a well-maintained project.

Third, even after those caveats: 3,629 suspicious patterns in a database driver, or 2,988 in a reactive programming library, is worth looking at. Some fraction of those will be genuine. The static analysis gets you to the door; a human has to decide what's inside.

What's more telling than the absolute counts is the *pattern distribution* within repositories. Real-time and messaging repos (`socketio/socket.io`, `NodeBB/NodeBB`, `RocketChat/Rocket.Chat`, `nats-io/nats.js`) unsurprisingly show heavier event listener and connection counts. CLI and build tool repos (`eslint/eslint`, `webpack/webpack`, `pnpm/pnpm`) show lighter overall counts with stream patterns dominating. Testing frameworks (`cypress-io/cypress`, `microsoft/playwright`) show timer and listener patterns — which makes sense, given how much test infrastructure uses `setInterval` for polling and event listeners for browser communication.

## How the detector actually works

The detector is a Babel AST traversal. Here's what it checks for each of the 6 patterns:

**1. Unclosed connections** — looks for calls to `createConnection`, `connect`, `open`, `createPool`, or `getConnection`. Then checks if the enclosing function scope contains any of `close`, `end`, `destroy`, `release`, `disconnect`, or `dispose`. Also checks for `try/finally` blocks with cleanup, and `using` declarations (the TC39 explicit resource management proposal). If none of those exist, it's flagged.

**2. Unclosed streams** — same approach for `createReadStream`, `createWriteStream`, `pipe`, `openSync`. Checks for `close`, `end`, or `destroy` in scope, plus whether the stream pipes to `res` or `response` (which is a common valid pattern in web servers that doesn't indicate a leak).

**3. Unclosed file handles** — specifically targeting `fs.open`, `fs.promises.open`, and `openSync` where the callee object is `fs` or `promises`. Checks for `close` or `closeSync` in scope.

**4. Resources without cleanup** — looks for `new WebSocket(...)`, `new Worker(...)`, `new EventSource(...)`, `new BroadcastChannel(...)`, `new MessageChannel(...)`, `new AbortController(...)`. Each class has expected cleanup methods (`close`, `terminate`, `abort`) that it checks for.

**5. Unclosed timers** — `setInterval` or `setTimeout` calls at the top level (not as method calls) without a corresponding `clearInterval` or `clearTimeout` in scope.

**6. Unclosed event listeners** — `.on(...)`, `.addListener(...)`, or `.addEventListener(...)` without `.off(...)`, `.removeListener(...)`, or `.removeEventListener(...)` in the same function scope.

All six rules run in a single AST traversal pass. The key optimization that makes this fast enough for large repos: per-function scope analysis is computed once and cached in a `WeakMap` keyed on the AST node. So if a function body has five suspicious calls in it, the function's cleanup analysis is computed once on the first hit and reused for the remaining four. Without this, large files — especially those with many small helper functions — would trigger redundant re-traversal of the same subtrees hundreds of times.

```typescript
const functionAnalysisCache = new WeakMap<object, FunctionAnalysis>();

function getFunctionAnalysis(scopeNode: any, scope: any): FunctionAnalysis {
  const cached = functionAnalysisCache.get(scopeNode);
  if (cached) return cached;

  const analysis: FunctionAnalysis = {
    calledMethods: new Set<string>(),
    hasPipeToResponse: false,
    hasUsingDeclaration: false,
    hasFinallyClose: false,
  };

  // Single traversal of function body — builds the full method call set
  traverse(scopeNode, { /* ... */ }, scope);

  functionAnalysisCache.set(scopeNode, analysis);
  return analysis;
}
```

Each finding records: file path, line number, pattern type, severity (`high` for connection/FD/stream, `medium` for timer/listener/resource), description, and the triggering method name. The findings stream directly to a JSON file as they're generated, so even a repo with thousands of findings doesn't accumulate them all in heap before writing.

## The false positive question

Static analysis detectors live and die by their false positive rate. Ours is deliberately conservative — it only flags patterns where the cleanup is missing *in the same function scope*. It won't flag a listener added in one function and removed in another. It won't flag a stream created at module level where `destroy()` is called elsewhere. In those cases, the detector produces a false negative (misses a real leak) rather than a false positive (flags clean code).

This means the 33,625 findings are a **lower bound** on suspicious patterns in the corpus. Some actual leaks — particularly ones where resource lifetime spans multiple functions or module-level state — aren't counted at all. What *is* counted are patterns where a resource is created and no cleanup exists within the same lexical function. That's still a real and actionable signal.

The detector also won't catch cleanup that happens through higher-level abstractions. A `finally` block that calls a cleanup method not in the `CLOSE_METHODS` list won't register. A custom wrapper class with a `dispose()` method that internally calls `close()` won't register.

For a study trying to estimate prevalence across 368 repositories without manual review of each finding, this tradeoff is fine. The numbers you'd generate through exhaustive manual audit would likely be higher than what we found, not lower.

## What to actually check in your codebase

The detector flags all six patterns, but they're not all equally actionable. Based on the controlled experiment data, here's where to focus:

**Event listeners first.** They're the most prevalent (57.7%), they're the hardest to catch through monitoring alone, and the controlled data shows they can cause real operational failures — 600 ms to 6 seconds depending on listener accumulation rate. The pattern to look for:

```typescript
// This leaks — listener accumulates on every call
function startWatching(emitter: EventEmitter) {
  emitter.on('data', handleData);
  // Where is emitter.off('data', handleData)?
}

// This doesn't — cleanup is paired with setup
function startWatching(emitter: EventEmitter, signal: AbortSignal) {
  const handler = (data: unknown) => handleData(data);
  emitter.on('data', handler);
  signal.addEventListener('abort', () => emitter.off('data', handler), { once: true });
}
```

**Connection leaks second.** Less common in the wild (6.6%), but the fastest-failing in controlled experiments (132 ms). The controlled data showed that error paths that forget to `release()` or `end()` can exhaust a pool just as fast as the happy path — check your `catch` blocks specifically.

```typescript
// Missing cleanup in the error path — pool slot never returned
async function runQuery(pool: Pool) {
  const client = await pool.connect();
  try {
    return await client.query('SELECT 1');
  } catch (err) {
    // client.release() missing here — this slot is gone
    throw err;
  } finally {
    client.release(); // This is what you want
  }
}
```

**Timers third.** 14.4% of findings, and controlled experiments showed they can fail fast (1.25 s) when firing at high frequency. The issue: a leaked `setInterval` at 1 ms interval fires 1,000 times per second. Accumulate enough of those and the event loop saturates. Use `ref()`/`unref()` for timers that shouldn't block process exit, and always store the return value so you can clear it.

## What your monitoring should actually watch

The controlled experiment data maps directly to what's worth instrumenting:

For **event listener leaks**, the useful signal isn't heap growth — it's `emitter.listenerCount(eventName)` on your hot emitters. Node.js itself warns at 10 listeners per emitter by default (`MaxListenersExceededWarning`). Don't silence that warning. It's real signal.

```typescript
// Check listener count at intervals in long-running services
setInterval(() => {
  const count = myEmitter.listenerCount('data');
  if (count > 20) {
    console.warn(`Possible listener leak: 'data' has ${count} listeners`);
  }
}, 10_000).unref();
```

For **timer leaks**, what matters is event loop lag. The `perf_hooks` module measures this directly:

```typescript
import { monitorEventLoopDelay } from 'perf_hooks';

const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();

// Sample it periodically
setInterval(() => {
  const p99 = histogram.percentile(99) / 1e6; // nanoseconds → ms
  if (p99 > 50) {
    console.warn(`Event loop P99 lag: ${p99.toFixed(1)} ms`);
  }
  histogram.reset();
}, 30_000).unref();
```

For **connection leaks**, most connection pool libraries expose pool state directly. The signal you want is `pool.waitingCount` — requests waiting for a connection to become available. If it climbs continuously, connections are leaking.

## The honest picture

A few things this study can't tell you.

The detector doesn't distinguish between patterns that are genuinely bugs and patterns that are intentional by design. Some "unclosed" event listeners are long-lived by intent. Some `setInterval` calls are supposed to run for the lifetime of the process. The detector flags the pattern; it can't know the intent.

The prevalence numbers also can't tell you how often these patterns actually cause problems in practice. The 33,625 findings exist in code that generally works — most of these repositories are actively maintained, widely used, and don't have open issues about resource exhaustion. Some percentage of these findings are real bugs. Some are survivable leaks in code paths that execute infrequently. Some are false positives from the function-scope limitation. Without manual review of a ground-truth sample, we can't split those categories.

What the corpus data *does* confirm is that these patterns are present in production code at high rates — including in mature, well-maintained, widely-reviewed repositories. The controlled experiments tell you what happens when they manifest under load. Connecting those two data sources is the point of this study.

The 87.8% prevalence number is real. The failure time data is real. Whether your specific 87 lines of `emitter.on()` calls will cause a problem depends on usage patterns, listener lifecycle, and event frequency that static analysis alone can't determine. But the first step is knowing they're there.

---

## Appendix: Running the detector on your own code

The detector is available in the study repository:

```bash
git clone https://github.com/liangk/empirical-study
cd empirical-study/studies/06-resource-leaks
npm install
npm run detect -- --path /path/to/your/project
```

Output format:

```
[HIGH] unclosed_connection
  src/db/queries.ts:42
  Connection created with 'connect' without close/release in function scope

[MEDIUM] unclosed_event_listener
  src/server/handlers.ts:108
  Event listener added with 'on' without removeListener/off
```

Files larger than 1 MB are skipped (generated code is expensive to parse and rarely the source of handwritten leaks). Test files, declaration files, and `node_modules` are excluded automatically.

The full corpus scan data — 33,625 findings across 368 repositories — is available in the `results/` directory of the study repository.

---

*Source: [empirical-study](https://github.com/liangk/empirical-study) repository, `studies/06-resource-leaks/`. Corpus scan data from `results/findings-2026-03-23T13-09-13.json` and `results/prevalence-2026-03-23T13-09-13.json`. Previous article in this series: "How Fast Do Node.js Resource Leaks Fail? A Six-Subsystem Scaling Study."*
