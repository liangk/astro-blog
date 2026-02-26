---
title: "The Missing Index Crisis: A 40-Repo Scan and Five-Module Benchmark Study of Prisma and PostgreSQL"
pubDate: "2026-02-25"
heroImage: "../../assets/missing-index-empirical-study.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "We scanned 40 production Prisma repositories and found 1,209 missing index patterns. Then we benchmarked five scenarios against PostgreSQL at four dataset sizes (1K–1M rows) with 30 trials each. FK scan without an index: 153× slower. ORDER BY without an index: 190× slower. Point lookup: 26× slower. The one surprise: covering indexes showed zero measurable benefit because PostgreSQL chose sequential scan regardless. All findings, raw data, and the static detector are open source."
excerpt: "Prisma does not create indexes on foreign key columns by default. We scanned 40 production repos, found 1,209 missing indexes, then benchmarked the performance cost. An unindexed FK scan is 153× slower. An unindexed ORDER BY is 190× slower. Here's the full data."
lastmod: "2026-02-25"
canonical_url: "https://stackinsight.dev/blog/missing-index-empirical-study"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - prisma missing index
  - postgresql missing index performance
  - prisma foreign key index
  - prisma @@index missing
  - postgresql sequential scan vs index scan
  - prisma schema indexing best practices
  - postgresql order by without index
  - composite index postgresql prisma
  - covering index postgresql include
  - database index benchmark empirical study
  - prisma performance optimization
  - postgresql query planner index
  - missing fk index prisma default
  - prisma static analysis index detector
  - postgresql benchmark node.js prisma
  - index scan vs seq scan postgresql
  - prisma schema audit tool
  - cohen's d database benchmark
  - power law database scaling
  - prisma orderby performance

# AIEO (AI Engine Optimization)
ai_summary: "This empirical study combines controlled PostgreSQL benchmarks of five missing-index scenarios with static analysis of 40 production Prisma repositories. Benchmarks ran 30 trials each at n = 1K, 10K, 100K, and 1M rows with 5 warmup queries and VACUUM ANALYZE between configurations. Key findings: (1) Unindexed FK scan was 153× slower than indexed at all dataset sizes. (2) Unindexed ORDER BY was 158–190× slower. (3) Point lookup scaled from 1.2× at n=1K to 26× at n=1M (b=0.50 vs b=0.003). (4) Single-column vs composite index for multi-field WHERE was 151–167× slower. (5) Covering index (INCLUDE) showed zero benefit — PostgreSQL chose Seq Scan for low-cardinality status column. Real-world scan: 1,209 missing index findings in 22/40 repos (55% prevalence). Missing sort indexes dominated at 846 instances (70%); missing FK indexes were 363 (30%). Critical discovery: Prisma does NOT auto-create FK indexes."
ai_key_facts:
  - "Unindexed FK scan was 153× slower than indexed at n=1M (p < 0.001, Cohen's d = 2.3)"
  - "Unindexed ORDER BY created_at DESC LIMIT 20 was 190× slower at n=1M (p < 0.001, Cohen's d = 3.0)"
  - "Unindexed email point lookup scaled from 1.2× at n=1K to 26× at n=1M (Cohen's d = 11.0)"
  - "Composite index was 166× faster than single-column index for multi-field WHERE at n=1M"
  - "Covering index (INCLUDE) showed zero measurable benefit — PostgreSQL chose Seq Scan for low-cardinality column"
  - "1,209 missing index patterns found across 40 Prisma repos; 22 of 40 repos (55%) had at least one"
  - "846 missing-sort-index instances (70%) and 363 missing-fk-index instances (30%)"
  - "trigger.dev had 177 missing indexes, cal.com had 171, amplication had 137"
  - "Prisma does NOT auto-create indexes on foreign key columns — each @relation requires manual @@index"
ai_entities:
  - "Prisma ORM"
  - "PostgreSQL"
  - "Node.js"
  - "TypeScript"
  - "B-tree Index"
  - "Covering Index"
  - "Composite Index"
  - "Sequential Scan"
  - "Bitmap Heap Scan"
  - "VACUUM ANALYZE"
  - "Cohen's d"
  - "Power-Law Regression"
  - "trigger.dev"
  - "cal.com"
  - "amplication"
  - "EXPLAIN ANALYZE"

# Structured Data (Article Schema)
schema_type: "TechArticle"
schema_proficiency_level: "Advanced"
schema_dependencies: "Node.js v18+, TypeScript 5+, Prisma 6+, PostgreSQL 14+"
schema_time_required: "PT25M"

