---
title: "DOM Manipulation That Kills Your 60fps: A Benchmarked Study of Layout Thrashing and Anti-Patterns Across 275 Repositories"
pubDate: "2026-05-03"
heroImage: "../../assets/dom-manipulation-empirical-study.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "I ran 5 Playwright browser benchmarks across 5 DOM node counts (100–10,000) to measure the real cost of layout thrashing, innerHTML-in-loop, and style-mutation-in-loop. Then I scanned 275 repositories. The innerHTML anti-pattern at n=10,000 hit 24.8 seconds — 8,000× slower than batching. 54.9% of repos had at least one anti-pattern. Here's the full data."
excerpt: "You know the advice: batch your DOM writes, cache your selectors, use DocumentFragment. But I've never seen anyone show you what it actually costs. So I built a benchmark suite and ran it on real Chromium. The innerHTML numbers will make you rethink everything."
lastmod: "2026-05-03"
canonical_url: "https://stackinsight.dev/blog/dom-manipulation-empirical-study"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - layout thrashing
  - dom manipulation performance
  - innerHTML loop performance
  - forced synchronous layout
  - documentfragment performance
  - dom anti-patterns
  - css class toggle vs style mutation
  - querySelector loop performance
  - dom benchmark chromium
  - frontend performance 60fps
  - reflow repaint optimization
  - javascript dom performance study
  - web performance empirical study
  - chrome devtools performance
  - requestAnimationFrame performance

# AIEO (AI Engine Optimization)
ai_summary: "This empirical study combines Playwright-based browser benchmarks of five DOM manipulation anti-patterns with a static analysis scan of 275 public repositories. BM-02 (innerHTML in loop) showed the most dramatic results: baseline at n=10,000 took 24,809ms versus 3.1ms optimized — an 8,000× difference. BM-01 (forced synchronous layout) showed consistent 1.5–2.3× slowdown across all scales. BM-03 (style mutation in loop) showed 2.7–3.4× slowdowns. BM-04 (querySelector in loop) showed 1.2–1.3× impact. BM-05 (appendChild vs DocumentFragment) showed essentially zero difference at all scales. The corpus scan found 2,789 anti-pattern instances across 151 of 275 repos (54.9% prevalence). Vanilla JS repos had the highest finding count (1,556) despite being only 40 of the 275 repos. forced_sync_layout was the most common high-severity pattern (861 findings), followed by style_mutation_in_loop (691) and innerhtml_in_loop (127). Top repos by finding count: mrdoob/three.js (195), highcharts/highcharts (156), SortableJS/Sortable (134), ag-grid/ag-grid (133)."
ai_key_facts:
  - "innerHTML in loop at n=10,000 took 24,809ms vs 3.1ms with template string — 8,000× slower"
  - "innerHTML in loop at n=1,000 took 223ms vs 0.4ms optimized — 570× slower, worse than any database query I've benchmarked"
  - "Forced synchronous layout (BM-01) showed consistent 1.5–2.3× slowdown across all node counts"
  - "Style mutation in loop (BM-03) showed 2.7–3.4× slowdown across all node counts"
  - "querySelector in loop (BM-04) showed minimal 1.2–1.3× impact — modern browsers cache selectors aggressively"
  - "appendChild × n vs DocumentFragment (BM-05) showed zero measurable difference at all scales — browsers coalesce DOM insertions"
  - "54.9% of 275 scanned repos had at least one DOM anti-pattern (151 of 275)"
  - "2,789 total anti-pattern findings across all 275 scanned repos"
  - "Vanilla JS repos averaged 38.9 findings each vs React at 7.1 — canvas and game engine code is the worst offender"
  - "Top offenders: three.js (195 findings), highcharts (156), SortableJS (134), ag-grid (133), codemirror5 (53)"
  - "React contributed 558 findings (20.0%), Vue 235 (8.4%), Angular only 13 (0.5%)"
  - "988 findings (35.4%) were classified as high-severity (forced_sync_layout or innerhtml_in_loop)"
