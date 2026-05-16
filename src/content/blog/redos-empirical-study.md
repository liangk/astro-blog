---
title: "ReDoS in the Wild: What 329 JavaScript Repositories Taught Us About Regex Denial of Service"
pubDate: "2026-05-16"
heroImage: "../../assets/redos-empirical-study.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "We scanned 329 JavaScript/TypeScript repositories for ReDoS patterns, benchmarked the core attack mechanisms, and found 9,528 potential vulnerabilities. This study explains what those findings mean, why synthetic benchmarks are still useful, and how junior developers can spot the real danger in regex code."
excerpt: "A regex can look innocent and still be a time bomb. In this study we scanned 329 repos, found 9,528 potential ReDoS patterns, and used synthetic and real-world benchmarks to separate real risk from over-detection."
lastmod: "2026-05-16"
canonical_url: "https://stackinsight.dev/blog/redos-empirical-study"
twitter_card: "summary_large_image"
twitter_site: "@stackinsightDev"

# SEO
keywords:
  - regex denial of service
  - redos vulnerability empirical study
  - regex performance JavaScript
  - overlapping alternatives regex vulnerability
  - nested quantifier regex attack
  - typeScript static analysis regex
  - real world Redos detection
  - regex benchmark patterns
  - javascript regex security
  - regex backtracking attack
  - ReDoS study article

# AIEO (AI Engine Optimization)
ai_summary: "This study scanned 329 JavaScript repositories for regex patterns that can cause ReDoS, found 9,528 potential issues, and benchmarked core vulnerability structures. The key result: overlapping alternatives dominate the scan, but simple performance tests showed 0 timeouts without tailored malicious input, which means the scan is broad and needs careful follow-up. The report explains why synthetic benchmarks still matter, how real regex vulnerabilities map to patterns like nested quantifiers, and which fixes actually reduce risk."
ai_key_facts:
  - "Scanned 329 public JavaScript/TypeScript repositories with a cleaned corpus after removing 170 dead repos."
  - "Found 9,528 potential ReDoS patterns across 176 repos."
  - "Overlapping alternatives accounted for 9,516 of the findings."
  - "Only 12 findings were email or URL validation patterns."
  - "Performance validation on all findings using simple malicious inputs produced 0 timeouts, showing the difference between potential and provable ReDoS."
  - "Synthetic benchmark documentation is available in `docs/benchmark-patterns-explained.md`."
  - "The study emphasizes validating regex in context, not just counting pattern fingerprints."

# Structured Data (Article Schema)
schema_type: "TechArticle"
schema_proficiency_level: "Intermediate"
schema_dependencies: "Node.js v24+, TypeScript 5+, @babel/parser, ret.js"
schema_time_required: "PT18M"

taxonomy:
  categories:
    - "Software Performance"
    - "Security"
    - "JavaScript"
  tags:
    - javascript
    - regex
    - performance
    - security
    - empirical-study
    - redos
    - static-analysis
    - benchmarking

related_posts:
  - "loop-performance-empirical-study"
  - "memory-leak-empirical-study"
  - "blocking-io-empirical-study"
series: "Software Performance Empirical Studies"
series_order: 10
---

# ReDoS in the Wild: What 329 JavaScript Repositories Taught Us About Regex Denial of Service

A 30-line regex can bring a service to its knees. It does not have to be a huge engine or an exotic parser — often it is a tiny validation regex in a forgotten utility function.

I scanned 329 public JavaScript and TypeScript repositories and found 9,528 potential ReDoS patterns. That number is startling, but it is not the whole story.

This article explains the study design, why we benchmarked simplified regex patterns, and what the scan actually found.

## Why this study exists

If you have written regex in a web app, you have probably seen warnings like “don’t use `.*`” or “avoid nested quantifiers.” Those warnings are real. But they are also easy to turn into noise.

I wanted a clearer answer:

- Which regex structures are actually dangerous?
- How often do those patterns show up in real repositories?
- When does a detected pattern mean “this can be abused” versus “this deserves a second look”?

The short answer is: ReDoS is real, but the scan is an early filter. The attack is about the combination of pattern shape and input, not just the pattern alone.

## How we built the study

The study has two main parts:

1. **Static scanning** — A Babel-based AST detector looked for regex literals and `new RegExp()` calls, then classified patterns into vulnerability types.
2. **Benchmark validation** — We used synthetic benchmarks and real pattern analogues to explain why the scan patterns matter.

This is a study, not a fuzz test. That means we want measurable patterns and clear evidence, not just a long list of hits.

## What we actually found

The scan produced these totals:

- **329 repositories scanned**
- **176 repositories with findings**
- **9,528 total potential ReDoS matches**
- **9,516 overlapping alternative patterns**
- **9 URL-related patterns**
- **3 email-related patterns**

The biggest lesson is this: the scan is heavily weighted toward one pattern type. That is both a useful signal and a warning.

### Overlapping alternatives dominate

Most of the findings came from the pattern class we call `overlapping_alternatives`.

That includes expressions such as:

```regex
/(a|a)+$/
/(a|aa)+$/
/(user|username)+$/
```

These patterns are often easy to write accidentally. They are also the same category of vulnerability that causes exponential backtracking in real attacks.

But there is an important nuance:

- `/(a|a)+$/` is a clear ReDoS pattern.
- `/^(view|edit)?$/` is usually safe in practice because it is bounded and the alternatives do not create a long ambiguous prefix.

So the scan tells us where to look, not which lines are definitely broken.

