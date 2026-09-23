---
title: "89% of 2,720 Prisma Schemas Leave a Foreign Key Unindexed"
pubDate: "2026-09-23"
heroImage: "../../assets/prisma-unindexed-foreign-keys-story.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "Prisma doesn't index foreign keys. Across 2,720 public schemas, the typical one leaves 41% of its foreign keys unindexed, and 89% miss at least one."
excerpt: "Rails and Django index your foreign keys for you. Prisma doesn't. I pulled 2,720 real Prisma schemas off GitHub to count how often anyone adds the index themselves."
lastmod: "2026-09-23"
canonical_url: "https://stackinsight.dev/blog/prisma-unindexed-foreign-keys-story"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - prisma foreign key index
  - prisma @@index foreign key
  - does prisma index foreign keys
  - prisma missing index
  - postgresql foreign key index
  - prisma relationMode prisma index
  - mysql innodb foreign key index
  - prisma schema performance
  - unindexed foreign key
  - prisma schema audit

# AIEO (AI Engine Optimization)
ai_summary: "This study measures how often public Prisma schemas leave foreign keys unindexed. Prisma does not create indexes for foreign-key columns, unlike Rails and Django, and PostgreSQL does not create them either. From 5,263 candidate schema.prisma files found through GitHub code search, 3,016 met the inclusion criteria and 2,890 were analysed after removing duplicates, snapshots, a test fixture and schemas Prisma's own validator rejected. MySQL with foreign-key constraints was reported separately because InnoDB creates foreign-key indexes itself, leaving 2,720 schemas and 82,476 foreign keys. The median schema leaves 41% of its foreign keys unindexed, and 89.2% have at least one unindexed foreign key. The share falls with schema size, from a median of 100% for schemas under 2 KB to 28.4% above 32 KB. The detector's schema parser was cross-checked against Prisma's own parser on 2,961 schemas and agreed on all 90,029 foreign keys."
ai_key_facts:
  - "Prisma does not create indexes on foreign-key columns; Rails and Django do, and PostgreSQL does not"
  - "2,720 public Prisma schemas analysed, containing 82,476 foreign keys"
  - "The median schema leaves 41% of its foreign keys unindexed"
  - "89.2% of schemas (2,425 of 2,720) have at least one unindexed foreign key"
  - "Schemas under 2 KB typically index none of their foreign keys; schemas over 32 KB leave a median 28.4% unindexed"
  - "PostgreSQL is 83% of the corpus; its median unindexed share is 38.9%"
  - "MySQL with foreign-key constraints was excluded from the headline because InnoDB creates the index automatically"
  - "Under relationMode = prisma, where Prisma warns about missing foreign-key indexes, the median unindexed share was 0% across 11 schemas"
  - "The detector's parser agreed with Prisma's own parser on all 90,029 foreign keys across 2,961 schemas"
  - "Six parser bugs were found and fixed during the study, three of which silently dropped foreign keys"
ai_entities:
  - "Prisma ORM"
  - "PostgreSQL"
  - "MySQL"
  - "InnoDB"
  - "SQLite"
  - "MongoDB"
  - "PlanetScale"
  - "Foreign Key"
  - "Database Index"
  - "Code Evolution Lab"

# Structured Data (Article Schema)
schema_type: "TechArticle"
schema_proficiency_level: "Intermediate"
schema_dependencies: "Prisma 5+, PostgreSQL 14+"
schema_time_required: "PT12M"

# Taxonomy
categories:
  - "Database Performance"
  - "Software Engineering Research"
  - "Backend Development"
tags:
  - prisma
  - postgresql
  - mysql
  - database-index
  - foreign-key
  - static-analysis
  - performance
  - empirical-study

# Related
related_posts:
  - "missing-index-empirical-study"
  - "n-plus-1-query-detection-story"
  - "n-plus-1-query-empirical-study"
series: "Detector Application Reports"
series_order: 2
---

