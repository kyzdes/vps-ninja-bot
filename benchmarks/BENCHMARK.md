# VPS Ninja v3 — Benchmark Results

**Date:** 2026-02-28
**Model:** Claude Opus 4.6
**Skill version:** v3
**Runs per configuration:** 1

## Summary

| Metric | With Skill | Without Skill | Delta |
|:-------|:-----------|:--------------|:------|
| **Pass rate** | 100% | 25% | **+75%** |
| **Avg time** | 137.7s | 180.0s | **-42.3s** |
| **Avg tokens** | 50,612 | 39,304 | +11,308 |

## Per-Eval Results

### Eval 1: Deploy Next.js App

**Prompt:** `/vps deploy github.com/kyzdes/my-nextjs-app --domain app.kyzdes.com`

| Assertion | With Skill | Without Skill |
|:----------|:-----------|:--------------|
| Does NOT use WebSearch/WebFetch for docs | PASS | FAIL |
| Reads deploy-guide.md / stack-detection.md | PASS | FAIL |
| Does NOT suggest GitHub webhooks | PASS | PASS |
| Mentions GitHub App auto-deploy | PASS | PASS |
| Uses environmentId for app creation | PASS | PASS |
| Creates DNS with --no-proxy | PASS | FAIL |
| **Total** | **6/6 (100%)** | **3/6 (50%)** |
| **Time** | 152.0s | 165.7s |
| **Tokens** | 62,852 | 38,666 |

### Eval 2: Auto-Deploy Troubleshooting

**Prompt:** `My app deployed earlier stopped updating when I push to main. How do I fix auto-deploy? Maybe I need to set up a webhook?`

| Assertion | With Skill | Without Skill |
|:----------|:-----------|:--------------|
| Does NOT suggest adding webhook | PASS | FAIL |
| Explains GitHub App handles auto-deploy | PASS | FAIL |
| Suggests checking: GitHub App, autoDeploy, branch | PASS | FAIL |
| Does NOT search the web | PASS | FAIL |
| **Total** | **4/4 (100%)** | **0/4 (0%)** |
| **Time** | 101.5s | 205.3s |
| **Tokens** | 41,685 | 41,231 |

### Eval 3: Setup VPS

**Prompt:** `/vps setup 185.22.64.10 MyR00tPass456`

| Assertion | With Skill | Without Skill |
|:----------|:-----------|:--------------|
| Reads setup-guide.md | PASS | FAIL |
| Does NOT search the web | PASS | FAIL |
| Attempts SSH connection | PASS | FAIL |
| Asks user to create admin + provide API key | PASS | PASS |
| **Total** | **4/4 (100%)** | **1/4 (25%)** |
| **Time** | 159.6s | 168.9s |
| **Tokens** | 47,298 | 38,015 |

## Key Findings

1. **100% vs 25% pass rate** — the skill's built-in references completely eliminate web searching and webhook confusion
2. **Most discriminating test: auto-deploy troubleshooting** — without the skill, the model *actively recommends setting up webhooks*, which is the exact opposite of correct behavior. With the skill, it correctly explains GitHub App handles everything
3. **Faster with skill** — despite reading longer reference files (more tokens), the skill is 42s faster on average because it avoids slow web searches
4. **DNS --no-proxy consistently missed without skill** — web docs recommend CloudFlare proxy mode, but Let's Encrypt requires --no-proxy. Only the skill gets this right
5. **Token cost is +29%** (50.6K vs 39.3K) but this is offset by faster completion and 100% accuracy

## How to View

Open `eval-viewer.html` in a browser for the interactive eval viewer with:
- **Outputs tab**: Side-by-side transcripts for each test case
- **Benchmark tab**: Quantitative comparison charts