# Taxonomy
categories:
  - "Database Performance"
  - "Software Engineering Research"
  - "Backend Development"
tags:
  - prisma
  - postgresql
  - database-indexes
  - performance
  - typescript
  - benchmarking
  - static-analysis
  - empirical-study
  - query-optimization
  - foreign-key
  - composite-index
  - covering-index
  - cohens-d
  - power-law
  - orm

# Related
related_posts:
  - "n-plus-1-query-empirical-study"
  - "loop-performance-empirical-study"
series: "Software Performance Empirical Studies"
series_order: 5
---

# The Missing Index Crisis: A 40-Repo Scan and Five-Module Benchmark Study of Prisma and PostgreSQL

There's a database index bug hiding in most Prisma projects, and it's almost certainly in yours too.

It's not a bug that throws an error. Your queries return the right data. Everything works fine in development, staging, even early production. Then your table crosses 100K rows and a query that used to take 2ms starts taking 400ms. You run `EXPLAIN ANALYZE` and see two words you didn't want: **Seq Scan**.

The cause, almost every time: a foreign key column with no index.

Here's the part that surprises most Prisma developers: **Prisma does not create indexes on foreign key columns by default.** Unlike MySQL/InnoDB, which auto-indexes foreign keys, PostgreSQL leaves that to you. And Prisma doesn't add them. If you have a `userId Int` field with a `@relation`, there is no index on `userId` unless you explicitly add `@@index([userId])`. (Prisma v4.7.0 added a missing-index warning — but only when `relationMode = "prisma"` is set. The default `relationMode = "foreignKeys"`, which all standard PostgreSQL projects use, produces no warning. If you haven't explicitly opted into prisma relation mode, you're in the silent case.)

I wanted to know how widespread this is and what it actually costs. So I scanned 40 production Prisma repositories from GitHub and benchmarked five missing-index scenarios against PostgreSQL with 30 trials each at four dataset sizes — 1K, 10K, 100K, and 1 million rows.

The results are more dramatic than I expected.

---

## TL;DR

| Scenario | No index | With index | Speedup |
|---|---|---|---|
| Point lookup `WHERE email = ?` at 1M rows | 6.45 ms | 0.25 ms | **26×** |
| Sort query `ORDER BY created_at LIMIT 20` | ~49 ms | ~0.27 ms | **190×** |
| FK scan `WHERE user_id = ?` | ~42 ms | ~0.27 ms | **153×** |
| Composite filter `WHERE status AND created_at >` | ~46 ms | ~0.28 ms | **166×** |
| Covering index `INCLUDE (email)` | ~52 ms | ~49 ms | **No benefit** |

Real-world scan of 40 Prisma repos: **1,209 missing index patterns, 55% prevalence rate.**

> **One important negative result:** BM-05 (covering index with `INCLUDE`) showed zero benefit — speedup ~0.92–1.20×, p = 0.24. PostgreSQL chose sequential scan for both variants because the `status` column is low-cardinality. Not all index additions help.

> **Methodology note:** All benchmarks use a warm shared buffer pool (5 warmup queries before each trial set). Baselines with parallel scan had CV > 15% — I use medians, not means, to account for this. The static detector uses naming-convention heuristics and may have false positives.

---

## Part 1: The benchmarks

### Setup

The benchmark database has two tables: `bench_users` (email, status, created_at) and `bench_orders` (user_id, status, amount, created_at). No application-layer indexes except primary key — all indexes are created and dropped programmatically per benchmark. For each module and dataset size:

1. Seed exactly n rows, `VACUUM ANALYZE`
2. 5 warmup queries to populate shared buffer pool
3. 30 baseline trials (no index), `performance.now()` per trial
4. `CREATE INDEX` + `ANALYZE`
5. 5 warmup queries
6. 30 optimized trials
7. `DROP INDEX` to restore baseline state

CV threshold: 15%. Some baselines had higher variance due to parallel scan jitter — I'll note those.

---

### BM-01: Point lookup on an unindexed column

`WHERE email = 'user@example.com'` with no index on `email`. PostgreSQL scans every row looking for a match.

```typescript
// Both versions use the same Prisma query — difference is @@index([email]) in schema
const user = await prisma.benchUser.findFirst({ where: { email } });
```

