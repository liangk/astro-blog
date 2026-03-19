---
title: "Event Listener Leaks: A Five-Case Simulation Study of How emitter.on() Without off() Degrades Node.js Services"
pubDate: "2026-03-19"
heroImage: "../../assets/resource-leak-empirical-study-part6.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "We built a discrete-event event listener simulator and ran five two-dimensional parameter grid experiments to measure how listener leak probability, listener count, closure size, event frequency, emitter topology, and listener type interact to cause MaxListenersExceeded warnings, heap growth, and emit latency degradation. At 100 listeners per emitter with 10% leak rate, MaxListeners threshold is exceeded immediately. Emit latency scales linearly with listener count: 1,000 listeners = 30ms per emit. emitter.once() is no safer than emitter.on() if the event never fires. This is Part 6 of our resource leak study, focusing on BM-06: event listener leaks."
excerpt: "Event listener leaks have three simultaneous failure modes: MaxListenersExceeded warnings (Node.js default limit is 10), heap growth from closure retention (30,000 leaked listeners × 4KB = 117MB), and emit latency degradation linear with listener count (1,000 listeners = 30ms per emit at 1,000Hz = 465M callbacks). emitter.once() is not safer than on() if the event never fires — listeners accumulate identically."
lastmod: "2026-03-19"
canonical_url: "https://stackinsight.dev/blog/resource-leak-empirical-study-part6"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - nodejs event listener leak
  - emitter.on without off
  - MaxListenersExceededWarning nodejs
  - removeEventListener nodejs
  - emitter.off nodejs
  - event listener memory leak
  - nodejs EventEmitter leak
  - emitter.once vs on nodejs
  - event listener cleanup nodejs
  - nodejs listener count warning
  - emit latency nodejs
  - EventEmitter maxListeners
  - removeListener nodejs
  - event emitter resource leak
  - listener accumulation nodejs

# AIEO (AI Engine Optimization)
ai_summary: "This empirical study uses a discrete-event event listener simulator to run five two-dimensional parameter grid experiments measuring how event listener leaks cause MaxListenersExceeded warnings, heap growth, and emit latency degradation. Case 1 (Leak Probability × Listeners Per Component): With 100 listeners per component at 10% leak, MaxListeners threshold is exceeded immediately (TTE=0ms). At 10 listeners per component × 1% leak: 26 leaked listeners, TTE 13.5s. Heap scales as leaked count × closure size. Case 2 (Closure Size × Leak Probability): Identical to timer leaks — heap = leaked count × closure size. 57 leaked listeners × 1MB = 57MB heap. Case 3 (Event Frequency × Listener Count): Total callbacks = listener count × emit frequency × time. 1,000 listeners × 1,000Hz × 30s = 465 million callbacks. Emit latency scales linearly at 0.03ms per listener: 1,000 listeners = 30ms per emit. Case 4 (Emitter Count × Listeners Per Emitter): MaxListeners threshold is per-emitter, not global. With 1 emitter and 50 listeners/emitter at 5% leak: TTE 400ms. With 100 emitters and same configuration: TTE 5,200ms (listeners spread across more emitters). Case 5 (Listener Type × Leak Probability): emitter.once() and emitter.on() accumulate identically when the event never fires. Leaked listeners, heap growth, TTE, and callback invocations are identical for both types."
ai_key_facts:
  - "MaxListenersExceeded warning fires when any single emitter exceeds 10 listeners (Node.js default)"
  - "100 listeners per component × 10% leak = MaxListeners exceeded immediately (TTE=0ms)"
  - "10 listeners per component × 1% leak = 26 leaked listeners, TTE 13.5s"
  - "Heap growth = leaked listener count × closure size (identical formula to timers)"
  - "57 leaked listeners × 1MB closure = 57MB heap growth"
  - "Emit latency scales linearly: 0.03ms per leaked listener → 1,000 listeners = 30ms per emit"
  - "1,000 listeners × 1,000Hz emit rate = 465 million callbacks in 30 seconds"
  - "MaxListeners threshold is per-emitter: concentrating on 1 emitter is 100× more dangerous"
  - "emitter.once() is NOT safer than on() when the event never fires — both accumulate identically"
  - "emitter.off(event, callback) requires storing the callback reference — anonymous callbacks cannot be removed"
