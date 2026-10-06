---
title: "I Re-Ran My Own Payload Scan. Fewer Than 1 in 7 of 52,010 Findings Were Queries."
pubDate: "2026-10-02"
heroImage: "../../assets/large-payloads-detection-story.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "In May I published 52,010 large-payload findings from 300 repos. I re-ran the scan at the same commits and checked it: about 12.7% were database calls at all. Here's what the real ones look like, and what one costs: 6.7 seconds and 69 MB at 50,000 rows."
excerpt: "My Study 09 detector reported 52,010 large-payload findings. Most were Array.find and objects that happened to nest three levels deep. I rebuilt the detector, labelled what it found, and measured one real unbounded endpoint on its own stack."
lastmod: "2026-10-02"
canonical_url: "https://stackinsight.dev/blog/large-payloads-detection-story"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - unbounded query detection
  - findMany without take
  - prisma pagination performance
  - api response size nodejs
  - large payload static analysis
  - select star performance
  - deep include prisma
  - knex query without limit
  - trpc superjson performance
  - static analysis false positives
  - unpaginated api endpoint
  - orm performance audit

# AIEO (AI Engine Optimization)
ai_summary: "This report re-runs the large-payload scan from stackinsight.dev's Study 09 (May 2026) on the same corpus at the same commits, and checks it. Study 09 published 52,010 findings from 300 repositories. Re-run at 283 pinned commits, its detector reproduced every per-repository count exactly (51,756 findings after correcting double-counted repositories and repositories dropped on a parse error). A 400-finding stratified sample showed about 12.7% were database calls at all; the rest were Array.prototype.find, lodash, jQuery, test helpers, route definitions and minified bundles. The detector was rebuilt in Code Evolution Lab's core engine and calibrated against hand-reviewed labels: two row-limit rules went from an estimated 9.2% precision to 52.8%, and four new rules were added (API responses traced across files, query builders, relation depth counted per ORM, SELECT * reaching a database), each with its own labelled precision between 52% and 98%. The final scan reports 1,320 findings in 38 repositories. A benchmark of one true positive, cal.com's admin user list (prisma.user.findMany() returned through tRPC), measured on cal.com's own stack (Prisma 6.16.1 with the pg adapter, PostgreSQL 16, superjson 1.9.1): at 50,000 users the endpoint took 6.7 seconds on the server, sent 68.8 MB and grew the heap by about 790 MB; the generated fix (take: 100) took 15.8ms and sent 139 KB."
ai_key_facts:
  - "Study 09 published 52,010 large-payload findings from 300 repositories; re-run at the same commits, every one of the 272 repositories it scanned successfully reproduced its count exactly"
  - "About 12.7% of Study 09's findings were database calls at all (51 of a 400-finding stratified sample; ceiling 14.2%)"
  - "The old unbounded_find_all rule matched any method named find, so Array.prototype.find always matched; 10 of 256 sampled were database calls"
  - "The old deep_nested_include rule fired on any call whose first argument nested three objects deep, including where filters and route options"
  - "Recalibrated, the two row-limit rules went from an estimated 9.2% to 52.8% precision among decided findings"
  - "Four new rules: api-response (76.0% precision), deep-include (97.7%), select-star (66.7%), and query-builder support (51.7%)"
  - "Final scan: 1,320 findings in 38 of 283 repositories; a GraphQL resolver rule found nothing in this corpus"
  - "cal.com's admin user list calls prisma.user.findMany() beside a comment reading 'TODO: Add search, pagination, etc.'"
  - "At 50,000 users that endpoint took 6.7 seconds on the server, sent 68.8 MB and grew the heap by about 790 MB; take: 100 took 15.8ms and sent 139 KB"
  - "PostgreSQL returned the 50,000 rows in 675ms; Prisma's row mapping took the query to 2.5 seconds and superjson serialisation added 4.2 seconds"
  - "Database distance made no difference to the unbounded query, unlike an N+1: the cost is CPU and memory, and it grows with the table"
