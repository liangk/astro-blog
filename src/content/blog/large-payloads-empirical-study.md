---
title: "A 10MB API Response Costs 66ms Before Your Code Even Runs."
pubDate: "2026-05-12"
heroImage: "../../assets/large-payloads-empirical-study.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "I benchmarked five large-payload patterns (1KB–10MB) and scanned 277 public API repositories (300 in corpus, 23 failed) with a Babel AST detector. JSON.parse on a 10MB response takes 66.0ms median on Node.js 22. Pagination cuts parse cost by ~10x. In the wild, 179/277 repos (64.6%) had at least one large-payload anti-pattern: 52,010 total findings. Unbounded ORM fetches dominate (32,829). Deep nested includes account for another 17,069. Here’s the data and the fixes."
excerpt: "A 10MB JSON response parses in ~66ms on my machine — long enough to blow past most API latency budgets before you even touch the data. I benchmarked the cost, then scanned 300 real API repos (277 successfully, 23 failed). 64.6% had at least one large payload anti-pattern."
lastmod: "2026-05-12"
canonical_url: "https://stackinsight.dev/blog/large-payloads-empirical-study"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - large api payload
  - json parse performance
  - api pagination
  - unbounded query
  - prisma findMany take
  - select star
  - graphql pagination
  - api performance empirical study
  - node.js json.parse benchmark
  - large response payload

# AIEO (AI Engine Optimization)
ai_summary: "This empirical study measures the performance impact and prevalence of large API payload anti-patterns. Controlled benchmarks on Node.js v22 tested payload sizes from 1KB to 10MB across five scenarios. JSON.parse median time scaled from ~0.006ms (1KB) to 66.0ms (10MB). Paginating into 100KB chunks reduced parse cost by ~10.3x at 10MB. Unbounded vs paginated queries showed a 1,246× speedup at 10MB. Deep nested includes vs flat structures showed up to 12× additional parse cost at small payload sizes, with the advantage reversing at larger payloads as flat structures grow in object count. A real-world scan of 300 public API repositories (277 successfully scanned, 23 failed due to clone or parse errors) found 52,010 large-payload findings across 179 repos (64.6% prevalence). The most common pattern was unbounded ORM fetches (unbounded_find_all) with 32,829 findings (63.1%), followed by deep nested includes (deep_nested_include) with 17,069 (32.8%), and SELECT * (select_star) with 2,112 (4.1%). High-severity patterns accounted for 34,941 findings (67.2%)."
ai_key_facts:
  - "10MB JSON.parse median time: 66.0ms on Node.js v22"
  - "Pagination into smaller chunks reduced parse cost by ~10.3x at 10MB"
  - "Unbounded vs paginated query: 1,246× speedup at 10MB"
  - "300 repos in corpus; 277 successfully scanned (23 failed); 179 repos (64.6%) had at least one large-payload anti-pattern"
  - "52,010 total findings; unbounded_find_all: 32,829 (63.1%)"
  - "deep_nested_include: 17,069 (32.8%); select_star: 2,112 (4.1%)"
  - "High severity findings: 34,941 (67.2%)"
ai_entities:
  - "Node.js"
  - "V8"
  - "JSON.parse"
  - "REST"
  - "GraphQL"
  - "Prisma"
  - "Sequelize"
  - "TypeORM"
  - "Mongoose"
  - "SQL"
  - "Babel AST"

# Structured Data (Article Schema)
schema_type: "TechArticle"
schema_proficiency_level: "Intermediate"
schema_dependencies: "Node.js v22+, TypeScript 5+"
schema_time_required: "PT25M"

# Taxonomy
categories:
  - "Backend Performance"
  - "Software Engineering Research"
  - "Web Development"
tags:
  - api
  - rest
  - graphql
  - pagination
  - json
  - performance
  - static-analysis
  - anti-pattern
  - empirical-study
  - nodejs

# Related
related_posts:
  - "n-plus-1-query-empirical-study"
  - "blocking-io-empirical-study"
series: "API Performance Empirical Studies"
series_order: 2
---

# A 10MB API Response Costs 66ms Before Your Code Even Runs.

Every backend developer has seen it: an endpoint that "works fine" in development, passes all tests, then collapses in production the day a customer with 50,000 records hits it.