ai_entities:
  - "Playwright"
  - "Chromium (Blink)"
  - "innerHTML"
  - "DocumentFragment"
  - "getBoundingClientRect"
  - "offsetWidth"
  - "offsetHeight"
  - "querySelector"
  - "appendChild"
  - "classList"
  - "requestAnimationFrame"
  - "Layout Thrashing"
  - "Reflow"
  - "Repaint"
  - "CSS cascade"
  - "CSSOM"
  - "three.js"
  - "highcharts"
  - "SortableJS"
  - "ag-grid"
  - "CodeMirror"
  - "React"
  - "Vue"
  - "Babel AST"

# Structured Data (Article Schema)
schema_type: "TechArticle"
schema_proficiency_level: "Intermediate"
schema_dependencies: "Node.js v24+, TypeScript 5+, Playwright 1.50+"
schema_time_required: "PT30M"

# Taxonomy
categories:
  - "Frontend Performance"
  - "Software Engineering Research"
  - "Web Development"
tags:
  - dom-manipulation
  - layout-thrashing
  - performance
  - benchmarking
  - chromium
  - playwright
  - anti-pattern
  - empirical-study
  - javascript
  - dom
  - reflow
  - repaint
  - frontend-performance

# Related
related_posts:
  - "memory-leak-empirical-study"
  - "bundle-bloat-empirical-study"
  - "blocking-io-empirical-study"
series: "Frontend Performance Empirical Studies"
series_order: 8
---

# DOM Manipulation That Kills Your 60fps: A Benchmarked Study of Layout Thrashing and Anti-Patterns Across 275 Repositories

Your users are scrolling through a list. It stutters. They're dragging items in a Kanban board. It lags. They filter a data table. The UI freezes for two seconds then snaps to the result.

You're quick to blame the network, the database, or React's reconciliation algorithm. But I've seen this pattern enough times to know: the bottleneck is almost always in the DOM.

Specifically, the way the code touches the DOM. One read after a write in a loop. Building up innerHTML piece by piece. Mutating individual style properties on every animation frame. These are the kinds of things that look harmless in a code review and destroy frame rate in production.

So I did what I always do: built a benchmark suite, ran it on real Chromium, then pointed an AST detector at 275 real repositories to see how common each pattern actually is.

The results surprised me. Not just *that* these anti-patterns hurt — but *how much* one of them hurts, and how irrelevant another one turned out to be.

---

## How the Browser Renders a Frame

Before diving into the benchmarks, you need a mental model for *why* these anti-patterns are expensive. The browser doesn't update the screen continuously — it processes rendering work in discrete phases. Each phase depends on the previous one completing cleanly:

```
Style Calculation → Layout → Paint → Layer Promotion → Composite
```

1. **Style Calculation**: The browser computes which CSS rules apply to which elements, building the computed style for each element.
2. **Layout**: The browser calculates the precise geometry (position, size) of each element in the document tree.
3. **Paint**: The browser fills in pixels — drawing text, images, borders, shadows.
4. **Layer Promotion**: The browser promotes certain layers (typically fixed/positioned elements, animated transforms, opacity changes) to their own compositing layers.
5. **Composite**: The browser assembles all layers onto the screen.

When you read a layout property like `offsetWidth`, the browser must give you an accurate answer. If there are pending style or layout changes, it has to flush them *right now* before returning the value. That's the forced synchronous layout — a synchronous (blocking) trip back to an earlier pipeline stage, right in the middle of your JavaScript.

When you write to `innerHTML`, the browser has to serialize the current DOM subtree to a string, parse the new HTML, and rebuild nodes. That's a full round-trip through the parsing subsystem.

Understanding these phases is the foundation for everything that follows.

---

## The 16.67ms Frame Budget

Every frame you want to paint has a fixed time budget: **1000ms ÷ 60fps = 16.67ms**. That's the maximum time all browser work on the main thread can consume per frame if you want smooth 60fps animation. Any work that exceeds this budget causes dropped frames — visible stutter.

For reference, a typical database query in a production system might take 5–20ms. One of the benchmarks shows `innerHTML` concatenation at n=1,000 taking **223ms** — not because the database is slow, but because the DOM is being serialized and re-parsed 1,000 times in a row, each time growing the string larger.

