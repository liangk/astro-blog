---
title: "ReDoS in the Wild: What 329 JavaScript Repositories Taught Us About Regex Denial of Service"
pubDate: "2026-05-20"
heroImage: "../../assets/redos-empirical-study.webp"
author: "Ko-Hsin Liang"
repo: "https://github.com/liangk/empirical-study"
description: "We scanned 329 JavaScript/TypeScript repositories for ReDoS patterns, benchmarked the core attack mechanisms, and found 9,528 potential vulnerabilities. This study explains what those findings mean, why synthetic benchmarks are still useful, and how junior developers can spot the real danger in regex code."
excerpt: "A regex can look innocent and still be a time bomb. In this study we scanned 329 repos, found 9,528 potential ReDoS patterns, and used synthetic and real-world benchmarks to separate real risk from over-detection."
lastmod: "2026-05-20"
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

This article explains the study design, why I benchmarked simplified regex patterns, and what the scan actually found.

## Why this study exists

If you have written regex in a web app, you have probably seen warnings like “don’t use `.*`” or “avoid nested quantifiers.” Those warnings are real. But they are also easy to turn into noise.

I wanted a clearer answer:

- Which regex structures are actually dangerous?
- How often do those patterns show up in real repositories?
- When does a detected pattern mean “this can be abused” versus “this deserves a second look”?

The short answer is: ReDoS is real, but the scan is an early filter. The attack is about the combination of pattern shape and input, not just the pattern alone.

**Prerequisite:** You should be comfortable reading JavaScript regex syntax. No security background is required.

## What is ReDoS? (and why it matters)

Before diving into the study, here is what you need to know.

**What backtracking is:** A regex engine does not magically match strings. It follows a path through your pattern, character by character. When it hits a mismatch, it backs up and tries a different path. This is backtracking. For simple patterns like `/hello/`, there is only one path, so backtracking is rare. But for patterns with alternatives or repeated groups, there are many valid paths, and the engine may explore them all.

**What catastrophic backtracking is:** Some regex patterns have exponentially many paths. As the input string grows longer, the number of paths to try grows exponentially. If your pattern is `/(a*)*$/` and you feed it 20 `a` characters followed by a `!` (which fails to match), the engine does not find out it lost until it has tried millions of partitions. A 20-character input can take 100+ milliseconds. A 30-character input takes 10+ seconds.

**Why it is called denial of service:** Node.js runs on a single-threaded event loop. When a regex call blocks (waiting for exponential backtracking to finish), the entire server stalls. All other requests are frozen until that regex completes or times out. One bad regex + one attacker-controlled input = no requests processed = denial of service. This is not just a slow function—it is a complete service outage for as long as the regex is stuck.

**A concrete example:** The pattern `/(a|a)+$/` looks innocent. Both alternatives match the same thing, so why would this be slow? Because the engine is allowed to choose either branch at each position. For a 30-character input of `aaaa...aaaa!` (where `!` fails to match), the engine tries all $2^{30}$ combinations before giving up. That is over 1 billion attempts.

Now: on to the study.

## How I built the study

The study has two main parts:

1. **Static scanning** — A Babel-based AST detector (an Abstract Syntax Tree parser that examines the structure of code to find regex literals and `new RegExp()` calls) looked for regex patterns and classified them by vulnerability type.
2. **Benchmark validation** — I used synthetic benchmarks and real pattern analogues to demonstrate and measure why the scan patterns matter.

This is a study, not a fuzz test. That means I want measurable patterns and clear evidence, not just a long list of hits.

**Repo selection:** I scanned 329 public JavaScript and TypeScript repositories. Repositories were selected from popular open-source projects on GitHub and npm, filtered to exclude archived projects, forks with no independent commits, and repositories with fewer than 50 stars (a heuristic to reduce noise from inactive or trivial codebases). My initial candidate set was approximately 500 projects; 170 were excluded as inactive or dead, leaving 329 analysed. The detector source is available in the study repository linked at the top of this article, and it uses `ret.js` internally to parse regex token structure.

## What I actually found

The scan produced these totals:

- **329 repositories scanned**
- **176 repositories with findings**
- **9,528 total potential ReDoS matches**
- **9,516 overlapping alternative patterns**
- **9 URL-related patterns**
- **3 email-related patterns**

The biggest lesson is this: the scan is heavily weighted toward one pattern type. That is both a useful signal and a warning.

### Overlapping alternatives dominate

Most of the findings came from the pattern class I call `overlapping_alternatives`.

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