The database isn't slow. The query plan is fine. The problem is what comes back: a 10MB JSON blob that takes **66 milliseconds just to parse** on Node.js v22. That's before validation, before mapping, before business logic — just V8 (the JavaScript engine inside Node.js and Chrome) turning bytes into objects.

So I ran two experiments. First, five controlled benchmarks measuring parse time and memory pressure across payload sizes from 1KB to 10MB. Then a Babel AST (Abstract Syntax Tree) scan — a way to query source code programmatically without running it — of 300 public API repositories to see how often the root causes actually show up in real code.

The short version: pagination cuts the per-interaction parse cost by **10×** at 1MB and **1,246×** at 10MB. In the wild, **179 of 277 successfully scanned repos (64.6%)** had at least one large-payload anti-pattern. Unbounded ORM fetches dominated with 32,829 findings. Deep nested includes added another 17,069.

Here's the full breakdown.

---

## The Pattern

Large payload bugs look like "API slowness" on the surface. They're not one problem. They're a family of problems:

- **Unbounded ORM fetches**: An ORM (Object-Relational Mapper) is a library that turns database queries into JavaScript function calls. The anti-pattern is calling `findMany()` / `findAll()` / `find()` with no `take`/`limit` and no meaningful `where`.
- **Deep nested includes**: the ORM version of "just join everything" — `user.posts.comments` and friends.
- **`SELECT *`**: extra columns you don't need, shipped to every client.
- **Missing pagination**: returning arrays with no cursor/offset mechanism.
- **Unbounded GraphQL**: resolvers returning lists with no pagination contract.

The common failure mode is the same: you ship *more data than the user can possibly consume in one interaction*, and you pay the parse/memory/network bill every time.

---

## The Simulation

I ran five benchmark modules, each isolating one large-payload anti-pattern. Payload sizes ranged from 1KB to 10MB — covering the spectrum from normal API responses to the catastrophic end of the scale.

- **BM-01:** Pure `JSON.parse()` cost by payload size — baseline vs chunked parsing.
- **BM-02:** Parse time and RSS memory by size — the same parse benchmark, but instrumented to show how heap growth forces OS memory page requests at large payload sizes.
- **BM-03:** Unbounded query (one massive array) vs paginated (100KB chunks).
- **BM-04:** Deep nested include structures vs flat, denormalized records.
- **BM-05:** GraphQL batch loading vs cursor pagination — same total bytes, different delivery.

**Environment:** Node.js v22+, 30 trials per size, 5 warmups discarded.

The payloads are synthetic JSON, not real API responses. That is intentional. A real API adds serialization, compression, network latency, and schema validation — all of which make the problem worse, not better. These benchmarks isolate the cost people consistently underestimate: parse time and heap pressure. The numbers you're about to see are a *lower bound*.

---

### BM-01: JSON Parse Time by Size

This is the simplest possible large-payload cost: how long does `JSON.parse()` take?

| Payload Size | Baseline Median | Optimized Median | Speedup |
|--------------|-----------------|------------------|---------|
| 1KB | 0.0062 ms | 0.0061 ms | 1.0× |
| 10KB | 0.054 ms | 0.0075 ms | 7.2× |
| 100KB | 0.557 ms | 0.054 ms | 10.4× |
| 1MB | 6.32 ms | 0.576 ms | 11.0× |
| 10MB | 66.0 ms | 6.38 ms | **10.3×** |

At 10MB, the baseline takes 66 milliseconds just to parse. That's not background work. It's 66 milliseconds of blocking CPU on your Node.js event loop — during which no other requests can be processed. A 100ms P95 budget (95% of requests must complete within this time), you just burned two-thirds of it on parsing alone.

The optimized version chunks the 10MB payload into 100KB pieces and parses each separately. The overhead of multiple parse calls is dwarfed by the savings from not allocating a single massive object graph.

**Why chunking helps:** V8's JSON parser performs a single-pass recursive descent parse. For each JSON object it allocates a V8 `JSObject` on the heap; for each array, a `JSArray`. A 10MB payload may create tens of millions of these allocations in one synchronous operation. V8 cannot interleave GC with the parse — the parse completes or it doesn't. The allocation pressure eventually triggers a full Mark-Compact GC cycle, which is the expensive pause.

