---
title: "How Fast Do Node.js Resource Leaks Fail? A Six-Subsystem Scaling Study"
pubDate: "2026-03-21"
heroImage: "../../assets/resource-leak-scaling-empirical-study.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "We redesigned and re-ran six Node.js resource leak simulation experiments to answer the operator's question that matters most: when does a leak stop being survivable? The scaling results show three distinct failure classes. Connection pool leaks collapse in 132 ms to 880 ms. HTTP socket leaks follow at 245 ms to 3.1 s. File descriptor and stream leaks usually fail over 10-26 s. Redesigned timer and event-listener experiments, which previously had no finite time-to-failure, now produce operational exhaustion signals from 600 ms to 25.6 s. This article presents the final medians, explains the redesign, and shows why leak detection must be tied to the subsystem being leaked."
excerpt: "Most leak articles reduce everything to memory growth. That misses the practical question: how long until the system stops being usable? We redesigned six Node.js leak simulation experiments and found that some leaks kill a service in under a second, while others take 20+ seconds to cross an operational failure threshold."
lastmod: "2026-03-21"

ai_summary: "This article presents the cross-module scaling and exhaustion analysis for a six-module Node.js resource leak study. The study covers connection pool leaks (BM-01), file descriptor leaks (BM-02), stream leaks (BM-03), HTTP socket leaks (BM-04), timer leaks (BM-05), and event-listener leaks (BM-06). The central result is that resource leaks do not share a common time scale or failure mode. Connection pools fail fastest, with median observed time-to-exhaustion of 132 ms in the leak-probability × concurrency case and 535-880 ms in other failing BM-01 cases. HTTP sockets are similarly aggressive, ranging from 245 ms to 3.1 s across the cases that crossed the threshold. File descriptors and streams fail more slowly but still within operationally relevant windows, typically 10.8-25.7 s, with BM-02 and BM-03 showing near-parallel behavior because both are handle-accumulation problems. The most important methodological result is the redesign of BM-05 and BM-06. Earlier timer and listener experiments recorded growth but often produced null time-to-exhaustion because these leaks do not naturally map to a fixed-capacity pool. The redesign added operational thresholds for scheduler overload, event-loop latency, emit latency, heap growth, and listener-count saturation. After the redesign, BM-05 produced finite medians from 1.25 s to 25.6 s and BM-06 produced finite medians from 600 ms to 6.0 s, except for one listener closure-size case that showed measurable growth without crossing the threshold in the experiment horizon. The updated scaling logic now summarizes finite observed time-to-exhaustion only where failure actually occurred, preserving null regions instead of forcing a false single trend."
key_takeaways:
  - "Connection pool leaks (BM-01) were the fastest failures in the study: median observed exhaustion fell as low as 132 ms."
  - "HTTP socket leaks (BM-04) also failed quickly, with medians from 245 ms to 3.1 s in the cases that crossed thresholds."
  - "File descriptor and stream leaks (BM-02, BM-03) formed a slower class, usually exhausting in 10.8-25.7 s."
  - "The BM-05 timer redesign succeeded: timer leaks now produce finite operational failure signals, with the timer-interval × creation-rate case failing at a median 1.25 s."
  - "The BM-06 listener redesign also succeeded: listener leaks now fail through dispatch amplification and latency, not only heap retention, with medians from 600 ms to 6.0 s."
  - "Not every parameter combination exhausted within the test window; the updated scaling logic preserves those null regions instead of pretending they failed."
keywords:
  - "Node.js"
  - "Resource Leaks"
  - "Connection Pool"
  - "File Descriptors"
  - "Streams"
  - "HTTP Sockets"
  - "Timers"
  - "Event Listeners"
  - "Time to Failure"
  - "Event Loop Latency"
  - "Software Reliability"
  - "TypeScript"
schema_type: "TechArticle"
schema_proficiency_level: "Advanced"
schema_dependencies: "Node.js v24+, TypeScript 5+"
schema_time_required: "PT20M"
categories:
  - "Software Performance"
  - "Software Reliability"
  - "Web Development"
series: "Software Reliability Empirical Studies"
---