Regex engines are a lot like maze solvers: the engine follows one path through the pattern and only backtracks if the current path fails. The hard part for junior developers is that many patterns have multiple valid paths, and the engine may explore them all before deciding the match is impossible.

A synthetic benchmark isolates the core hazard:

- a simple pattern with a known ambiguity
- a deliberately long input that looks valid until the end
- a failure only after the engine has explored many options

For example:

```regex
/(a*)*$/
```

with input:

```text
aaaaaaaaaaaaaaaaaaaa!
```

The regex can match the `a` sequence in many different ways. Each `*` can consume a different number of characters, so the engine tries one partition after another. The failure happens only when the final `!` cannot match, forcing backtracking through all those partitions.

This is not a fake problem. The same pattern shape exists in real validators, and the engine behavior is the same whether the pattern is written as a toy example or as a production email parser.

### Understanding the gap: synthetic vs real-world

The study uses synthetic examples to explain the mechanism, not to claim real code always looks like those exact regexes.

A synthetic example is valuable because it:

- exposes the hazard in the smallest possible form
- makes the backtracking path easy to follow
- gives a repeatable benchmark for comparison
- preserves the structural error even when real patterns are larger

A real-world regex may contain more tokens, more groups, and more character classes, but the attack principle is the same:

1. the pattern allows multiple matching paths
2. the input stays valid until late in the string
3. the engine exhausts many paths only after a final failure
4. the runtime cost grows much faster than the input length

That is why the study maps synthetic classes to real patterns, instead of treating synthetic testing as a separate exercise.

### Why a simple attack string works for learning

With a junior audience, it helps to see the exact failure mode.

- `/(a|a)+$/` is ambiguous because both alternatives match the same prefix.
- `/^(user|username)+$/` is ambiguous because `user` is a prefix of `username`.
- `/([0-9]{1,3}?)+/` is ambiguous because repeated groups can be split in many ways.

The attack string is always the same idea: feed the regex something that looks valid for a long prefix, then make it fail only after the engine is committed to many choices.

### Benchmark pattern mappings

**BM-01: Nested quantifiers**

- Synthetic: `/(a*)*$/` on `aaaaaaaaaaaaaaaaaaaa!`
- Real-world analogue: a repeated dot-group in an email validator such as `(([a-zA-Z0-9_-]+\.)*[a-zA-Z0-9_-]+)+@...`
- Why they match: both patterns nest repetition inside repetition. The engine can assign the same input to the inner and outer quantifiers in exponentially many ways. When the final `@` or `!` fails, the engine backtracks through all of them.

**BM-02: Overlapping alternatives**

- Synthetic: `/(a|a)*$/` on `aaaaaaaaaaaaaaaaaaaa!`
- Real-world analogue: `^(user|username|user_id|user-name)+$` on `useruserususer_!`
- Why they match: the alternatives share prefixes. At each position, the engine can choose `user` or part of `username`, so many alternative paths are possible before the final reject.

**BM-03: Large bounded repetition**

- Synthetic: `/(a{1,100})*b/` on `aaaaaaaaaaaaaaaaaaaa`
- Real-world analogue: `^((%[0-9a-fA-F]{2})+)+$` on `%2F%2F%2F...%2F`
- Why they match: there is a repetition of a bounded group. The engine must try many ways to slice the input into repeated chunks, and each failure forces a new partitioning attempt.

**BM-04: Complex nested groups**

- Synthetic: `/((a+)+)+$/` on `aaaaaaaaaaaaaaaaaaaa!`
- Real-world analogue: `(([a-z0-9]+[-+_]?)*)+\s*$` on `verylongstringwithhyphens---!`
- Why they match: there are multiple nested quantifiers layered on top of each other. The cost multiplies at each nesting level, so the runtime jumps from linear to exponential.

### Benchmark results: The performance gap

To move beyond theoretical explanations, I ran controlled benchmarks on the vulnerability patterns. The results show a dramatic performance difference between vulnerable and safe regex variants.

**Benchmark methodology:**

All benchmarks were run on Node.js v24 using `performance.now()` for millisecond-precision timing. Each pattern was tested against a single carefully crafted attack input designed to force maximum backtracking: a long sequence of characters that matches the pattern's prefix but fails only at the very end. Timing is single-run per input size (not averaged) to isolate the worst-case behaviour. The 5-second timeout was enforced using `AbortController` with a `setTimeout` of 5000ms, and patterns that exceeded this limit are marked `5000*` in the tables. Measurements were taken on a mini PC CPU (AMD Ryzen 7 5825U) running Windows 11 Pro; relative speedup ratios are reproducible across machines, but absolute millisecond values will vary by hardware.

