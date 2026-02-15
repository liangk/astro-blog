---
title: "We Measured the N+1 Query Problem. The Numbers Are Worse Than You Think."
pubDate: "2026-02-12"
heroImage: "../../assets/n-plus-1-query-empirical-study.webp"
author: "Ko-Hsin Liang"
repo: ""
description: "We benchmarked four N+1 query patterns using Prisma and PostgreSQL at 100 and 1,000 records. The worst case hit 27x slower with 2,000 unnecessary queries — and the nested pattern crossed 1.2 seconds with over 4,000 queries. Here's the data and the fixes."
excerpt: "Everyone warns you about the N+1 query problem, but nobody shows you the actual numbers. So we built a benchmark suite and measured it. The results surprised even us."
lastmod: "2026-02-12"
canonical_url: "https://stackinsight.dev/blog/n-plus-1-query-empirical-study"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - n+1 query problem
  - n+1 query prisma
  - prisma eager loading
  - prisma include performance
  - orm performance benchmark
  - n+1 query fix typescript
  - prisma n+1 detection
  - database query optimization nodejs
  - orm anti-pattern empirical study
  - postgresql query performance analysis
  - eager loading vs lazy loading
  - n+1 problem explained

# AIEO (AI Engine Optimization)
ai_summary: "This empirical study measures the performance impact of the N+1 query anti-pattern across four controlled test cases using Prisma ORM and PostgreSQL at two dataset sizes (100 and 1,000 records). At 100 records, N+1 patterns produced 9.2x to 22.2x slower execution; at 1,000 records, penalties increased to 10.4x–26.5x with the nested pattern exceeding 1.2 seconds and generating 4,001 queries. Optimized versions used 2–3 queries vs. 56–4,001 in unoptimized code. Mitigation strategies include eager loading and batch-query-before-loop patterns."
ai_key_facts:
  - "N+1 queries caused 9.2x to 22.2x slower execution on a 100-user dataset"
  - "Query count dropped from 56–401 queries to just 2–3 queries after optimization"
  - "Nested N+1 (Users → Posts → Comments) generated 401 queries vs 3 with eager loading"
  - "Prisma include (eager loading) is the primary mitigation for N+1 in Prisma ORM applications"
  - "Batch query with Map lookup is the recommended fix for conditional or dynamic loading patterns"
  - "Query reduction ranged from 96.4% to 99.3% across all four test cases"
  - "At 1,000 users, nested N+1 (TC2) exceeded 1.2 seconds with 4,001 queries"
  - "Speedup factors held steady or increased at 10x scale: TC3 rose from 22.2x to 26.5x"
  - "TC4 conditional loading speedup doubled from 10.5x to 21.9x at 1,000 users"
  - "Query reduction exceeded 99.5% across all test cases at 1,000 users"
ai_entities:
  - "Prisma ORM"
  - "PostgreSQL"
  - "Node.js"
  - "TypeScript"
  - "N+1 Query Problem"
  - "Eager Loading"
  - "Lazy Loading"
  - "Object-Relational Mapping"
  - "Code Evolution Lab"
  - "AST Analysis"

# Structured Data (Article Schema)
schema_type: "TechArticle"
schema_proficiency_level: "Intermediate"
schema_dependencies: "Node.js v18+, TypeScript 5+, Prisma 6+, PostgreSQL 15+"
schema_time_required: "PT20M"

# Taxonomy
categories:
  - "Database Performance"
  - "Software Engineering Research"
  - "Backend Development"
tags:
  - prisma
  - postgresql
  - n-plus-1
  - performance
  - typescript
  - orm
  - benchmarking
  - eager-loading
  - query-optimization
  - empirical-study
  - anti-pattern

# Related
related_posts:
  - "prisma-query-optimization-guide"
  - "understanding-orm-performance"
series: "Database Performance Empirical Studies"
series_order: 1
---

# We Measured the N+1 Query Problem. The Numbers Are Worse Than You Think.

I kept seeing the same advice in every ORM tutorial: "Watch out for N+1 queries." Every code review, every blog post, every conference talk. Always the same warning, never the actual numbers.

So I decided to measure it.