During a recent incident review I was staring at a Grafana dashboard when it hit me: we'd been asking the wrong question about resource leaks for years.

Every article, every conference talk, every "detect memory leaks in Node.js" tutorial — they all focus on the same thing. Memory goes up. That's the signal. Watch your heap.

And sure, that's *true*. But it's not the question you're actually asking at 2 AM when your pager goes off. The real question — the one that determines whether you're fixing this in five minutes or five hours — is much simpler:

**How long do I have before this thing is completely dead?**

That's what I set out to model. I built six simulation experiments covering the major resource leak categories in Node.js — connection pools, file descriptors, streams, HTTP sockets, timers, and event listeners. Each runs as a discrete-event simulation: no real OS handles opened, resource limits set as explicit config parameters, results deterministic and reproducible. Across 27 cases spanning hundreds of individual parameter grid configurations, I measured modeled time-to-failure: how long each simulated system takes to cross its configured operational threshold. The answer surprised me.

The modeled failure times span three orders of magnitude. Some scenarios exhaust their resource budget in 132 model-milliseconds. Others take 25 seconds. And timer leaks and listener leaks didn't produce any finite failure signal at all until I redesigned how the experiments define failure.

Here's what I found.

## What we're actually measuring (and why it matters)

Before we get into numbers, you'll want to understand the six subsystems I tested. Think of these as the six ways a Node.js service can bleed resources:

- **BM-01: Connection pool leaks** — your database pool hands out connections that never come back
- **BM-02: File descriptor leaks** — `fs.open()` without `close()`, the classic EMFILE crash
- **BM-03: Stream leaks** — `createReadStream()` without `destroy()`, where the exhaustion clock is driven by the same FD accumulation mechanism as BM-02, but streams carry additional heap baggage
- **BM-04: HTTP socket leaks** — outbound HTTP connections that pile up and never release
- **BM-05: Timer leaks** — `setInterval()` without `clearInterval()`, slowly choking the event loop
- **BM-06: Event listener leaks** — `emitter.on()` without `off()`, amplifying every event dispatch

For each one, I ran 2D parameter grids — varying things like leak probability, concurrency, error rates, and resource limits — and measured the time it took to cross an operational failure threshold.

*Quick note on methodology:* All experiments run as discrete-event simulations under Node.js v24 on Windows x64 — but no real file handles, database connections, or sockets are opened. Every resource limit (pool size, FD cap, socket count) is a parameter in the experiment config, not derived from the host OS. Two things this means for interpreting the results. First, the FD exhaustion timings don't involve Windows HANDLE semantics — the simulator enforces its own configured ceiling. Second, the subsecond results (132 ms, 245 ms) are simulation-time durations driven by the event model, not wall-clock measurements on Windows hardware. Windows timer resolution (15.6 ms default) and libuv's IOCP vs epoll difference don't affect the simulation's internal event counts or accumulation model. The simulators are seeded (deterministic). For BM-05 and BM-06, each case has its own specific failure threshold — the exact values are shown in the case tables below. For subsecond results, I use the raw `medianMs` values rather than the rounded `medianHuman` strings, because the JSON rounds 132 ms to "0s" — technically correct, but not helpful when you're trying to understand failure speed.

## The big picture: three very different ways to die

Here are the final numbers. Take a moment with this table — it's the most important thing in the article:

| Module | What's leaking | Cases that failed | Modeled time to failure |
|---|---|---:|---|
| BM-01 | Connection pool slots | 3 of 5 | **132 ms – 880 ms** |
| BM-02 | File descriptors | 4 of 4 | **10.8 s – 21.5 s** |
| BM-03 | Streams | 4 of 4 | **12.9 s – 25.7 s** |
| BM-04 | HTTP sockets | 4 of 5 | **245 ms – 3.1 s** |
| BM-05 | Timers | 4 of 4 | **1.25 s – 25.6 s** |
| BM-06 | Event listeners | 4 of 5 | **600 ms – 6.0 s** |

*(All failure times are simulation-time durations — model-milliseconds throughout, not wall-clock measurements.)*