**BM-01: Nested quantifiers (/(a*)*$/ vs /a*$/)**

Vulnerable: `/(a*)*$/`
Safe: `/a*$/`

What changed: Removed the outer `*` quantifier. The outer quantifier forces the engine to try many ways of partitioning the inner `*` matches; removing it eliminates the nested repetition. The safe pattern still matches any sequence of `a` characters followed by end-of-string, but without exponential branching.

| Input Size | Vulnerable (ms) | Safe (ms) | Speedup |
|------------|-----------------|-----------|---------|
| 10         | 0.17            | 0         | –       |
| 20         | 151.77          | 0.03      | ~5,059x |
| 40         | 5000*           | 0         | >5000x  |
| 60         | 5000*           | 0         | >5000x  |
| 80         | 5000*           | 0         | >5000x  |
| 100        | 5000*           | 0         | >5000x  |
| 1,000      | 5000*           | 0         | >5000x  |
| 10,000     | 5000*           | 0         | >5000x  |

*Hit 5-second timeout. "–" indicates both patterns completed near-instantly; speedup is not meaningful. ">5000x" indicates the vulnerable pattern hit timeout while the safe pattern remained sub-millisecond.

The vulnerable pattern shows exponential degradation: from 0.17ms at size 10 to 151.77ms at size 20, then timing out at size 40 and beyond. The safe variant remains consistently fast regardless of input length.

**BM-02: Overlapping alternatives (/(a|a)*$/ vs /a*$/)**

Vulnerable: `/(a|a)*$/`
Safe: `/a*$/` or `/a+$/`

What changed: Removed the overlapping alternatives. Both branches of the vulnerable pattern match the same character (`a`), so the engine can choose either branch at every position, creating 2^N possible paths for N characters. The safe pattern directly matches `a` one or more times without the branching decision.

| Input Size | Vulnerable (ms) | Safe (ms) | Speedup |
|------------|-----------------|-----------|---------|
| 10         | 0.2             | 0         | –       |
| 20         | 137.77          | 0.07      | ~1,968x |
| 40         | 5000*           | 0.03      | >166,000x |
| 60         | 5000*           | 0.03      | >166,000x |
| 80         | 5000*           | 0.07      | >71,000x  |
| 100        | 5000*           | 0.13      | >38,000x  |
| 1,000      | 5000*           | 0.67      | >7,500x   |
| 10,000     | 5000*           | 70        | ~71x      |

*Hit 5-second timeout. "–" indicates both patterns completed near-instantly. Speedup figures show the ratio of vulnerable time to safe time; where both are non-zero, the actual ratio is shown.

The overlapping alternatives pattern shows severe degradation similar to BM-01: 0.2ms at size 10 jumps to 137.77ms at size 20, then times out at size 40. The safe pattern shows minimal growth even at 10,000 characters.

**BM-03: Large repetition (/(a{1,100})*b/ vs bounded)**

Vulnerable: `/(a{1,100})*b/`
Safe: `/a+b/` or `/a{1,100}b/`

What changed: Removed the outer repetition of the bounded group. The vulnerable pattern requires the engine to try many ways of slicing the input into repeated chunks of 1–100 `a` characters each. The safe pattern matches 1–100 `a` characters followed by `b`, without repeating the group. This eliminates the partitioning search.

| Input Size | Vulnerable (ms) | Safe (ms) | Speedup |
|------------|-----------------|-----------|---------|
| 10         | 0.1             | 0         | –       |
| 20         | 78.63           | 0.03      | ~2,621x |
| 40         | 5000*           | 0.03      | >166,000x |
| 60         | 5000*           | 0.03      | >166,000x |
| 80         | 5000*           | 0.07      | >71,000x  |
| 100        | 5000*           | 0.13      | >38,000x  |
| 1,000      | 5000*           | 0.67      | >7,500x   |
| 10,000     | 5000*           | 70        | ~71x      |

*Hit 5-second timeout.

The large repetition pattern exhibits exponential backtracking: 0.1ms at size 10 grows to 78.63ms at size 20, then times out at size 40. The bounded safe variant maintains linear performance.

**BM-04: Complex nested groups (/((a+)+)+$/ vs /a+$/)**

Vulnerable: `/((a+)+)+$/`
Safe: `/a+$/`

