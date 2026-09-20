---
title: "N+1 Queries: 34x Slower on Localhost, 98x in Production"
pubDate: "2026-09-20"
heroImage: "../../assets/n-plus-1-query-detection-story.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "I scanned 28 open-source repos for N+1 queries and verified all 213 findings against source. 212 hold up. Then measured one: 5.1 seconds where the batched fix takes 52ms."
excerpt: "Static analysis reports are easy to produce and easy to ignore. So every single finding was checked against its source, then benchmarked to see what one of them actually costs in production."
lastmod: "2026-09-20"
canonical_url: "https://stackinsight.dev/blog/n-plus-1-query-detection-story"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - n+1 query detection
  - find n+1 queries
  - n+1 query static analysis
  - prisma n+1 detection
  - sequelize n+1 query
  - n+1 query typescript
  - detect n+1 queries nodejs
  - orm performance audit
  - n+1 query real world examples
  - database round trip latency
  - batch query optimization
  - ast analysis javascript

# AIEO (AI Engine Optimization)
ai_summary: "This application report documents an AST-based scan for N+1 query patterns across 28 open-source JavaScript and TypeScript repositories covering Prisma, Sequelize, TypeORM, Mongoose and Kysely. The detector reported 213 findings and every one was verified against source in an AI-assisted review loop whose labels are published; 212 were genuine and one was a false positive, a 0.5% rate on this corpus. 19 of 28 repositories reported at least one N+1 pattern and 18 genuinely contain one. Severity distribution across the 213 reported findings was 15 critical, 32 high and 166 medium. By location, 37% sat in request handlers, 21% in background jobs, 20% in scripts and seeds, and 2% in migrations. A companion benchmark using Sequelize against PostgreSQL 16 measured the cost: resolving 1,000 recipients took 5,115ms as an N+1 versus 52ms batched at a 5ms per-query round trip, a 98x difference, while the same code on a local socket showed only 34x. The penalty scales with database round-trip latency, which is why N+1 patterns are rarely caught in local development."
ai_key_facts:
  - "213 N+1 patterns reported across 28 open-source repositories; 212 verified genuine, 1 false positive, a 0.5% rate"
  - "Verification was AI-assisted rather than done unaided by hand; the resulting labels are published so the classification is auditable"
  - "The single false positive was a fallback chain in keystone that returns on the first successful connection, not one query per item"
  - "19 of 28 repositories reported at least one N+1 pattern; 18 genuinely contain one"
  - "Severity split across the 213 reported findings: 15 critical (3+ queries per iteration), 32 high, 166 medium"
  - "37% of findings were in request handlers; 43% were in background jobs, scripts and migrations that rarely get profiled"
  - "Measured cost at 1,000 items: 5,115ms for sequential N+1 vs 52ms batched at 5ms per-query round trip (98x)"
  - "The same code on a local unix socket showed only a 34x penalty, which is why local profiling misses N+1 patterns"
  - "Parallelising an N+1 with Promise.all cut 5,115ms to 553ms but still issued 1,000 queries instead of 1"
  - "25 concurrent notification jobs issued 2,500 queries as an N+1 versus 25 batched"
  - "A method named deleteBulkMetadata in immich runs one DELETE per item inside its own loop"
  - "Five of cal.com's seven findings were write-side N+1s using update or upsert per item"
  - "By data-access layer: Prisma 114, generic db/tx handles 51, Sequelize 25, repository layers 17, raw SQL 5, query builders 1"
  - "The single worst finding, in trigger.dev, runs six queries per item: a lookup, two deletes, an update and two creates"
ai_entities:
  - "N+1 Query Problem"
  - "Prisma ORM"
  - "Sequelize"
  - "TypeORM"
  - "Mongoose"
  - "Kysely"
  - "PostgreSQL"
  - "Code Evolution Lab"
  - "AST Analysis"
  - "Static Analysis"
  - "Outline"
  - "Cal.com"
  - "Immich"

# Structured Data (Article Schema)
schema_type: "TechArticle"
schema_proficiency_level: "Intermediate"
schema_dependencies: "Node.js v18+, TypeScript 5+, PostgreSQL 15+"
schema_time_required: "PT16M"