ai_entities:
  - "Node.js"
  - "EventEmitter"
  - "emitter.on"
  - "emitter.off"
  - "emitter.once"
  - "removeListener"
  - "MaxListenersExceededWarning"
  - "maxListeners"
  - "emit latency"
  - "Closure"
  - "Heap Memory"
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
  - event-emitter
  - resource-leaks
  - MaxListenersExceeded
  - performance
  - typescript
  - benchmarking
  - simulation
  - empirical-study
  - event-listeners
  - error-handling
  - heap-memory
  - emit-latency
  - closures

# Related
related_posts:
  - "resource-leak-empirical-study"
  - "resource-leak-empirical-study-part5"
  - "resource-leak-empirical-study-part2"
series: "Backend Performance Empirical Studies"
series_order: 11
---

# Event Listener Leaks: How `emitter.on()` Without `off()` Degrades Node.js Services

You've seen the warning in Node.js logs:

```
MaxListenersExceededWarning: Possible EventEmitter memory leak detected.
11 data listeners added to [EventEmitter]. Use emitter.setMaxListeners() to increase limit.
```

The standard response is to call `emitter.setMaxListeners(20)` to silence the warning and move on. That's the wrong fix — the warning is correct. The emitter is accumulating listeners that are never being removed, and increasing the limit just lets the leak continue further before you notice.

Event listener leaks are unique among Node.js resource leaks because they have **three simultaneous failure modes**:

1. **MaxListenersExceeded warning** — when any single `EventEmitter` accumulates more than 10 listeners for the same event (the Node.js default)
2. **Heap growth** — every leaked listener holds its closure in memory indefinitely
3. **Emit latency degradation** — every `emitter.emit()` call must invoke all registered listeners synchronously; more listeners = higher latency per emit

I built a discrete-event event listener simulator and ran five two-dimensional parameter experiments. The results reveal where each failure mode becomes operationally critical — and correct a common misconception: `emitter.once()` is not safer than `emitter.on()` when the event never fires.

Event listener leaks simultaneously produce three distinct failure signals: MaxListenersExceeded warnings (>10 listeners on any single emitter), heap growth from retained closures (57 leaked listeners × 1MB = 57MB heap), and emit latency degradation linear with listener count (1,000 leaked listeners = 30ms per emit; at 1,000Hz = 465 million callbacks per 30 seconds). The MaxListeners threshold is per emitter — concentrating listeners on 1 emitter is 100× more dangerous than spreading across 100. And `emitter.once()` accumulates listeners identically to `on()` if the event never fires.

---

## The Pattern

An event listener leak occurs when you register a listener with `emitter.on()` but never remove it with `emitter.off()`:

```typescript
// Leaky — common in WebSocket handlers, pub/sub consumers
class DataProcessor {
  constructor(private bus: EventEmitter) {}

  start() {
    // New listener added every time start() is called
    // If start() is called again (reconnect, reinit), listeners accumulate
    this.bus.on('data', (payload) => {
      this.processData(payload); // 'this' captured in closure
    });
  }
  // No stop() method — no way to remove the listener
}
```

The insidious version with anonymous callbacks:

```typescript
// Leaky — anonymous function cannot be removed later
function setupStream(stream: Readable, processor: DataProcessor) {
  stream.on('data', (chunk) => {
    processor.handle(chunk); // processor captured in closure
  });
  stream.on('error', (err) => {
    processor.reportError(err); // cannot call stream.off() with anonymous function
  });
}
```

You cannot remove an anonymous listener because `emitter.off(event, callback)` requires an exact reference to the function you registered. Once the anonymous function is created inline, it's anonymous — there's no way to remove it.

In a service that reconnects WebSocket handlers, reinitializes data consumers, or runs multiple concurrent request handlers sharing an emitter, listeners accumulate on every initialization cycle.

---

## The Simulation

The listener simulator models `emitter.on()` registration, `emitter.emit()` dispatch, and `emitter.off()` removal (or leak). Parameters:

| Parameter | What it controls |
|-----------|-----------------|
| `leakProbability` | Chance a listener is not removed (0–100%) |
| `listenersPerComponent` | Listeners each component registers (1–100) |
| `closureSize` | Bytes captured per listener closure (0B–1MB) |
| `emitFrequencyHz` | How often `emitter.emit()` is called (1–1,000 Hz) |
| `emitterCount` | Number of separate `EventEmitter` instances (1–100) |
| `listenerType` | `on` vs `once` |