What changed: Removed both layers of nesting. The vulnerable pattern has three repetition operators stacked on top of each other, multiplying the search space at each level. The safe pattern matches one or more `a` characters with a single quantifier, requiring no backtracking decisions.

| Input Size | Vulnerable (ms) | Safe (ms) | Speedup |
|------------|-----------------|-----------|---------|
| 10         | 0.5             | 0         | –       |
| 20         | 244             | 0         | >5000x  |
| 40         | 5000*           | 0         | >5000x  |
| 60         | 5000*           | 0         | >5000x  |
| 80         | 5000*           | 0         | >5000x  |
| 100        | 5000*           | 0         | >5000x  |
| 1,000      | 5000*           | 1         | >5000x  |
| 10,000     | 5000*           | 123       | ~41x    |

*Hit 5-second timeout.

The complex nested groups pattern exhibits severe backtracking: 0.5ms at size 10 jumps to 244ms at size 20, then times out at size 40. The simplified safe pattern maintains linear performance even at 10,000 characters.

**BM-05: Email validator (/^([a-zA-Z0-9_%+-]+)+@([a-zA-Z0-9.-]+)+\.[a-zA-Z]{2,}$/ vs simple)**

Vulnerable: `/^([a-zA-Z0-9_%+-]+)+@([a-zA-Z0-9.-]+)+\.[a-zA-Z]{2,}$/`
Safe: `/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/`

What changed: Removed the nested `+` quantifiers. The vulnerable pattern repeats character-class groups, allowing the engine to partition the same characters across multiple repetitions. The safe pattern uses a single `+` per section (local part, domain, TLD), which still matches valid email prefixes but without exponential branching. This is a more realistic example: many email validators in production code are written like the vulnerable version.

| Input Size | Vulnerable (ms) | Safe (ms) | Speedup |
|------------|-----------------|-----------|---------|
| 10         | 0.07            | 0         | –       |
| 20         | 5.3             | 0         | >5000x  |
| 40         | 5000*           | 0         | >5000x  |
| 60         | 5000*           | 0         | >5000x  |
| 80         | 5000*           | 0         | >5000x  |
| 100        | 5000*           | 0         | >5000x  |
| 1,000      | 5000*           | 0         | >5000x  |
| 10,000     | 5000*           | 0.07      | >71,000x |

*Hit 5-second timeout.

The email validator with nested quantifiers shows the same exponential pattern: negligible at size 10, 5.3ms at size 20, then timeout at size 40. The safe email validator remains near-instantaneous.

**BM-06: Cookie parser (/^(token|token)+end$/ vs /^token+end$/)**

Vulnerable: `/^(token|token)+end$/`
Safe: `/^token+end$/`

What changed: Removed the overlapping alternatives inside the group. The vulnerable pattern allows the engine to choose between two identical branches at every position, creating a search space that grows with input length. The safe pattern matches the token directly without branching.

Real-world context: Cookie headers have size limits. nginx defaults to 4KB–8KB per header line, and Apache/Express also enforce defaults in this range. A 1,000-character cookie value is within typical limits, meaning this pattern could be triggered in real deployments with moderately sized cookies. However, this pattern only times out beyond 1,000 characters, so it is less severe than BM-01 through BM-05.

| Input Size | Vulnerable (ms) | Safe (ms) | Speedup |
|------------|-----------------|-----------|---------|
| 10         | 0               | 0         | –       |
| 20         | 0               | 0         | –       |
| 40         | 0               | 0         | –       |
| 60         | 0               | 0         | –       |
| 80         | 0               | 0         | –       |
| 100        | 0               | 0         | –       |
| 1,000      | 5000*           | 0         | >5000x  |
| 10,000     | 5000*           | 0         | >5000x  |

*Hit 5-second timeout. "–" indicates both patterns completed in unmeasurable time (<0.01ms).

The cookie parser benchmark shows no measurable performance difference for small inputs (10-100 characters), but hits timeouts at larger sizes (1,000+ characters). This highlights an important nuance: not all overlapping alternatives produce the same severity of backtracking. The specific pattern structure and input characteristics matter.

**Key observations across all benchmarks:**