Three distinct failure patterns jump out immediately:

**The "blink and you're down" leaks** — connection pools and HTTP sockets (BM-01, BM-04). These exhaust a hard capacity limit. Say your pool has 10 slots: leak 10, you're done. If your monitoring samples once a minute, you'll miss the entire incident.

**The "slow burn" leaks** — file descriptors and streams (BM-02, BM-03). These accumulate handles steadily. You've got maybe 10–25 seconds before the configured FD ceiling is hit. Long enough to notice something's wrong. Short enough that you probably can't fix it before it crashes.

**The "death by a thousand cuts" leaks** — timers and listeners (BM-05, BM-06). These don't run out of a finite pool. They degrade the runtime itself — more callbacks to fire, more dispatch work per event, growing latency until the service just... stops responding.

That last group? That's the one nobody talks about properly. And it's the reason this study needed a redesign.

## We had to rethink what "failure" means for timers and listeners

Here's the problem I ran into.

Connection pools are easy to reason about. You've got 10 slots. You leak them. Eventually `pool.acquire()` throws because there's nothing left. Clear failure, clear measurement.

Timers and listeners don't work that way.

You can leak `setInterval` callbacks for a long time without hitting any obvious wall. There's no `EMFILE` equivalent for timers. No hard limit that triggers an error. The process just gets progressively slower, the event loop falls behind, and eventually — maybe — things fall over.

In the first version of these experiments, that's exactly what happened. The timers leaked. Memory grew. But `timeToExhaustion` stayed `null` because nothing technically "exhausted." The experiment was right — the leak was real — but it couldn't tell me *when* the service would stop being usable.

That's not a useful answer.

So I redesigned BM-05 and BM-06 to use **operational failure thresholds** — the kind of signals that actually correlate with "your users are now having a bad time":