When you split the parse into 100 × 100KB chunks, each chunk's allocations stay within V8's "new space" (young generation). New-space GC (Scavenger) runs in microseconds and is largely concurrent. The objects from each chunk can be reclaimed between parses, keeping peak heap bounded. The full 10MB parse, by contrast, overflows new space, promotes objects to old space, and triggers the full pause.

### BM-02: Parse Time and Memory by Size

BM-02 measures both parse time and memory consumption. Unlike BM-01 which focuses solely on parsing speed, BM-02 shows how large payloads impact memory pressure — a critical production concern that RSS (Resident Set Size) growth makes visible.

| Payload Size | Baseline Median | Optimized Median | Speedup |
|--------------|-----------------|------------------|---------|
| 1KB | 0.008 ms | 0.008 ms | 1.0× |
| 10KB | 0.067 ms | 0.055 ms | 1.2× |
| 100KB | 0.641 ms | 0.061 ms | **10.5×** |
| 1MB | 6.84 ms | 0.576 ms | **11.9×** |
| 10MB | 68.9 ms | 6.38 ms | **10.8×** |

> **Memory Insight (10MB case):** At 10MB, baseline parse caused a **~13 MB RSS spike** as V8 requested new OS memory pages to accommodate the object graph. The chunked approach produced no measurable RSS growth — each 100KB chunk was satisfied from V8's existing heap headroom. Below 10MB, RSS growth was unmeasurable with this method; per-operation heap allocation remained within V8's already-committed pages.

> The real win is **memory boundedness**: chunking keeps memory growth O(chunk size) instead of O(payload size). In a multi-tenant server, that's the difference between predictable resource usage and memory spikes that trigger GC pressure or OOM kills.

But parse time and memory are just mechanics. BM-03 is where this becomes a production fire.

### BM-03: Unbounded vs Paginated Query

This is where large payloads become a production fire. The baseline returns the entire result set in one array. The optimized version paginates into 100KB chunks.

| Payload Size | Baseline Median | Optimized Median | Speedup |
|--------------|-----------------|------------------|---------|
| 1KB | 0.0059 ms | 0.053 ms | 0.11× |
| 10KB | 0.053 ms | 0.053 ms | 1.0× |
| 100KB | 0.544 ms | 0.053 ms | 10.3× |
| 1MB | 6.36 ms | 0.053 ms | **121×** |
| 10MB | 66.1 ms | 0.053 ms | **1,246×** |

The numbers at 1MB and 10MB are staggering. Pagination doesn’t just reduce bandwidth — it reduces parse cost by two to three orders of magnitude.

At 10MB, the unbounded baseline takes 66ms. The paginated version takes 0.053ms. That's the difference between "API is down" and "API is fast."

One note on interpretation: the optimized column measures the parse cost of a single 100KB page. If the full 10MB dataset were consumed across all 100 pages, the total parse time would be approximately 5.3ms — still a 12× improvement over the 66ms one-shot, and more importantly, that cost is now distributed across asynchronous user interactions rather than blocking a single request. The goal of pagination is not to reduce total data — it is to eliminate the single worst-case parse event from any one user interaction.

At 1KB and 10KB, both approaches return a single chunk. The "optimized" version has slightly more overhead from pagination metadata, which is why the speedup is near or below 1× at small sizes. The benefit only appears when the payload actually crosses your chunk threshold.

### BM-04: Deep Nested Include vs Flat

I measured what ORMs make easy: `include: { posts: { comments: true } }`. The benchmark compares deeply nested objects against flat, denormalized structures.

| Payload Size | Baseline Median | Optimized Median | Speedup |
|--------------|-----------------|------------------|---------|
| 1KB | 0.073 ms | 0.006 ms | **11.7×** |
| 10KB | 0.786 ms | 0.066 ms | **11.9×** |
| 100KB | 1.56 ms | 0.594 ms | **2.6×** |
| 1MB | 1.58 ms | 6.79 ms | 0.23× |
| 10MB | 1.56 ms | 6.62 ms | 0.24× |

The results tell a more nuanced story than "flat is always faster." At smaller sizes, flat structures win decisively — the nested overhead of `users → posts → comments` creates many more JavaScript objects for the same conceptual data. Parse cost is driven by object count, not raw bytes.