| n | No index (ms) | Indexed (ms) | Speedup |
|---|---|---|---|
| 1K | 0.29 | 0.24 | 1.2× |
| 10K | 0.56 | 0.25 | 2.2× |
| 100K | 4.76 | 0.25 | **18.8×** |
| 1M | 6.45 | 0.25 | **26.0×** |

The baseline doesn't grow linearly. Power-law regression gives exponent b = 0.50 (roughly O(√n)), not b = 1.0 as sequential scan theory predicts. This is because the data fits in PostgreSQL's shared buffer pool — the scan is a memory traversal, not disk I/O. CPU cache effects compress the curve.

The optimized version: b = 0.003. Effectively O(1). A B-tree lookup takes ~0.25ms whether there are 1K or 1M rows.

**Cohen's d at n=1M: 11.0.** For reference, d > 0.8 is "large." At this magnitude, Cohen's d stops adding granularity — it simply confirms total separation of distributions. The more practically useful number is the raw speedup: **26×**. Every single optimized trial was faster than every single baseline trial, without exception.

---

### BM-02: ORDER BY without an index

`ORDER BY created_at DESC LIMIT 20`. No index on `created_at`. PostgreSQL scans the full table, sorts everything, returns the top 20.

```prisma
// Without index: full table scan + sort on every query
model BenchUser {
  id        Int      @id @default(autoincrement())
  createdAt DateTime @default(now())
  // No index — every ORDER BY query scans the full table
}

// With index: walks the first 20 index entries — done
model BenchUser {
  id        Int      @id @default(autoincrement())
  createdAt DateTime @default(now())
  
  @@index([createdAt(sort: Desc)])
}
```

| n | No index (ms) | Indexed (ms) | Speedup |
|---|---|---|---|
| 1K | 48.8 | 0.29 | **170×** |
| 10K | 53.7 | 0.31 | **171×** |
| 100K | 49.2 | 0.31 | **158×** |
| 1M | 48.5 | 0.26 | **190×** |

The baseline is approximately flat across all n — 48–54ms at every dataset size (the variation is within the CV range already disclosed). This surprises people. The reason: PostgreSQL uses parallel workers (plan type: `Gather → Sort → Parallel Seq Scan`). With a warm buffer pool, the bottleneck is parallel worker coordination and the sort, not I/O. Those costs don't scale linearly with n when the data fits in shared buffers.

The optimized version reads exactly 20 rows in sorted order and stops. O(1). Whether the table has 1K or 1M rows, the answer is always in the first 20 index entries.

**If you have a "list recent items" endpoint without an index on your timestamp column, you're paying 170–190× right now — regardless of table size.**

---

### BM-03: The unindexed FK scan — Prisma's default

This is the big one. When you define a relation in Prisma:

```prisma
model BenchOrder {
  id     Int       @id @default(autoincrement())
  userId Int
  user   BenchUser @relation(fields: [userId], references: [id])
  // No @@index([userId]) — Prisma generates no index here
}
```

Every query like `findMany({ where: { userId } })` is a full table scan. Prisma does not add `@@index([userId])` automatically. This is intentional — Prisma's docs note that indexes have write costs and leave the decision to you — but most developers don't know to make this decision.

> **Prisma v4.7.0 note:** Prisma added a missing-index validation warning in v4.7.0, but it only fires when `relationMode = "prisma"` is configured. The default `relationMode = "foreignKeys"` — the mode every standard PostgreSQL project uses — produces no warning. Unless you've explicitly set `relationMode = "prisma"` in your schema datasource block, this problem is completely silent.

| n | No FK index (ms) | With FK index (ms) | Speedup |
|---|---|---|---|
| 1K | 42.0 | 0.27 | **153×** |
| 10K | 42.7 | 0.28 | **153×** |
| 100K | 41.0 | 0.27 | **150×** |
| 1M | 41.1 | 0.27 | **153×** |

Again the baseline is constant — parallel Gather plan with warm buffers. The optimized plan switches to `Bitmap Heap Scan`: PostgreSQL builds a bitmap of matching row positions from the index, then fetches only those rows. A completely different access strategy.

The fix is one line in your Prisma schema:

```prisma
model BenchOrder {
  userId Int
  user   BenchUser @relation(fields: [userId], references: [id])
  @@index([userId])  // Add this
}
```

One line. 153× faster. It's the single highest-ROI change you can make to most Prisma schemas.

---

### BM-04: Single-column index vs composite index

You have `WHERE status = 'active' AND created_at > ?`. You've added `@@index([status])`. Is that enough?