- Event-loop latency crossing a threshold (your API stops responding in time)
- Callback rate overwhelming the scheduler (the runtime can't keep up)
- Heap growth exceeding a limit (the process is visibly sick)
- Listener count hitting saturation (every `emit()` does 10× more work than it should)
- Emit latency spiking (dispatching a single event takes longer than the event interval)

And just as important — the scaling logic now only summarizes time-to-failure **where failure actually happened**. Some parameter combinations leaked but didn't cross the threshold in the test window. Those stay `null`. I'm not going to pretend the entire grid failed just to get a cleaner chart.

This change turned timers and listeners from "yeah, they leak, we guess it's bad" into actual measurable results. That matters a lot.

## Connection pools: the 132-millisecond failure

Let's start with the scariest number in the study.

BM-01 — connection pool leaks — was the fastest failure across all six modules. And I don't mean "fast" as in a few seconds. I mean *blink-and-you're-down* fast.

| Case | What we tested | Median time to failure | What else we saw |
|---|---|---:|---|
| Case 1 | Leak probability × Concurrency | **132 ms** | 87% failure rate, 20 leaked connections |
| Case 4 | Error rate × Leak-on-error | **535 ms** | Throughput cratered to 9 req/s |
| Case 5 | Leak probability × DB max connections | **880 ms** | 20 leaked connections, throughput at 44.6 req/s |
| Case 2 | Query time × Pool size | Didn't fail in window | But: 138 ms mean latency, 90% failure rate |
| Case 3 | Burst size × Acquire timeout | Didn't fail in window | But: 60 ms p95 latency, 80% failure rate |

132 milliseconds. That's faster than a human can read a log line.

To be specific about where this came from: the 132 ms median is from the high-concurrency, high-leak-probability corner of the Case 1 grid — pool size 20, concurrency 50–100, leak probability 10–20%. A non-leaking run at the same concurrency serves requests cleanly with sub-10 ms acquire times. The leaking version exhausted all 20 pool slots and hit 87% failure. Same pool, same workload, completely different outcome.

Here's what's happening mechanically: your pool has 20 connection slots. Under high concurrency with even a 10% leak probability, those slots disappear almost instantly because every tenth request fails to return its connection. New requests queue up, the acquire timeout kicks in, and suddenly 87% of your requests are failing. Not "slow" — *failing*.

And here's the part that should make you nervous: **the error path matters just as much as the happy path**. Case 4 tested what happens when connections leak specifically during error handling — the `catch` block that forgets to release the connection back to the pool. That scenario still collapsed in just over half a second.

The two cases that didn't technically "fail" in the test window are worth understanding. Case 2 sweeps query time × pool size: when queries are long-held, the pool saturates because connections are legitimately in use — a slower release cadence means leaked slots get partially masked by connections timing out and being reclaimed. The pool degrades hard (90% failure, 138 ms latency) but never fully drains in the test window. Case 3 is a bursty arrival pattern: between bursts, the steady-state leak rate isn't fast enough to drain the remaining pool before the next measurement cycle. Both are at brownout severity — your users are already mad — just not at the specific "zero slots remaining" threshold.

The takeaway: if you're leaking pool connections, you don't have a memory problem. You have an admission-control problem. And it happens *fast*.

## File descriptors: the 10-second slow burn

BM-02 moves us into a different failure rhythm. File descriptor leaks are slower than pool leaks, but "slower" here means 10–22 seconds. Not exactly a leisurely pace.

| Case | What we tested | Median time to failure | What else we saw |
|---|---|---:|---|
| Case 1 | Leak probability × Concurrency | **12,907 ms** | 224 leaked FDs |
| Case 2 | File size × FD limit | **14,750 ms** | 47.7 MB heap growth, 267 peak active FDs |
| Case 3 | Error rate × Leak-on-error | **21,510 ms** | 366 leaked FDs |
| Case 4 | Open rate × FD limit | **10,769 ms** | 99 ops/s throughput, 128 leaked FDs |

Every single case produced a finite time-to-failure. No ambiguity here — FD leaks are deterministic. The simulator enforces its own configured FD ceiling, independent of the OS running the experiments. In production, the equivalent limit is set via `ulimit -n` — typically 1,024 files per process on Linux (often raised to 65,536 on servers), 256 on default macOS. The modeled failure pattern applies regardless of your target OS; only the specific ceiling value differs.

The interesting case is Case 2. File size doesn't really affect *when* you run out of descriptors — the limit is about the count, not the bytes. But file size matters enormously for how sick the process *looks* before it dies. That 47.7 MB of heap growth is the process bloating while the real killer (FD exhaustion) is still ticking down in the background.

This is a pattern operators see all the time in production: the memory dashboard goes yellow, everyone starts investigating heap usage, but the actual crash comes from EMFILE. The heap growth was a symptom, not the cause.

For a concrete baseline: a non-leaking run at the same concurrency and open rate keeps the active FD count near zero — every open is immediately followed by a close, throughput holds at the configured maximum. The 10–22 second failure window is simply ceiling ÷ net-leak-rate: fill time from the first unclosed handle to the configured FD maximum.

## Streams: same clock, more heap baggage

I tested stream leaks (BM-03) separately from raw FD leaks, and the timing is almost identical — which is actually a useful validation, not a surprise.

| Case | What we tested | Median time to failure | What else we saw |
|---|---|---:|---|
| Case 1 | Leak probability × Concurrency | **12,879 ms** | 224 leaked streams, 14.7 MB heap growth |
| Case 2 | File size × Leak probability | **25,715 ms** | 4.3 MB heap growth |
| Case 3 | Error rate × Error handling | **21,515 ms** | 366 leaked streams |
| Case 4 | Stream type × Leak probability | **25,695 ms** | Only 3 finite samples (sparse) |

Look at how close the matched cases are:

- BM-02 Case 1: **12,907 ms** → BM-03 Case 1: **12,879 ms**
- BM-02 Case 3: **21,510 ms** → BM-03 Case 3: **21,515 ms**

Within 30 ms of each other. This is exactly what you'd expect if the failure clock is driven by FD accumulation in both cases — and that's precisely the point. Streams add internal buffering, `'error'` event handling, backpressure signaling, and `'close'` events that bare FD handles don't have. But none of that changes *when* the process runs out of file descriptors. The stream abstraction adds no material timing overhead to the exhaustion path.

The practical difference? Streams carry more heap baggage. A bare FD leak is mostly invisible on a memory dashboard until the EMFILE crash. A stream leak at least gives you a visible heap signal while the clock is ticking.

The non-leaking baseline for both: handles opened and closed within each simulated operation, active handle count stays near zero, heap growth stays flat. The 12–26 second failure window is the fill time from zero to the configured ceiling — the stream abstraction changes nothing about that math.

## HTTP sockets: the other fast killer

If connection pools are the fastest-to-fail, HTTP sockets are a close second. BM-04 produced some genuinely alarming numbers.

| Case | What we tested | Median time to failure | What else we saw |
|---|---|---:|---|
| Case 1 | Leak probability × Concurrency | **1,050 ms** | 72% failure rate, 50 leaked sockets |
| Case 2 | Timeout × Concurrency | Didn't fail in window | But: 60 ms p95 latency, 85% failure rate |
| Case 3 | Error rate × Error handling | **2,210 ms** | Throughput dropped to 26 ops/s |
| Case 4 | Response size × Concurrency | **3,135 ms** | 17 ms p95 latency |
| Case 5 | Keep-alive × Leak probability | **245 ms** | 13 finite failure samples |

Case 5. **245 milliseconds.**

That's the keep-alive scenario — and it's not some exotic edge case. Keep-alive is the default for HTTP connections in Node.js. When leaked sockets under keep-alive pile up, the failure is almost instantaneous. Quarter of a second and you're down.

For context: a non-leaking keep-alive scenario under the same simulated concurrency reuses connections from the socket pool without accumulation. Requests complete at the simulated baseline latency with pool utilization staying low. The 245 ms isn't a slow single request — it's the interval from first leaked socket to zero pool slots remaining.

Case 2 is also worth thinking about. It didn't technically cross the exhaustion threshold, but with an 85% failure rate and 60 ms p95 latency, your users are already complaining. This is the difference between a brownout (everything's slow, some things fail) and a blackout (everything fails). Both are bad. But a brownout might not trigger your alerts if they're only watching for complete failures.

