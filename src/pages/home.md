---
title: "StackInsight — Empirical Performance Research for JavaScript and TypeScript"
description: "Large-scale empirical studies on performance anti-patterns in real-world JavaScript and TypeScript codebases, with controlled benchmarks and an open-source detection tool."
---

# StackInsight

Empirical research on code performance and quality for JavaScript and TypeScript developers. Each study combines large-scale repository analysis with controlled benchmarks to produce verified, reproducible findings.

[**Scan your repository with Code Evolution Lab →**](https://codeevolutionlab.com)

---

## Research at a Glance

| | |
|---|---|
| Empirical studies published | 11 |
| Detection rules derived from research | 16 |
| Repositories scanned (memory leak study) | 500 |
| Prevalence of missing-cleanup patterns | 86% of repositories |
| Total findings (memory leak study) | 55,864 across 714,217 files |
| Nested loop speedup vs. Map lookup at n = 10,000 | 64× |

---

## Code Evolution Lab

A static analysis tool for JavaScript and TypeScript codebases, built directly from the findings of this research. Code Evolution Lab detects N+1 queries, memory leaks, missing database indexes, inefficient loops, and 12 additional anti-patterns using Babel AST and Prisma schema analysis.

- [**App** → codeevolutionlab.com](https://codeevolutionlab.com)
- [**Documentation** → docs.codeevolutionlab.com](https://docs.codeevolutionlab.com/)
- [**GitHub** → liangk/code-evolution-lab](https://github.com/liangk/code-evolution-lab)

---

## Empirical Studies

Each study is structured in two phases: a corpus scan measuring the prevalence of a target pattern across real open-source repositories, followed by a controlled benchmark quantifying the performance cost of that pattern under varying load conditions. All methodology, raw data, and benchmark source code are published alongside each article.

[**Browse all studies and articles →**](/blog)