# 89% of 2,720 Prisma Schemas Leave a Foreign Key Unindexed

Rails indexes your foreign keys for you. So does Django. Prisma doesn't, and neither does PostgreSQL, so unless you write `@@index` yourself, every foreign key in a Prisma-on-Postgres app starts life unindexed. I wanted to know how often anyone fixes that.

I pulled 2,720 real `schema.prisma` files off GitHub, holding 82,476 foreign keys between them. The typical schema leaves 41% of its foreign keys unindexed, and 89% of schemas miss at least one. Small schemas are the worst of it: under 2 KB, the typical schema indexes none of them.

---

## The Pattern

Here's a model from a chat app in the corpus. It's completely ordinary:

```prisma
model Chat {
  id      Int    @id @default(autoincrement())
  message String
  userId  String
  roomId  Int
  room    Room   @relation(fields: [roomId], references: [id])
  user    User   @relation(fields: [userId], references: [id])
}
```

Two foreign keys, no indexes. Loading a room's messages scans every message in the table. So does deleting a user, because Postgres has to check whether any `Chat` row still points at them before it lets the delete through.

Nothing errors and every query returns the right rows, which is why it survives code review. Earlier this year I [benchmarked five missing-index scenarios](/blog/missing-index-empirical-study) against PostgreSQL to put numbers on it: 30 timed trials each at 1K, 10K, 100K and 1 million rows, with the index created and dropped between runs. The short version:

| Query | No index | With index | Slower by |
|---|---:|---:|---:|
| Rows for one foreign key, `WHERE user_id = ?` | ~42 ms | ~0.27 ms | **153×** |
| Latest 20, `ORDER BY created_at DESC LIMIT 20` | ~49 ms | ~0.27 ms | **158–190×** |
| Two-column filter, `WHERE status = ? AND created_at > ?` | ~46 ms | ~0.28 ms | **166×** |
| Point lookup, `WHERE email = ?`, at 1M rows | 6.45 ms | 0.25 ms | **26×** |

In that benchmark the foreign-key and sort cases cost about the same at 1K rows as at 1M, so it isn't only a big-table problem. One thing didn't help at all: a covering index with `INCLUDE`, where PostgreSQL chose a sequential scan regardless. Those were warm-cache numbers on one machine, so read them as orders of magnitude rather than promises.

That study answered "how bad is it". This one answers "how common is it".

---

## The Scan

I searched GitHub for `schema.prisma` files and kept one per repository if it had been pushed to in the last year, had at least three models and one relation, and wasn't a template, starter or tutorial. That's 3,016 schemas out of 5,263 candidates. A year of inactivity was by far the biggest filter: 1,859 candidates hadn't been touched in a year.

Then I removed 126 more: 65 byte-identical copies of another schema, 55 that Prisma's own validator rejects, 5 snapshots of other people's projects, and one test fixture. The most-copied schema was cal.com's, snapshotted five times by different AI code-review tools for the same pull request.

That left 2,890. One more cut follows further down, and it matters.

A **foreign key** here is the column list in a `@relation(fields: [...])`. It counts as **covered** when some index on the model leads with all of its columns. `@id`, `@unique`, `@@unique` and `@@index` all count, since each creates a real index. Order matters: `@@index([projectId, createdAt])` covers `projectId` but does nothing for a lookup on `createdAt` alone.

---

## 1. Small schemas vs. large schemas

| Schema size | Schemas | FKs | FKs per schema | Median unindexed per schema | Pooled unindexed % |
|---|---:|---:|---:|---:|---:|
| under 1 KB | 14 | 23 | 1.6 | 100% | 91.3% |
| 1–2 KB | 245 | 668 | 2.7 | 100% | 71.0% |
| 2–4 KB | 256 | 1,362 | 5.3 | 72.1% | 62.1% |
| 4–8 KB | 484 | 5,178 | 10.7 | 60.0% | 54.1% |
| 8–16 KB | 667 | 12,718 | 19.1 | 38.1% | 44.2% |
| 16–32 KB | 529 | 18,548 | 35.1 | 30.0% | 38.8% |
| over 32 KB | 525 | 43,979 | 83.8 | 28.4% | 33.9% |
| **All** | **2,720** | **82,476** | **30.3** | **41.0%** | **38.7%** |