## Timers: the redesign that made the invisible visible

This is where the story gets interesting.

BM-05 — timer leaks — was the module that *didn't work* before the redesign. The timers leaked, sure. Memory grew. But the original experiments couldn't tell me when a timer leak becomes an actual problem, because there's no hard cap. No EMFILE. No pool exhaustion. Just... more callbacks.

After redesigning with operational thresholds, every single case now produces a real time-to-failure:

| Case | What we tested | Failure threshold | Median time to failure | What else we saw |
|---|---|---|---:|---|
| Case 1 | Leak probability × Creation rate | latency > 5 ms or heap > 1 MB | **24,730 ms** | 12.5 leaked timers, 2,337 callback invocations |
| Case 2 | Closure size × Leak probability | latency > 8 ms or heap > 5 MB | **10,900 ms** | 164 KB heap growth |
| Case 3 | Timer interval × Creation rate | latency > 3 ms or heap > 1 MB | **1,250 ms** | 30 leaked timers, 8,573 callbacks |
| Case 4 | Timer type × Leak probability | latency > 6 ms or heap > 2 MB | **25,600 ms** | Only 2 finite samples (sparse) |

Case 3 is the proof this redesign was worth doing.

A timer-interval × creation-rate sweep now fails at **1.25 seconds**, with 32 solid data points backing it up. That's a real number. Not "it might be a problem someday" — it's "your event loop is overwhelmed in just over a second."

You might notice Case 3 fails *faster* than Case 1 despite having more leaked timers (30 vs 12.5). The 30 is the median count accumulated at the point the latency threshold was crossed — with leak probability sweeping around 50% in the parameter grid, roughly half of the 50–100 timers created per second were never cleared during the 1.25-second run. That seems backwards until you look at the mechanism. Case 1 sweeps leak probability × creation rate — the leaked timers use a much slower baseline interval, on the order of seconds rather than milliseconds. Case 3 explicitly sweeps *timer interval down to 1 ms* × creation rate. At 1 ms intervals, each leaked `setInterval` fires 1,000 times per second. Creating them at 50–100 timers/second means the callback queue grows by tens of thousands of pending invocations per second. Case 1's leaked timers fire far less frequently, so it takes much longer to saturate the event loop despite similar timer counts.