**Metrics collected:**
- **Leaked listener count** — total registered listeners never removed
- **Heap growth** — captured closure memory from leaked listeners
- **Time-to-exhaustion** — when MaxListeners threshold is exceeded on any emitter
- **Total callback invocations** — all listener callbacks fired during simulation
- **Mean emit latency** — milliseconds per `emitter.emit()` call (proxy for event loop overhead)

---

## 1. Leak Probability vs. Listeners Per Component

### Time-to-MaxListeners-exceeded

| | 0% leak | 1% | 5% | 10% | 20% | 50% | 100% |
|---|---|---|---|---|---|---|---|
| **1 listener/component** | ∞ | ∞ | 20.9s | 9.6s | 5.0s | 2.1s | 1.0s |
| **2 listeners/component** | ∞ | ∞ | 13.9s | 6.4s | 2.0s | 1.0s | 0.5s |
| **5 listeners/component** | ∞ | ∞ | 6.3s | 2.2s | 0.9s | 0.4s | 0.2s |
| **10 listeners/component** | ∞ | 13.5s | 2.0s | 1.0s | 0.3s | 0.2s | 0.1s |
| **20 listeners/component** | ∞ | 4.9s | 1.0s | 0.4s | 0.2s | 0.1s | 0ms |
| **50 listeners/component** | ∞ | 2.0s | 0.4s | 0.1s | 0ms | 0ms | 0ms |
| **100 listeners/component** | ∞ | 1.0s | 0.2s | 0ms | 0ms | 0ms | 0ms |

*MaxListeners threshold: 10 per emitter (Node.js default).*

`0ms` means MaxListeners is exceeded before the simulation clock advances — the very first leak exhausts the threshold.

At **100 listeners per component with 10% leak**: a single component initialization leaks 10 listeners onto the emitter — exactly matching the MaxListeners default. The warning fires immediately.

At **10 listeners per component with 1% leak**: TTE 13.5 seconds. The leak is slow but inevitable.

### Leaked listener count

| | 1% leak | 5% | 10% | 20% | 50% | 100% |
|---|---|---|---|---|---|---|
| **1 listener/component** | 4 | 19 | 36 | 57 | 140 | 300 |
| **10 listeners/component** | 26 | 147 | 308 | 594 | 1,493 | 3,000 |
| **50 listeners/component** | 145 | 743 | 1,517 | 2,997 | 7,496 | 15,000 |
| **100 listeners/component** | 285 | 1,475 | **3,000** | 6,015 | 14,939 | 30,000 |

At 100 listeners per component with 100% leak (every component fails to clean up): **30,000 leaked listeners** over a 30-second simulation.

### Heap growth (4KB closure per listener)

| | 1% leak | 5% | 10% | 20% | 50% | 100% |
|---|---|---|---|---|---|---|
| **1 listener/component** | 16 KB | 77 KB | 147 KB | 234 KB | 573 KB | 1.2 MB |
| **10 listeners/component** | 104 KB | 591 KB | 1.2 MB | 2.4 MB | 5.9 MB | 11.7 MB |
| **50 listeners/component** | 580 KB | 2.9 MB | 5.9 MB | 11.7 MB | 29.3 MB | 58.6 MB |
| **100 listeners/component** | 1.1 MB | 5.8 MB | 11.7 MB | 23.5 MB | 58.4 MB | **117 MB** |

*30,000 leaked listeners × 4KB each = 117MB at 100% leak, 100 listeners/component.*

Components registering many listeners per lifecycle are extremely dangerous — 10 listeners per mount with 10% leak rate triggers MaxListeners in 1 second. MaxListeners is a leading indicator, not the actual failure; the real damage is heap growth and emit latency. The warning fires early enough to act on — treat it as a critical alert, not noise to suppress with `setMaxListeners(100)`.

---

## 2. Closure Size vs. Leak Probability

### Heap growth by closure size