ai_entities:
  - "Unbounded Query"
  - "Pagination"
  - "Prisma ORM"
  - "tRPC"
  - "superjson"
  - "knex"
  - "TypeORM"
  - "Mongoose"
  - "PostgreSQL"
  - "Code Evolution Lab"
  - "Static Analysis"
  - "Cal.com"
  - "Lightdash"
  - "n8n"
  - "GrowthBook"
  - "Documenso"

# Structured Data (Article Schema)
schema_type: "TechArticle"
schema_proficiency_level: "Intermediate"
schema_dependencies: "Node.js v18+, TypeScript 5+, PostgreSQL 15+"
schema_time_required: "PT17M"

# Taxonomy
categories:
  - "Database Performance"
  - "Software Engineering Research"
  - "Backend Development"
tags:
  - large-payloads
  - pagination
  - static-analysis
  - prisma
  - postgresql
  - performance
  - typescript
  - orm
  - empirical-study

# Related
related_posts:
  - "large-payloads-empirical-study"
  - "n-plus-1-query-detection-story"
  - "prisma-unindexed-foreign-keys-story"
series: "Detector Application Reports"
series_order: 3
---

# I Re-Ran My Own Payload Scan. Fewer Than 1 in 7 of 52,010 Findings Were Queries.

In May I published a study of large API payloads that scanned 300 open-source repositories and reported 52,010 findings. I went back and re-ran that exact scan, at the exact commits, and then checked what it had found. About 12.7% of the findings were database calls at all. The rest were `Array.prototype.find`, lodash, Cypress selectors, and objects that happened to nest three levels deep.

So I rebuilt the detector and labelled what the new one reports. It reports 1,320 findings in 38 of the 283 repositories, with measured precision between 52% and 98% depending on the rule. Then I measured one of them on its own stack: cal.com's admin user list, a `findMany()` with a `TODO: Add search, pagination` comment beside it. At 50,000 users it takes 6.7 seconds and sends 68.8 MB. The one-line fix takes 16ms.

---

## The Pattern

An unbounded query returns every row that matches. Nothing caps it: no `take`, no `limit`, no page. It's fine on the day it ships, because the table is small. It gets slower every day after that, because the table isn't.

```ts
// Every user, every column, every time.
const users = await prisma.user.findMany();
return users;
```

The cost lands in three places. The database reads every row. The server turns every row into an object and then into JSON. The client parses all of it back. A row count doesn't show up in a code review, and on a development database with forty rows it doesn't show up in a profiler either.

Two related shapes multiply the same problem. A query that loads relations three levels deep, with a to-many relation in the chain, returns rows per parent per child. And `SELECT *` sends every column, including the wide ones nobody asked for. Study 09 tried to detect all three. This is the story of how well it did.

## Re-running Study 09

Study 09 cloned 300 repositories with `--depth 1` in May, and the checkouts were still on disk. 283 of them had a recorded commit; the other twelve had failed to clone in May and have no snapshot. Every scan in this report runs at those 283 commits.

The first job was to reproduce the published numbers exactly, with Study 09's own detector, compiled unchanged. It did. All 272 repositories that Study 09 scanned successfully gave the same per-repository count. The total needed reconciling, because the published 52,010 had three problems I hadn't noticed in May:

| | Findings |
|---|---|
| Study 09, published | 52,010 |
| Four repositories listed twice in the corpus were scanned and counted twice | −2,988 → 49,022 |
| `mikeal/request` and `request/request` are the same repository | −1 → 49,021 |
| Repositories Study 09 dropped whole after one file failed to parse (10 with findings) | +2,735 → **51,756** |

Close enough to the published figure that nobody would have caught it from the outside. That's the uncomfortable part.

Then the real question: are these findings database calls? I drew a 400-finding sample, stratified by pattern, and labelled each one with that single question. Counted generously, any read or write against any database.

| Pattern | Findings | Sampled | Database calls | Estimated |
|---|---|---|---|---|
| `unbounded_find_all` | 33,127 | 256 | 10 | 1,294 |
| `deep_nested_include` | 16,428 | 127 | 35 | 4,527 |
| `select_star` | 2,201 | 17 | 6 | 777 |
| **Total** | **51,756** | **400** | **51** | **6,598 (12.7%)** |

