---
title: "Suspected Resource Leak Patterns in 87.8% of 368 Production Node.js Repositories: A Static Analysis Study"
pubDate: "2026-03-24"
heroImage: "../../assets/resource-leaks-corpus-detector.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "I scanned 368 Node.js production repositories using a Babel AST detector for six resource leak patterns. 323 of them — 87.8% — matched at least one suspicious pattern (false positive rate unvalidated). 33,625 total findings. The dominant pattern was unclosed event listeners at 57.7%, followed by streams at 20.7% and timers at 14.4%. The fastest-killing leak types in controlled experiments (connection pools: 132 ms median exhaustion, HTTP sockets: 245 ms) appeared in only 7.2% of findings. The leak types that degrade slowly and evade standard heap monitoring dominate real code."
excerpt: "I scanned 368 production Node.js repositories for six resource leak patterns. 87.8% matched at least one suspicious pattern (false positive rate unvalidated). The leak types that fail fastest in controlled experiments are the rarest in production code. The ones that degrade slowly are everywhere."
lastmod: "2026-03-24"
ai_summary: "Corpus study scanning 368 Node.js production repositories using a Babel AST detector covering six resource leak patterns aligned with benchmark modules BM-01 through BM-06. 323 repositories (87.8%) had at least one finding. Total findings: 33,625. Pattern distribution: unclosed_event_listener 19,385 (57.7%), unclosed_stream 6,950 (20.7%), unclosed_timer 4,835 (14.4%), unclosed_connection 2,225 (6.6%), resource_without_cleanup 197 (0.6%), unclosed_file_handle 33 (0.1%). Severity: medium 24,417, high 9,208. Zero scan errors across all 368 repositories. Key finding: fastest-failing leak types in controlled experiments (connection pools at 132 ms, HTTP sockets at 245 ms) are the least prevalent in production code. Slowest-degrading types (event listeners, streams) dominate. The detector uses Babel AST traversal with per-function-scope WeakMap caching for a single-pass analysis."
key_takeaways:
  - "87.8% of 368 scanned Node.js repositories matched at least one suspicious resource leak pattern (false positive rate not yet validated against a labeled ground-truth set)."
  - "unclosed_event_listener was the most prevalent at 57.7% of all 33,625 findings."
  - "The fastest-failing leak types in controlled experiments — connections (132 ms) and HTTP sockets (245 ms) — together accounted for only 7.2% of real-world findings."
  - "Top repositories by finding count: mongodb/node-mongodb-native (3,629), ReactiveX/rxjs (2,988), cypress-io/cypress (2,649), bitwarden/clients (2,640)."
  - "Zero scan errors across all 368 repositories in the final run."
  - "The detector runs all six rules in a single AST pass using WeakMap-cached per-function scope analysis."
keywords:
  - "Node.js"
  - "Resource Leaks"
  - "Static Analysis"
  - "AST"
  - "Babel"
  - "Event Listeners"
  - "Streams"
  - "Connection Pool"
  - "Software Reliability"
  - "TypeScript"
  - "Corpus Study"
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

I scanned 368 production Node.js repositories for six resource leak patterns. 323 of them matched at least one suspicious pattern. That's 87.8%.

*A note on what these numbers mean: all findings are static analysis pattern matches, not confirmed resource leaks. The detector's false positive rate has not been validated against a labeled ground-truth set — that evaluation is planned as Phase 4 of this study. The 33,625 count is simultaneously an upper bound on confirmed true leaks (false positives inflate it) and a lower bound on total real leaks in the corpus (false negatives deflate it). A precision/recall evaluation against a labeled ground-truth set would narrow both toward the actual figure.*