| | 0B | 1KB | 4KB | 16KB | 64KB | 256KB | 1MB |
|---|---|---|---|---|---|---|---|
| **0% leak** | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **1% leak** (4 listeners) | 0 | 4 KB | 16 KB | 64 KB | 256 KB | 1.0 MB | 4.0 MB |
| **2% leak** (6 listeners) | 0 | 6 KB | 24 KB | 96 KB | 384 KB | 1.5 MB | 6.0 MB |
| **5% leak** (19 listeners) | 0 | 19 KB | 76 KB | 304 KB | 1.2 MB | 4.8 MB | 19.1 MB |
| **10% leak** (36 listeners) | 0 | 36 KB | 144 KB | 576 KB | 2.3 MB | 9.1 MB | **35.2 MB** |
| **20% leak** (57 listeners) | 0 | 57 KB | 228 KB | 912 KB | 3.6 MB | 14.4 MB | **57.0 MB** |

*Fixed: 1 listener/component configuration.*

Identical behavior to BM-05 timer closures: **heap growth = leaked count × closure size, linearly.**

The dangerous real-world scenario: listeners capturing React/Vue component state, service objects, or request contexts:

```typescript
// Captures the entire 'component' object in closure
service.on('userUpdate', (event) => {
  component.state.user = event.user;     // component is ~100KB state tree
  component.renderUserBadge();
  component.notifyChildren(event);
});
// If component.cleanup() doesn't call service.off('userUpdate', handler),
// the component object is retained in the listener closure forever
```

If `component` is 100KB and 57 listeners leak over a session: **5.7MB of component state retained** — across all active users, this scales to GB.

Same formula as timer leaks: heap = count × closure size. Listeners capturing large service objects are the highest-risk pattern — per-request or per-session listeners that capture full session state are particularly dangerous. Zero-closure listeners cause zero heap growth; the danger is always in what the closure captures.

---

## 3. Event Frequency vs. Listener Count

### Total callback invocations

| | 1Hz | 10Hz | 50Hz | 100Hz | 500Hz | 1,000Hz |
|---|---|---|---|---|---|---|
| **1 listener** | 435 | 4,620 | 23,220 | 46,470 | 232,470 | 464,970 |
| **10 listeners** | 4,350 | 46,200 | 232,200 | 464,700 | 2,324,700 | 4,649,700 |
| **100 listeners** | 43,500 | 462,000 | 2,322,000 | 4,647,000 | 23,247,000 | 46,497,000 |
| **500 listeners** | 217,500 | 2,310,000 | 11,610,000 | 23,235,000 | 116,235,000 | 232,485,000 |
| **1,000 listeners** | 435,000 | 4,620,000 | 23,220,000 | 46,470,000 | 232,470,000 | **464,970,000** |

At **1,000 leaked listeners × 1,000Hz emit frequency**: **465 million callback invocations** over 30 seconds — over 15 million per second. At typical event handler execution times of microseconds, this represents dozens of seconds of CPU time per second. The event loop cannot process anything else.

Contrast with the manageable end: **1 listener × 1Hz**: 435 callbacks over 30 seconds — completely invisible.

### Mean emit latency

| | 1Hz | 10Hz | 50Hz | 100Hz | 500Hz | 1,000Hz |
|---|---|---|---|---|---|---|
| **1 listener** | 0.03ms | 0.03ms | 0.03ms | 0.03ms | 0.03ms | 0.03ms |
| **10 listeners** | 0.30ms | 0.30ms | 0.30ms | 0.30ms | 0.30ms | 0.30ms |
| **50 listeners** | 1.5ms | 1.5ms | 1.5ms | 1.5ms | 1.5ms | 1.5ms |
| **100 listeners** | 3.0ms | 3.0ms | 3.0ms | 3.0ms | 3.0ms | 3.0ms |
| **500 listeners** | 15ms | 15ms | 15ms | 15ms | 15ms | 15ms |
| **1,000 listeners** | 30ms | 30ms | 30ms | 30ms | 30ms | **30ms** |

**Mean emit latency scales perfectly linearly with listener count at 0.03ms per listener.** Emit frequency has no effect on per-call latency — each emit still invokes all listeners synchronously.

But emit frequency determines the *aggregate CPU time*:
- 100 listeners × 1Hz × 30s = 100 × 3.0ms × 30 = **9 seconds of CPU** for emits alone
- 100 listeners × 1,000Hz × 30s = 100 × 3.0ms × 30,000 = **9,000 seconds of CPU** — impossible in 30 real seconds

The 1,000Hz case with 100+ listeners is catastrophically over-budget. The event loop can only process ~33,333ms of work per second. 100 listeners × 3ms × 1,000 Hz = 300,000ms of work per second scheduled — 9× CPU capacity. Everything else in the process starves.