Ten database calls out of 256 `unbounded_find_all` findings. The cause is right there in the detector's source. It fired on any method named `find`, `findFirst`, `findMany` or `findAll` whose first argument wasn't an object with a `take`, `limit` or `where` key. So `array.find(x => x.id === id)` always matched, because a callback isn't an object. `findFirst`, which returns one row, matched too. And `deep_nested_include` fired on any call at all whose first argument nested three objects deep, which describes most route definitions and every `where` filter on a JSON column.

Even if I count every finding I couldn't decide as a real database call, the ceiling is 14.2%. Study 09's benchmarks still stand: a 10 MB response really does take 66ms to parse. Its scan didn't measure what it said it measured. The study's article now carries a correction pointing here.

## Rebuilding the Detector

The rebuild lives in Code Evolution Lab's core engine, and it went the way the N+1 and Missing Index rebuilds went. Criteria written before reading a single finding. A seeded sample, labelled. Fixes in rounds, each one scored against the labels, and every true positive a fix nearly lost turned into a regression test.

The engine already had two payload rules, `unbounded-query` and `large-return`. As shipped in 1.3.0 they reported 3,584 findings on this corpus, with an estimated 9.2% precision. They shared Study 09's disease in milder form: a method name was treated as evidence. Two rounds of fixes later they report 923 findings at an estimated 52.8% precision. The fixes were unglamorous. Skip test directories, migrations, seeds and minified bundles. Treat `where: { id }` and `{ in: ids }` as bounded. See a `.limit()` that comes later in the chain. Report a returned query once, not twice.

One fix I tried and reverted is worth showing, because it's where static analysis runs out:

```ts
// Lightdash: ProjectService
const allowedSpaceUuids = await this.spacePermissionService.getAccessibleSpaceUuids(...);
return this.savedChartModel.find({ projectUuid, spaceUuids: allowedSpaceUuids });
```

`spaceUuids` is a list of ids, so the obvious rule says the result is bounded by the list. Treating plural id keys as bounded removed six false positives and one true positive, and this was the true positive. A list of the rows' own ids bounds the result. A list of parent ids doesn't: this loads every chart in every space the user can see. The key name can't tell you which, so the rule doesn't pretend to.

Then four additions, because Study 09 had claimed patterns the engine didn't cover:

- **API responses, traced across files.** `res.json(rows)`, `reply.send`, a Nest controller's return value, a tRPC procedure. Most applications query in a repository and respond in a route, in another file, so the rule links them by function name after the whole project is scanned.
- **Query builders.** knex, TypeORM's `createQueryBuilder`, Kysely. Directus and nocodb build every query with knex and had reported nothing at all under either detector.
- **Relation depth, counted in relations.** `include` for Prisma, `with` for Drizzle, `relations` for TypeORM, nested `populate` for Mongoose, and so on. When the project's `schema.prisma` is scanned, a tree whose relations are all to-one isn't reported.
- **`SELECT *` that reaches a database.** The string has to be passed to `query`, `raw`, `execute`, a `sql` tagged template, or a `const` that is. `EXISTS (SELECT *)` and `INSERT ... SELECT *` don't count, because no rows come back.

## What I Found

| Rule | Findings | Repositories | Precision among decided labels |
|---|---:|---:|---|
| `unbounded-query` | 894 | 29 | 52.8% (estimated, stratified sample) |
| `large-return` | 196 | 21 | (same sample) |
| `api-response` | 108 | 12 | 76.0% (19 of 25; 49 undecidable) |
| `deep-include` | 72 | 6 | 97.7% (43 of 44; 28 undecidable) |
| `select-star` | 50 | 16 | 66.7% (32 of 48; 2 undecidable) |
| `unbounded-graphql` | 0 | 0 | — |
| **Total** | **1,320** | **38** | |

Each precision figure was measured when that rule was calibrated, on the findings it reported then; query builders were measured separately at 51.7%. Study 09's detector reported something in 184 of these repositories. This one reports something in 38.

The undecidable column matters, and I'll come back to it. First, what the real ones look like.

## 1. Cal.com: the TODO that says it all

```ts
list: authedAdminProcedure.query(async ({ ctx }) => {
  const { prisma } = ctx;
  // TODO: Add search, pagination, etc.
  const users = await prisma.user.findMany();
  return users;
}),
```