The [previous article in this series](https://stackinsight.dev/blog/resource-leak-scaling-empirical-study) measured how fast each leak type kills a simulated service under load: connection pools in 132 ms, HTTP sockets in 245 ms, file descriptors in 10–25 seconds, timers and event listeners in 600 ms to 25 seconds depending on failure threshold. All controlled discrete-event simulations — parameterized, reproducible, no real OS handles.

This article covers what happens when you apply the same detection logic to real production code.

## The Corpus

400 repositories selected across 8 domains: Web APIs, CLI Tools, Database/ORM, File Processing/Build Tools, Real-time/WebSocket, DevOps/Infrastructure, Testing Tools, and Data Processing/Messaging. Selection criteria: ≥100 GitHub stars, JavaScript or TypeScript as the primary language, active maintenance within the last 18 months, server-side or CLI code.

The corpus targets 400 repositories (50 per domain). The corpus parser loaded 368 of them for the March 24, 2026 run; 32 entries were filtered during loading due to format discrepancies, inactive repositories, or placeholder entries added during earlier corpus construction that did not resolve to valid Node.js repositories. Zero scan errors against the loaded 368.

For each repository, the scanner:

1. Clones a shallow copy (`--depth 1`)
2. Discovers all `.ts`, `.js`, `.mts`, `.mjs`, `.cts`, `.cjs` source files, excluding `node_modules/`, `dist/`, `build/`, `coverage/`, `.d.ts` declaration files, and test directories
3. Parses each file with `@babel/parser` (TypeScript + JSX plugins, `errorRecovery: true`), skipping files larger than 1 MB
4. Runs all six detection rules in a single AST traversal pass
5. Streams findings to disk as they are produced

The streaming write in step 5 is load-bearing. An earlier implementation accumulated all `LeakFinding` objects in memory before writing. At `mongodb/node-mongodb-native` — 564 source files, 3,629 findings — that caused an OOM. The current implementation writes each finding immediately and tracks only counters in memory.

## Results

33,625 findings across 323 repositories. 45 repositories had zero findings.

| Pattern | Count | Share | Benchmark | Controlled median TTF |
|---|---:|---:|---|---|
| `unclosed_event_listener` | 19,385 | 57.7% | BM-06 | 600 ms – 6.0 s |
| `unclosed_stream` | 6,950 | 20.7% | BM-03 | 12.9 s – 25.7 s |
| `unclosed_timer` | 4,835 | 14.4% | BM-05 | 1.25 s – 25.6 s |
| `unclosed_connection` | 2,225 | 6.6% | BM-01 | 132 ms – 880 ms |
| `resource_without_cleanup` | 197 | 0.6% | BM-04 | 245 ms – 3.1 s |
| `unclosed_file_handle` | 33 | 0.1% | BM-02 | 10.8 s – 21.5 s |
| **Total** | **33,625** | | | |

By severity: 9,208 high, 24,417 medium. Severity is assigned by pattern type based on failure mode in the controlled experiments: `unclosed_connection`, `unclosed_file_handle`, and `unclosed_stream` are **high** because they exhaust a hard OS or pool capacity limit (FD ceiling, pool size); `unclosed_timer`, `unclosed_event_listener`, and `resource_without_cleanup` are **medium** because they degrade performance without hitting a hard system boundary.

*(Controlled TTF figures are simulation-time durations from the linked scaling study, not wall-clock measurements.)*

**Finding distribution.** The distribution across repositories is heavily right-skewed. Among the 323 repositories with at least one match: median 25 findings, P90 202 findings. The top 10 repositories account for 16,380 findings — **48.7% of the total** — from 2.7% of the corpus. The distribution implies that a small number of large, event-driven codebases drive the aggregate pattern counts, while the majority of repositories have modest match counts in the single-to-double digits.

## The Inversion

The two fastest-failing leak types in controlled experiments — connection pool exhaustion and HTTP socket accumulation — together account for 7.2% of all findings. The two most prevalent types — event listeners and streams — are the ones with slower, harder-to-detect failure modes.

This isn't random. It reflects survivability pressure.

A connection pool leak fails loudly. Pool has 20 slots, leak rate 10%, concurrency 100: the pool exhausts in 132 ms of simulation time. Requests time out. Error rates spike immediately. The bug gets noticed and fixed within a deployment cycle. It *has* to be, because the service is completely unusable within seconds.

An event listener leak doesn't work that way. `emitter.on('data', handler)` — the listener accumulates. Nothing breaks on the next request, or the one after. The emitter's `_events` object grows by one entry. V8's GC cannot collect the handler because the emitter holds a strong reference. The heap grows by whatever the handler closure captures — 4 KB in the BM-06 benchmark, more in production closures with application state. The `emit('data')` call now invokes N+1 callbacks instead of N. That's an O(N) dispatch. At 1,000 accumulated listeners, emit latency in the BM-06 event-frequency case reached 30 ms per event. Events fired faster than that fanout could drain. Six seconds to complete failure — and on a standard heap dashboard, you're looking at a few megabytes of growth. Nothing alarming.

That survivability pressure is consistent with the inversion — though the same pattern could also reflect base rate differences: EventEmitter and timer APIs are simply used more frequently in Node.js than connection pool APIs, so there are more opportunities for the detector to match. The two explanations are not mutually exclusive, and the data cannot distinguish between them without controlling for how often each resource type appears in the corpus independent of leak patterns. Either way, the failure mode is the same: slow degradation with no hard-limit alarm.

## Top Repositories

| Repository | Findings | Domain |
|---|---:|---|
| mongodb/node-mongodb-native | 3,629 | Database/ORM |
| ReactiveX/rxjs | 2,988 | Data Processing |
| cypress-io/cypress | 2,649 | Testing Tools |
| bitwarden/clients | 2,640 | Security / Identity† |
| googleapis/google-cloud-node | 1,030 | DevOps |
| microsoft/playwright | 969 | Testing Tools |
| NodeBB/NodeBB | 717 | Real-time |
| pouchdb/pouchdb | 640 | Database/ORM |
| RocketChat/Rocket.Chat | 630 | Real-time |
| triggerdotdev/trigger.dev | 475 | DevOps |

†*`bitwarden/clients` is a password manager, not a DevOps tool. The study's eight-domain taxonomy does not include a security category; it was placed in DevOps/Infrastructure as the closest available bucket. The domain label does not affect the findings.*

Finding count correlates with codebase size. `mongodb/node-mongodb-native` has 564 scanned source files and extensive stream and connection handling throughout — exactly the two patterns the detector targets most heavily.

**The RxJS case: a systematic false positive source.** `rxjs` has 2,988 matches, almost entirely `unclosed_timer` and `unclosed_event_listener`. This is a known limitation of function-scope analysis applied to observable-lifecycle libraries: RxJS manages cleanup through `Subscription.unsubscribe()` and `takeUntil()` at an abstraction layer the detector cannot see. The detector correctly identifies that `.on()` / `setInterval()` calls in RxJS internals have no `off()` / `clearInterval()` in the same function scope — it cannot know that the cleanup happens via observable disposal higher up the call chain.

Sensitivity check: removing `rxjs` alone reduces total findings to 30,637 and prevalence to 87.5% (322/368 repos). Removing all six observable-lifecycle libraries in the corpus (`rxjs`, `xstream`, `kefir`, `highland`, `bacon.js`, `most`) reduces findings by 3,251 to 30,374, with prevalence at 86.1% (317/368 repos). The headline finding is robust: 86–88% prevalence regardless of whether you exclude the most plausible systematic false positive category.

The domain-level pattern is consistent. Real-time repos (`socketio/socket.io`: 293, `NodeBB/NodeBB`: 717, `RocketChat/Rocket.Chat`: 630) show heavy event listener and connection counts — they're connection-per-client architectures built on top of EventEmitter. Testing frameworks (`cypress-io/cypress`: 2,649, `microsoft/playwright`: 969) show timer and listener patterns — expected for infrastructure that polls browser state and maintains browser-facing event channels. Build tools (`nrwl/nx`: 392, `pnpm/pnpm`: 86) show stream patterns — file I/O pipelines that create streams for transform operations.

## The Detector

Six rules run in a single Babel AST traversal pass:

**`unclosed_connection`** — detects `createConnection`, `connect`, `open`, `createPool`, `getConnection` without `close`, `end`, `destroy`, `release`, `disconnect`, or `dispose` in the enclosing function scope. Also checks for `try/finally` with a close method, and `using` declarations (TC39 explicit resource management).

**`unclosed_stream`** — detects `createReadStream`, `createWriteStream`, `pipe` without `close`, `end`, or `destroy`. Exception: streams piped to `res` or `response` are excluded (standard web server response pattern).

**`unclosed_file_handle`** — detects `fs.open`, `fs.promises.open`, `openSync` without `close` or `closeSync` in scope.

**`resource_without_cleanup`** — detects `new WebSocket()`, `new Worker()`, `new EventSource()`, `new BroadcastChannel()`, `new MessageChannel()`, `new AbortController()` without expected cleanup methods (`close`, `terminate`, `abort`).

**`unclosed_timer`** — detects bare `setInterval` / `setTimeout` calls (not method calls) without `clearInterval` / `clearTimeout` in scope.

**`unclosed_event_listener`** — detects `.on()`, `.addListener()`, `.addEventListener()` without `.off()`, `.removeListener()`, `.removeEventListener()` in scope.

Each rule checks cleanup in the enclosing function scope only. Cleanup in a different function — a separate `cleanup()` method, a class destructor, a higher-order subscription manager — produces a false negative, not a false positive.

The performance-critical path is scope analysis. Without caching, a function body with N suspicious call expressions would be re-traversed N times. The implementation caches per-function analysis in a `WeakMap` keyed on the function AST node:

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

  traverse(scopeNode, {
    CallExpression(innerPath) { /* collect method names */ },
    VariableDeclaration(innerPath) { /* detect 'using' */ },
    TryStatement(innerPath) { /* detect finally-close */ },
  }, scope);

  functionAnalysisCache.set(scopeNode, analysis);
  return analysis;
}
```

The `WeakMap` allows the GC to reclaim entries when the corresponding AST nodes are no longer referenced — important when scanning thousands of files sequentially. Without this, total heap during a scan of a large monorepo would grow proportionally to the total number of functions across all files.

## Precision and Coverage

The detector is intentionally conservative. It only flags patterns where cleanup is absent in the same lexical function scope. This produces a lower false positive rate at the cost of a higher false negative rate.

What the detector misses:
- Cleanup delegated to a different function or method
- Cleanup via higher-order abstractions (RxJS `Subscription`, `AbortSignal`, `using` with custom disposable)
- Cleanup registered on a parent lifecycle hook (`ngOnDestroy`, React `useEffect` return, etc.)

What the detector flags:
- Resources created and never cleaned up in a self-contained function
- Timer or listener setup in a function with no corresponding clear/remove

Phase 4 of this study will establish precision and recall against a labeled ground-truth set — 50 confirmed true positives and 50 confirmed true negatives — to quantify how much of the 33,625 is real signal and how much is structural noise from patterns like observable lifecycle management.

## Mapping to Operational Risk

The controlled experiments established failure times per pattern. Applied to the corpus distributions:

**High operational risk, low prevalence.** Connection leaks (`unclosed_connection`: 2,225 findings, 6.6%) are the fastest-failing pattern — 132 ms median exhaustion at moderate concurrency. Low prevalence suggests they get fixed quickly when they manifest in production — or that connection pool code is simply less prevalent in the corpus, though the practical implication is the same either way.

**Moderate operational risk, high prevalence.** Event listener leaks (`unclosed_event_listener`: 19,385 findings, 57.7%) fail through dispatch amplification and event-loop saturation rather than capacity exhaustion. The BM-06 experiments reached failure in 600 ms to 6 s, but the failure signal is emit latency and event-loop lag — metrics most teams don't instrument at all. These leaks survive in production because standard heap monitoring doesn't catch them.

**Variable risk.** Timer leaks (`unclosed_timer`: 4,835, 14.4%) have the widest failure range in the controlled experiments: 1.25 s when timers fire at high frequency (1 ms interval), 25.6 s for slow-firing timers. The failure mode is event-loop saturation via callback accumulation, not heap exhaustion. A `setInterval` firing at 1 ms leaked into 1,000 accumulated instances fires 10^6 callbacks per second — past Node.js's single-threaded saturation point.

## What to Instrument

Standard `process.memoryUsage().heapUsed` monitoring will miss connection pool exhaustion (capacity problem, not memory), give only a lagging signal for FD leaks, and actively mislead for timer and listener leaks where the failure is latency, not heap size.

Specific signals, per pattern class:

**Event listeners.** Node.js emits `MaxListenersExceededWarning` at 10 listeners per emitter by default. That warning is real signal. Don't silence it. For programmatic inspection:

```typescript
import { EventEmitter } from 'events';

