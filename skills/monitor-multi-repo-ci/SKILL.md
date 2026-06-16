---
name: monitor-multi-repo-ci
description: Use when watching or diagnosing CI across the contributors-please three-repo system (engine → action → test) — a PR merge cascade that isn't completing, a downstream suite that failed, a workflow that never triggered, rate-limit errors from gh, or "is everything green?". Triggers on "watch the CI", "why did the cascade fail", "downstream suite failed", "CP-GHA-038/044 failed", "the action repo CI is red", "engine sync".
metadata:
  type: technique
  repos: smorinlabs/contributors-please, contributors-please-action, contributors-please-test
---

# Monitor multi-repo CI

The `contributors-please` system spans three repos with an event-driven cascade. Failures are usually in the *plumbing between* repos (stale tracked refs, lost events, rate limits), not the code. This skill is how to watch the cascade and map a red mark to its real cause.

**Core principle:** distinguish a *code* failure from an *environmental* one before acting. A red suite is far more often a stale tracked ref, a lost webhook, or a shared-account rate limit than a real regression.

## The cascade (what triggers what)

```
engine (contributors-please)                action (contributors-please-action)        test (contributors-please-test)
  publish.yml  ── tag vX ──▶ npm publish
       └─ repository_dispatch ─────────────▶ engine-sync.yml (verify version refs)
                                              ci.yml (push/PR)
                                                └─ workflow_run ─▶ downstream-e2e.yml
                                                      └─ repository_dispatch ──────────▶ action-downstream-suite.yml
                                                                                          └─ fans out CP-GHA-* suites
  release-please merge ─▶ release.yml/e2e.yml (tag) ─▶ e2e.yml vs scratch repo
```

See `references/topology.md` for the full trigger map and the four version references that must stay in sync.

## Watching a cascade

Use a persistent Monitor that streams run state across the action and test repos. Key facts:
- `gh run list --json` is **REST** (core quota), safe to poll; `gh pr` / `gh api graphql` are **GraphQL** (separate, smaller bucket — see rate-limit note).
- The same code change produces a downstream run **per head SHA** (each push to action `main`). The newest SHA is authoritative; older concurrent runs are superseded but still execute.
- Concurrent downstream sweeps **serialize** through the test repo's per-ref concurrency group — not a race.

```bash
# one-shot snapshot of a cascade for a given action sha
gh run list --repo smorinlabs/contributors-please-action --json name,headSha,status,conclusion \
  --jq '.[] | select(.headSha|startswith("SHA")) | "\(.name): \(.status)/\(.conclusion)"'
```

## Triage: is it code or environment?

```
Red suite/job
  ├─ Failed at a SETUP step (checkout, "Prepare … baseline", token)? ─▶ environmental
  │     └─ message has "rate limit", "API limit exceeded", "not found"? ─▶ rate-limit / lost-event (see catalog)
  ├─ Failed at a BUILD step with TS2307/TS2345 (engine types)? ─────▶ stale tracked ref / setup drift (catalog: tracked ref)
  ├─ git diff on dist (CP-GHA-038)? ───────────────────────────────▶ embedded version drift (catalog: drift)
  ├─ "conflicting configuration for keys …"? ──────────────────────▶ config-source conflict (catalog: conflict)
  └─ Failed inside a fake-API deterministic suite asserting behavior? ─▶ likely a REAL regression — investigate the change
```

**Deterministic vs live suites:** the CP-GHA-* suites use *fake* APIs; `live-adoption` hits *real* GitHub APIs and is rate-limit-sensitive — a setup-step failure there is usually environmental, not a code regression. **But by policy (`contributors-please-test/CLAUDE.md`), `live-adoption` is a BLOCKING gate** — it is watched with `--exit-status` and a failure fails the downstream suite. Do **not** downgrade it to non-blocking / report-only to get green; root-cause the failure instead (reduce GraphQL calls / add backoff / dedicated token for the live suite). "Environmental" classifies the cause, not permission to ignore it.

## Rate limits (this bites constantly)

`gh` shares one quota across the session and all agents, split into buckets:
- **GraphQL** (`gh pr create/merge/ready`, `gh api graphql`): ~5000/hr, exhausts fast.
- **REST/core** (`gh api repos/...`, `gh run list`): separate ~5000/hr.

When GraphQL is exhausted, **switch to REST**: create/merge PRs via `gh api repos/{repo}/pulls` and `.../merge` instead of `gh pr`. Check with `gh api rate_limit --jq .resources` (this call is free). The shared bot account (e.g. user 124719) is also what the `live-adoption` suite uses — heavy session activity can starve it and flake that suite.

## Quick reference

| Want | Command |
|---|---|
| Per-job conclusions of a run | `gh api repos/{repo}/actions/runs/{id}/jobs --jq '.jobs[] \| "\(.name): \(.conclusion)"'` |
| Why a step failed | `gh run view {id} --repo {repo} --log-failed` |
| Did CI even trigger? | `gh api repos/{repo}/commits/{sha}/check-suites --jq '.check_suites[] \| {app:.app.slug,status}'` |
| Rate-limit state | `gh api rate_limit --jq .resources` |
| Engine sync state | `npm run check:sync:trusted` (in the action repo) |

## Failure catalog

Full diagnosis + remedy per failure mode in `references/failure-catalog.md`. Summary:

| Failure | Tell | Class |
|---|---|---|
| Lost webhook event | No run for head SHA; third-party check-suites queued but no `github-actions` | environmental |
| Stale tracked ref | tracked ref < latest, or engine type mismatch after release | plumbing |
| Embedded version drift | CP-GHA-038 `git diff … dist` non-empty | plumbing |
| Config-source conflict | `ConfigError: conflicting configuration for keys` | config |
| GraphQL exhaustion | `gh pr` fails "rate limit"; `gh api` works | rate-limit |
| live-adoption flake | live suite fails at setup w/ "rate limit … user ID" | environmental |
| sync-dist red | release PR check fails build `TS2307` (no engine dep) | plumbing (fixed #29; recurs if a build job drops engine setup) |
| PR fails engine-sync on stale dist | PR predating a dist rebuild; embedded < tracked/latest | plumbing (update the PR branch) |
| Engine-release drift | after engine release, tracked ref < latest | plumbing (use update-multi-repo-ci) |

When the fix is a plumbing change, hand off to the **update-multi-repo-ci** skill.