This is the admin user list in cal.com's tRPC router. The developer knew. The comment is right there. It's an admin page on a self-hosted scheduling app, so it ships, and it works, and it keeps working until an instance has enough users that it doesn't. This is the one I benchmarked, and the numbers are further down.

It's the cleanest example in the set because nothing about it is subtle. Most of them are a little more interesting than that.

## 2. GrowthBook: load everything, then filter

```ts
const features = (await FeatureModel.find(q)).map((m) => toInterface(m, context));

return features.filter((feature) =>
  context.permissions.canReadSingleProjectResource(feature.project),
);
```

Every feature flag in the organisation comes back from MongoDB, gets mapped, and then the ones the user can't read are thrown away in memory. That's not a mistake anyone makes on purpose. Permissions were bolted on after the query existed, and the cheapest place to bolt them on was after it. The query's cost is set by the organisation's size, not by what the user is allowed to see.

GrowthBook accounts for ten of the 19 `api-response` true positives: features, reports, ideas, presentations, fact tables. Each one is a list that grows every time somebody uses the product for its intended purpose.

## 3. n8n: every test case of a run

```ts
@Get('/:workflowId/test-runs/:id/test-cases')
async getTestCases(req: TestRunsRequest.GetCases) {
  await this.getTestRun(req.params.id, req.params.workflowId, req.user);

  return await this.testCaseExecutionRepository.find({
    where: { testRun: { id: req.params.id } },
  });
}
```

Scoped to one test run, so it looks bounded. It isn't. The `where` is on the parent, and a test run has as many test cases as the dataset someone fed it. An evaluation over a few thousand examples returns a few thousand rows, each carrying its own inputs and outputs.

This file also taught the detector a lesson. It sits in a directory called `evaluation.ee/` and the file is named `test-runs.controller.ee.ts`. A path rule that skips anything with "test" in the name dropped it. The rule now only matches directories, and only names that start or end with a test word, so `test-runs.controller` and novu's `build-test-data/` are both read.

## 4. Documenso: three relations deep on a public link

```ts
const envelope = await prisma.envelope.findFirst({
  where: { type: EnvelopeType.TEMPLATE, status: DocumentStatus.DRAFT, directLink: { enabled: true, token } },
  include: {
    recipients: {
      include: { fields: { include: { signature: true } } },
      orderBy: { signingOrder: 'asc' },
    },
    envelopeItems: { include: { documentData: true } },
    // ...
  },
});
```

`findFirst`, one envelope. But recipients is a list, fields is a list per recipient, and each field brings its signature. The rows multiply per level. On a document with a handful of signers and a few dozen fields each, that's fine. On a template with a hundred fields per recipient, it isn't, and this path is reachable from a public signing link.

This is what `deep-include` is for, and why Study 09's version of it couldn't work. Counting nested objects can't tell `include: { recipients: { include: { fields } } }` from `where: { meta: { path: { equals } } }`. Counting relations, and checking the schema for which ones are lists, can. 43 of the 44 decided findings held up.

## 5. Lightdash: the queries nobody's ORM can see

```ts
const tableValidationErrorsRows = await this.database(ValidationTableName)
  .select(`${ValidationTableName}.*`)
  .where('project_uuid', projectUuid)
  .andWhere(/* job filter */)
  .andWhere(`${ValidationTableName}.source`, ValidationSourceType.Table)
  .distinctOn(`${ValidationTableName}.error`);
```

Every validation error in a project, via knex. No finder method, no ORM call, so the old rules never saw it and neither did Study 09. Lightdash's backend is built almost entirely this way, and so are Directus and nocodb.

Query builders were the hardest rule to get right. The first round reported 589 builder findings at 15.7% precision. The false positives came in classes. There were single-row lookups through table-name constants like `this.database(ProjectTableName).where('project_uuid', uuid)`. There were builder factories that return a query for the caller to finish. And there were MongoDB's `client.db()` and Spanner's `instance.database()`, which only look like knex handles. Three rounds got it to 51.7%, with the one true positive I couldn't keep explained in the study notes.

## What an Unbounded List Actually Costs