But the pattern inverts at larger sizes. The deep nested structure is capped at ~660KB actual payload (the nesting overhead limits growth), while the flat structure continues scaling to ~2MB. At 1MB and 10MB target sizes, we're comparing a capped nested payload against a substantially larger flat payload — and the larger payload naturally takes longer to parse.

The takeaway: flat structures win when they carry the same data with fewer object boundaries. But if your "flat" structure ends up holding more actual data than the nested equivalent, the size effect can outweigh the structural benefit.

---

### BM-05: GraphQL Batch vs Cursor Pagination

I tested GraphQL batching against cursor pagination. Batching loads N pages in one request. Cursor pagination loads them sequentially.

| Payload Size | Baseline Median | Optimized Median | Speedup |
|--------------|-----------------|------------------|---------|
| 1KB | 0.0079 ms | 0.060 ms | 0.13× |
| 10KB | 0.053 ms | 0.058 ms | 0.92× |
| 100KB | 0.542 ms | 0.536 ms | 1.0× |
| 1MB | 6.37 ms | 5.47 ms | 1.2× |
| 10MB | 66.7 ms | 66.0 ms | **1.0×** |

This is the surprise. Cursor pagination shows almost no parse-time advantage over batching. The payload is the same size either way — you're just slicing it differently. The 1.2× advantage at 1MB is within measurement variance across 30 trials and should not be read as a directional finding.

GraphQL pagination is still the right choice, but not because it saves parse time on the client. The total bytes are identical whether batched or paginated, so total parse time is equivalent. What changes is the distribution of that cost across time — paginated clients pay in small instalments.

Where pagination wins is on the server. An unbounded GraphQL resolver typically calls `db.findAll()` and returns the entire result set to the execution engine, requiring O(N) server memory during execution. A paginated resolver fetches only `first: 100` records per execution, keeping server memory bounded to O(page size). For a dataset of 1 million records, this is the difference between 500MB of working memory and 500KB.

Pagination also gives the client backpressure. A slow client can pause between pages. An unbounded response must be consumed or buffered in its entirety.

---

## The Real-World Scan

### Scan Methodology

Before the findings, a word on corpus construction. Candidate repos were identified via GitHub topic searches (`nodejs-api`, `rest-api`, `graphql-server`) and supplemented by known open-source backend projects in each target domain. The 300 repositories were manually curated from this pool — not a random sample, but a representative slice of public Node.js/TypeScript projects with explicit API layers.

Selection criteria included:

- **Language:** Primarily JavaScript and TypeScript (Node.js backend focus)
- **Domain:** SaaS, e-commerce, analytics, developer tools, fintech, content platforms — chosen for API surface area
- **Size:** Mix of small services and large monorepos (including Kibana, a 14,000+ finding outlier)
- **Stars:** No minimum star threshold; inclusion was based on functional relevance, not popularity
- **Exclusions:** Frontend-only repos, personal toy projects, and repos with fewer than 50 commits

This is not a random sample of the Node.js ecosystem. It is a representative sample of the API-server slice. The 64.6% prevalence claim applies to this corpus, not the entire npm ecosystem. Kibana's inclusion was intentional — large monorepos are where the architectural-default problem is most visible.

I pointed a Babel AST detector at **300** public API repositories. **23** failed — either the repo was deleted (GitHub returned 404), or the parser choked on TypeScript/JSX edge cases that Babel couldn't handle without a full project config. That leaves **277** successfully scanned repos.

Of those 277, **179 had at least one large-payload anti-pattern. That's 64.6%**.

Let that sink in. Walk into a room of Node.js API developers. Two out of three of their codebases are shipping unbounded data right now.

Total findings: **52,010**.

| Pattern | Findings | Share | Severity |
|---------|----------|-------|----------|
| `unbounded_find_all` | 32,829 | 63.1% | High |
| `deep_nested_include` | 17,069 | 32.8% | Medium |
| `select_star` | 2,112 | 4.1% | High |

The most common pattern is also the most catastrophic. BM-03 showed that an unbounded 10MB query parses **1,246× slower** than its paginated equivalent. And here it is in the wild: 32,829 instances across 179 repos. This isn't a theoretical edge case — it's the default.