```prisma
// Baseline state: @@index([status]) only
model BenchUser {
  id        Int      @id @default(autoincrement())
  status    String
  createdAt DateTime @default(now())
  
  @@index([status])  // Only indexes status — not enough!
}

// Optimized state: @@index([status, createdAt])
model BenchUser {
  id        Int      @id @default(autoincrement())
  status    String
  createdAt DateTime @default(now())
  
  @@index([status, createdAt])  // Composite index handles both predicates
}
```

| n | Single-col index (ms) | Composite index (ms) | Speedup |
|---|---|---|---|
| 1K | 46.4 | 0.29 | **157×** |
| 10K | 45.3 | 0.27 | **167×** |
| 100K | 45.9 | 0.30 | **151×** |
| 1M | 45.8 | 0.28 | **166×** |

With only `@@index([status])`, PostgreSQL won't use the index — the planner determines a sequential scan is cheaper when the single-column index covers a large fraction of rows (around 40% match `status='active'` in this dataset) and doesn't help narrow the date range. It still scans the full table with a parallel Gather plan. The composite index on `(status, createdAt)` handles both predicates: seek to `status='active'` in the index, walk forward for the date range. Zero heap rows outside the range are visited.

Rule of thumb: put equality fields first in the composite index, range fields last. `@@index([status, createdAt])` follows this. `@@index([createdAt, status])` would not help the range query as effectively.

---

### BM-05: Covering index — the one that didn't help

`SELECT id, email FROM bench_users WHERE status = 'active'`. A covering index adds the projected columns to the index itself via `INCLUDE`, so PostgreSQL never needs to touch the heap.

```sql
-- Optimized: covering index, no heap fetch needed
CREATE INDEX ON bench_users (status) INCLUDE (id, email);
```

| n | Index on status (ms) | Covering index (ms) | Speedup |
|---|---|---|---|
| 1K | 56.4 | 57.6 | 0.98× |
| 10K | 52.1 | 56.3 | 0.93× |
| 100K | 59.1 | 49.2 | 1.20× |
| 1M | 52.4 | 56.7 | 0.92× |

No benefit. p-value at n=1M: 0.24. Both variants show `Seq Scan` in EXPLAIN ANALYZE.

PostgreSQL's planner chose sequential scan for both — because `status` is low-cardinality (a handful of distinct values). If 30-40% of rows match `status='active'`, visiting each through an index + heap lookup is *slower* than a straight sequential scan. The covering index never gets used, so INCLUDE changes nothing.

**Covering indexes help when your filter column is highly selective** (e.g., `WHERE userId = ?` returns a tiny fraction of rows) and you want to avoid heap fetches for the projected columns. On a low-selectivity column like status, the planner correctly ignores the index.

This is a useful negative result: don't blindly add INCLUDE to every index. Check your selectivity first with `EXPLAIN ANALYZE` and look for `Heap Fetches` in the index scan stats.

---

## The full scaling picture

| Module | Variant | Exponent (b) | R² | Label |
|---|---|---|---|---|
| BM-01 | Baseline | 0.50 | 0.92 | O(√n) — warm buffer scan |
| BM-01 | Optimized | 0.003 | 0.25 | O(1) — B-tree lookup |
| BM-02 | Baseline | −0.005 | 0.08 | O(1) — parallel scan constant |
| BM-02 | Optimized | −0.016 | 0.24 | O(1) — 190× faster constant |
| BM-03 | Baseline | −0.004 | 0.48 | O(1) — parallel Gather constant |
| BM-03 | Optimized | −0.003 | 0.36 | O(1) — Bitmap Heap Scan |
| BM-04 | Baseline | −0.001 | 0.13 | O(1) — parallel scan constant |
| BM-04 | Optimized | −0.004 | 0.04 | O(1) — Index Scan |
| BM-05 | Baseline | −0.004 | 0.04 | O(1) — Seq Scan |
| BM-05 | Optimized | −0.008 | 0.10 | O(1) — Seq Scan (same) |

BM-01 is the only module where the baseline scales with n (b=0.50). The others are effectively constant because parallel sequential scan + warm buffer pool makes the bottleneck independent of table size in this range.

The practical implication: **the performance gap between indexed and unindexed is not a "scaling problem" you can defer.** BM-02/03/04 show 150–190× penalties at n=1K. You're paying that cost right now, in production, regardless of table size. The indexed version is also constant — ~0.27ms — meaning your query time stays flat as your data grows. The unindexed version does too, but 150× slower.

---

## Part 2: How common is this in real Prisma projects?

### The scan