- **Vulnerable patterns exhibit exponential backtracking**: Runtime grows dramatically with input size, often hitting timeouts at 40-100 characters for the most severe patterns (BM-01, BM-02, BM-03, BM-04, BM-05).
- **Safe patterns maintain linear performance**: Runtime stays near 0ms even at 10,000-character inputs for most patterns.
- **The gap is measurable, not theoretical**: Speedup factors range from 2x to over 150,000x depending on the pattern and input size.
- **Timeouts are real**: At input sizes of 40-100 characters, vulnerable patterns consistently hit the 5-second timeout limit for BM-01 through BM-05.
- **Pattern severity varies**: BM-01, BM-02, BM-03, BM-04, and BM-05 show severe degradation at small input sizes, while BM-06 only degrades at very large inputs (1,000+ characters).
- **BM-06 is a special case**: The cookie parser pattern shows no performance impact for typical input sizes but degrades at very large inputs, suggesting that overlapping alternatives may only be exploitable with specially crafted large payloads.

This experimental evidence confirms that the structural hazards identified by the detector are not just theoretical concerns—they produce measurable, exploitable performance degradation under realistic attack conditions. However, the results also show that not all flagged patterns have the same severity, reinforcing the need for context-aware triage.

**Summary: concise takeaways**

- **Highest risk:** BM-01, BM-02, BM-03, BM-04, BM-05 — these patterns show exponential backtracking and hit the 5s timeout at relatively small input sizes (40–100 chars).
- **Lower risk (but not negligible):** BM-06 — no measurable slowdown on typical inputs, but times out on very large inputs (1,000+ chars).
- **Exploitability rule-of-thumb:** a pattern that accepts a long valid prefix and only fails near the end is the one to worry about; synthetic benchmarks reveal this by construction.

**Compact risk matrix**

| Benchmark | Pattern class | Severity | Why it matters | Fast triage action |
|-----------|---------------|----------|----------------|--------------------|
| BM-01 | Nested quantifiers | High | Times out on small inputs | Bound quantifiers, use atomic groups, or rewrite |
| BM-02 | Overlapping alternatives | High | Ambiguous prefixes cause repeated backtracking | Remove redundant overlaps or anchor alternatives |
| BM-03 | Large repetition | High | Repeated bounded groups force many partitions | Enforce stricter bounds or simplify repetition |
| BM-04 | Complex nested groups | High | Nested repetition multiplies backtracking cost | Simplify nesting or parse instead of regexing |
| BM-05 | Email validator with nested quantifiers | High | Real-world validators inherit the hazard | Prefer simpler validators or dedicated parsing |
| BM-06 | Cookie parser overlapping tokens | Medium | Only triggers on very large inputs | Add length limits, validate input size |

**Key terms in the triage matrix:**

- **Atomic groups:** A regex feature (written `(?>...)`) that commits the engine to the match so far and prevents backtracking into the group. Supported in some languages and regex libraries; not native to JavaScript's built-in regex, but can be simulated with lookahead or external libraries.
- **Non-backtracking engine:** A regex engine that matches in linear time by never backtracking (e.g., RE2, or the `re2` npm module for Node.js). These engines reject some regex features (like backreferences) but guarantee no exponential behaviour.


## What the follow-up validation showed (and why it matters)

The most important finding in this study is this one: 0 timeouts from simple dynamic probes.

In the second phase, I generated a very simple dynamic test for every finding:

- create a long input that matches the pattern as far as possible
- make the last character cause the match to fail
- run the regex and observe whether the runtime spikes

The result:

- **Patterns with obvious performance issues from the simple test: 0**
- **Patterns with timeouts using that baseline input: 0**

This is **not** the same as "all 9,528 patterns are safe." It means: **the static detector is a broad filter, not a final verdict.** Exploitability depends on input shape and context, not just pattern fingerprint. The benchmarks in the previous sections show that when you craft the right attack input, real hazards emerge. But the simple probe, which would catch the most obvious cases, found none. This gap is the main lesson: scan for patterns, then validate contextually.

A structured false-positive rate study remains future work; this article reports the current finding and flags the next step for more precise validation.

The dynamic probe result also explains why this study has value: it shows that a high hit count (9,528) does not translate to a high exploitable count without human judgment and targeted testing.

**Actionable triage checklist (fast route for reviewers)**


1. **Classify** the flagged regex as nested/overlap/large-repeat/complex.
2. **Construct** the minimal attack input: long valid prefix + single failing char at the end.
3. **Measure** runtime growth across increasing input sizes (10, 20, 40, 100, 1000).
4. **Decide**: if runtime grows superlinearly or hits timeout, mark as high priority; otherwise, mark for contextual review.
5. **Fix options**: rewrite to remove ambiguous alternatives, add bounds, use atomic grouping or a non-backtracking engine, or replace with a parser for semantic validation.