# Taxonomy
categories:
  - "Database Performance"
  - "Software Engineering Research"
  - "Backend Development"
tags:
  - n-plus-1
  - static-analysis
  - prisma
  - sequelize
  - postgresql
  - performance
  - typescript
  - orm
  - query-optimization
  - ast
  - empirical-study

# Related
related_posts:
  - "n-plus-1-query-empirical-study"
  - "missing-index-empirical-study"
  - "blocking-io-empirical-study"
series: "Detector Application Reports"
series_order: 1
---

# N+1 Queries: 34x Slower on Localhost, 98x in Production

I pointed an N+1 query detector at 28 open-source repositories — roughly 8,700 files of real application code across Prisma, Sequelize, TypeORM, Mongoose and Kysely. It reported 213 N+1 patterns. Every one was then checked against the source that produced it, which took considerably longer than the scan did. 212 of them hold up; the one that doesn't is described near the end, because it's more interesting than a clean sweep would have been. 19 of the 28 repositories reported at least one, and 18 genuinely have one.

Then I did the thing most static analysis reports skip: I measured what one of these actually costs. A loop resolving 1,000 records takes 5,115ms as an N+1 and 52ms batched. That's against a database 5ms away. With the database on the same machine, the identical code showed a 34x gap instead of 98x — which is the most useful thing I learned all month, and the reason nobody catches this locally.

---

## The Pattern

An N+1 query happens when code fetches a list of N items, then loops over that list making one more database call per item — N+1 round trips where one would do. It's one of the oldest performance bugs in web development and one of the easiest to introduce by accident, because the code reads perfectly naturally:

```ts
for (const mention of mentions) {
  const recipient = await User.findByPk(mention.modelId);
  // ...
}
```

Nothing about that looks wrong in review. With five mentions, nobody notices. With five thousand, you've turned one background job into five thousand sequential round trips.

I've already [benchmarked the pattern in isolation](/blog/n-plus-1-query-empirical-study) using synthetic Prisma workloads. This is the other half of the question: how often does it actually appear in code people ship, and where does it hide?

## What I Found

213 findings across 28 repositories, 212 of which hold up. The tables in this section describe all 213 as reported — what the detector said — with the accuracy question handled separately further down. Severity is set by how many queries run per iteration — three or more is critical, two is high, one is medium.

| | Findings |
|---|---:|
| Critical (3+ queries per iteration) | 15 |
| High (2 queries) | 32 |
| Medium (1 query) | 166 |
| **Total** | **213** |

The worst single finding, in trigger.dev's environment-variable repository, runs six queries per item: a lookup, two deletes, an update and two creates, once for every value being saved.

The ORM spread tells you this isn't a Prisma-specific problem. Prisma accounts for 114 findings, but that mostly reflects what the corpus is made of. Sequelize contributed 25, generic database handles (`db.*`, `tx.*`) 51, repository layers 17, raw SQL 5, and query builders 1 — 213 in total. Every data-access layer I scanned had the pattern somewhere.

Where the findings live is the part I didn't expect:

| Location | Findings | Share |
|---|---:|---:|
| Request handlers, routes, services | 79 | 37% |
| Background jobs, queues, workers, cron | 45 | 21% |
| Scripts, seeds, CLI commands | 43 | 20% |
| Other application code | 42 | 20% |
| Migrations | 4 | 2% |

37% sitting in request paths is the number that hurts users directly. But 43% in jobs, scripts and migrations is the more interesting one. That's code nobody profiles, that never shows up in an APM trace attached to a slow endpoint, and that frequently runs against the largest datasets in the system. A migration is the one piece of code you run exactly once, on all of production's data, usually at night, usually with someone watching a progress bar and wondering why it's taking so long.

## 1. Outline: one mistake, twenty-seven times

Outline is an open-source wiki built on Sequelize. It produced 27 findings across 17 files, and 13 of them are the same habit repeated in six different notification tasks.