High-severity findings account for **34,941 (67.2%)**. Every one of those is an `unbounded_find_all` or `select_star` — patterns that directly translate to multi-second parse times and memory pressure in production. The deep nested includes are "only" medium severity because at common API payload sizes (under 100KB) they cost up to 12× in additional parse time — significant, but not in the same category as unbounded fetches. But 17,069 of them still means a lot of unnecessarily bloated payloads.

What surprised me was the concentration. Look at the per-repo breakdown: **elastic/kibana alone contributed 14,088 findings** — 27% of the entire dataset. Kibana is the open-source analytics dashboard for the Elastic Stack — a large, mature TypeScript codebase with many data-access layers. It has more unbounded queries than the bottom 100 repos combined. It's not a mistake. It's an architecture.

This is Conway's Law applied to data access: as a codebase grows across teams and modules, each new feature author inherits the ORM setup but not the pagination contract. Prisma's `findMany()` default is unbounded. Mongoose's `find()` default is unbounded. These ORMs chose convenience over safety as their zero-config default. In a small codebase, one developer can enforce a global convention. In a large codebase, no convention propagates unless it is encoded in the framework layer — a base repository pattern, a middleware enforcement, or a linting rule.

This is why "just add pagination" is insufficient advice for large systems. The fix must be architectural, not a per-call discipline. Kibana didn't have 14,088 instances because someone forgot a `take: 100` once. It had 14,088 because every new module shipped a new data access pattern, and none of them inherited a pagination contract.

---

## Where the Findings Clustered

By domain, findings were heavily concentrated in SaaS and data platforms:

| Domain | Findings |
|--------|----------|
| SaaS / Business Applications | 19,040 |
| Data / Analytics APIs | 18,909 |
| E-commerce / Marketplace APIs | 6,592 |
| Content / Media APIs | 5,513 |
| Developer Tools / APIs | 1,528 |
| Fintech / Banking APIs | 428 |

That matches intuition — and the numbers are stark. SaaS and analytics platforms together account for **37,949 findings (73%)**. These are products built around user-generated data, filtering, and exports. Every admin dashboard, every CSV export, every "load all my records" feature is a potential unbounded query waiting to happen.

E-commerce and content platforms are the next tier. They deal with catalogs, media assets, and user content — data that grows linearly with the business. The 6,592 e-commerce findings are particularly concerning because checkout flows can't afford 66ms parse spikes. A customer waiting for their cart to load doesn't care that your ORM defaults to `findAll`.