Emit latency = 0.03ms × listener count — a deterministic formula. High-frequency emitters are the critical path: 100 leaked listeners on a stream emitting 100 times/second = 300ms/second of extra CPU just for dispatch. The safe zone is under 50 listeners on any high-frequency emitter. Above 100 listeners at 100Hz+, degradation becomes operationally significant. At the Node.js default of 10 listeners × 1,000Hz: 300ms/second — still manageable. At 100 listeners: 3,000ms/second — approaching saturation.

---

## 4. Emitter Count vs. Listeners Per Emitter

### Time-to-MaxListeners-exceeded

| Listeners/emitter | 1 emitter | 2 | 5 | 10 | 20 | 50 | 100 emitters |
|---|---|---|---|---|---|---|---|
| **1** | 20.9s | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |
| **5** | 6.3s | 7.9s | 12.9s | 20.7s | ∞ | ∞ | ∞ |
| **10** | 2.0s | 4.1s | 5.2s | 14.5s | 24.3s | ∞ | ∞ |
| **20** | 1.0s | 2.1s | 3.3s | 5.7s | 11.9s | 20.6s | 21.4s |
| **50** | 0.4s | 0.4s | 1.1s | 1.4s | 2.1s | 3.7s | 5.2s |
| **100** | 0.2s | 0.3s | 0.4s | 0.4s | 1.0s | 1.8s | 1.8s |

*Fixed: 5% leak probability.*

The table reveals the per-emitter nature of MaxListeners: **with 1 emitter and 1 listener/emitter at 5% leak: TTE = 20.9 seconds.** With 10 emitters and the same configuration: TTE = ∞ (never triggered in 30 seconds) because each emitter only accumulates ~2 leaked listeners (19 total ÷ 10 emitters).

At **50 listeners/emitter with 1 emitter: TTE = 0.4 seconds.** With 100 emitters: TTE = 5.2 seconds. More emitters distribute the listener load, but the total damage (heap, callback invocations) is identical — it's just distributed.

### Leaked listener count (independent of emitter count)

| Listeners/emitter | Any emitter count |
|---|---|
| **1** | 19 leaked |
| **5** | 73 leaked |
| **10** | 147 leaked |
| **50** | 743 leaked |
| **100** | 1,475 leaked |

**Total leaked listener count is identical regardless of emitter count.** Five percent of (emitter_count × listeners_per_emitter × operations) leak, regardless of how many emitters share those listeners.

MaxListeners is per-emitter, not global. Splitting listeners across more emitters delays the warning but doesn't reduce total heap or callback overhead. A single shared "bus" emitter is the highest-risk architecture — 100 listeners per component at 10% leak hits MaxListeners immediately. The architectural fix is fine-grained per-instance emitters. Increasing `maxListeners` delays the warning but doesn't stop the leak:

```typescript
// Wrong — silences the warning, doesn't fix the leak
emitter.setMaxListeners(100);

// Right — store the callback and remove it in cleanup
class Component {
  private readonly onDataHandler = (data: unknown) => this.handleData(data);

  mount(emitter: EventEmitter) {
    emitter.on('data', this.onDataHandler); // Stored as class property
  }

  unmount(emitter: EventEmitter) {
    emitter.off('data', this.onDataHandler); // Exact reference — removes correctly
  }
}
```

---

## 5. Listener Type vs. Leak Probability

### Leaked listener count comparison

| | 0% leak | 1% | 2% | 5% | 10% | 20% | 50% | 100% |
|---|---|---|---|---|---|---|---|---|
| **emitter.on()** | 0 | 4 | 6 | 19 | 36 | 57 | 140 | 300 |
| **emitter.once()** | 0 | 4 | 6 | 19 | 36 | 57 | 140 | 300 |

**Identical.** The listener type has zero effect on how many listeners accumulate when leaks occur.

### Heap growth comparison

| | 0% leak | 5% | 10% | 20% | 50% | 100% |
|---|---|---|---|---|---|---|
| **emitter.on()** | 0 | 77 KB | 147 KB | 234 KB | 573 KB | 1.2 MB |
| **emitter.once()** | 0 | 77 KB | 147 KB | 234 KB | 573 KB | 1.2 MB |

**Identical.** Both `on()` and `once()` retain their closure in heap memory until the listener is either removed or fires.