Outline fires a background job per event — someone mentioned you, a document was published, a comment was posted. Each job answers "who needs to be notified?" by looping over mentions or group members and calling `findByPk` once per entry. The files were written at different times, and going by the structure, by different people. `CommentCreatedNotificationsTask`, `CommentUpdatedNotificationsTask`, `DocumentPublishedNotificationsTask`, `RevisionCreatedNotificationsTask`, `RevokeUserNotificationsTask`, `InviteReminderTask` — same shape in all six.

This is the case that justifies running a tool at all. A reviewer looking at any one of those diffs sees a perfectly ordinary loop. The pattern only becomes visible when something reads all seventeen files at once and notices they rhyme. No amount of care on any individual pull request surfaces it, because on any individual pull request there's nothing to surface.

The worst instance stacks two queries per iteration inside a loop that's itself nested in another loop over groups. That one a reviewer might catch. The other twelve, realistically, nobody catches.

## 2. Immich: a function named `deleteBulkMetadata` that isn't bulk

Immich is a self-hosted photo server. Its data layer is Kysely wrapped in a custom repository pattern — no traditional ORM at all, which is worth noting because it means the pattern isn't an artifact of any particular library's ergonomics.

Eight findings. This is one of them:

```ts
// server/src/repositories/asset.repository.ts
async deleteBulkMetadata(items: Array<{ assetId: string; key: string }>) {
  await this.db.transaction().execute(async (tx) => {
    for (const { assetId, key } of items) {
      await tx.deleteFrom('asset_metadata')
        .where('assetId', '=', assetId)
        .where('key', '=', key)
        .execute();
    }
  });
}
```

The method is called `deleteBulkMetadata`. It deletes one row at a time.

You don't need to know Kysely, or immich, or anything about the surrounding code to see it. The function's own name is the bug report. That one a human would have caught eventually. The next one, most tools structurally cannot.

## 3. Cal.com: the half of N+1 that read-focused tooling misses

Cal.com is a scheduling platform on Prisma. Seven findings in its tRPC package — and five of them are writes.

Almost everything written about N+1 queries is about reads: `findMany` inside a loop, missing eager loading, the classic users-and-their-posts example. A write N+1 costs exactly the same round trips and gets a fraction of the attention. My own detector was blind to it until I fixed that, which is how I learned the lesson.

```ts
// packages/trpc/server/routers/viewer/eventTypes/heavy/update.handler.ts
for (const group of groupsToUpdate) {
  await tx.hostGroup.update({
    where: { id: group.id },
    data: { name: group.name },
  });
}

// ... eleven lines later, in the same function:
await tx.hostGroup.deleteMany({ where: { id: { in: /* ... */ } } });
```

One `UPDATE` per group, awaited sequentially inside a transaction. Eleven lines further down, the same function uses `deleteMany` to do a batched delete. The codebase already knows the batch form and already uses it. The update path just never got it.

That's what these findings mostly look like, once you've read a couple of hundred. Not incompetence. Just the version of the code that got written first, in a file where the batched version also exists.

## 4. AFFiNE: five queries per document row, in a migration

AFFiNE is a knowledge-base workspace. It contributed 11 findings, including a migration that does this for every document row in the table:

`findFirst`, `findFirst`, `deleteMany`, `update`, `update`.

Five queries per row. At a million rows — a plausible size for a document table in a mature installation — that's five million round trips in a migration that was presumably tested against a development database with a few hundred.

This is where severity ranking earns its keep. A single-query N+1 in a rarely-hit admin endpoint and a five-query N+1 in a migration are the same shape and wildly different problems. Migrations are written once, reviewed lightly, and run against the largest dataset the system has ever held.

## 5. Prisma's own examples

`prisma/prisma-examples` produced 29 findings. 28 of them are the same seed script, copied across example apps:

```ts
for (const u of userData) {
  const user = await prisma.user.create({ data: u })
}
```

Small N. Intentional. Nobody's production path. I want to be fair to Prisma here, because the point isn't that they did something wrong — it's a seed script for a demo, and `createMany` would arguably make the example harder to read.

The point is that this shape is so ordinary that it reproduces itself into the canonical examples people learn the ORM from. That's a decent hypothesis for *why* I found it 213 times.

## What an N+1 Actually Costs