The lesson: the interval matters as much as the count. A slowly-firing leaked timer is mostly a heap problem. A fast-firing one is an event-loop problem.

What's happening mechanically in Case 3: when you create 1ms-interval timers at 50–100 timers/second and never clear them, the accumulating timers collectively fire at roughly 50,000 invocations per second. For simple no-op callbacks, Node.js throughput is in the hundreds of thousands per second — but each of these leaked timers captures a closure and allocates heap. With that overhead, the effective saturation rate is far lower, and at 50,000 invocations/second the queue stops draining between ticks and starts growing. That's why Case 3's 3 ms latency threshold (the tightest of the four cases) is crossed within seconds, not minutes.

Case 2 adds another dimension. It's not just about *how many* timers you leak — it's about *how big their closures are*. But look at the numbers: 164 KB heap growth against a 5 MB heap ceiling. The heap branch of the threshold never fired. What happened instead: large closures increase GC mark-and-sweep work during each collection cycle. The heap stays under 5 MB, but collection pauses create latency spikes that eventually cross the 8 ms threshold. It's a latency failure caused by heap churn, not a heap-size failure — and that's actually the more interesting finding.

The sparse cases (Case 1 with 3 samples, Case 4 with 2) aren't failures of the methodology. They're the experiment honestly saying: "only part of this parameter space is bad enough to cross the threshold." And that's exactly what I wanted the scaling logic to preserve.

## Listeners: when every event does 10× more work than it should

BM-06 was the other redesign success, and the results tell a story most developers don't expect.

| Case | What we tested | Failure threshold | Median time to failure | What else we saw |
|---|---|---|---:|---|
| Case 1 | Leak probability × Listener count | listeners > 10 per emitter | **600 ms** | 11 leaked listeners, 45 KB heap growth |
| Case 2 | Closure size × Leak probability | listeners > 100 per emitter | Didn't fail in window | But: 88 KB heap growth, 12.5 leaked listeners |
| Case 3 | Event frequency × Listener count | listeners > 10,000 OR emit latency > 30 ms | **6,000 ms** | 30 ms emit latency, 1 MB heap, ~1,000 accumulated |
| Case 4 | Emitter count × Listeners per emitter | listeners > 10 per emitter | **3,400 ms** | 32 leaked listeners, 133 KB heap |
| Case 5 | Listener type (once vs on) × Leak prob | listeners > 10 per emitter | **5,100 ms** | 10 finite samples |

**600 milliseconds** for Case 1. That's faster than most people would guess for a listener leak.

And look at the heap growth: only 45 KB. That's practically nothing on a memory dashboard. You wouldn't notice it. But the service is already failing because every time the emitter fires an event, it's calling 11 extra callbacks that shouldn't be there. It's not a memory problem — it's a CPU and latency problem.

This connects directly to a Node.js runtime behaviour worth knowing: Node.js warns by default when any single emitter exceeds **10 listeners** (`MaxListenersExceededWarning`). That default threshold of 10 is exactly what the Case 1 and Case 4 experiments use as their failure boundary — which means in production, you'd actually get a warning before the latency degrades if you're watching stderr. The warning is real signal, not noise. Most teams silence it. They probably shouldn't.

Case 3 is the clearest illustration of what I call "dispatch amplification." Here's the chain:

1. You leak listeners on a hot emitter
2. Each `emit()` now invokes ~1,000 callbacks instead of the expected handful
3. Emit latency grows to 30 ms per event
4. If events fire faster than 30 ms apart, the system falls behind permanently

Heap grew to 1 MB — noticeable but not the trigger. Here's the thing: ~1,000 listeners accumulated, but the listener-count threshold was 10,000 — the count branch was never crossed. Case 3 failed through the *other* half of its dual threshold: emit latency hitting 30 ms. With ~1,000 callbacks invoked per `emit()`, per-dispatch cost eventually crossed 30 ms. At that point events fire faster than they can be processed and the queue grows without bound. The listener-count ceiling was a safety net; the emit-latency ceiling is what actually fired. It took 6 seconds.