---

## The Five Patterns I Tested

The classic DOM performance advice covers five categories. I wanted to measure each one precisely:

| Module | Pattern | What goes wrong |
|--------|---------|----------------|
| BM-01 | Forced synchronous layout | Reading `offsetWidth` right after writing `style.width` inside a loop — forces the browser to flush pending layout work on every iteration |
| BM-02 | innerHTML in loop | Building HTML with `el.innerHTML +=` inside a loop — triggers n parse-and-serialize cycles, each growing in cost as the DOM tree expands |
| BM-03 | Style mutation in loop | Setting `el.style.X = Y` per element per property — each write marks the element as style-dirty, and the cascade must resolve each property mutation individually at recalculation time rather than bundling all declarations in a single pass |
| BM-04 | DOM query in loop | Calling `getElementById` or `querySelector` inside a loop — repeated DOM tree traversal |
| BM-05 | appendChild × n vs. DocumentFragment | Calling `appendChild` n times instead of batching via DocumentFragment |

Each module had a baseline (the anti-pattern) and an optimized version. I ran each across 5 node counts: 100, 500, 1,000, 5,000, and 10,000. 30 trials per configuration, warmup discarded. Real Chromium (headless, via Playwright). Results report the median across 25 accepted trials (coefficient of variation < 15%).

---

## The Benchmark Results

### BM-01: Forced Synchronous Layout

This is the classic "layout thrashing" pattern. You write a style, then immediately read a layout property, then write again. The browser can't optimize because each read depends on the previous write having been applied.