function auditEmitter(emitter: EventEmitter, name: string, threshold = 20): void {
  for (const event of emitter.eventNames()) {
    const count = emitter.listenerCount(event as string);
    if (count > threshold) {
      console.warn(`[leak-audit] ${name} '${String(event)}': ${count} listeners`);
    }
  }
}

// Call periodically in long-running services
setInterval(() => auditEmitter(myEmitter, 'myEmitter'), 30_000).unref();
```

**Timers and event-loop saturation.** The `perf_hooks` `monitorEventLoopDelay` histogram measures actual event-loop lag. A rising P99 is the primary signal for timer accumulation:

```typescript
import { monitorEventLoopDelay } from 'perf_hooks';

const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();

setInterval(() => {
  const p99Ms = histogram.percentile(99) / 1e6;
  if (p99Ms > 50) process.stderr.write(`[loop-lag] P99=${p99Ms.toFixed(1)}ms\n`);
  histogram.reset();
}, 30_000).unref();
```

**Connection pools.** Watch `waitingCount` (requests queued for an available connection). A continuously climbing `waitingCount` indicates connection slots are not being returned:

```typescript
setInterval(() => {
  const { totalCount, idleCount, waitingCount } = pool;
  if (waitingCount > 5) {
    console.warn(`[pool] waiting=${waitingCount} total=${totalCount} idle=${idleCount}`);
  }
}, 10_000).unref();
```

## What This Means for Prioritization

The central finding — that the fastest-failing leak types are the rarest in production code — has a direct implication for how teams should prioritize.

Don't build your remediation queue by failure speed. Build it by detectability gap.

Connection pool leaks and FD leaks fail loudly: request timeouts, EMFILE crashes, pool-full errors that surface immediately in logs and are hard to ignore. The open work is on the other side of the table: event listener accumulation and timer proliferation, which account for 72% of all matches in this corpus and fail through signals — emit latency, event-loop lag — that most monitoring stacks don't track at all.

The 45 zero-finding repositories are also informative, though a systematic breakdown — by domain, file count, and resource API usage — is deferred to the Phase 4 evaluation. Informally, the correlation between codebase size and match count is visible across the top-repository data; the zero-finding set likely represents the opposite end of that distribution, but that claim needs the data to back it.

The practical question this study can't answer is what fraction of the 33,625 matches are genuine bugs versus intentional long-lived resource patterns. That requires a ground-truth labeled evaluation, which is the next phase. What this study establishes is the floor: these patterns are present at high rates in mature, well-reviewed codebases that ship production software used by millions of developers. Some fraction of them are real bugs. Identifying which ones requires the monitoring instrumentation described in the previous section — not a static analysis tool, but runtime signals that catch actual accumulation.

## Running the Detector

```bash
git clone https://github.com/liangk/empirical-study
cd empirical-study/studies/06-resource-leaks
npm install
npm run detect -- --path /path/to/your/project
```

Sample output:

```
[HIGH] unclosed_stream
  src/pipeline/transform.ts:87
  Stream created with 'createReadStream' without close/destroy in function scope

[MEDIUM] unclosed_event_listener
  src/workers/handler.ts:214
  Event listener added with 'on' without removeListener/off
```

Files over 1 MB are skipped. `node_modules/`, `dist/`, `build/`, coverage directories, and `.d.ts` files are excluded automatically.

The full corpus findings — 33,625 entries from a scan of 368 repositories (323 contributed at least one finding) — can be reproduced locally by cloning the study repository and running `npm run realworld:scan` from `studies/06-resource-leaks/`. The scanner writes `findings-<timestamp>.json` and `prevalence-<timestamp>.json` to the `results/` directory.

---

**Study source:** [github.com/liangk/empirical-study](https://github.com/liangk/empirical-study), `studies/06-resource-leaks/`. Previous article: [How Fast Do Node.js Resource Leaks Fail?](https://stackinsight.dev/blog/resource-leak-scaling-empirical-study)

---

*[Code Evolution Lab](https://codeevolutionlab.com) builds static analysis tooling, performance diagnostics, and codebase audits for Node.js and TypeScript teams. If the detector or methodology described here is relevant to your infrastructure, the work is open and the contact is on the site.*