### Time-to-MaxListeners comparison

| | 5% leak | 10% | 20% | 50% |
|---|---|---|---|---|
| **emitter.on()** | 20.9s | 9.6s | 5.0s | 2.1s |
| **emitter.once()** | 20.9s | 9.6s | 5.0s | 2.1s |

**Identical.** The MaxListeners threshold counts all registered listeners, regardless of whether they're `on` or `once`.

### When does `once()` help — and when doesn't it?

`emitter.once()` auto-removes the listener after the event fires exactly once. This prevents accumulation **only if the event is guaranteed to fire before the component/scope is destroyed.**

```typescript
// SAFE: 'close' event always fires once — once() prevents leak
socket.once('close', () => cleanup());

// LEAKY: if 'authenticated' never fires (connection dropped first),
// the listener accumulates
socket.once('authenticated', (user) => {
  session.user = user; // session captured in closure — retained if never fires
});
```

In the second example, `once()` gives false safety. If the connection drops before `'authenticated'` fires, the listener is never removed, the `session` object is permanently retained, and MaxListeners accumulates on the socket emitter.

**`once()` is safe only when the event is guaranteed to fire.** For events that may or may not fire (error conditions, race conditions, connection states), treat `once()` the same as `on()` — store the reference and call `off()` explicitly in cleanup.

`emitter.once()` is not a leak prevention mechanism — it fires once and auto-removes only if the event fires. If the event never fires, it leaks identically to `on()`. The commonly held belief is wrong: replacing `on()` with `once()` doesn't fix listener leaks. The fix is always `emitter.off(event, callback)` with a stored reference. Anonymous callbacks are permanently leaked — once written as `emitter.on('event', () => { ... })`, there is no way to remove them.

---

## What I Found

Event listener leaks are the only resource leak type in this series that simultaneously produces three distinct failure signals:

| Failure mode | Trigger | Latency to first symptom |
|---|---|---|
| MaxListeners warning | Any emitter accumulates >10 listeners | Seconds to minutes |
| Heap growth | Closure retention | Gradual over minutes to hours |
| Emit latency degradation | >50 listeners on high-frequency emitter | Gradual, no hard threshold |

| Finding | Data point |
|---------|-----------|
| MaxListeners default | 10 per emitter |
| 100 listeners/component × 10% leak | MaxListeners exceeded immediately |
| 10 listeners/component × 1% leak | MaxListeners in 13.5s |
| Heap formula | leaked count × closure size |
| 57 leaked listeners × 1MB closure | 57MB heap growth |
| Emit latency formula | 0.03ms × listener count |
| 1,000 listeners × 1,000Hz | 465M callbacks in 30s, 30ms/emit |
| MaxListeners is per-emitter | 1 emitter vs 100 emitters: 5.2s vs ∞ TTE |
| once() vs on() | Identical behavior when event never fires |

---

## The Fix

**Stored callback reference (required for anonymous-style):**

```typescript
class DataConsumer {
  private readonly onMessage: (msg: Message) => void;

  constructor(private readonly emitter: EventEmitter) {
    // Store the bound method — same reference every time
    this.onMessage = (msg) => this.handleMessage(msg);
  }

  start(): void {
    this.emitter.on('message', this.onMessage);
  }

  stop(): void {
    this.emitter.off('message', this.onMessage); // Exact reference
  }
}
```

**Method binding (TypeScript class pattern):**

```typescript
class RequestHandler {
  // Bound method reference is stable across calls
  private readonly handleData = this.onData.bind(this);

  attach(stream: EventEmitter): void {
    stream.on('data', this.handleData);
    stream.on('end', this.handleEnd);
  }

  detach(stream: EventEmitter): void {
    stream.off('data', this.handleData);
    stream.off('end', this.handleEnd);
  }

  private onData(chunk: Buffer): void { /* ... */ }
  private handleEnd(): void { /* ... */ }
}
```

**Cleanup registry (for complex multi-listener components):**

```typescript
class Component {
  private cleanups: Array<() => void> = [];

  listen(emitter: EventEmitter, event: string, handler: (...args: any[]) => void): void {
    emitter.on(event, handler);
    // Register cleanup
    this.cleanups.push(() => emitter.off(event, handler));
  }

  destroy(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }
}

// Usage
const comp = new Component();
comp.listen(bus, 'data', (d) => handle(d));
comp.listen(bus, 'error', (e) => report(e));
comp.listen(bus, 'close', () => disconnect());

// On component lifecycle end:
comp.destroy(); // Removes all listeners at once
```