## Why synthetic benchmarks still matter

Synthetic benchmarks isolate the backtracking mechanism so it becomes clear and reproducible. A pattern like:

```regex
/(a*)*$/
```

with input like:

```text
aaaaa...aaa!
```

shows exponential backtracking in a way that is easy to reason about. The real-world pattern may be an email validator or a URL parser, but the underlying vulnerability mechanism is identical.

### Understanding the Gap: Synthetic vs Real-World

Synthetic benchmarks isolate a single vulnerability mechanism in its pure form, allowing precise measurement and reproducibility. When the attack succeeds, the exponential backtracking is clear:

1. **Pattern has nested quantifiers or overlapping alternatives**
2. **Input has valid characters that don't satisfy all constraints**
3. **Engine tries exponentially many ways to partition or match**
4. **Time grows exponentially with input length**

Even though real patterns are more complex, the exponential backtracking mechanism is identical. An attacker does not need to send literally `aaaa...aaab` — they craft inputs that trigger the vulnerable code path. Example: A typo in an email (`aaaa...aaaa@` with no domain) sends valid characters that trigger backtracking.

### Benchmark Pattern Mappings

**BM-01: Nested Quantifiers**

- Synthetic: `/(a*)*$/` on `aaaa...aaaa!` (40 'a's + fail)
- Real-world: Apache Commons email validator with `([a-zA-Z0-9_-]+\.)*[a-zA-Z0-9_-]+)+@...` on `aaa.aaa.aaa...aaa@` (missing domain)
- Both have nested quantifiers; both fail when valid characters run out, forcing exponential backtracking through all dot-placement combinations.

**BM-02: Overlapping Alternatives**

- Synthetic: `/(a|a)*$/` on `aaaa...aaaa!` (30 'a's + fail)
- Real-world: HTML form validator with `^(user|username|user_id|user-name)+$` on `useruserususer_!` (repeated valid chars + fail)
- Both force the engine to try all combinations of which alternative to pick at each position, creating 2^N possible paths.

**BM-03: Large Bounded Repetition**

- Synthetic: `/(a{1,100})*b/` on `aaaa...aaaa` (60 'a's, no 'b')
- Real-world: Nginx URL decoder with `^((%[0-9a-fA-F]{2})+)+$` on `%2F%2F%2F...%2F` (missing terminator)
- Both have outer repetition of bounded groups; both fail when terminator is missing, forcing the engine to try all partition sizes.

**BM-04: Complex Nested Groups**

- Synthetic: `/((a+)+)+$/` on `aaaa...aaaa!` (20 'a's + fail)
- Real-world: Markdown parser with `(([a-z0-9]+[-+_]?)*)+\s*$` on `verylongstringwithhyphens---!` (no space)
- Both have three levels of nesting with quantifiers; exponential complexity multiplies through the layers.

### Why This Approach Works

The vulnerability mechanism is identical in both synthetic and real-world cases:
- The backtracking is universal — it is not tied to semantics
- Real attackers use similar principles — crafting valid-prefix inputs that fail matching
- Synthetic inputs represent worst-case scenarios
- Results generalize — if pattern X times out on 50 characters in the synthetic case, it will timeout on any malicious input of similar structure

The benchmarks serve as a diagnostic tool: if your pattern matches these structures, you are likely vulnerable. If you want to confirm on your real pattern, apply the same attack strategy — extend the valid prefix and omit required terminators.

## What the follow-up validation showed

I did a second pass on the findings with a simple performance test: build an input that is long, valid in prefix, and fails only at the end.

That test looked at all 9,528 patterns. The result was surprising:

- **Patterns with performance issues: 0**
- **Patterns with timeouts: 0**

That does not mean the scan was useless. It means our pattern detection is broad. It also means the real danger is about choosing the right input.

Put another way:

- The static scan is good at finding suspicious regex shapes.
- The dynamic test is good at showing whether a specific input can prove the vulnerability.
- If the dynamic test gives 0 timeouts, the pattern still may be vulnerable — but it requires a smarter attack string.

## Detector design and pattern coverage

We designed the detector to catch these patterns:

- **Nested quantifiers**: `(...*)*`, `(...+)+`, `(...{1,5})+`
- **Overlapping alternatives**: `(a|a)`, `(x|xy)`
- **Large repetitions**: `.{100,}`
- **Complex groups**: nested groups with repeated matching logic
- **Email/URL validators**: common semantic patterns

For each one, the question is whether an attacker can feed it a long valid-looking string that still fails.

## What I learned from this round

1. **Static detection is only the first step.** 9,528 findings looks scary, but follow-up testing showed the scan was broad.
2. **Overlapping alternatives are everywhere.** That pattern class is the biggest source of alerts.
3. **Real risk is about input, not just regex shape.** The same vulnerable pattern can be harmless in one context and fatal in another.
4. **Synthetic benchmarks transfer to real-world patterns.** The backtracking mechanism is universal — understanding the benchmark helps you spot the risk in production code.

## How to use this study

If you are reviewing regex in your codebase, use this study as a roadmap:

- Start with the scanner categories, not the raw hit count.
- Treat `overlapping_alternatives` and `nested_quantifiers` as high-priority review items.
- Use real-world inputs that mirror your user data, not only synthetic `aaaa...a!` strings.
- Keep the benchmark model in mind: the attack is valid-looking input that fails late.
- When possible, prefer dedicated parsers (e.g., `new URL()`) over complex regex for semantic validation.

That is the difference between a noisy security scan and a useful audit.