Fintech is the outlier: only **428 findings**. Either financial services developers are more disciplined about data access (possible — they're regulated and audited), or their APIs are more intentionally constrained by design. Either way, it's the one sector where large payloads aren't the default.

---

## The Fix

Large payload fixes aren’t glamorous, but they’re predictable.

### 1) Put a contract on list endpoints

If an endpoint returns an array, it needs a pagination story.

Cursor pagination is the safest default. It uses an opaque pointer (a cursor) to the next page, which means inserting or deleting rows in the middle of the dataset won't cause duplicate or skipped results. Offset pagination uses `LIMIT 100 OFFSET 200`, which is simpler but breaks under concurrent modifications — a row deleted between page 2 and page 3 shifts every subsequent result. Offset is fine for internal tools with stable datasets. But “return everything” is not a strategy.

### 2) Make limits explicit in ORM calls

If your ORM call returns “many,” force yourself to answer: how many?

- Prisma: `findMany({ take: 100, ... })`
- Sequelize: `findAll({ limit: 100, ... })`
- TypeORM: `find({ take: 100, ... })`
- Mongoose: `find().limit(100)`

### 3) Flatten responses when nested includes explode

Deep nested includes feel ergonomic. They also quietly multiply payload size.

If your endpoint is returning `user → posts → comments`, it's worth asking if this should be two endpoints.

Flatten when the flat structure carries the same data in fewer objects — not when the flat version ends up materialising more records than the nested equivalent. If `user.posts.comments` involves a fan-out that the flat version would also have to represent, the flattening only helps if you also paginate.

The goal isn't "no nesting." It's "no accidental fan-out."

### 4) Stop writing `SELECT *` in production paths

If your table has 40 columns and you need 6, ship 6.

It’s not just bandwidth. It’s parse time. It’s memory. It’s cache pressure. It’s mobile data. It’s everything.

---

## Detection

I built the detector as a Babel AST scanner that looks for a few high-signal patterns:

- ORM fetches with no `limit`/`take`
- Deep `include` chains (3+ levels)
- SQL strings containing `SELECT *`

Static analysis won’t tell you the payload size at runtime. But it will tell you where the risk is hiding.

The detector only covers three of the five patterns listed in The Pattern section. `unbounded_find_all`, `deep_nested_include`, and `select_star` are detectable by static analysis because they leave clear AST signatures. Missing pagination and unbounded GraphQL are harder to detect statically — a missing pagination contract doesn't always have a unique code shape, and GraphQL resolver analysis requires schema+resolver coupling that Babel AST alone can't provide. The 64.6% prevalence is a lower bound; the true rate including undetectable patterns is likely higher.

If you want the fastest pass on your own codebase, start with grep:

```bash
# Find obvious SELECT *
grep -rn "SELECT \*" .

# Find ORM list fetches (examples)
grep -rn "findMany(" src/
grep -rn "findAll(" src/
```

Then use your APM to confirm which endpoints actually produce large responses.

---

## Caveats

A few things to keep the results honest:

**Synthetic JSON is a lower bound.** Real APIs add serialization, compression, network latency, and schema validation. If anything, the production penalty is larger than what these benchmarks show. The 66ms parse time assumes the bytes are already in memory.

**Node.js-specific, but the pattern generalizes.** These numbers are for V8 on Node.js. Browser `JSON.parse()` differs — Chrome's parser has different GC heuristics and may handle large object graphs differently. But the underlying truth holds everywhere: bigger payloads cost more to parse. Looking at BM-01, the scaling is approximately linear — each 10× size increase produces roughly a 10× parse time increase. The superlinearity is mild: the 10MB parse (66ms) is slightly worse than 10× the 1MB parse (63.2ms), because GC interference at large sizes adds a small but measurable penalty. "Superlinear" is technically true, but the dominant effect is linear scaling with a GC-induced kink at the top end.

**Findings are not all on the hot path** (code that executes on every request, not just occasionally). Some detector hits are in test files, example code, or build tooling. The AST scan can't distinguish a `findAll()` in an integration test from one in an Express route handler. What it *can* tell you is that the anti-pattern is culturally normalized — it shows up often enough that developers don't think twice. The 64.6% prevalence is a signal about ecosystem defaults, not a guarantee that every hit is causing production incidents.

**23 repos failed to scan.** Eleven were deleted or renamed between corpus selection and scan time. Seven hit Babel parse errors on TypeScript edge cases the detector couldn't resolve without full project configuration. Five had JSX patterns that tripped the parser. Those repos are excluded from all prevalence numbers. They don't change the conclusion — even if every excluded repo were clean, you'd still be looking at 60%+ prevalence.

---

## Streaming JSON: The Alternative Not Benchmarked

Chunking, as benchmarked here, is a client-side optimisation that works with any existing API. But there is a more complete solution: streaming JSON parsers.

Streaming parsers (e.g., `JSONStream`, `stream-json`, WHATWG Streams API) read JSON incrementally as bytes arrive over the network, emitting objects as they are completed rather than waiting for the full payload. This reduces time-to-first-object and peak heap usage significantly for large payloads. However, it requires a streaming-compatible API design — the server must support chunked transfer encoding — and fundamentally different client code.

The two approaches serve different constraints. Chunking is what you do when the API surface is fixed and you need a quick client-side win. Streaming is what you design into the system when you control both sides and can afford the architectural change. This study benchmarked chunking because it is the pragmatic fix most teams can apply today.

---

## Appendix: Source Code and Data

Everything for this study is in the empirical-study repository:

- Corpus + scanner: `studies/09-large-payloads/src/step2-realworld/`
- Detector: `studies/09-large-payloads/src/step3-static-analysis/detector/`
- Benchmark results: `studies/09-large-payloads/results/bench-*.json`
- Scan prevalence: `studies/09-large-payloads/results/prevalence-*.json`

---

*Built at [Stack Insight](https://stackinsight.dev).*