## Detector design and pattern coverage

I designed the detector to catch the structural hazards developers actually write:

- **Nested quantifiers**: `(...*)*`, `(...+)+`, `(...{1,5})+`
- **Overlapping alternatives**: `(a|a)`, `(x|xy)`
- **Large repetitions**: `.{100,}` or repeated bounded groups
- **Complex groups**: nested groups with repeated matching logic
- **Email/URL validators**: common semantic patterns with prefix ambiguity

For each one, the review question is the same: can an attacker feed it a long, valid-looking string that still fails only at the end?

## What I learned from this round

- **A high hit count is not a proof of exploitability.** The study found 9,528 suspicious regexes, but the dynamic probe showed that many of those patterns need a smarter input to produce a measurable delay.
- **Most alerts come from one class.** `overlapping_alternatives` dominated the findings, so that category is the most important place to focus effort.
- **The real hazard is the matcher’s behavior, not the regex text alone.** Two patterns can look similar, but only one may be vulnerable once you include anchors, input length, and expected character sets.
- **Benchmarks are the bridge from theory to practice.** A synthetic stress test helps junior developers understand why a pattern is risky and how to construct a follow-up test.
- **The study contributes a triage model.** Use static scan for broad coverage, then use benchmark reasoning to separate likely noise from likely risk.

## How to use this study

This study is designed to help reviewers and developers move from alarm to action.

1. **Start with categories, not counts.** Focus on `overlapping_alternatives`, `nested_quantifiers`, and large repeated groups first. Those categories are the highest-risk outputs from the scan.
2. **Ask the right question for each hit.** Do not ask “how many regexes matched?” Ask “can this regex accept a long valid prefix and then fail only at the end?”
3. **Build the smallest attack input.** Use the synthetic benchmark pattern as a template, then replace the toy tokens with the real character classes and anchors from the actual regex.
4. **Validate with real data shape.** If the regex is an email or URL checker, use realistic user data and make a single invalid change near the end. If it is a username validator, use a string that resembles actual usernames.
5. **Prefer parsers over complex regex.** When a validator is doing semantic work, it is usually safer to parse with `new URL()`, `Date.parse()`, or a dedicated library rather than a deeply nested regex.
6. **Use the scan as triage, not as a final score.** Treat the results as “review these patterns next,” not “these are security vulnerabilities.”

The contribution of this study is a practical workflow: static pattern scanning finds suspicious regex shapes, synthetic benchmarks explain why those shapes matter, and targeted follow-up testing separates true risk from noise.

## Tools for immediate protection

You do not need to wait for a scan of your whole codebase. Here are established tools to start with:

- **`safe-regex`** (npm package) — A lightweight static analyser that flags patterns with exponential worst-case complexity. It is fast enough for pre-commit hooks and ideal for catching the most obvious cases.
- **`eslint-plugin-regexp`** — An ESLint plugin that integrates ReDoS detection rules into your CI pipeline. It gives you feedback at lint time without a separate scanning step.
- **`node-re2`** (npm package) — Binds the RE2 regex engine (which guarantees linear-time matching) to Node.js. A drop-in replacement for patterns that only need standard features; requires rewriting your regex calls.
- **`regexploit`** or **`vuln-regex-detector`** — Research tools for generating attack inputs to test whether a regex is actually exploitable in your context. Useful for the manual verification phase.

At the runtime level, Node.js does not yet provide a built-in regex timeout. As a defence-in-depth measure, you can wrap regex calls in a worker thread with an `AbortController` timeout.

## Closing: what this study shows and what comes next

ReDoS is not a theoretical hazard—this study produced measurable evidence that certain regex patterns cause exponential backtracking in Node.js. The 9,528 findings across 176 repositories show that overlapping alternatives, nested quantifiers, and large repetitions are common in real codebases. At the same time, the 0-timeout result from simple dynamic probes reminds us that not all flagged patterns are immediately exploitable; context and input shape matter.

For developers: start with the tools section. Integrate `safe-regex` or `eslint-plugin-regexp` into your CI today. For maintainers of affected libraries: run the triage checklist on your highest-risk patterns. For security researchers: this study creates a baseline for future work on finer-grained detection, false-positive reduction, and Node.js-specific mitigation strategies.

The practical insight from this round: turn detection into action through measurement. A regex that passes your own timeout test is safer than one that does not. Use that principle, and you will reduce the risk surface significantly.