The detector says a query has no row limit and its rows reach a response. That's a shape, not a cost. So I took the cal.com admin list and measured it on cal.com's own stack. That means Prisma 6.16.1 generated from cal.com's own `schema.prisma`, with `engineType = "client"` and the pg adapter as cal.com runs it, plus PostgreSQL 16 and superjson 1.9.1, the transformer cal.com's tRPC puts on the wire. The `users` table has all 45 columns of cal.com's `User` model. The rows look like ordinary accounts and come to about 1.4 KB each in the response. Nothing is padded.

Two strategies: the query as found, and the query the payload generator suggests, `findMany({ take: 100 })`.

| Users in the table | Strategy | Rows sent | Response | Server total | Client parse |
|---:|---|---:|---:|---:|---:|
| 1,000 | as found | 1,000 | 1.4 MB | 126.3ms | 27.9ms |
| 1,000 | `take: 100` | 100 | 139 KB | 15.1ms | 2.5ms |
| 10,000 | as found | 10,000 | 13.7 MB | 1,155.1ms | 284.2ms |
| 10,000 | `take: 100` | 100 | 139 KB | 15.7ms | 2.4ms |
| 50,000 | as found | 50,000 | 68.8 MB | 6,724.5ms | 1,654.7ms |
| 50,000 | `take: 100` | 100 | 139 KB | 15.8ms | 2.6ms |

At 50,000 users one request takes 6.7 seconds of server time and sends 68.8 MB, and the client then spends another 1.7 seconds parsing it. The server's heap grew by about 790 MB to answer it. The capped version costs the same 16ms at every size, because it does the same work at every size. That's the whole argument for a row limit in one table: one line's cost is flat, the other's is a straight line up and to the right.

### It isn't the database

| Users | PostgreSQL + driver | Prisma query, incl. row mapping | superjson serialise | Server total |
|---:|---:|---:|---:|---:|
| 1,000 | 16.5ms | 50.5ms | 75.5ms | 126.3ms |
| 10,000 | 134.9ms | 437.1ms | 743.9ms | 1,155.1ms |
| 50,000 | 675.3ms | 2,544.0ms | 4,217.1ms | 6,724.5ms |

PostgreSQL hands back all 50,000 rows in 675ms. Everything after that is JavaScript. Prisma turning rows into objects takes the query to 2.5 seconds, and superjson walking the result to preserve its `Date`s takes 4.2 more. A database dashboard would show this endpoint as a moderately slow query. The other six seconds would show up as a Node process with a pegged CPU and a heap that just grew by most of a gigabyte.

### Distance doesn't matter here

The N+1 benchmark's big finding was that latency multiplies: the same loop cost 34x more than the fix on a local socket and 98x at 5ms. So I ran this one at the same three distances, measured the same way.

| Users | Strategy | Local socket (0.12ms) | Proxied (2.80ms) | Proxied (4.86ms) |
|---:|---|---:|---:|---:|
| 10,000 | as found | 1,155.1ms | 1,103.4ms | 1,169.9ms |
| 10,000 | `take: 100` | 15.7ms | 20.1ms | 21.3ms |
| 50,000 | as found | 6,724.5ms | 6,748.2ms | 6,698.0ms |
| 50,000 | `take: 100` | 15.8ms | 16.0ms | 21.8ms |

Flat. One query is one round trip, however many rows it returns. An unbounded list is the opposite failure to an N+1. It's cheap to observe locally, and it'd be just as visible locally, if the development database had production's row count. It almost never does. The developer who wrote that TODO was looking at a table with a few dozen users in it.

## The Fix

Paginate the endpoint. Accept a page size with a maximum, accept a cursor or an offset, pass them to the query, and return the cursor for the next page:

```ts
list: authedAdminProcedure
  .input(z.object({ cursor: z.number().optional(), limit: z.number().max(100).default(50) }))
  .query(async ({ ctx, input }) => {
    const users = await ctx.prisma.user.findMany({
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
    });
    const hasMore = users.length > input.limit;
    if (hasMore) users.pop();
    return { users, next: hasMore ? users[users.length - 1].id : undefined };
  }),
```