The line only goes one way. The typical schema under 2 KB indexes none of its foreign keys. Over 32 KB, the typical schema still leaves 28% unindexed, which is better but not good.

I lead with the median rather than the pooled figure because pooling lets the biggest schemas outvote everyone else. The top bucket holds 53% of all foreign keys on its own. The median gives every schema one vote, and "the typical schema" means exactly that.

It's tempting to read this as "schemas grow up and get indexed". The data can't tell you that. These are different schemas at one point in time, not the same schema over its life. Small schemas might simply be a different crowd: people learning, projects that never get big. I'll come back to that in the caveats. What the table does show is that the problem doesn't go away with size. It shrinks.

That covers size. The database turned out to matter in a way I'd missed.

---

## 2. PostgreSQL vs. MySQL

| Provider | Schemas | FKs | Median unindexed | Pooled | ≥1 unindexed | Database creates the index |
|---|---:|---:|---:|---:|---:|---|
| PostgreSQL | 2,411 | 75,787 | 38.9% | 38.0% | 89.4% | no |
| SQLite | 225 | 4,874 | 64.7% | 41.7% | 88.4% | no |
| MySQL, `relationMode = "foreignKeys"` | 170 | 5,805 | 21.6% | 34.4% | 75.9% | **yes** |
| MongoDB | 60 | 1,237 | 65.8% | 69.4% | 90.0% | no |
| MySQL, `relationMode = "prisma"` | 11 | 265 | 0% | 20.8% | 36.4% | no |
| SQL Server | 6 | 169 | 51.7% | 55.6% | 83.3% | no |

I first ran the numbers across every schema, and only caught this while writing them up. MySQL's InnoDB engine requires an index on every foreign-key column, and if there isn't one when the constraint is created, it makes one. So on MySQL, a foreign key with no `@@index` in the schema still has an index in the database. Counting it as unindexed would have been wrong on 170 schemas.

Those 170 are out of the headline. That's the cut I mentioned: 2,890 down to 2,720. The headline barely moved, 40% to 41%, because 83% of the corpus is PostgreSQL anyway. But it was wrong before, and now it isn't.

MySQL under `relationMode = "prisma"` stays in. That mode, common on PlanetScale, emulates relations in Prisma and creates no foreign-key constraint at all, so InnoDB never gets the chance to add an index. It's also the one setup where Prisma actively warns you about unindexed foreign keys. Its median is 0%. Eleven schemas is far too few to lean on, but it's hard to ignore: where Prisma says something, people add the index.

---

## Checking the Checker