I built a static detector (`prisma-index-detector.ts`) that parses `schema.prisma` files and checks two rules:

1. **Missing FK index:** Any field ending in `Id` with type `Int` or `String` that lacks a matching `@@index`
2. **Missing sort index:** `createdAt` or `updatedAt` DateTime fields without `@@index`

Then I pointed it at 40 production Prisma repos from GitHub — 5 domains × 8 repos each, all with ≥1K stars, all actively maintained, all confirmed to have `schema.prisma` files present.

### The numbers

**40 repos scanned. 1,209 missing index patterns found. 22 repos (55%) had at least one.**

| Pattern | Count | Share |
|---|---|---|
| Missing sort index (createdAt/updatedAt) | 846 | 70% |
| Missing FK index (userId, orderId, etc.) | 363 | 30% |

Sort indexes dominate. Most Prisma schemas have `createdAt DateTime @default(now())` on nearly every model, and `ORDER BY createdAt DESC` is one of the most common queries. The @@index is almost never there.

### Repos with most missing indexes

| Repo | Missing indexes | Domain |
|---|---|---|
| triggerdotdev/trigger.dev | 177 | Developer tools |
| calcom/cal.com | 171 | SaaS |
| amplication/amplication | 137 | Developer tools |
| prisma/prisma-examples | 125 | Examples |
| baptisteArno/typebot.io | 110 | SaaS |
| toeverything/AFFiNE | 107 | Collaboration |
| blitz-js/blitz | 72 | Framework |
| documenso/documenso | 68 | SaaS |
| formbricks/formbricks | 66 | SaaS |
| mfts/papermark | 36 | SaaS |

A few things stand out here.

**trigger.dev and cal.com have 170+ missing indexes each.** These are serious, production-grade projects used by thousands of developers. Their Prisma schemas are large and complex. The missing sort indexes accumulate fast when you have 50+ models and none of them have `@@index([createdAt])`.

**prisma/prisma-examples has 125.** The official Prisma example repository — the one most developers look at when learning Prisma — has 125 missing indexes. If the canonical learning resource doesn't model this, it's not surprising that production apps don't either.

**Only 18 of 40 repos have zero findings.** The other 22 range from 1 missing index to 177. If you pick a random Prisma project with more than a few models, there's a 55% chance it's missing at least one index.

---

## The three fixes

### Fix 1: Index every FK column

Every `@relation` in Prisma adds a scalar FK field. Add `@@index` for each one:

```prisma
model Post {
  id       Int    @id @default(autoincrement())
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])

  @@index([authorId])  // Required — Prisma won't add this for you
}
```

If you have 10 models with relations, you need 10 `@@index` additions. It's tedious, which is probably why it doesn't happen. A linter can catch these automatically — more on that below.

### Fix 2: Index your timestamp columns

If you ever query `ORDER BY createdAt DESC` or filter by date range, index it:

```prisma
model Order {
  id        Int      @id @default(autoincrement())
  createdAt DateTime @default(now())

  @@index([createdAt(sort: Desc)])  // Descending order matches most queries
}
```

### Fix 3: Use composite indexes for multi-field WHERE

If you filter on `status` AND `createdAt` together, a composite index is 150× faster than a single-column index:

```prisma
model Order {
  status    String
  createdAt DateTime

  // Instead of separate @@index([status]) and @@index([createdAt])
  @@index([status, createdAt])
}
```

---

## How to detect missing indexes in your own schema

### Option 1: Use Code Evolution Lab (Recommended)