That changes the endpoint's contract, so the client has to change with it. What the detector can do on its own is smaller. For each row-limit finding, the solution generator rewrites the query with a cap in the form its library takes: `take` for Prisma and TypeORM, `limit` for Sequelize, Drizzle and MikroORM, `.limit()` for knex, Kysely and MongoDB, `.take()` on a TypeORM query builder. The standard it's held to is the one the Missing Index generator set: paste the suggestion over the query, scan again, and the finding has to be gone. Applied to all 1,198 row-limit findings in this corpus, it produced a suggestion for 1,092, and all 1,092 cleared on a rescan without breaking the file's syntax.

It refuses the other 106. Most are `find()` calls on an application's own wrapper, novu's `BaseRepository` or Kibana's saved-objects client, where the option name is whatever that wrapper decided. A guessed `take` that the wrapper silently ignores would look exactly like a fix and change nothing, which is worse than no suggestion.

A cap is not pagination, and the suggestion says so. Rows past the hundredth stop coming back. For an admin list that's the right first step. For an export, it's a bug.

## Can You Trust These Numbers?

Every precision figure above comes from labels, and the labels are published with the rest of the study: criteria written before any finding was read, the sample, every label with a one-line reason, and the script that scores a rescan against them. I should be as clear here as I was in the N+1 report about how the labelling was done. It was AI-assisted, a review loop over each finding's source rather than me reading some 1,500 snippets unaided. That's a real limit on the strongest claims. It's also why the labels are a file you can argue with, not a summary you have to trust.

The bigger limit is the undecidable pile. Across the rules, a large share of findings can't be settled from the repository: 49 of 74 `api-response` findings, 28 of 72 `deep-include`. Almost all are the same shape: a list of things a user or a team configures. Credentials, webhooks, API tokens, environments, event types. Nothing in the code caps them. Nothing in normal use makes them grow either. Whether an organisation can have 10,000 webhooks is a product question, and the code doesn't answer it. I didn't count those as true positives, and I didn't count them as false ones. Precision among decided labels is the honest number, and the undecidable count goes beside it.

Two more things I haven't established. Recall: I know what the rules report is mostly real, and I don't know what they stay silent about. Reaction Commerce, for one, reads MongoDB through `context.collections.Shops.find(...)`, which the finder rules don't recognise as a query. And GraphQL: the rule for unbounded resolvers is built and tested, and it found nothing here, because most GraphQL code in this corpus is GraphQL libraries rather than applications that use them. Zero findings isn't a precision number.

## Running This Yourself

The payload rules ship in Code Evolution Lab 1.4.0. It's an offline static analyser: no account, no API, your code doesn't leave your machine.

```bash
npx code-evolution-lab@1.4.0 analyze src/server --category payload --solutions
```

That writes `.codeevolution/results.json` with every finding, the query as written, and a suggested row limit where the library can be told. Scope it to a service or a package rather than a whole monorepo. And read each finding before acting on it, because the undecidable pile above will be in your results too: a list of a user's API keys is technically unbounded and almost certainly fine.

The study itself is reproducible from the repository: the pinned corpus, both detectors' output for every repository, the labels, and the benchmark harness with cal.com's schema.

## Caveats

The corpus is Study 09's, by design, so the comparison is like for like. It's 283 repositories chosen in May for having an API, which leans towards large, well-known projects, and the findings concentrate in a few of them. GrowthBook, Lightdash, cal.com and n8n account for most of the true positives.

The benchmark is one endpoint on one machine. The rows are synthetic, ordinary accounts with nothing padded, but synthetic. They repeat more than real data does, which makes the gzipped sizes (127 KB at 1,000 users, 6.1 MB at 50,000) a lower bound. Transfer time to the browser isn't measured; the response sizes are, and you can divide them by your own bandwidth. And it's an admin page. Only an instance's administrators can open it, and it runs rarely. The point isn't that cal.com is slow today. It's what one line costs as a table grows, on a real application's own stack.

Finally, Study 09. Its benchmark results stand. Its scan numbers don't, and the article now says so at the top. If you cited its 52,010 findings or its 64.6% prevalence figure, the defensible statement is roughly 6,600 database calls, of which the share that are genuinely unbounded is what this report measures.