Every severity estimate the detector prints is arithmetic: "301 queries for 100 items vs 1 optimal query." True, but a count isn't a cost. So I built a benchmark.

The workload is a faithful reduction of outline's notification pipeline — same ORM (Sequelize), same shape — against a real PostgreSQL 16. Three strategies: the N+1 as found, the same queries fired concurrently with `Promise.all`, and the batched fix. Query counts were captured with a logging hook rather than predicted; the N+1 issues exactly N queries and the fix issues exactly 1, every time.

Here's the result at 1,000 recipients, with nothing changing between rows except how far away the database is:

| Database distance | N+1 sequential | N+1 parallel | Batched | Penalty |
|---|---:|---:|---:|---:|
| Unix socket, same machine (0.23ms/query) | 232.5ms | 150.9ms | 6.8ms | 34x |
| Proxied, 2.75ms per query | 2,920.5ms | 409.6ms | 51.6ms | 57x |
| Proxied, 5.04ms per query | 5,114.7ms | 552.8ms | 52.0ms | 98x |

And at 100 recipients, which is the more realistic scale for a busy document:

| Database distance | N+1 sequential | Batched | Penalty |
|---|---:|---:|---:|
| Unix socket (0.23ms/query) | 35.1ms | 1.1ms | 32x |
| Proxied, 2.75ms per query | 315.8ms | 4.0ms | 79x |
| Proxied, 5.04ms per query | 537.7ms | 6.1ms | 88x |

An N+1 is a latency amplifier. Every millisecond of round trip gets multiplied by N, so the penalty isn't a fixed multiple — it scales with how far away your database is. The same loop that costs 232ms against a local socket costs 5.1 seconds against a database 5ms away, while the batched version barely moves: 6.8ms to 52ms.

That's the part worth internalising. The environment where this pattern is cheapest to observe is the developer's own machine, where Postgres is a unix socket away and 232ms feels like nothing. The environment where it's most expensive is production. A profiler run locally will never make this look urgent.

The distances aren't simulated numbers, by the way. A TCP proxy delays every forwarded chunk and I measured the resulting per-query round trip directly — 0.23ms local, 2.75ms and 5.04ms proxied. Two to five milliseconds is unremarkable for an application talking to a managed database in the same region.

### Parallelising it doesn't fix it

The instinct when a loop of `await`s feels slow is to fire them all at once. It helps: at 1,000 recipients and 5ms round trips, `Promise.all` drops 5,115ms to 553ms.

It's still ten times slower than the single-query version, and it still issues 1,000 queries. The work didn't go away — it moved onto the connection pool, where it now competes with every other request the service is trying to serve. Parallelising an N+1 converts a latency problem into a capacity problem, which is an improvement in the same sense that moving a fire from the kitchen to the garage is an improvement.

### Concurrency is where it actually bites

Outline fires one notification job per comment, so several run at once. At 100 recipients each and 2.75ms per query:

| Concurrent jobs | Strategy | Wall time | Queries issued |
|---:|---|---:|---:|
| 1 | N+1 | 316.4ms | 100 |
| 1 | Batched | 4.0ms | 1 |
| 10 | N+1 | 331.9ms | 1,000 |
| 10 | Batched | 8.8ms | 10 |
| 25 | N+1 | 876.7ms | 2,500 |
| 25 | Batched | 28.8ms | 25 |

Latency degrades gently at first, because these jobs spend most of their time waiting on the network and interleave on the pool reasonably well until it saturates. The number to watch isn't the wall time — it's the last column. Twenty-five comments posted around the same time means 2,500 queries instead of 25. Your database does a hundred times the work to produce the same result, and that capacity isn't available to anything else.

## The Fix

Every confirmed finding came with generated fix code. The shape is always the same three steps: collect the ids, issue one batched query, build a lookup map, then run the original loop against the map instead of the database.

```ts
// Step 1: collect the ids
const allIds = mentions.map((mention) => mention.modelId);

// Step 2: one query
const users = await User.findAll({ where: { id: allIds } });
const byId = new Map(users.map((u) => [u.id, u]));

// Step 3: the original loop, now against memory
for (const mention of mentions) {
  const recipient = byId.get(mention.modelId);
  // ...
}
```