Case 2 is a useful reference point, but with an important caveat: its failure threshold (listeners > 100 per emitter) is ten times higher than Cases 1, 4, and 5 (listeners > 10). The case accumulated 12.5 listeners — 88 below its own threshold. It didn't fail — not because large-closure listeners are inherently safer, but because the threshold wasn't reachable at that accumulation rate in the test window. If you read it as 'large closures don't cause failures,' that's the wrong takeaway; the threshold difference is the confound.

## The on-call mental model: three kinds of incidents

If you took all six experiments and turned them into a cheat sheet for incident response, it'd look like this:

### "We're down" — pools and sockets

Connection pools (BM-01) and HTTP sockets (BM-04) fail because a finite shared resource simply runs out. Pool has 10 slots, you leak 10 slots, game over. Sockets work the same way.

The failure is *fast*. We're talking sub-second to a few seconds. If your monitoring only checks in once a minute, you'll see "it was fine, then it was dead" with nothing useful in between.

What to watch: active vs. max connections, acquisition failures, queue depth, and — this is the one people miss — **cleanup behavior on error paths**. The experiments showed error-driven leaks failing almost as fast as steady-state leaks.

### "We're degrading" — FDs and streams

File descriptors (BM-02) and streams (BM-03) fail through steady accumulation. You've got maybe 10–25 seconds. Long enough to notice something's wrong in your logs. Short enough that you probably can't ship a fix before it crashes.

These are the incidents where the operator says "it looked fine, then it got flaky, then it died." That 10–25 second window maps perfectly to a service that's slowly losing the ability to open new files or sockets.

What to watch: open handle count, error-path cleanup success rate, and — because of what BM-02 Case 2 showed us — heap growth *alongside* handle growth. A pure memory dashboard will mislead you. The handle count is the leading indicator.

### "We're getting slower and we don't know why" — timers and listeners

Timers (BM-05) and listeners (BM-06) fail because the *runtime itself* gets overwhelmed. No clean "resource exhausted" error. No EMFILE. Just mounting pressure on the event loop and dispatch paths until the service just... stops responding.

This is the failure class that most monitoring setups miss entirely. Your heap looks okay-ish. Your CPU might be elevated but not pegged. But every request is taking significantly longer than it should because leaked timer callbacks and listener fanout are eating your event loop's lunch.

What to watch: timer cardinality, callback rate, event-loop delay, listeners per emitter, and emit latency. These aren't metrics most teams track, which is exactly why these leaks are so insidious.

Event-loop delay is the most actionable starting point. Node.js exposes it natively via `perf_hooks`:

```js
// CJS; for ESM projects: import { monitorEventLoopDelay } from 'perf_hooks';
const { monitorEventLoopDelay } = require('perf_hooks');
const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();

setInterval(() => {
  console.log('p99 event loop delay (ms):', histogram.percentile(99) / 1e6);
  histogram.reset();
}, 5000);
```