I built a benchmark suite, seeded a PostgreSQL database, wrote the "bad" code that everyone warns about, wrote the "good" code that everyone recommends, and ran them side by side. Four different scenarios, each one timed and query-counted down to the individual SQL statement.

The short version? On a tiny dataset — just 100 users — the worst pattern was **22x slower** and fired **200 unnecessary queries**. And that's the *conservative* estimate, because I ran everything on localhost where network latency is basically zero.

Here's what I found.

---

## What's the N+1 problem, actually?

You probably already know this, but it's worth being precise about it because the devil is in the details.

Say you've got 100 users and you want each user's posts. The naive approach does this:

1. One query to grab all users
2. Then, inside a loop, one query *per user* to get their posts

That's 101 database round-trips. The "1" to get the users, plus "N" (100) to get each user's posts. Hence, N+1.

The thing is, each individual query is fast — sub-millisecond in most cases. But every single one of those queries carries overhead. The app has to send the request to PostgreSQL, PostgreSQL has to parse it, plan it, execute it, serialise the results, and send them back. Do that 101 times and the overhead stacks up fast.

The fix is usually straightforward: tell your ORM to grab the related data upfront. In Prisma, that's the `include` keyword. Instead of 101 queries, you get 2. Same result, fraction of the time.

But *how much* of a fraction? That's what I wanted to pin down.

---

## How I set this up

I wanted the benchmarks to be fair and reproducible, so here's what I did.