The mechanism: Blink (Chrome's rendering engine) maintains a "layout-dirty" flag on elements whose style has been mutated. When JavaScript reads a geometry property like `offsetWidth`, `getBoundingClientRect`, or `scrollTop`, Blink must return an accurate value. If the dirty flag is set, Blink **flushes all pending style and layout work synchronously** before returning the value. This flush is what costs time. Without an intervening read, the dirty flag would be resolved lazily at the end of the task.

The numbers were consistent across the board:

| Nodes | Baseline | Optimized | Speedup |
|-------|----------|----------|---------|
| 100 | 0.15 ms | 0.08 ms | **1.8×** |
| 500 | 0.30 ms | 0.20 ms | **1.5×** |
| 1,000 | 0.53 ms | 0.26 ms | **2.0×** |
| 5,000 | 2.31 ms | 1.02 ms | **2.3×** |
| 10,000 | 4.25 ms | 1.89 ms | **2.3×** |

At n=10,000, the optimized version was still under 2ms. The baseline was 4.25ms — not catastrophic in isolation, but this is per animation frame. If your scroll handler fires this 60 times per second, you're spending 255ms/s in forced layouts versus 113ms/s. That's the difference between silky 60fps and visible jank.

The fix is dead simple: read all layout properties *before* you start writing. One read, batch writes.

**Benchmark implementation:**

```js
// Baseline: forces layout every iteration (repeatedly mutating the same element)
const el = document.getElementById('target');
for (let i = 0; i < n; i++) {
  el.style.width = (el.offsetWidth + 0.001) + 'px';
}

// Optimized: one read, all writes
const baseWidth = el.offsetWidth;
for (let i = 0; i < n; i++) {
  el.style.width = (baseWidth + (i % 10) * 0.001) + 'px';
}
```

**Real-world equivalent — layout thrashing over a collection:**

```js
const items = document.querySelectorAll('.list-item');

// Baseline: interleaved read-write on each element
items.forEach(el => {
  el.style.height = (el.offsetHeight + 10) + 'px';
});

// Optimized: read phase, then write phase
const heights = Array.from(items).map(el => el.offsetHeight);
items.forEach((el, i) => {
  el.style.height = (heights[i] + 10) + 'px';
});
```

> **Why this happens:** Blink marks elements as layout-dirty when their style changes. A geometry property read (`offsetWidth`, `getBoundingClientRect`, etc.) must return an accurate value, so if the dirty flag is set, Blink synchronously flushes all pending style recalculation and layout recomputation before returning. This "dirty-flag flush" is the fundamental cost — it's not the read itself that's expensive, it's the forced pipeline restart triggered by reading at the wrong time.

---

### BM-02: innerHTML in Loop

This is where things get ugly.

Most developers know that `innerHTML +=` is not great. But I didn't expect *this*.

| Nodes | Baseline | Optimized | Speedup |
|-------|----------|----------|---------|
| 100 | 2.41 ms | 0.06 ms | **40×** |
| 500 | 56.1 ms | 0.20 ms | **280×** |
| 1,000 | 223 ms | 0.39 ms | **570×** |
| 5,000 | 6,955 ms | 1.51 ms | **4,606×** |
| 10,000 | 24,809 ms | 3.12 ms | **7,955×** |

At n=1,000, you're looking at 223 milliseconds. That's the kind of number you'd expect for a slow database query, not a DOM operation. At n=10,000, it hits **24.8 seconds**. Twenty-four seconds of blocking main thread, with no way to abort it, no loading state, no nothing.

The optimized version? 3.12ms. The same operation, the same DOM nodes, two orders of magnitude faster.

This isn't a marginal case. 570× slower at n=1,000 is a production fire. You don't need a high-traffic app to feel this — a single user filtering a table with 1,000 rows would hit 223ms of UI freeze.

The fix is a single template string built *once*:

```js
// Baseline: n parse-and-serialize cycles, each growing in cost
for (let i = 0; i < n; i++) {
  container.innerHTML += `<div class="item">${i}</div>`;
}

// Optimized: one parse, one serialize
container.innerHTML = Array.from({ length: n }, (_, i) =>
  `<div class="item">${i}</div>`
).join('');
```

> **Note:** This pattern is safe here because `i` is a numeric index (not user-supplied data). When the content includes user-supplied input, prefer `insertAdjacentHTML` with sanitized input, or use `createElement` + `textContent` to avoid XSS exposure.

**The mechanism — why this is O(n²), not just O(n):**

At iteration k, the browser holds a DOM subtree with k-1 nodes. Assigning to `innerHTML +=` triggers three operations:

1. **Serialize** the existing k-1 node subtree to a string
2. **Concatenate** the new element string to produce a string representing k nodes
3. **Destroy** the existing subtree and **parse** the concatenated string to reconstruct k nodes from scratch

The serialization work scales with k. The reconstruction work also scales with k. Summing across all n iterations:

> total work ∝ 1 + 2 + 3 + ... + n = n(n+1)/2

That's **quadratic** — O(n²) total DOM operations. This is why the jump from n=1,000 (223ms) to n=5,000 (6,955ms) is not a 5× increase but a **31× increase**. The data matches the theory perfectly.

The critical difference: baseline does O(n) HTML parses + O(n) serializations, but each parse grows with the accumulated string — hence O(n²) total. Optimized does 1 parse + 1 serialize. At n=10,000, that's 20,000 DOM operations reduced to 2.

---

### BM-03: Style Mutation in Loop

Setting individual style properties on each element sounds tedious more than catastrophic. The numbers bear that out — but it's still meaningful:

| Nodes | Baseline | Optimized | Speedup |
|-------|----------|----------|---------|
| 100 | 0.19 ms | 0.06 ms | **3.1×** |
| 500 | 0.80 ms | 0.30 ms | **2.7×** |
| 1,000 | 1.68 ms | 0.57 ms | **3.0×** |
| 5,000 | 8.53 ms | 2.52 ms | **3.4×** |
| 10,000 | 15.18 ms | 4.72 ms | **3.2×** |

At n=10,000, you're at 15ms — still under the 16.67ms budget for a single frame, but only just. Stack this with other work and you'll drop frames.

The fix is a CSS class:

```js
// Baseline: individual style mutations
items.forEach(el => {
  el.style.backgroundColor = '#e74c3c';
  el.style.color = '#ffffff';
  el.style.padding = '2px';
  el.style.borderRadius = '2px';
  el.style.transform = 'scale(1.1)';
});

// Optimized: single class toggle
items.forEach(el => el.classList.add('highlighted'));
```

> **Why class toggling is faster:** When you assign to `element.style.X`, you write directly to the element's inline style object — the highest-priority layer in the CSS cascade. Each write marks the element as style-dirty. The browser defers the actual cascade re-evaluation to the next rendering phase, but it must process each property mutation individually when that recalculation runs. A `classList.add()` call also marks the element as style-dirty, but the class rule bundles all its declarations together — the cascade resolves them in a single pass at recalculation time. The difference is the cascade resolution cost per property versus per rule.
>
> The properties in the example above have different pipeline costs: `backgroundColor` and `color` are **paint-only** — they don't trigger layout. `padding` is a **box-model property** that does trigger layout. `borderRadius` is **paint-only** — it changes the element's visual shape without affecting its box-model geometry, so it triggers a repaint but not a layout. `transform` is **compositor-only** — it doesn't touch layout or paint, the GPU handles it directly. The inline style write costs you the cascade resolution each time; the class toggle resolves the cascade once for all declared properties together.

---

### BM-04: DOM Query in Loop

This one surprised me. Modern browsers are *good* at caching DOM queries. The numbers were nearly identical:

| Nodes | Baseline | Optimized | Speedup |
|-------|----------|----------|---------|
| 100 | 0.06 ms | 0.05 ms | **1.2×** |
| 500 | 0.14 ms | 0.12 ms | **1.2×** |
| 1,000 | 0.42 ms | 0.32 ms | **1.3×** |
| 5,000 | 1.68 ms | 1.35 ms | **1.2×** |
| 10,000 | 3.33 ms | 2.64 ms | **1.3×** |

At n=10,000, the difference was 0.69ms. That's noise. Chrome's selector engine does internal caching that makes repeated `getElementById` calls essentially free after the first one.

> **Important caveat:** This benchmark queries the *same element* repeatedly in each loop iteration — the canonical "cheap repeated query" case. Repeated queries for the same element are effectively free in modern Chromium due to selector caching. The anti-pattern remains relevant when iterating over distinct selectors or large, deeply-nested trees, which this benchmark does not cover.

I still cache element references when I see them in a loop. It's free to do, and it communicates intent. But based on this data, it's not the performance win the advice columns make it out to be — at least not for the same-element case.

---

### BM-05: appendChild × n vs. DocumentFragment

The conventional wisdom says that calling `appendChild` n times is expensive because each call can trigger a reflow, and that batching with a DocumentFragment is much faster.

Conventional wisdom is wrong here. Or at least, it was wrong in 2015 and browsers fixed it.

| Nodes | Baseline | Optimized | Speedup |
|-------|----------|----------|---------|
| 100 | 0.06 ms | 0.08 ms | **0.8×** |
| 500 | 0.30 ms | 0.30 ms | **1.0×** |
| 1,000 | 0.48 ms | 0.54 ms | **0.9×** |
| 5,000 | 2.14 ms | 2.42 ms | **0.9×** |
| 10,000 | 4.02 ms | 5.12 ms | **0.8×** |

The DocumentFragment version was at best equal (at n=500, both measured 0.30ms) and often slightly *slower* at other node counts. This makes sense: DocumentFragment adds a layer of indirection, and modern browsers coalesce DOM mutations automatically via their rendering pipeline.

> **Why browsers coalesce insertions:** Modern Chromium defers rendering pipeline work — style recalculation, layout, paint — to the end of the current task, rather than executing it synchronously on each DOM mutation. This means that calling `appendChild` n times in sequence triggers at most one layout pass after all insertions are complete, making DocumentFragment's historical batching advantage obsolete for performance purposes.
>
> Prior to Chromium's unified rendering pipeline (around Chrome 66–70), multiple `appendChild` calls inside a live document could trigger intermediate style and layout flushes because the element was attached to a live document tree with active observers. DocumentFragment avoided this by building the tree off-document. Blink's current architecture coalesces these flushes at the task boundary regardless, making the distinction irrelevant for performance. Firefox and Safari have made equivalent optimizations.

So if you've been writing DocumentFragment code for performance reasons — keep doing it for code clarity (it's cleaner to build a fragment then attach once), but not because it's faster. At least not in 2026 Chromium.