The counts come from the same schema parser that ships in [Code Evolution Lab](https://github.com/liangk/code-evolution-lab), not a second one written for the study. That was deliberate. A study that reimplements what it measures can quietly disagree with the tool it's about.

It also meant the parser had to be right. So I ran it against Prisma's own parser on every schema, asking both for the models, the foreign keys, and whether each foreign key is covered. They agree on all 2,961 schemas Prisma accepts, all 90,029 foreign keys, zero disagreements.

They didn't start that way. The cross-check turned up six valid Prisma shapes my parser misread:

| Shape | What went wrong |
|---|---|
| `@@index(field)` without brackets | index ignored |
| fields at column 0, no indentation | no fields read at all |
| `// @@index([field])` commented out | read as a real index |
| a model inside `/* */` | read as live |
| `}model Next {` on one line | second model lost |
| `fields : [x]`, space before the colon | foreign key not recognised |

Three of those dropped foreign keys silently. That's the kind of bug no amount of spot-checking finds, because a foreign key the parser never counts never shows up in the results to be checked.

I also went through fourteen unindexed foreign keys by hand, two from each size bucket. Thirteen were genuinely unindexed. The fourteenth was the bracketless `@@index(field)`, which is how that first bug surfaced. Several of the thirteen came from schemas that use `@@index` elsewhere, just not on that foreign key. Knowing to index and remembering to index everything turn out to be different skills.

One correction belongs here. The [earlier missing-index article](/blog/missing-index-empirical-study) reported 1,209 missing-index patterns across 40 repositories. That count came from the detector before this rewrite, which mishandled `@@unique`, composite indexes and multi-line queries, so I don't trust it and this study replaces it. The benchmark numbers in that article are measurements and still stand.

---

## The Fix

For the chat model above:

```prisma
model Chat {
  id      Int    @id @default(autoincrement())
  message String
  userId  String
  roomId  Int
  room    Room   @relation(fields: [roomId], references: [id])
  user    User   @relation(fields: [userId], references: [id])

  @@index([roomId, id])
  @@index([userId])
}
```

`[roomId, id]` instead of just `[roomId]` because the query a chat app actually runs is "this room's latest 50 messages", ordered by `id`. With the composite index, Postgres walks the index backwards and stops after 50 rows. With `[roomId]` alone, it finds every message in the room and sorts them first. Either one covers the foreign key.

`[userId]` is needed even if you never list a user's messages. Deleting a user makes Postgres check `Chat` for rows pointing at them, and without the index that's a full scan on every delete.

One warning for tables that already have data. The migration Prisma generates runs a plain `CREATE INDEX`, which blocks writes to the table while it builds. On a table with millions of rows, run `prisma migrate dev --create-only`, change the statement to `CREATE INDEX CONCURRENTLY`, and keep it in a migration by itself, because it can't run inside a transaction.

---

## Detection

The rule is small enough to check by eye: for every `@relation(fields: [...])`, find an `@@index`, `@@unique` or `@id` whose **first** columns are those fields. If there isn't one, the foreign key is unindexed.

Or run the detector:

```bash
npx code-evolution-lab analyze . --category index
```

It reads `schema.prisma` alongside your query code and reports unindexed foreign keys, plus filters and sorts on unindexed columns. `results.json` includes `index.foreignKeys` and `index.foreignKeysIndexed`, so you get the denominator too: not just how many are missing, but how many there are.

Everything in this study, including the per-schema results and every unindexed foreign key with its repository and blob SHA, is in the [study repository](https://github.com/liangk/empirical-study/tree/main/stories/02-missing-index).

---

## Caveats

**Unindexed in the schema isn't always unindexed in the database.** The parser is verified against Prisma's, but what a schema means for the database wasn't verified against a database. PostgreSQL, SQLite and SQL Server don't create foreign-key indexes. MySQL with constraints does, which is why it's excluded. MongoDB has no foreign-key constraints and creates nothing. I'm not certain what CockroachDB does across versions; it's one schema.

**This is public GitHub, not production.** Between 79% and 89% of schemas in every size bucket have zero stars, so stars can't separate side projects from real products, and the biggest schemas aren't a proxy for production either. The honest scope is public, recently maintained Prisma schemas.

**Correlation, not change over time.** Bigger schemas index more of their foreign keys. Whether schemas pick up indexes as they grow, whether bigger projects have more experienced authors, or whether the badly indexed ones got abandoned before they got big, this data can't say. That needs the git history of individual schemas.

**Declarations, not cost.** An unindexed foreign key on a 50-row lookup table is technically unindexed and practically irrelevant. This counts how often the index is missing. The benchmark study measures what it costs when the table is large.

**One schema per repository, exact duplicates only.** A monorepo contributes the first `schema.prisma` the search returned. Copies were removed by content hash, so a copy with one changed line survives; spot checks of the largest schemas found only distinct projects.