**The stack:** Prisma 6.3.1, PostgreSQL 17, TypeScript, Node.js 22 — all running locally on the same machine. Running the database locally means there's no network hop between the app and the database. That makes the numbers *more conservative* than what you'd see in production, where the database is usually on a separate server (or across the internet, if you're using a managed service).

**The data:** 100 users, each with 3 posts, 2 comments per post, and 2 orders. All generated with Faker so the string content is realistic — not just `"test"` repeated a thousand times. Serialisation costs are real costs, and I didn't want to cheat there.

**The measurement:** Every query that Prisma sends to PostgreSQL gets intercepted and counted. Not estimated, not sampled — counted. Each benchmark runs 5 times (after a warmup run) using `performance.now()`, and I report the mean, median, P95, and P99.

**The test cases:**

| # | What it tests | Relationship |
|---|--------------|-------------|
| TC1 | Users with their posts | One-to-many |
| TC2 | Users → posts → comments | Three-level nesting |
| TC3 | Orders with their user | Many-to-one (reverse) |
| TC4 | Active orders, conditionally load user | Conditional access |

Each test case has a "bad" version (the N+1 pattern) and a "good" version (the recommended fix). Both return the exact same data.

Source code for everything: [github.com/liangk/empirical-study](https://github.com/liangk/empirical-study)

---

## TC1: Users with posts — the textbook case

This is the one everyone uses as an example. Grab all users, loop through them, fetch posts for each one.

The bad version fires 101 queries. The good version uses `include: { posts: true }` and fires 2.

| Metric | Bad (N+1) | Good (Eager) | Improvement |
|--------|-----------|--------------|-------------|
| **Queries** | 101 | 2 | 98.0% fewer |
| **Avg time** | 39.31 ms | 4.28 ms | **9.2x faster** |
| **Median** | 38.96 ms | 4.21 ms | 9.3x faster |
| **P95** | 41.49 ms | 4.53 ms | 9.2x faster |

Here's what caught my attention: the variance in the good version is tiny. The standard deviation is under 0.25ms. That matters if you're building an API where you care about tail latency — and you should care about tail latency.
The bad version stays surprisingly steady too, with a relatively small variance. It *feels* fine at this scale. 39ms isn't going to trigger any alarms. But it's doing 50x more work than it needs to, and the cost grows linearly with your user count.

---

## TC2: Nested relationships — where it gets ugly

This one goes deeper. Users → posts → comments. Three levels of entities.

The bad code has two nested loops, each firing queries. With 100 users and 3 posts each, that's 1 query for users + 100 for posts + 300 for comments = **401 queries**.

The good version? Nested `include` directives. **3 queries total.** One per entity level, no matter how many records.

| Metric | Bad (N+1) | Good (Eager) | Improvement |
|--------|-----------|--------------|-------------|
| **Queries** | 401 | 3 | 99.3% fewer |
| **Avg time** | 153.59 ms | 10.50 ms | **14.6x faster** |
| **Median** | 143.21 ms | 10.07 ms | 14.2x faster |
| **P95** | 185.53 ms | 11.82 ms | 15.7x faster |

401 queries versus 3. That's not a percentage I need to calculate to know it's bad.

But the timing tells a more interesting story. The bad version's P95 is 185ms — that's 29% higher than its median. Some of those runs are hitting extra overhead, probably connection pool pressure or plan cache misses from hammering PostgreSQL with 400 queries in rapid succession. The good version's P95 is only 17% above its median. Fewer queries means less contention, which means more predictable performance.

And this is the part that should worry you: 153ms with 100 users. The N+1 cost here isn't linear — it's multiplicative. Each level of nesting multiplies the query count. The general formula looks something like:

```
Queries = 1 + N + (N × posts_per_user) + (N × posts_per_user × comments_per_post) + ...
```

With eager loading, it's just the number of entity levels + 1. Always. Doesn't matter if you've got 100 users or 100,000.

If you're thinking "well, my app doesn't have three levels of nesting" — check again. User → projects → tasks. Store → products → reviews. Organization → teams → members. It's more common than you'd expect.

---

## TC3: Orders → User — the biggest speedup

This one flips the relationship. Instead of fetching children for each parent, you're fetching the parent for each child. Classic scenario: you've got an orders list and you want to show the customer name next to each order.

The bad version grabs all orders (200 of them — 2 per user), then calls `findUnique` for each order's user. That's 201 queries.

The good version adds `include: { user: true }`. Two queries.

| Metric | Bad (N+1) | Good (Eager) | Improvement |
|--------|-----------|--------------|-------------|
| **Queries** | 201 | 2 | 99.0% fewer |
| **Avg time** | 82.54 ms | 3.72 ms | **22.2x faster** |
| **Median** | 86.10 ms | 3.66 ms | 23.5x faster |
| **P95** | 88.71 ms | 4.02 ms | 22.1x faster |

**22.2x.** That's the largest speedup across all four test cases.

Why so much bigger than TC1? Two reasons. First, there are more records involved — 200 orders versus 100 users. More queries means more wasted overhead. Second, many of those `findUnique` calls are fetching the *same user* — each user has 2 orders, so each user gets fetched twice. Prisma doesn't deduplicate those calls. It doesn't have an identity map or a request-level cache. So you're not just making too many queries — you're making redundant ones too.

The eager loading version sidesteps all of that. Prisma resolves the relationships from the batch result set in memory.

---

## TC4: Conditional loading — the tricky one

Here's where things get interesting from a design perspective. You've got active orders, but you only need user data for orders where `requiresUserData` is true. Not all of them.

You can't just slap `include: { user: true }` on this one — that would over-fetch user data for orders that don't need it. So the fix is different: collect the user IDs you actually need, fetch them all in one batch, build a lookup map, and assign the results.

The bad version loops through active orders and calls `findUnique` for each one that needs user data. About 70% of them do, which gave us 56 queries.

The good version collects the needed IDs into a Set, does one `findMany` with `WHERE id IN (...)`, builds a Map, and does the assignment in a second pass. Two queries total.

| Metric | Bad (N+1) | Good (Batch) | Improvement |
|--------|-----------|--------------|-------------|
| **Queries** | 56 | 2 | 96.4% fewer |
| **Avg time** | 22.75 ms | 2.16 ms | **10.5x faster** |
| **Median** | 23.05 ms | 2.11 ms | 10.9x faster |
| **P95** | 23.49 ms | 2.57 ms | 9.1x faster |

Even though the conditional logic cuts the query count from a potential 200+ down to 56, you're still paying a **10.5x penalty**. Partial N+1 is still N+1.

This batch-query pattern is worth keeping in your back pocket. It works everywhere — not just in Prisma, not just in JavaScript. Collect the IDs, batch fetch, build a map, assign. You trade a bit of memory for the Map and an extra loop, but you eliminate dozens (or hundreds or thousands) of database round-trips. That trade-off pays for itself every time.

---

## The full picture

Here's everything in one table:

| Test Case | Bad Queries | Good Queries | Reduction | Bad Time | Good Time | Speedup |
|-----------|-------------|--------------|-----------|----------|-----------|---------|
| TC1: One-to-many | 101 | 2 | 98.0% | 39.31 ms | 4.28 ms | **9.2x** |
| TC2: Nested (3-level) | 401 | 3 | 99.3% | 153.59 ms | 10.50 ms | **14.6x** |
| TC3: Many-to-one | 201 | 2 | 99.0% | 82.54 ms | 3.72 ms | **22.2x** |
| TC4: Conditional | 56 | 2 | 96.4% | 22.75 ms | 2.16 ms | **10.5x** |

A few things jump out.

**The optimised versions never exceed 3 queries.** Doesn't matter which pattern, doesn't matter how many records. That's the whole point — you go from O(N) queries to O(1). And the benefit scales with your data. At 1,000 users, the bad TC2 version would fire over 4,000 queries. The good version would still fire 3.

**The speedup correlates with query count.** TC3 had the most queries (201) and the biggest speedup (22.2x). TC4 had the fewest (56) and the smallest speedup (10.5x). Per-query overhead is roughly constant, so more queries = more waste = more gain from fixing it.

**These numbers are the floor, not the ceiling.** I ran everything on localhost. In production, add network latency between app and database — maybe 1-5ms per round-trip. Now multiply that by 401 queries. That's where a 150ms endpoint becomes a 2-second one.

## What happens at 1,000 users?

I ran the same benchmarks on a 10x larger dataset. 1,000 users, 3,000 posts, 6,000 comments, 2,000 orders.

Here's the medium dataset alongside the small one:

| Test Case | 100 Users | | 1,000 Users | | Change |
|-----------|-----------|---|-------------|---|--------|
| TC1: One-to-many | 39ms → 4ms | 9.2x | 364ms → 35ms | **10.4x** | Slightly worse |
| TC2: Nested | 154ms → 11ms | 14.6x | 1,271ms → 88ms | **14.5x** | About the same |
| TC3: Many-to-one | 83ms → 4ms | 22.2x | 739ms → 28ms | **26.5x** | Noticeably worse |
| TC4: Conditional | 23ms → 2ms | 10.5x | 169ms → 8ms | **21.9x** | *Way* worse |

A few things I didn't expect.

**TC2 blew past 1 second.** 1,271ms for a single data fetch. With 4,001 queries. On localhost. In production with a network hop, you're looking at multiple seconds — from one API call. That's not a performance issue. That's a broken endpoint.

**TC4's speedup doubled.** It went from 10.5x to 21.9x. That surprised me. But the reason makes sense once you look at the numbers: the batch query version barely grew (2ms → 8ms, only 3.6x) while the loop-with-findUnique version grew 7.4x. The batch approach has near-constant overhead regardless of how many IDs you're fetching — PostgreSQL is really good at `WHERE id IN (...)` queries. The loop approach pays full overhead for every single query.

**TC3 got worse too.** 22.2x → 26.5x. Same story — the good version scales better than the bad version because batch fetching is fundamentally more efficient than doing it one at a time.

**The bad code scales roughly linearly.** 10x more data, roughly 8-9x more time across the board. Which makes sense — 10x more users means ~10x more queries in the loop, and per-query overhead is approximately constant.

**The good code sometimes scales *better* than linearly.** TC4's good version grew only 3.6x for 10x more data. The batch query with deduplication is doing less redundant work at scale.

The bottom line: the N+1 penalty doesn't shrink as you scale. It gets worse. Every test case either maintained or increased its speedup factor at 1,000 users compared to 100. If you've got N+1 patterns in your code and you're thinking "I'll fix it when we scale" — the data says you're already paying for it.

---

## How to spot this in your own code

The pattern is always the same: **a database call inside a loop.** If you see `await prisma.something.findMany()` or `findUnique()` inside a `for`, `map`, `forEach`, or any kind of iteration — that's your red flag.

Three ways to catch it:

**Turn on query logging.** Set `log: [{ emit: "stdout", level: "query" }]` in your Prisma client config. If you see the same `SELECT` statement repeated 50 times in a row, differing only in the `WHERE` clause value, you've got an N+1.

**Use static analysis.** Tools like [Code Evolution Lab](https://codeevolutionlab.com) walk your AST (Abstract Syntax Tree) to find database calls nested inside loops. They can catch these before your code even runs — during CI, code review, or in your IDE. They'll also suggest the right fix for your specific ORM.

**Watch your APM dashboards.** If an endpoint's query count scales linearly with the number of records it returns, something is wrong. A healthy endpoint has a roughly constant query count.

---

## Two fixes that cover almost everything

Across all four test cases, two patterns handled every situation:

**Eager loading** for cases where you know you'll need the related data. In Prisma, that's `include`. It works for one-to-many, many-to-one, and nested relationships. You can stack `include` directives as deep as your schema goes, and Prisma always resolves it in a constant number of queries (one per entity level).

**Batch pre-fetching** for cases where you need related data conditionally. Collect the IDs, do one `findMany` with `WHERE IN`, build a Map for O(1) lookup, and do the assignment in memory. It's a few extra lines of code, but it turns 56 queries into 2.

Both approaches do the same fundamental thing: they take the number of database round-trips from "proportional to your data" down to "constant, no matter how much data." That's the whole game.

---

## What I'd push back on

There's a common belief that N+1 queries are a "scaling problem" — something you can ignore early and fix when your dataset gets big enough to matter.

The data doesn't support that.

At 100 users, we're already seeing 9x-22x slowdowns. At 1,000 users, it's 10x-27x. That's not a rounding error. If your API has a 200ms budget per endpoint (pretty standard), the bad TC2 version is already eating 75% of that *with just 100 records and zero network latency*. In production, you're probably blown past it.

The other thing I'd push back on: the idea that `findUnique` is somehow safe because it's a primary key lookup. It's fast per query, sure. But when you call it 200 times in a loop (TC3), the fixed overhead of 200 round-trips completely dominates. A fast query executed 200 times is slower than a slightly heavier query executed once.

---

## What about the honesty section?

A few things that could affect how you read these numbers.

**Localhost flatters the good version.** With no network latency, the per-query overhead is as small as it can be. In production, the penalty for each extra query would be higher, which means the speedup numbers would be *larger* than what I measured. So think of these as conservative estimates.

**I only tested 100 users.** The scaling behaviour at 1K, 10K, and 100K records is something I want to measure next. I expect the gap to widen, not narrow, because connection pool contention and buffer pressure get worse with more queries.

**This is Prisma-specific.** Sequelize, TypeORM, and other ORMs have different internals. The per-query overhead might be higher or lower. The fix patterns are similar though — eager loading and batching work everywhere.

**Warm caches.** I did a warmup run before measuring, which means PostgreSQL's query plan cache and shared buffers are warm. Both versions benefit equally from this, so it shouldn't bias the comparison. But cold-start numbers might look different.

---

## Try it yourself

Everything's open source:

```bash
git clone https://github.com/liangk/empirical-study.git
cd empirical-study
npm install
npx prisma db push
npm run seed -- small
npm run bench:all
```

Swap `small` for `medium` (1,000 users), `large` (10,000), or `xlarge` (100,000) to see how the numbers scale.

---

## What's coming next

This is the first piece in a series I'm working on. The questions I still want to answer:

- **How do the numbers scale beyond 1K?** The 1,000-user results are in (see above) and the penalties got worse, not better. Next up: 10K and 100K, where I expect connection pool contention to make things even uglier.
- **Can automated tools fix this?** I'm going to feed the bad code into [Code Evolution Lab](https://codeevolutionlab.com) and see if the auto-generated solutions perform as well as the hand-written ones.
- **Is Prisma better or worse than other ORMs?** Same benchmarks, Sequelize and TypeORM. The per-query overhead profile might be very different.
- **What about concurrent load?** All my benchmarks are single-threaded. Under real traffic, connection pool contention makes the N+1 penalty even worse.

The bottom line: the N+1 problem isn't a theoretical concern you can defer. It's a measurable, order-of-magnitude performance hit that shows up at 100 records and gets worse at 1,000. The nested pattern crossed 1.2 seconds. The conditional pattern's penalty doubled. And fixing it is rarely more than a one-line change.

---

*The benchmark suite and raw data are on [GitHub](https://github.com/liangk/empirical-study). Built at [Stack Insight](https://stackinsight.dev).*