Where eager loading applies, the generated output also offers a Sequelize `include` variant. Being straight about the limits: the generated code is a correct-shaped scaffold with a placeholder where your actual batch query goes, not a patch you can apply blind. The fix was never the hard part. Finding all 213 places that need it is.

## Can You Trust These Numbers?

213 reported, 212 genuine, one false positive. That's 0.5% on this corpus.

The false positive is worth showing, because a clean sweep would have been the less honest result. It's keystone's, in a helper that creates a test database:

```ts
for (const candidate of candidates) {
  const client = new Client(configForDatabase(config, candidate))
  try {
    await client.connect()
    await client.query(`CREATE DATABASE ${escapeIdentifier(database)}`)
    return                                   // first success wins
  } catch (error) {
    if (errorCode(error) === '42P04') return // already exists, also done
    lastError = error
  } finally {
    await client.end().catch(() => {})
  }
}
```

It returns on the first success, so at most one iteration ever does any work. `candidates` is a short fixed list of connection configurations, not a data collection — the detector's "101 queries for 100 items" describes a situation that cannot arise. And `CREATE DATABASE` is DDL, so there is no batched form to rewrite it into. It slipped through because the retry-loop rule keys on counters named `retry` or `attempt`, and this loop is named after the thing it iterates. The detector now also skips a loop whose query result is discarded and which returns in the same block.

I should be explicit about how the checking was done, because this article is otherwise an argument about not trusting raw tool output. The verification was AI-assisted: I ran the findings through a review loop rather than reading 213 snippets by hand, and the labels that loop produced are what the published ground-truth file contains. That's a real limitation on the strongest claim here, because a model classifying a pattern-matching detector's output shares some of that detector's blind spots. It's also why the labels are published rather than summarised: the claim is auditable, not authoritative. If you think a finding is wrong, the file to argue with is in the repository — the keystone one got caught that way.

That's not where it started. The first run of this scan had a **60.3% false-positive rate** on the three repositories I used to develop the fix — and those turned out to be the clean ones. Across the twenty repositories I hadn't touched, the original detector's rate was 88.6%; corpus-wide it was 83.3%. It was reporting `Map.get()` calls, `Array.find()` with a callback, and `Promise.all` as database queries. It took seven rounds of fixes to get from there to here, and it also turned out the detector was missing genuine findings the whole time because its method list contained only read methods. The full account of what broke and how it was measured is published alongside the data — the labelled ground truth, the scan output for every repository, and the scoring script that turns one into the other — so the false-positive rate is something you can recompute rather than something you have to take my word for.

What I have not established is recall. I know what the detector reports is real. I don't know what it stays silent about — measuring that properly means hand-auditing files it reported nothing on, and I haven't done it yet. A detector that found 3 real problems and missed 300 would also show a 0% false-positive rate. Precision and recall are different claims and I'm only making one of them.

## Running This Yourself

The N+1 Query Detector is one of eleven detectors in Code Evolution Lab. It's a standalone offline static analyzer — no database, no API server, and your code never leaves your machine. There's nothing to sign up for.

The quickest way in is npx. Scope it to one service, one router, one worker package — it's built for scans under roughly 500 files, not a whole monorepo — and filter to this detector, because the other ten are a separate conversation:

```bash
npx code-evolution-lab analyze src/server --category n1
```

That writes `.codeevolution/results.json` with every finding's location, severity, query count and source snippet. Read the snippet on each one before you act on it. This article is a long argument for why raw output needs a human pass, and that applies to your codebase too.

If you want the generated batch-query rewrites — the three-step scaffold shown above — or you want to reproduce the exact scans in this report, build the study CLI from source instead. It takes glob patterns and emits a `solutions` block per finding:

```bash
git clone https://github.com/liangk/code-evolution-lab.git
cd code-evolution-lab/backend
npm install
npx tsc                      # emits dist/cli.js

node dist/cli.js "src/server/**/*.{js,ts}" \
  --format json --output findings.json \
  --solutions --min-severity low \
  --ignore "**/*.test.*" --ignore "**/__tests__/**"
```