---

## Detection

### Static analysis

```bash
# Find emitter.on calls — verify each has a matching off
grep -rn "\.on(" src/ --include="*.ts" | grep -v "\.once\|EventEmitter\|\.on('"

# Count on vs off calls (should be balanced)
grep -c "emitter\.on\b\|\.on('" src/**/*.ts
grep -c "emitter\.off\|removeListener\|removeAllListeners" src/**/*.ts

# Find anonymous arrow functions in event listeners (cannot be removed)
grep -rn "\.on('[^']*', (" src/ --include="*.ts"
```

### Runtime monitoring

```typescript
// Monitor emitter listener counts
function checkListenerCounts(emitters: Map<string, EventEmitter>): void {
  for (const [name, emitter] of emitters) {
    for (const event of emitter.eventNames()) {
      const count = emitter.listenerCount(event as string);
      if (count > 8) { // Alert before MaxListeners default of 10
        console.warn(`[${name}] Event '${event as string}' has ${count} listeners`);
      }
    }
  }
}

// Override maxListeners to add monitoring
class MonitoredEmitter extends EventEmitter {
  constructor(name: string) {
    super();
    this.setMaxListeners(10); // Keep default
    this.on('newListener', (event, listener) => {
      const count = this.listenerCount(event);
      if (count > 7) {
        console.warn(`[${name}] Adding listener #${count + 1} to '${event}'`);
        // Log stack trace to find the caller:
        console.trace();
      }
    });
  }
}
```

---

## Caveats

**MaxListeners threshold simulation.** The simulation models MaxListeners as 10 per emitter (Node.js default). In practice, the warning is emitted but the listener is still registered — MaxListeners is a hint, not a hard limit. TTE in this study represents "when the warning fires," not "when the emitter stops working."

**Synchronous emit model.** Node.js `EventEmitter.emit()` is synchronous — all listeners execute before `emit()` returns. This is the model used in the simulation and is accurate for the standard `EventEmitter`. Async event systems (RxJS observables, async generators) have different scheduling semantics.

**Emit frequency modeling.** The simulation assumes a fixed emit frequency for the duration. Real systems have variable emit rates — bursty data processing, spike events, idle periods. The emit latency formula (0.03ms × listener count) is a steady-state approximation; bursty emitters may see higher instantaneous latency.

---

## Conclusion: the complete resource leak taxonomy

This is Part 6 and the final installment of the Node.js resource leak study. Across all six benchmark modules:

| Module | Resource limit | Failure mode | Key fix |
|--------|--------------|--------------|---------|
| BM-01 DB Pool | Pool size (20) | Pool exhaustion in seconds | `client.release()` in `finally` |
| BM-02 File FDs | OS limit (1,024) | EMFILE | `fd.close()` in `finally` |
| BM-03 Streams | OS limit + heap | EMFILE + OOM | `stream.destroy()` / `pipeline()` |
| BM-04 HTTP Sockets | Agent pool (50) | Socket starvation in seconds | `req.destroy()` in timeout/error |
| BM-05 Timers | None | Heap OOM + event loop lag | `clearInterval()` with stored ID |
| BM-06 Listeners | Per-emitter (10) | MaxListeners + heap + emit lag | `emitter.off()` with stored reference |

The consistent finding across all six: **resource leaks interact multiplicatively with workload parameters, and the only reliable mitigation is eliminating the leak at the source.**

---

## Try it yourself

```bash
git clone https://github.com/liangk/empirical-study.git
cd empirical-study/studies/06-resource-leaks
npm install

# Run all 5 BM-06 experiment cases
npm run experiments:bm06

# Run individual cases
npm run experiments:bm06:case1   # Leak Probability × Target Listener Count
npm run experiments:bm06:case2   # Closure Size × Leak Probability
npm run experiments:bm06:case3   # Event Frequency × Listener Count
npm run experiments:bm06:case4   # Emitter Count × Listeners Per Emitter
npm run experiments:bm06:case5   # Listener Type (once vs on) × Leak Probability
```

Results are saved to `src/step1-benchmarks/experiments/bm06/experiments-bm06-<timestamp>.json`.

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