For active timer and listener counts, `process.getActiveResourcesInfo()` (Node.js v17.3+) gives you a breakdown of what's currently alive in the event loop. A growing `Timeout` or `Interval` count in that list is a direct leak signal. The Node.js documentation on [monitoring event loop utilization](https://nodejs.org/api/perf_hooks.html#performanceeventlooputilizationutilization1-utilization2) and Clinic.js's [Bubbleprof](https://clinicjs.org/bubbleprof/) are both useful references if you want to go deeper.

## What you shouldn't overclaim from this data

I want to be upfront about the limitations, because it's easy to take a table of numbers and overfit a narrative.

### The threshold choice matters

The BM-05 and BM-06 results exist because we defined operational failure thresholds. Different thresholds would give different numbers. That's by design — production systems also define failure operationally — but it means these medians aren't universal constants. They're "time to cross *this* line, under *these* conditions."

### Some results are sparse. That's honest, not weak

A few cases only crossed the failure threshold in a small subset of the parameter grid:

- BM-05 Case 1: just 3 finite samples (range: 21.5 s – 27.9 s)
- BM-05 Case 4: just 2 finite samples (range not reportable)
- BM-06 Case 5: 10 finite samples (range: 2.1 s – 8.3 s)
- BM-03 Case 4: 3 finite samples (range: 22.1 s – 29.4 s)

With 2–3 finite samples, the reported median has very little statistical weight. What these cases tell you is that failure *exists* in that region of the parameter space — not that the median is precise. Treat the sparse-case numbers as order-of-magnitude signals, not exact thresholds. I could've smoothed over the nulls to make a cleaner story, but that would've been dishonest.

### "Didn't fail in the window" doesn't mean "safe"

BM-01 Cases 2 and 3, BM-04 Case 2, and BM-06 Case 2 all showed strong degradation signals — high failure rates, rising latency, visible resource accumulation — without technically crossing the exhaustion threshold in the test window.

The right reading isn't "these are safe." It's "these didn't get bad enough *yet*, under this test duration, with this threshold." In production, with longer runtime and higher traffic, the story might be very different.

## So what should you actually do?

If there's one thing to take away from this, it's that **you can't instrument all resource leaks the same way**.

A heap-growth dashboard is fine for catching some leaks. But it'll miss pool exhaustion entirely (that's a capacity problem, not a memory problem). It'll be a lagging indicator for FD leaks (the handle count fills up before heap growth gets dramatic). And it'll actively mislead you for timer and listener leaks (where the failure is latency and throughput degradation, not memory consumption).

Match your monitoring to the failure mode:

- **Pools and sockets** → watch capacity utilization and acquisition failures
- **FDs and streams** → watch handle counts and error-path cleanup rates
- **Timers** → watch callback cardinality and event-loop delay
- **Listeners** → watch per-emitter listener counts and emit latency

That's the real lesson from running 27 experiment cases across 6 subsystems: resource leaks aren't one problem. They're at least three very different problems wearing the same label.

And once you stop treating them as one thing, both the diagnosis and the fix get a lot clearer.

## About this research

This article presents the cross-module scaling and exhaustion analysis from a six-module Node.js resource leak study — it covers how failure times compare and scale across subsystems. Each module also has its own deeper simulation article:

- **[BM-01: Connection Pool Exhaustion](https://stackinsight.dev/blog/resource-leak-empirical-study-part1/)** — how 1% leak rates kill production services
- **[BM-02: File Descriptor Exhaustion](https://stackinsight.dev/blog/resource-leak-empirical-study-part2/)** — how fs.open() leaks trigger EMFILE
- **[BM-03: Stream Leaks](https://stackinsight.dev/blog/resource-leak-empirical-study-part3/)** — how createReadStream without destroy() causes dual EMFILE and OOM failures
- **[BM-04: HTTP Socket Exhaustion](https://stackinsight.dev/blog/resource-leak-empirical-study-part4/)** — how http.request() leaks destroy Node.js services
- **[BM-05: Timer Leaks](https://stackinsight.dev/blog/resource-leak-empirical-study-part5/)** — how setInterval without clearInterval silently saturates Node.js
- **[BM-06: Event Listener Leaks](https://stackinsight.dev/blog/resource-leak-empirical-study-part6/)** — how emitter.on() without off() degrades Node.js services

Other studies in this series:

- [Loop Performance Anti-Patterns](https://stackinsight.dev/blog/loop-performance-empirical-study) — 40 repos, six modules, 64× improvement from O(n²) → Map
- [Missing Index Crisis](https://stackinsight.dev/blog/missing-index-empirical-study) — 40 Prisma repos, 1,209 missing indexes, 190× slowdown
- [Frontend Memory Leaks](https://stackinsight.dev/blog/memory-leak-empirical-study) — 500 repos, 55,864 instances, ~8 KB/cycle retained heap

All simulation code, experiment data, and analysis scripts are open source on [GitHub](https://github.com/liangk/empirical-study). Built at [StackInsight](https://stackinsight.dev).