The fastest way to detect missing indexes — along with N+1 queries, memory leaks, and other performance issues — is to use [Code Evolution Lab](https://codeevolutionlab.com). It scans your entire codebase (not just Prisma schemas) and provides actionable reports with line numbers and fix recommendations.

Code Evolution Lab uses the same detection algorithms validated in this study, plus dozens more rules for React, Vue, Angular, Node.js, and database patterns.

### Option 2: Run the open-source detector

You don't need to audit by hand. The detector I built is open source:

```bash
git clone https://github.com/liangk/empirical-study.git
cd empirical-study/studies/05-missing-index
npm install
npm run detect -- --path /path/to/your/project
```

It will find all `schema.prisma` files under the path, check for missing FK and sort indexes, and list them with line numbers and recommended fixes. Running it on your project takes about 2 seconds.

You can also run the full benchmark suite if you have a local PostgreSQL instance:

```bash
cp .env.example .env  # Add your DATABASE_URL
npm run prisma:push
npm run seed
npm run bench:all
```

---

## What I'd push back on

**"This only matters at scale."**

The BM-02/03/04 data shows 150–190× penalties at n=1K. If you have 1,000 orders — which is nothing, a few days of data for a small SaaS — an unindexed `WHERE user_id = ?` takes 42ms instead of 0.27ms. That's not a scale problem. That's a problem right now.

**"PostgreSQL will choose the best plan anyway."**

The planner can only work with the indexes that exist. If there's no index on `userId`, the planner's best option is a sequential scan. It will do that efficiently — parallel workers, warm buffers — but it's still 150× slower than what's possible. The planner is not magic; it needs something to work with.

**"Our ORM handles this."**

Prisma and Sequelize do not add FK indexes automatically on PostgreSQL. TypeORM's behavior depends on version and configuration — recent versions with `createForeignKeyConstraints: true` (the default) do create FK indexes, though behavior has varied across versions. If you're on PostgreSQL, check your ORM's documentation. In Prisma specifically, FK indexes are never automatic — the decision is always left to you.

---

## The honest caveats

**Warm buffer pool.** I ran warmup queries before every measurement to populate shared buffers. Both variants benefit equally, but cold-start numbers would be worse for the unindexed cases because they scan more data. These benchmarks represent steady-state performance, not first-query-of-the-day performance.

**CV exceeded 15% on some baselines.** BM-02 and BM-03 baselines had CV of 35–60%. Parallel scan jitter — the timing of parallel worker scheduling introduces noise. The medians are stable and consistent; the variance is in the tails. I report medians, not means, to be robust to this.

**Only two detection rules.** The static detector checks FK columns and createdAt/updatedAt. A complete index audit would also check fields used in `orderBy`, `where`, and `distinct` in your query code — a much harder problem that requires analyzing TypeScript call sites, not just the schema file. The detector uses a naming-convention heuristic (fields ending in `Id` with type `Int` or `String`), which can produce false positives for non-FK fields like `externalId` or `sequenceId`, as well as false negatives for FK fields not following the convention. Treat the 1,209 count as an order-of-magnitude estimate rather than a precise figure.

**Dataset size.** My benchmark tables are simple two-model schemas. Real application schemas are more complex — foreign key chains, partial indexes, partial queries, more selective filters. Results will vary.

---

## Try it yourself

```bash
git clone https://github.com/liangk/empirical-study.git
cd empirical-study/studies/05-missing-index
npm install
# Run the static detector on your own project:
npm run detect -- --path /path/to/your/prisma/project
```

For the full benchmark suite, you'll need a local PostgreSQL instance and a `.env` with `DATABASE_URL`. See the README for setup instructions.

---

## What's next

This study focused on schema-level detection: missing `@@index` declarations. The harder problem is query-level detection: finding fields used in `findMany where` clauses that lack an index, even when the field is not a named FK or timestamp. That requires analyzing TypeScript call sites and cross-referencing the schema — much more complex static analysis.

I'm also curious how the BM-01 point lookup numbers change at n=10M, where the table no longer fits in shared buffers and the warm-cache assumption breaks down. At that scale, the unindexed sequential scan hits disk I/O, and the penalty should become much more dramatic.

The bottom line: missing indexes in Prisma projects are not an edge case. They're the default. 55% prevalence across 40 production repos, 1,209 instances, projects with hundreds of thousands of users. The fix is one line per relation. The performance penalty for not fixing it starts at 150× and it's already there at 1K rows.

---

## About this research

This study is part of a series of empirical performance investigations that validate the detection rules used in [Code Evolution Lab](https://codeevolutionlab.com). Each article in this series:

- Scans real-world production codebases to measure prevalence
- Runs controlled benchmarks to quantify performance impact
- Provides open-source detectors and raw data for reproducibility

Other studies in this series:
- [N+1 Query Problem](../n-plus-1-query-empirical-study) — 40 repos, 847 instances, 89× slowdown
- [Loop Performance](../loop-performance-empirical-study) — for...of vs forEach vs for(;;) across 6 engines
- [Memory Leaks](../memory-leak-empirical-study) — React/Vue/Angular cleanup patterns
- [Blocking I/O](../blocking-io-empirical-study) — sync vs async file operations

If you want these checks running automatically on your codebase, check out [Code Evolution Lab](https://codeevolutionlab.com).

---

*The benchmark suite, static detector, and raw data are on [GitHub](https://github.com/liangk/empirical-study). Built at [StackInsight](https://stackinsight.dev).*