Either way it exits non-zero when it finds something, which is deliberate — that's the lint-style convention for gating CI — so don't read a non-zero exit as a crash.

The scan itself is cheap: a 400-file scope finishes in a few seconds, and all 28 repositories in this study scan in a couple of minutes. That's the economic argument in one line — this isn't something you budget time for, it's something you run.

If you'd rather not run anything, the pattern is greppable enough to spot-check by hand. Look for `await` inside `for`, `for...of`, or `.map()` where the awaited call is a finder, and check whether the thing being awaited takes a scalar from the loop variable. A query filtered by `item.id` inside a loop is an N+1. A query filtered by `{ in: wholeBatch }` is the fix.

## Caveats

28 repositories is not a random sample of the JavaScript ecosystem. The corpus is weighted toward a Prisma-heavy set assembled for [an earlier study on missing database indexes](/blog/missing-index-empirical-study), plus repositories I added specifically for ORM coverage. The candidate pool was 45 rows covering 42 distinct repositories, of which 28 were scanned at a valid scope. Twelve were never scanned at all: four use Drizzle, which this detector doesn't support; three aren't JavaScript backends (Elixir, Django, Rails); three have no ORM dependency; and two I couldn't clone. Reporting "zero findings" for any of them would have implied the detector looked. The remaining two were scanned early on at a scope that turned out to contain no application code, and are excluded rather than counted as clean.

The benchmark is one process, one machine, one PostgreSQL instance, one indexed table. Real production databases are under other load and real tables are wider. The latency proxy delays every forwarded chunk rather than modelling bandwidth and latency separately, which penalises the batched version more than the N+1 version — a single query returning 1,000 rows spans more chunks than 1,000 queries returning one row each. So the measured advantage of batching is, if anything, understated.

And the workload is a reduction of outline's task, not the task itself. It isolates recipient resolution and leaves out notification creation and email rendering, which are constant across strategies and would only dilute the comparison. The [blocking I/O study](/blog/blocking-io-empirical-study) took the fuller load-testing approach; this one deliberately measures a narrower thing more precisely.

## Frequently Asked Questions

**How do I know if my codebase has N+1 queries without running a tool?**

Search for `await` inside loops where the awaited call is an ORM finder — `findByPk`, `findUnique`, `findOne`, `findMany` — and check what it's filtered by. If the filter takes a scalar off the loop variable (`where: { id: item.id }`), that's an N+1. If it takes the whole collection (`where: { id: { in: batch } }`), that's already the batched form. Write methods count too: one `update` or `upsert` per item is the same cost as one read per item.

**Does an N+1 matter if the list is usually short?**

Usually not, and this is the honest answer most tooling won't give you. Ten items at 2.75ms per query is 31ms — nobody will notice. The risk is that list lengths are rarely bounded by anything except data. A notification job that handles 10 mentions today handles 500 the first time someone @-mentions a large group, and the cost is linear in something you don't control.

**Why didn't our profiler catch this?**

Probably because you profiled locally. At a 0.23ms round trip the penalty in my benchmark was 34x; at 5ms it was 98x, and the absolute numbers went from 232ms to 5.1 seconds. Local databases make N+1 patterns look like minor inefficiencies. The other reason is location: 43% of the findings here were in background jobs, scripts and migrations, which typically aren't attached to a traced request at all.

**Is `Promise.all` a valid fix for N+1 queries?**

No, though it's a real improvement. In the benchmark it took 5,115ms down to 553ms at 1,000 items. But it still issues N queries, and they now hit the connection pool concurrently, competing with everything else the service is doing. It converts a latency problem into a capacity problem. Use it when a batched query genuinely isn't possible, not as the default answer.

**What's the difference between an N+1 and intentional batching?**

The query's filter. `for (const batch of chunks) { findMany({ where: { id: { in: batch } } }) }` issues one query per thousand rows and is the thing you're supposed to do. `for (const item of items) { findUnique({ where: { id: item.id } }) }` issues one query per row. Both are "a query inside a loop", which is why naive detection produces so many false positives — telling them apart is most of the work.