---

## What I Found in 275 Real Repositories

Benchmarks are controlled. Real code is messy. I cloned 300 public repositories (selected from high-DOM-activity projects: canvas libraries, charting engines, code editors, drag-and-drop utilities, and data grids) and ran an AST-based detector across 714,217 files (excluding `node_modules`, `dist`, `build`, and test files) looking for the four high/medium-severity patterns. Of the 300 intended repos, 25 failed to clone or had fatal processing errors — 275 repos were successfully analyzed.

> **Corpus selection note:** The 300 target repositories were intentionally selected to represent DOM-heavy codebases — canvas libraries, charting engines, code editors, data grids, drag-and-drop utilities. The 25 failures were evenly split between repos that had been deleted/moved (e.g., `dnd-kit/dnd-kit`, `headlessui/headlessui`) and repos with fatal TypeScript compilation errors ("Duplicate declaration" in `microsoft/fluentui`, `vercel/next.js`). The resulting 275-repo corpus is representative of the same DOM-heavy domain selection criteria. The full repo list with scan outcomes is documented in the [empirical-study repo](https://github.com/liangk/empirical-study/tree/main/studies/08-dom-manipulation/data).

**54.9% of repos had at least one anti-pattern.** 151 out of 275. That's more than half.

2,789 total findings. Here's the breakdown by pattern:

| Pattern | Findings | Severity | Typical Fix |
|---------|----------|----------|-------------|
| `dom_query_in_loop` | 1,110 | Medium | Cache element reference outside loop |
| `forced_sync_layout` | 861 | High | Read layout properties before writes |
| `style_mutation_in_loop` | 691 | Medium | Toggle CSS class instead |
| `innerhtml_in_loop` | 127 | High | Build single template string, assign once |

988 findings (35.4%) were high-severity. Those are the ones that genuinely hurt performance — `innerHTML` in loops and forced synchronous layouts.

By framework, the distribution was striking:

| Framework | Findings | % of Total | Avg per Repo |
|-----------|----------|------------|--------------|
| Vanilla JS | 1,556 | 55.8% | 38.9 |
| Mixed | 427 | 15.3% | — |
| React | 558 | 20.0% | 7.1 |
| Vue | 235 | 8.4% | 3.9 |
| Angular | 13 | 0.5% | 0.7 |

Vanilla JS repos had *by far* the most findings per repo. That's not a framework thing — it's a domain thing. The top offenders are canvas libraries, charting engines, game frameworks, and code editors. Three.js alone had 195 findings. Highcharts had 156. SortableJS had 134. These are applications that genuinely manipulate thousands of DOM nodes per frame, and the patterns that hurt there are the same patterns that hurt in your Kanban board.

React at 7.1 findings per repo on average sounds low until you realize how many React repos there are — React is the dominant web framework by any measure: first place in the 2025 Stack Overflow Developer Survey's "Most Used Web Frameworks" category, used by an estimated 6% of all websites according to W3Techs, and the default choice for new frontend projects. When a framework is used at this scale, even a low per-repo finding rate translates to the most total findings in absolute terms. In this scan, React contributed 558 findings — 20.0% of the total — making it the second-largest source of findings after Vanilla JS, even though React repos averaged only 7.1 findings each versus Vanilla JS's 38.9. The numbers aren't because React developers are better — they're because React abstracts DOM access through a virtual DOM, so direct `innerHTML` or `getElementById` calls are rarer and usually hidden behind framework APIs.

Angular's near-zero is harder to explain with a single phrase. Angular enforces a specific project structure (modules, components, services) and routes DOM access through its own rendering engine rather than raw APIs — `document.getElementById` becomes `@ViewChild`, imperative `innerHTML` becomes declarative template bindings. This makes the specific anti-patterns this study detects structurally unlikely in typical Angular code, not because Angular developers are immune to bad habits, but because Angular doesn't give you the raw DOM APIs that enable those patterns. The AST detector was looking for raw `getElementById` and `innerHTML` calls; Angular's abstraction layer simply doesn't produce those signatures.

---

## The Top Offenders

Some repos had *staggering* numbers of findings. This is where the data gets interesting — because these aren't abandoned side projects. These are libraries and frameworks used in production by millions of applications.

| Repo | Findings | Domain |
|------|----------|--------|
| mrdoob/three.js | 195 | 3D rendering engine |
| highcharts/highcharts | 156 | Charting library |
| SortableJS/Sortable | 134 | Drag-and-drop utility |
| ag-grid/ag-grid | 133 | Data grid |
| mozilla/pdf.js | 105 | PDF renderer |
| cytoscape/cytoscape.js | 99 | Graph visualization |
| nocodb/nocodb | 71 | Spreadsheet-like DB UI |
| notesnook/notesnook | 67 | Note-taking app |
| codemirror/codemirror5 | 53 | Code editor |
| swiper/nolimits4web | 53 | Touch slider |

These are all tools where DOM manipulation is a core feature, not an afterthought. Three.js renders 3D on a canvas, but it also manages a lot of HTML UI overlays. Highcharts is drawing SVGs with DOM operations. SortableJS is literally moving DOM nodes around.

I don't think less of these projects for having these findings. I'd bet most of them predate the modern browser optimizations that make some of these patterns less catastrophic. But it does mean: if you're using one of these libraries, and your app is slow, the problem might not be your code. It might be in the library.

---

## The Pattern That Surprised Me Most

BM-02 (innerHTML in loop) is the one I'll be thinking about for a while.

Most performance guides treat it as "a bad practice, avoid it." That's technically correct but wildly understated. At n=1,000, it's 570× slower than the trivial fix. That's not a 10% performance dip you can ignore. That's a freeze that makes your app unusable.

And here's the thing — n=1,000 isn't even a lot of items. It's a medium-sized table. A list of email subjects. A set of search results. A board with a few columns and cards.

The irony is that the fix is so easy. One `Array.from`, one `.join('')`, one assignment. Every developer who has ever written a `for` loop with `innerHTML +=` could fix it in 30 seconds once they know the cost.

---

## What to Actually Do

Based on this study, here's my prioritized list:

**1. Never use `innerHTML +=` inside a loop.** Ever. For any reason. The fix is a one-liner and the payoff is catastrophic at any real scale.

**2. Read layout properties before you write.** If you're measuring things in a loop and then updating things in the same loop, split them. Collect all reads first, then do all writes. This alone fixes the most common form of layout thrashing.

**3. Toggle CSS classes for bulk style changes.** If you are applying more than one style property to multiple elements in a loop, encode that state as a CSS class and toggle the class. Single-property inline style writes in a loop are a style concern but not a measurable performance concern at the scales tested. Reserve inline style writes for values that are computed at runtime and cannot be expressed in a static CSS rule (for example, a pixel position calculated from user input).

**4. You can stop worrying about `appendChild` in a loop.** Modern browsers batch these automatically. Use DocumentFragment if it makes your code clearer, but don't add it for performance reasons in 2026.

**5. Run an AST scan on your dependencies.** If you use three.js, highcharts, SortableJS, or any of the other top offenders, know that they have known DOM anti-patterns. Your application code might be fine and the library is still hurting your frame rate.

---

## How to Detect These Patterns

I ran the benchmarks and the corpus scan using a Babel AST-based detector. An AST (Abstract Syntax Tree) represents the structure of source code as a tree of nodes, which allows pattern detection that is aware of code context — for example, distinguishing an `innerHTML` assignment inside a loop body from one outside it — in a way that regular expression matching cannot reliably do.

The rules are simple:

- **`forced_sync_layout`**: `offsetWidth`, `offsetHeight`, `scrollTop`, `scrollLeft`, `clientWidth`, `clientHeight`, `getBoundingClientRect`, `getComputedStyle`, or `getClientRects` called *after* a style write inside a loop body
- **`innerhtml_in_loop`**: `innerHTML` or `outerHTML` assignment (`=`) inside a `for`/`while`/`forEach` loop
- **`style_mutation_in_loop`**: `element.style.X = Y` assignment inside a loop, setting 2+ distinct properties
- **`dom_query_in_loop`**: `querySelector`, `querySelectorAll`, `getElementById`, `getElementsByClassName`, or `getElementsByTagName` called inside a loop

The detector is in the [empirical-study repo](https://github.com/liangk/empirical-study) under `studies/08-dom-manipulation/src/step3-static-analysis/`. Point it at any JS/TS/Vue codebase and you'll get a report.

---

## Limitations

A few important caveats on the methodology:

- **Headless Chromium:** Benchmarks were run in headless Chromium (browser runs without a visible window). Some rendering behavior — particularly layout-related operations — can differ between headless and headed modes. The relative ordering of anti-pattern costs is consistent, but absolute numbers may shift in headed Chrome.
- **Same-element queries:** BM-04 tests repeated queries for the same element. Real-world scenarios with distinct selectors per iteration or deeply-nested DOM trees may show different cost profiles.
- **AST detection scope:** The detector cannot reliably find violations hidden behind framework virtual DOM (React JSX, Vue SFC templates compile to `createElement` calls, not direct DOM access). Findings are primarily in vanilla JS, event handlers, and framework escape hatches (`useEffect`, `onMounted`, directive hooks).
- **Corpus selection:** Repositories were intentionally selected for DOM-heavy domains (canvas, charting, code editors). The prevalence rate is representative of that niche, not frontend codebases generally.

---

## Further Reading

- [Google Web Dev: Rendering Performance](https://web.dev/articles/rendering-performance) — Addy Osmani and Paul Irish's canonical guide to the browser rendering pipeline, forced synchronous layouts, and compositor-only properties.
- [Jake Archibald: In The Loop](https://youtu.be/cCOL7MC4Pl0) (JSConf Asia 2018) — Precise explanation of the task/microtask queue and how rendering is scheduled relative to JavaScript execution.
- [Chrome DevTools: Diagnose Forced Synchronous Layouts](https://developer.chrome.com/docs/devtools/performance/forced-synchronous-layouts/) — Paul Lewis and Paul Irish's original documentation on identifying layout thrashing in DevTools.
- [Blink Source: Document::updateStyleAndLayout](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/dom/document.cc) — The function called on every forced synchronous layout; search for `Document::updateStyleAndLayout` within the file.
- [Steve Souders: DOM Performance](https://www.stevesouders.com/blog/category/dom/) — Original research on `innerHTML` performance and DOM mutation costs going back to 2008.

---

## The Full Picture

I went into this expecting to confirm conventional wisdom. Mostly I did — but with two plot twists.

The first: innerHTML in loop is *far* worse than the standard advice implies. 570× at n=1,000 isn't a warning flag. It's a red flag the size of a billboard.

The second: appendChild in loop is a solved problem. Browsers fixed it years ago. If you're still adding DocumentFragment for performance reasons, stop — unless it's making your code clearer, in which case, keep going for the right reasons.

The 54.9% prevalence across real repos tells me this isn't academic. Layout thrashing and innerHTML accumulation are living problems in production code, including some of the most widely-used libraries in the JavaScript ecosystem. The good news: both are trivially fixable once you know the pattern and the cost.

Run the detector on your codebase. Check your loops. Batch your writes. Your users will feel the difference at 60fps.

---

## Appendix: Benchmark Configuration

| Parameter | Value |
|-----------|-------|
| Browser | Chromium (headless) |
| Chromium version | 147.0.7727.15 |
| OS | Windows 11 Pro |
| CPU | AMD Ryzen 7 5825U |
| RAM | 16GB DDR5 |
| Playwright version | 1.51.0 |
| Trials per configuration | 30 |
| Warmup discarded | 5 |
| Accepted trials | 25 (CV < 15%) |
| Statistical summary | Median (IQR available in raw data) |
| n values | 100, 500, 1,000, 5,000, 10,000 |
| DOM query benchmark | Repeated same-element queries (same ID per iteration) |

All raw benchmark data with per-trial distributions and finding JSON files are available in the [empirical-study results directory](https://github.com/liangk/empirical-study/tree/main/studies/08-dom-manipulation/results).
