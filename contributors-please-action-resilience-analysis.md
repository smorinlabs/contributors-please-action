# contributors-please-action resilience implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `contributors-please` multi-repo release and live-adoption workflow resilient, behavior-tested, and explainable across engine, action, test harness, and scratch repositories.

**Architecture:** Keep GitHub Actions YAML as orchestration only. Move critical GitHub API fallback, dispatch, wait, payload validation, and release-state logic into small Node scripts with mocked tests, while preserving live end-to-end tests for real GitHub side effects.

**Tech Stack:** GitHub Actions, Node.js ESM scripts, Vitest, `gh` CLI, GitHub REST and GraphQL APIs, npm, repository dispatch, `contributors-please-test` live scratch workflows.

---

Date: 2026-06-16

## Review remediations applied (2026-06-16)

This plan was reviewed (see `contributors-please-action-resilience-analysis-review.md`)
and the following corrections have been folded in. They change framing and a few
specs; read them before executing.

- **Engine artifact root cause (RC5) — DONE, not just test-side.** The malformed
  `CONTRIBUTORS.md` cause is two inconsistent engine defaults: `columns_per_row`
  defaults to 6 while the default `entry_template` is a markdown list item, so even a
  defaults-only config corrupts output. The engine (`contributors-please`) now emits a
  warning at `columns_per_row > 1` whenever the `entry_template` cannot be safely
  space-joined onto one row — it contains a `|` delimiter, begins with a list/heading
  marker, or contains a newline (this includes the default template)
  (`columnsPerRowWarnings` in `src/engine/render.ts`, surfaced via the CLI `stderr`
  sink). The default is documented in `schemas/config.schema.json`, and
  `test/engine/render.test.ts` covers the delimiter, default-template, list-marker,
  and safe-grid cases. Tasks 1–2 here remain the live-test guard; they no longer carry
  the root cause alone. (A maintainer may still choose to flip the default to 1; the
  warning is the non-breaking step.)
- **Silent propagation (RC2) — framing.** The token-preflight-before-publish + fatal
  retried dispatch + replay command already exist on the engine `publish.yml`
  (`origin/main`). Tasks 6/7 here are **regression-locks** on that landed fix, not the
  fix itself. The non-transactional `npm publish` → propagation window remains a known
  gap: treat it as **accepted and documented** (self-heals via the sync workflow), or
  close it later by gating "release complete" on the Task 8 checker. It is not closed
  by any task here.
- **Ordering hazards (RC3) — observability, not prevention.** The Task 8 checker is
  read-only: it *explains* ordering states, it does not *prevent* hazardous orderings.
  Do not read the "resilient" framing as prevention for this category unless the
  checker is later wired as a required gate between propagation steps.
- **Run correlation (RC4).** Promote the `source_run_id` + created-at-window
  correlation (Task 6) to a tested contract: assert it *rejects* a same-window run with
  the wrong source marker. Note in the runbook that GitHub dispatch APIs return no run
  ID, so some heuristic correlation is inherent.
- **Error taxonomy (DOC2/TAX1).** The E-numbers (E001…E028) are referenced but never
  defined and are **non-contiguous** (E004–E006, E008, E014, E020–E022, E025–E027 are
  unused). Before relying on them, ship an error catalog appendix (E### → symptom →
  run/PR/commit → status) or renumber contiguously so gaps read as "deferred."
- **Version axes (DOC3).** Task 8 must distinguish the engine library ref from the
  action package version. `complete` means "engine ref present and propagated, action
  main ≥ requested," not strict equality, so an old fully-propagated release is not
  reported incomplete after main advances.
- **Checker state graph (DOC4).** Document which Task 8 states are linear vs.
  terminal/stuck; `action-main-stale` (no PR) is earlier-or-stuck, not later than
  `action-sync-pr-open`.
- **Security (SEC1/SEC2/SEC4) — DONE.** Dispatch-controlled values
  (`client_payload.*`, `inputs.action_ref`) now flow through `env:` in the test-repo
  workflows (script-injection fix), `validate-workflows.mjs` guards the pattern, and
  `ci.yml` declares `permissions: { contents: read }`. New helper scripts must never
  print env/argv/raw tokens (SEC3 acceptance, added to Tasks 4–8).
- **Blast radius (BR1) — teardown applied; structurally validated, pending one live
  dispatch.** `e2e.yml` and `live-adoption.yml` now run `if: always()` teardown (close
  PR, delete branch) so a failed run self-cleans; the runbook has a manual-reset entry.
  The teardown logic has passed YAML/validator/workflow-test checks but has not yet run
  against real GitHub — confirm with one live dispatch (note: the push-delete relies on
  credentials set by earlier steps, so a very early failure may skip branch deletion;
  this is non-fatal and logged). A scheduled GC for accumulated scratch `main` fixtures
  remains a tracked follow-up.

## Purpose

This document captures the post-v1.3.1 multi-repo workflow analysis for:

- `contributors-please`
- `contributors-please-action`
- `contributors-please-test`
- `contributors-please-e2e`

It focuses on the errors encountered during the v1.3.1 release propagation, the
test-validity review, the malformed `CONTRIBUTORS.md` follow-up, and the
recommended implementation order for making the workflow less fragile and more
maintainable.

## Current evidence

Final v1.3.1 propagation reached green:

- `contributors-please@1.3.1` published on npm.
- GitHub Release `v1.3.1` exists.
- `contributors-please-action` PR #44 was merged.
- Action main reached `8a43887ad9bb186484bea37045c1486c774dff32`.
- Action main `.contributors-please-engine-ref` is `v1.3.1`.
- Final action checks were green:
  - CI `27654268808`
  - engine-sync `27654268786`
  - release-please `27654268804`
  - downstream E2E wrapper `27654291600`
- Final downstream orchestrator `27654299618` was green.
- The final downstream live-adoption child run was `27654972284`.

Validated follow-up for malformed `CONTRIBUTORS.md`:

- The live adoption PR could pass while generating this malformed output:

  ```text
  live-pr-27654972284 | Pull Request Live | 0 smorin | Code Contributor | 80
  ```

- The configured template was:

  ```yaml
  entry_template: "{{login}} | {{title}} | {{commits}}"
  ```

- `columns_per_row` was omitted, so the engine defaulted to `6` and joined
  multiple rendered entries with a space.
- The bot omission was expected because records ending in `[bot]` are filtered
  unless explicitly unignored.
- The correct fix was not `0 | smorin`. That would treat the symptom as a
  missing field delimiter. The actual issue was row grouping.

Implemented follow-up:

- `contributors-please-test` commit `7c1c714` set `columns_per_row: 1` in the
  live adoption fixture and added a PR-branch content assertion.
- Live validation passed in `contributors-please-test` run `27656020118`.
- New scratch PR `smorinlabs/contributors-please-e2e#56` produced:

  ```text
  live-pr-27656020118 | Pull Request Live | 0
  smorin | Code Contributor | 83
  ```

## Executive conclusion

The main frailty is that release propagation is a multi-repo state machine, but
the implementation is still mostly a set of independent YAML steps and loosely
coupled repository dispatch payloads.

The immediate fixes made v1.3.1 green, but the workflow is still too dependent
on:

- inline shell and Node snippets inside YAML
- implicit repository-dispatch payload contracts
- string-sentinel workflow tests
- live tests that prove side effects but sometimes miss generated artifact
  semantics
- manual correlation across GitHub runs, PRs, tags, releases, npm, and scratch
  repo state

Recommended architecture: keep YAML as orchestration, but move critical behavior
into small testable scripts, validate cross-repo payloads as contracts, and add a
release propagation checker that explains current state and replay actions.

## Error taxonomy

### API quota and GitHub CLI path failures

Related errors: E001, E019, E023, E024.

Simple reads used `gh` commands that rely on GraphQL internally. When the shared
GraphQL quota was exhausted, live adoption and status checks failed even though
the underlying operation could have used REST.

Current mitigation:

- REST-first paths were added for simple PR reads/writes.
- GraphQL fallback is now bounded to rate-limit-shaped failures.
- Logs identify REST versus GraphQL fallback paths.

Remaining concern:

- Most fallback logic still lives in inline YAML shell.
- Local tests mostly check for strings such as `GraphQL fallback`, not actual
  control flow.

### Silent release propagation failure

Related errors: E009, E010, E013.

The engine publish workflow successfully published npm, but the action dispatch
silently failed because `GH_TOKEN` was empty and `continue-on-error: true` hid
the failure. After manual replay, the action sync workflow accepted the event but
had an empty `ENGINE_REF` because payload fields did not match.

Current mitigation:

- Dispatch token is preflighted before `npm publish`.
- Dispatch after publish is fatal, retried, and prints a manual replay command.
- Action sync accepts `client_payload.version`.
- Downstream dispatch passes `library_ref` from `.contributors-please-engine-ref`.

Remaining concern:

- npm publish can still complete before action propagation completes.
- This is now visible, but it is not transactional.
- Payload shapes are still implicit and spread across YAML.

### Release-state ordering hazards

Related errors: E002, E003, E007, E015, E016, E017, E028.

The tag, npm package, GitHub Release, action sync branch, action PR, action main,
and downstream tests can exist in different states. Some red checks were expected
intermediate states, but the system did not explain them clearly.

Current mitigation:

- The release was manually brought to a consistent final state.

Remaining concern:

- There is no first-class read-only state checker that says whether the release
  is incomplete, expected-stale, or broken.

### Downstream observability and run correlation

Related errors: E011, E012, E018.

The wrapper and child suite relationship required manual log and artifact
inspection. Downstream discovery currently depends on matching run names that
include `source_run_id`.

Current mitigation:

- The wrapper dispatches `source_run_id`.
- The wrapper waits for the downstream suite and uses
  `gh run watch --exit-status --interval 15`.

Remaining concern:

- Tests assert dispatch strings but do not fully prove the wait and failure
  propagation contract.
- Run discovery by display title is workable but fragile.

### Generated artifact semantics

Related finding: malformed `CONTRIBUTORS.md` review comment.

The live adoption workflow proved that a PR opened and included
`CONTRIBUTORS.md`, but it did not verify that the content matched the configured
template and state records.

Current mitigation:

- `contributors-please-test` now sets `columns_per_row: 1`.
- The live workflow checks the PR branch `CONTRIBUTORS.md` against the non-bot
  records from `.contributors.jsonl`.

Remaining concern:

- Similar semantic assertions should be added anywhere a workflow currently only
  checks file presence.

## Test validity assessment

The tests are valid, but their confidence level varies by layer.

Strong behavior tests:

- `runAction` unit tests in `contributors-please-action`.
- `check-engine-sync` diagnosis tests.
- Pure helper tests for sync branch names, planned files, and engine ref
  resolution.
- Live adoption side-effect tests against the scratch repo.

Useful but weaker contract tests:

- YAML parser tests for triggers, permissions, env, and required payload fields.
- Workflow tests checking that known fallback/replay markers exist.

Weakest areas:

- REST/GraphQL fallback tests based mainly on string sentinels.
- Downstream wait/correlation tests that do not fully simulate child-run
  discovery failure.
- Live tests that invoke `node dist/index.js` directly, which proves the bundle
  but not the consumer `uses:` path in `action.yml`.

## Recommended implementation order

### 1. Add one live adoption leg that invokes the action through `uses:`

Status: not done.

Why first:

The live adoption harness currently invokes:

```bash
node "${ACTION_PATH}/dist/index.js"
```

That proves the bundle and `INPUT_*` environment variables work, but it does not
prove the GitHub Action consumer boundary:

- `action.yml`
- `runs.using`
- `runs.main`
- input wiring through `uses:`

Important constraint:

The direct `node dist/index.js` design was intentional because a normal `uses:`
step runs in the workflow repository context. The harness needs to target the
scratch repo, not mutate `contributors-please-test`.

Plan:

1. Keep the existing direct `node dist/index.js` path as a bundle-entrypoint and
   scratch-repo retargeting test.
2. Add one small `uses:` leg that is safe to run in the harness context.
3. Use the action's explicit `repository` input to target:

   ```yaml
   repository: ${{ env.TARGET_OWNER }}/${{ env.TARGET_REPO }}
   ```

4. Make this leg narrow. It does not need to duplicate the full live adoption
   matrix.
5. Verify that outputs are emitted through the real action metadata path.
6. Keep the direct Node path only for behavior that cannot be safely expressed
   through `uses:`.

Likely files:

- `contributors-please-test/.github/workflows/live-adoption.yml`
- `contributors-please-test/scripts/validate-workflows.mjs`
- `contributors-please-action/test/package-metadata.test.ts` if additional
  metadata checks are needed

Validation:

- `node scripts/validate-workflows.mjs` in `contributors-please-test`
- live `live-adoption.yml` dispatch
- inspect generated PR files from `contributors-please-e2e`
- confirm action outputs from the `uses:` leg

Acceptance criteria:

- At least one live job step uses the action through `uses:`.
- That step targets the scratch repo explicitly.
- It cannot modify `contributors-please-test` generated files by accident.
- The existing direct Node path still works.

Risks:

- A `uses:` step may still bind some GitHub context to the workflow repo.
- If the repository input is insufficient for all operations, the leg should
  stay narrow and expose the limitation instead of replacing the existing live
  path.

### 2. Expand artifact-content assertions in live adoption

Status: partially done in `contributors-please-test` commit `7c1c714`.

Why second:

The malformed `CONTRIBUTORS.md` issue proved that "PR opened and files changed"
is not enough. The live test must verify the generated artifacts semantically.

Done:

- Live fixture now sets:

  ```yaml
  columns_per_row: 1
  ```

- Pull-request verification fetches `CONTRIBUTORS.md` and `.contributors.jsonl`
  from the PR branch.
- The workflow asserts rendered rows match non-bot records in state.
- Live validation passed in run `27656020118`.

Plan:

1. Keep the new assertion in `live-adoption.yml`.
2. Extend semantic checks to commit-mode output, not only pull-request mode.
3. Add checks for:
   - one rendered row per expected record
   - no bot records unless unignored
   - configured sort order
   - configured template fields
   - final newline
4. Store the actual generated `CONTRIBUTORS.md` and expected output as artifacts
   on failure.

Likely files:

- `contributors-please-test/.github/workflows/live-adoption.yml`
- `contributors-please-test/scripts/validate-workflows.mjs`

Validation:

- `node scripts/validate-workflows.mjs`
- live `live-adoption.yml` dispatch
- artifact inspection on failure

Acceptance criteria:

- The live workflow fails if contributors are concatenated onto one row.
- The live workflow fails if bot records appear unexpectedly.
- The live workflow fails if `.contributors.jsonl` and `CONTRIBUTORS.md` drift.

Risks:

- Assertion logic can duplicate renderer logic. Keep it simple and focused on
  observable output, not full engine reimplementation.

### 3. Strengthen downstream dispatch, wait, and correlation tests

Status: not done.

Why third:

The parent wrapper must not go green unless the downstream orchestrator is found
and succeeds. Current workflow behavior is better than the tests proving it.

Plan:

1. Extend `downstream-e2e-workflow.test.ts` to assert:
   - `SOURCE_RUN_ID` is set
   - `source_run_id` is sent in the dispatch payload
   - `library_ref` is sent in the dispatch payload
   - `Wait for downstream suite` step exists
   - run discovery filters on `SOURCE_RUN_ID`
   - `gh run watch --exit-status --interval 15` is used
   - missing child run fails the wrapper
2. Prefer moving wait logic into a script before adding many more string checks.
3. If the logic remains in YAML temporarily, keep tests focused on durable
   behavior markers, not human log phrasing.

Likely files:

- `contributors-please-action/.github/workflows/downstream-e2e.yml`
- `contributors-please-action/test/downstream-e2e-workflow.test.ts`
- optional `contributors-please-action/scripts/wait-downstream-suite.mjs`

Validation:

- `npm test -- test/downstream-e2e-workflow.test.ts`
- `npm run check`
- one manual `downstream-e2e.yml` dispatch

Acceptance criteria:

- A missing downstream run is a hard failure.
- A failed downstream run is a hard failure.
- The parent workflow logs the source run id, action ref, and library ref.

Risks:

- Display-title matching can race. This step should either document the current
  limitation or move to a more deterministic REST lookup.

### 4. Extract GitHub API fallback behavior into testable helpers

Status: not done.

Why fourth:

GraphQL quota failures caused multiple avoidable failures. The immediate
REST-first fixes work, but the fallback behavior is copied through inline shell.

Plan:

1. Add a small helper, for example:

   ```text
   contributors-please-action/scripts/github-api.mjs
   ```

2. Include:
   - `isRateLimitError(stderr, status)`
   - `runGh(args, options)`
   - `withRateLimitFallback(restFn, graphqlFn, label)`
   - `withRetry(fn, { attempts, backoff })`
   - API-path logging
3. Start with read paths:
   - PR lookup
   - PR file listing
   - issue label reads
4. Only add write fallback where the operation is idempotent or safely
   retryable.
5. Replace duplicated inline snippets gradually.

Likely files:

- `contributors-please-action/scripts/github-api.mjs`
- `contributors-please-action/test/github-api.test.ts`
- `contributors-please-action/.github/workflows/e2e.yml`
- `contributors-please-action/.github/workflows/sync-engine-release.yml`
- later equivalent helper in `contributors-please-test` or a copied minimal
  helper there

Validation:

- mocked-`gh` tests:
  - REST success does not call GraphQL
  - REST rate-limit calls GraphQL
  - REST fatal error does not call GraphQL
  - fallback failure fails loudly
  - logs identify selected path
- `npm run check`
- one workflow dispatch that exercises normal REST path

Acceptance criteria:

- Fallback happens only for known transient/rate-limit failures.
- Every API decision logs REST or GraphQL fallback.
- Unit tests prove fallback control flow without live GitHub.

Risks:

- Helpers can become too generic. Keep them narrow and workflow-driven.
- Mock tests do not replace live E2E; they only prove control flow.

### 5. Migrate the first workflow API read path to a helper-backed script

Status: not done.

Why fifth:

Creating `scripts/github-api.mjs` proves fallback behavior in isolation, but it
does not reduce workflow fragility until at least one inline REST/GraphQL block
is replaced. Migrate one read-only path first so the helper is exercised without
mixing in write-side risks.

Plan:

1. Create `scripts/e2e-pr-snapshot.mjs`.
2. Use `scripts/github-api.mjs` inside it for REST-first PR snapshot lookup with
   GraphQL fallback on rate-limit-shaped failures.
3. Replace the PR snapshot creation portion of `.github/workflows/e2e.yml`.
4. Keep the existing assertion block that verifies labels, files, state, and head
   ref.
5. Update workflow tests so they assert the script contract instead of old
   inline REST/GraphQL command strings.

Likely files:

- `contributors-please-action/scripts/e2e-pr-snapshot.mjs`
- `contributors-please-action/test/e2e-pr-snapshot.test.ts`
- `contributors-please-action/.github/workflows/e2e.yml`
- `contributors-please-action/test/e2e-workflow.test.ts`

Validation:

- mocked-`gh` script tests
- `npm test -- test/github-api.test.ts test/e2e-pr-snapshot.test.ts test/e2e-workflow.test.ts`
- `npm run check`

Acceptance criteria:

- PR snapshot read behavior is unit-tested.
- The workflow no longer owns that REST/GraphQL fallback block inline.
- Fatal REST errors do not fall back to GraphQL.

Risks:

- This migrates only one read path. Keep it small intentionally; migrate the
  remaining read/write paths after the pattern is proven.

### 6. Extract dispatch and wait logic into scripts

Status: not done.

Why sixth:

Repository dispatch, retry, replay payloads, and child-run discovery are critical
release behavior. They should be tested as code, not inspected as YAML strings.

Plan:

1. Add:

   ```text
   contributors-please-action/scripts/dispatch-downstream-suite.mjs
   contributors-please-action/scripts/wait-downstream-suite.mjs
   ```

2. `dispatch-downstream-suite.mjs` should:
   - validate required env/input values
   - build the dispatch payload
   - retry with backoff
   - print human replay instructions
   - write a replay JSON artifact
3. `wait-downstream-suite.mjs` should:
   - discover the child run
   - correlate with `source_run_id`
   - fail if not found
   - fail if child run fails
   - log the child run URL and conclusion
4. Update `downstream-e2e.yml` to call the scripts.

Likely files:

- `contributors-please-action/scripts/dispatch-downstream-suite.mjs`
- `contributors-please-action/scripts/wait-downstream-suite.mjs`
- `contributors-please-action/test/dispatch-downstream-suite.test.ts`
- `contributors-please-action/test/wait-downstream-suite.test.ts`
- `contributors-please-action/.github/workflows/downstream-e2e.yml`

Validation:

- mocked-`gh` tests for dispatch success, retry success, retry exhaustion, manual
  replay output, child found, child missing, child failed
- `npm run check`
- live downstream dispatch

Acceptance criteria:

- Replay payload is exact and machine-readable.
- Parent workflow cannot complete successfully unless the child run succeeds.
- Tests no longer depend mainly on YAML string sentinels.

Risks:

- Run discovery is inherently asynchronous. Use created-at windows and exact
  source markers to reduce false matches.

### 7. Add schema-validated cross-repo payload contracts

Status: not done.

Why seventh:

E010 happened because the engine sent one payload shape and the action expected
another. E013 happened because downstream testing did not use the action-declared
engine ref. Those are contract failures.

Plan:

1. Add simple versioned schemas or JS validators for:
   - engine release dispatch payload
   - action downstream dispatch payload
   - live adoption workflow inputs
2. Required engine release payload:
   - `version`
   - source repo/run metadata where available
3. Temporarily accepted aliases:
   - `engine_ref`
   - `tag_name`
   - `release.tag_name`
4. Required action downstream payload:
   - `action_ref`
   - `library_ref`
   - `source_run_id`
5. Fail early with precise errors when required fields are missing.
6. Keep schema dependencies minimal. A hand-written validator is acceptable if
   full JSON Schema support is too heavy for workflow scripts.

Likely files:

- `contributors-please-action/scripts/payload-contracts.mjs`
- `contributors-please-action/test/payload-contracts.test.ts`
- `contributors-please-action/.github/workflows/sync-engine-release.yml`
- `contributors-please-action/.github/workflows/downstream-e2e.yml`
- engine publish workflow in `contributors-please`

Validation:

- unit tests for valid payloads
- unit tests for missing `version`
- unit tests for accepted temporary aliases
- unit tests for missing `library_ref`
- live replay using the documented payload

Acceptance criteria:

- Missing version fails before sync logic runs.
- Missing library ref fails before downstream dispatch.
- Log output tells the operator exactly how to replay.

Risks:

- Schemas can slow iteration if too strict. Version them and keep aliases with
  deprecation notes.

### 8. Add a release propagation state checker and manifest

Status: not done.

Why eighth:

The release process needs one command that explains where propagation currently
stands. This will turn expected intermediate reds into explicit states.

Plan:

1. Add:

   ```text
   contributors-please-action/scripts/check-release-propagation.mjs
   ```

   or, if it belongs more naturally in the engine repo:

   ```text
   contributors-please/scripts/check-release-propagation.mjs
   ```

2. Make the checker read-only by default.
3. Inputs:
   - version, for example `v1.3.1`
   - action repo
   - engine repo
   - test repo
4. Check:
   - npm package version exists
   - engine git tag exists
   - GitHub Release exists
   - engine main contains the version
   - action sync branch/PR exists
   - action `.contributors-please-engine-ref`
   - action main bundled dependency/version
   - downstream wrapper run
   - downstream orchestrator and child suites
5. Output:
   - state table
   - current state name
   - next expected action
   - replay command if applicable
   - run IDs, PR URLs, commit SHAs
6. Add a JSON mode for artifacts.

State examples:

- `no-tag`
- `tagged-not-published`
- `published-no-github-release`
- `github-release-no-action-dispatch`
- `action-sync-pr-open`
- `action-main-stale`
- `downstream-running`
- `complete`

Likely files:

- `contributors-please-action/scripts/check-release-propagation.mjs`
- `contributors-please-action/test/check-release-propagation.test.ts`
- optional docs update in `docs/RUNBOOK.md`

Validation:

- mocked GitHub/npm responses for each state
- one live read-only run against v1.3.1
- compare output to known final evidence

Acceptance criteria:

- One command can explain whether a release is complete.
- Expected stale states are clearly separated from real failures.
- Replay commands are exact.

Risks:

- The checker can become stale if it duplicates too much workflow knowledge.
  Keep it focused on observable external state.

### 9. Split live testing lanes

Status: not done.

Why last:

Splitting lanes before contracts and helper scripts are clean would spread the
same ambiguity across more workflows. Do this after the behavioral seams are
clear.

Plan:

1. Define a fast PR/ref validation lane.
2. Define a full release/live-adoption lane.
3. Fast lane should verify:
   - bundle reproducibility
   - action-declared engine ref is used
   - one `uses:` action invocation
   - downstream dispatch/wait contract
4. Full lane should verify:
   - all downstream grouped suites
   - live adoption side effects
   - generated artifact semantics
   - release propagation manifest
5. Make required checks explicit in branch protection/release process docs.

Likely files:

- `contributors-please-action/.github/workflows/downstream-e2e.yml`
- `contributors-please-test/.github/workflows/action-downstream-suite.yml`
- `contributors-please-test/.github/workflows/live-adoption.yml`
- `contributors-please-action/docs/RUNBOOK.md`

Validation:

- PR dispatch uses fast lane.
- release/main dispatch uses full lane.
- required check names are stable.
- failure in either lane blocks the correct gate.

Acceptance criteria:

- PR validation remains fast and focused.
- Release validation remains comprehensive.
- Live tests do not hide behind unit tests, and unit tests do not depend on live
  GitHub to prove fallback logic.

Risks:

- Misconfigured required checks can reduce confidence. Document exactly which
  lane gates which operation.

## Suggested work packages

### Package A: close live test coverage gaps

Includes phases 1 and 2.

Deliverables:

- one `uses:` live adoption leg
- semantic artifact assertions for commit and PR modes
- validator updates
- one successful live adoption run

Expected impact:

- closes the strongest test-validity gap
- prevents malformed generated artifacts from passing live adoption

### Package B: harden downstream orchestration

Includes phases 3 and 6.

Deliverables:

- stronger downstream workflow tests
- dispatch helper
- wait helper
- replay JSON artifact
- live downstream E2E proof

Expected impact:

- parent wrapper cannot pass without child success
- dispatch/wait behavior becomes unit-testable

### Package C: harden GitHub API behavior

Includes phases 4 and 5.

Deliverables:

- REST-first helper
- rate-limit fallback helper
- mocked-`gh` tests
- workflow migration for PR reads/updates

Expected impact:

- prevents GraphQL quota issues from breaking simple workflow operations
- reduces duplicated inline shell

### Package D: formalize contracts and release state

Includes phases 7 and 8.

Deliverables:

- payload validators
- release propagation checker
- JSON manifest mode
- runbook update

Expected impact:

- prevents payload drift
- makes release propagation resumable and explainable

### Package E: split lanes

Includes phase 9.

Deliverables:

- fast PR/ref lane
- full release/live lane
- required-check documentation

Expected impact:

- reduces noisy PR validation while preserving strong release confidence

## Agentic implementation task checklist

Use this checklist in order. Each task should be implemented and verified before
starting the next task. Prefer one commit per task unless a task is split across
repositories, in which case commit each repository separately.

### Execution preconditions

Before implementing any task:

- Start from an up-to-date checkout or a fresh worktree based on
  `origin/main`. This plan was reviewed against `contributors-please-action`
  main `8a43887ad9bb186484bea37045c1486c774dff32`.
- Do not run a live `workflow_dispatch` against `--ref main` until the workflow
  changes being tested have been pushed to `main`. If working on a branch, push
  the branch and dispatch with `--ref <branch>`.
- For cross-repo tasks, commit and push each repository independently before
  running live validation that depends on that repository's workflow file.
- Use local temp caches for GitHub and npm commands when sandbox or permissions
  issues appear:

  ```bash
  export XDG_CACHE_HOME=/private/tmp/gh-cache
  export npm_config_cache=/private/tmp/contributors-please-npm-cache
  ```

- Do not poll GitHub run status more frequently than every 15 seconds. This
  applies to manual monitoring and to new workflow polling loops added by this
  plan.

### Task 1: Add a real `uses:` live adoption leg

**Files:**

- Modify: `../contributors-please-test/.github/workflows/live-adoption.yml`
- Modify: `../contributors-please-test/scripts/validate-workflows.mjs`
- Reference: `action.yml`
- Reference: `src/index.ts`

- [ ] **Step 1: Verify the current action input names**

  Run:

  ```bash
  sed -n '1,220p' action.yml
  rg -n 'repository|mode|output-file|state-file|config-file|bootstrap|unignore|pat' src/index.ts action.yml
  ```

  Expected: `action.yml` exposes `repository`, `mode`, `dry-run`, `output-file`,
  `state-file`, `config-file`, `bootstrap`, `unignore`, and `pat` inputs (verified
  present at HEAD `8a43887`; `dry-run` is `action.yml:96`).

- [ ] **Step 2: Add the narrow `uses:` smoke leg**

  In `../contributors-please-test/.github/workflows/live-adoption.yml`, after
  the action checkout and after the scratch repo has `.contributors.yml`, add a
  step shaped like (the step MUST be in the same job as, and after, the action
  checkout to `${ACTION_PATH}` = `.github/actions/contributors-please-action`,
  since the local `uses: ./path` resolves the action from the checked-out path):

  ```yaml
      - name: Run action metadata smoke
        id: action-metadata-smoke
        uses: ./.github/actions/contributors-please-action
        with:
          pat: ${{ secrets.CONTRIBUTORS_PLEASE_E2E_TOKEN }}
          repository: ${{ env.TARGET_OWNER }}/${{ env.TARGET_REPO }}
          mode: check
          dry-run: true
          bootstrap: true
          output-file: CONTRIBUTORS.md
          state-file: .contributors.jsonl
          config-file: .contributors.yml
          unignore: ${{ steps.target-actor.outputs.login }}
  ```

  Keep this as a smoke leg. Do not replace the direct `node dist/index.js` live
  path in this task. `dry-run: true` is required because `check` mode fails when
  generated files are stale; the smoke leg is proving action metadata wiring, not
  enforcing freshness. `dry-run: true` is also confirmed non-mutating: `src/index.ts`
  skips "commit, push, label, and pull request side effects" under dry-run
  (`src/index.ts:547`), so this leg cannot open a scratch PR or push a branch.

- [ ] **Step 3: Assert the `uses:` leg emitted outputs**

  Add a following shell step:

  ```yaml
      - name: Verify action metadata smoke outputs
        env:
          CHANGED: ${{ steps.action-metadata-smoke.outputs.changed }}
          CONTRIBUTORS_JSON: ${{ steps.action-metadata-smoke.outputs.contributors-json }}
        run: |
          set -euo pipefail
          test -n "${CHANGED}"
          test -n "${CONTRIBUTORS_JSON}"
          node -e 'const contributors=JSON.parse(process.env.CONTRIBUTORS_JSON); if (!Array.isArray(contributors)) process.exit(1);'
  ```

- [ ] **Step 4: Add validator markers**

  In `../contributors-please-test/scripts/validate-workflows.mjs`, add markers
  for:

  ```text
  Run action metadata smoke
  uses: ./.github/actions/contributors-please-action
  dry-run: true
  Verify action metadata smoke outputs
  ```

- [ ] **Step 5: Run local validation**

  Run:

  ```bash
  cd ../contributors-please-test
  node scripts/validate-workflows.mjs
  git diff --check
  ruby -e 'require "yaml"; YAML.load_file(".github/workflows/live-adoption.yml"); puts "live-adoption.yml YAML parsed"'
  ```

  Expected: validator succeeds, diff check has no output, YAML parse prints
  `live-adoption.yml YAML parsed`.

- [ ] **Step 6: Commit and push**

  ```bash
  cd ../contributors-please-test
  git add .github/workflows/live-adoption.yml scripts/validate-workflows.mjs
  git commit -m "ci: exercise action metadata in live adoption"
  git push origin main
  ```

- [ ] **Step 7: Live validate**

  Run:

  `gh workflow run` does not print the created run URL/ID — it only emits a
  confirmation to stderr. Dispatch with a unique `suite_run_id` marker, then
  discover the run by that marker (do not parse stdout of `gh workflow run`):

  ```bash
  marker="uses-smoke-$(git rev-parse --short HEAD)"
  gh workflow run live-adoption.yml \
    --repo smorinlabs/contributors-please-test \
    --ref main \
    -f action_ref=main \
    -f suite_run_id="$marker"
  # Poll no more often than every 15 seconds for the run carrying this marker.
  sleep 16
  run_id="$(gh run list --workflow live-adoption.yml \
    --repo smorinlabs/contributors-please-test \
    --json databaseId,displayTitle \
    --jq "map(select(.displayTitle | contains(\"$marker\"))) | .[0].databaseId")"
  printf 'run_id=%s\n' "$run_id"
  ```

  Then poll its status (no more often than every 15 seconds):

  ```bash
  gh run view "$run_id" --repo smorinlabs/contributors-please-test --json status,conclusion,url,jobs
  ```

  Expected: run concludes `success` and the `Run action metadata smoke` step is
  successful.

### Task 2: Finish generated artifact assertions across live adoption modes

**Files:**

- Modify: `../contributors-please-test/.github/workflows/live-adoption.yml`
- Modify: `../contributors-please-test/scripts/validate-workflows.mjs`

Do not introduce a helper script in this task. Keep the assertion inline so the
change stays small. Extract a helper only in a later cleanup after both commit
and PR mode assertions are green.

- [ ] **Step 1: Keep the current PR-mode assertion**

  Confirm commit `7c1c714` behavior remains present:

  ```bash
  rg -n 'columns_per_row: 1|pull-request-CONTRIBUTORS.md|unexpected pull request CONTRIBUTORS.md' ../contributors-please-test/.github/workflows/live-adoption.yml
  ```

  Expected: all three markers exist.

- [ ] **Step 2: Add commit-mode artifact assertion**

  > **Caution (TR3).** The block below *re-implements the renderer* (filter `[bot]`,
  > sort by `localeCompare`, apply a hardcoded `{{login}} | {{title}} | {{commits}}`
  > template, join with `\n`). That shares any renderer bug and silently breaks if
  > the fixture's `entry_template` ever drifts from the hardcoded string. It does
  > catch the row-grouping regression (test joins with `\n`; the engine joins with a
  > space when `columns_per_row > 1`), so it is acceptable as a *minimum*. Prefer a
  > **golden file**: commit the expected `CONTRIBUTORS.md` to the fixture and assert
  > byte-equality, regenerating the golden only on intentional template changes. The
  > engine now also warns on the delimiter × `columns_per_row > 1` hazard
  > (`columnsPerRowWarnings`, engine `src/engine/render.ts`), which this assertion
  > complements rather than replaces.

  In the `Verify incremental state rendered and preserved` step, after checking
  the expected logins, add (reimplementation form shown; golden-file form preferred):

  ```bash
          git show HEAD:CONTRIBUTORS.md > test-output/live-adoption/commit-mode-CONTRIBUTORS.md
          git show HEAD:.contributors.jsonl > test-output/live-adoption/commit-mode.contributors.jsonl
          node <<'NODE'
          const fs = require("node:fs");
          const contributors = fs.readFileSync("test-output/live-adoption/commit-mode.contributors.jsonl", "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map(line => JSON.parse(line));
          const expected = contributors
            .filter(contributor => !contributor.login.endsWith("[bot]"))
            .sort((left, right) => left.login.localeCompare(right.login))
            .map(contributor => `${contributor.login} | ${contributor.title} | ${contributor.commits}`)
            .join("\n")
            .concat("\n");
          const actual = fs.readFileSync("test-output/live-adoption/commit-mode-CONTRIBUTORS.md", "utf8");
          if (actual !== expected) {
            throw new Error(`unexpected commit mode CONTRIBUTORS.md\nexpected:\n${expected}\nactual:\n${actual}`);
          }
          NODE
  ```

- [ ] **Step 3: Add validator markers**

  Add markers:

  ```text
  commit-mode-CONTRIBUTORS.md
  unexpected commit mode CONTRIBUTORS.md
  ```

- [ ] **Step 4: Run local validation**

  ```bash
  cd ../contributors-please-test
  node scripts/validate-workflows.mjs
  git diff --check
  ```

  Expected: validator succeeds and diff check has no output.

- [ ] **Step 5: Commit and push**

  ```bash
  cd ../contributors-please-test
  git add .github/workflows/live-adoption.yml scripts/validate-workflows.mjs
  git commit -m "ci: validate live adoption commit output"
  git push origin main
  ```

- [ ] **Step 6: Live validate**

  Dispatch `live-adoption.yml` and verify the run succeeds. Fetch the scratch PR
  `CONTRIBUTORS.md` and `.contributors.jsonl` with REST and confirm the output
  has one non-bot contributor per line.

### Task 3: Strengthen downstream wait and correlation tests

> **Revised (DOC1/TR1).** The original string-`toContain` assertions below are
> *string-sentinel* tests: they prove only that the YAML contains literals it was
> authored to contain, do not simulate child-run discovery/failure, and — worse —
> are **deleted by Task 6**, which moves the dispatch/wait shell into
> `wait-downstream-suite.mjs`. Do not invest in them. Instead:
>
> - Keep **only** a single existence assertion here as a cheap regression net until
>   Task 6 lands: the `Wait for downstream suite` step exists.
> - Move the real coverage to **Task 6**: test `wait-downstream-suite.mjs` directly
>   with a mocked `gh` for child-found / child-missing / child-failed → correct exit
>   code (behavior, not YAML string matching).

**Files:**

- Reference: `.github/workflows/downstream-e2e.yml`
- Modify: `test/downstream-e2e-workflow.test.ts`

- [ ] **Step 1: Assert the wait step exists (regression net only)**

  Use the existing workflow parser pattern to assert the step is present. Do **not**
  add `toContain` assertions on the shell body — Task 6 replaces that body with a
  script and tests its behavior instead.

  ```ts
  const wait = steps.find(step => step.name === "Wait for downstream suite");
  expect(wait).toBeDefined();
  ```

- [ ] **Step 2: Verify the test fails if the wait step is removed**

  Temporarily change the workflow step name in `.github/workflows/downstream-e2e.yml`
  from `Wait for downstream suite` to `Wait for downstream suite disabled`, run
  the test, then restore the workflow file.

  ```bash
  npm test -- test/downstream-e2e-workflow.test.ts
  ```

  Expected while temporarily broken: FAIL mentioning the missing wait-step
  contract. Expected after restore: PASS.

- [ ] **Step 3: Run action checks**

  ```bash
  npm test -- test/downstream-e2e-workflow.test.ts
  npm run check
  ```

  Expected: both commands succeed.

- [ ] **Step 4: Commit**

  ```bash
  git add test/downstream-e2e-workflow.test.ts
  git commit -m "test: assert downstream wait correlation"
  ```

### Task 4: Extract REST-first API fallback helpers

**Files:**

- Create: `scripts/github-api.mjs`
- Create: `test/github-api.test.ts`
- Reference: `.github/workflows/e2e.yml`
- Reference: `.github/workflows/sync-engine-release.yml`

- [ ] **Step 1: Add helper tests first**

  Create `test/github-api.test.ts` with tests for:

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { isRateLimitError, withRateLimitFallback } from "../scripts/github-api.mjs";

  // RC1/TR2: isRateLimitError takes (message, status). Rate limits frequently
  // surface as a bare HTTP 403/429 with no rate-limit text, so the status arg is
  // required — a message-only matcher fails fatally on exactly the case the helper
  // exists to handle. The message strings below match by construction (circular),
  // so the status-code and over-fallback cases are the ones that actually prove
  // behavior.
  describe("isRateLimitError", () => {
    it("detects rate limits by message text", () => {
      expect(isRateLimitError("API rate limit exceeded")).toBe(true);
      expect(isRateLimitError("secondary rate limit")).toBe(true);
      expect(isRateLimitError("abuse detection mechanism")).toBe(true);
      expect(isRateLimitError("not found")).toBe(false);
    });

    it("detects status-only rate limits with no rate-limit text", () => {
      expect(isRateLimitError("", 429)).toBe(true);
      expect(isRateLimitError("", 403)).toBe(true);
    });

    it("does not treat a genuine 403 authorization failure as a rate limit", () => {
      // Guard against over-fallback: a 403 whose body is a real permission error,
      // not a rate limit, must stay fatal. Distinguish via body text and/or the
      // presence of a Retry-After / x-ratelimit-remaining: 0 signal at the call site.
      expect(isRateLimitError("Resource not accessible by integration", 403)).toBe(false);
    });
  });

  describe("withRateLimitFallback", () => {
    it("uses REST success without GraphQL", async () => {
      const rest = vi.fn(async () => "rest-ok");
      const graphql = vi.fn(async () => "graphql-ok");
      await expect(withRateLimitFallback(rest, graphql, "PR lookup")).resolves.toBe("rest-ok");
      expect(graphql).not.toHaveBeenCalled();
    });

    it("falls back only on rate-limit-shaped REST errors", async () => {
      const error = new Error("API rate limit exceeded");
      const rest = vi.fn(async () => { throw error; });
      const graphql = vi.fn(async () => "graphql-ok");
      await expect(withRateLimitFallback(rest, graphql, "PR lookup")).resolves.toBe("graphql-ok");
    });

    it("does not fall back on fatal REST errors", async () => {
      const error = new Error("validation failed");
      const rest = vi.fn(async () => { throw error; });
      const graphql = vi.fn(async () => "graphql-ok");
      await expect(withRateLimitFallback(rest, graphql, "PR lookup")).rejects.toThrow("validation failed");
      expect(graphql).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] **Step 2: Implement minimal helper**

  Create `scripts/github-api.mjs` with exports:

  ```js
  // (message, status): a rate limit may arrive as a 403/429 with no rate-limit
  // text. A genuine 403 authorization failure must NOT fall back, so a bare 403 is
  // treated as rate-limit-shaped only when the message lacks an authorization
  // signal (callers should additionally gate on Retry-After / x-ratelimit-remaining
  // when available).
  const RATE_LIMIT_TEXT = /rate limit|secondary rate|abuse detection/i;
  const AUTHZ_FAILURE_TEXT = /not accessible|not authorized|forbidden|bad credentials/i;

  export function isRateLimitError(message, status) {
    const text = String(message ?? "");
    if (RATE_LIMIT_TEXT.test(text)) return true;
    if (status === 429) return true;
    if (status === 403) return !AUTHZ_FAILURE_TEXT.test(text);
    return false;
  }

  export async function withRateLimitFallback(rest, graphql, label, logger = console.error) {
    try {
      const result = await rest();
      logger(`${label} API path: REST`);
      return result;
    } catch (error) {
      // error.status is set by gh/octokit-style errors; fall back to parsing stderr.
      if (!isRateLimitError(error?.message ?? error, error?.status)) {
        throw error;
      }
      logger(`${label} REST hit a rate limit; using GraphQL fallback.`);
      const result = await graphql();
      logger(`${label} API path: GraphQL fallback`);
      return result;
    }
  }
  ```

  SEC3 acceptance for this and every helper script below: never print
  `process.env`, `argv`, or a raw token; redact token-shaped strings from any error
  output. Replay output prints `${GH_TOKEN}` as a literal reference, never its value.

- [ ] **Step 3: Run helper tests**

  ```bash
  npm test -- test/github-api.test.ts
  ```

  Expected: all helper tests pass.

- [ ] **Step 4: Record the first migration target without changing workflow behavior**

  Add a short comment to `scripts/github-api.mjs` naming the first workflow
  migration target:

  ```js
  // First migration target: the "Verify pull request and label" REST/GraphQL
  // block in .github/workflows/e2e.yml.
  ```

  Do not edit workflow YAML in this task. The helper API should be proven first;
  Task 5 performs the first workflow migration with a dedicated workflow script
  and its own tests.

- [ ] **Step 5: Run workflow tests and full check**

  ```bash
  npm test -- test/e2e-workflow.test.ts test/github-api.test.ts
  npm run check
  ```

  Expected: all tests and check pass.

- [ ] **Step 6: Commit**

  ```bash
  git add scripts/github-api.mjs test/github-api.test.ts
  git commit -m "ci: test REST fallback helper"
  ```

### Task 5: Migrate first workflow API read path to a helper-backed script

**Files:**

- Create: `scripts/e2e-pr-snapshot.mjs`
- Create: `test/e2e-pr-snapshot.test.ts`
- Modify: `.github/workflows/e2e.yml`
- Modify: `test/e2e-workflow.test.ts`
- Reference: `scripts/github-api.mjs`

- [ ] **Step 1: Add script tests first**

  Test `scripts/e2e-pr-snapshot.mjs` with a fake command runner or fake `gh`
  executable. Cover:

  - REST success writes a JSON snapshot containing files, labels, head ref,
    state, title, and URL.
  - REST rate-limit failure falls back to GraphQL.
  - REST fatal failure does not fall back.
  - GraphQL fallback failure exits non-zero.

- [ ] **Step 2: Implement the script**

  The script must accept:

  ```text
  TARGET_OWNER
  TARGET_REPO
  PR_NUMBER
  OUT_PATH
  ```

  Note (CD2): the current `Verify pull request and label` step does NOT consume a
  combined snapshot — it writes three `/tmp/pull-request-*.json` temp files and
  asserts inline, checking only the pending label and the changed-file list. So this
  task *creates a new combined snapshot* (and a rewritten assertion block that
  consumes it), it does not mirror an existing shape. The new combined shape is:

  ```json
  {
    "files": [{ "path": ".contributors.jsonl" }],
    "headRefName": "contributors-please/update",
    "labels": [{ "name": "contributors-please: pending" }],
    "state": "open",
    "title": "docs: update contributors",
    "url": "https://github.com/smorinlabs/example/pull/1"
  }
  ```

- [ ] **Step 3: Wire the E2E workflow**

  In `.github/workflows/e2e.yml`, replace the REST/GraphQL snapshot creation
  portion of `Verify pull request and label` with the call below. `TARGET_OWNER`,
  `TARGET_REPO`, and `PR_NUMBER` already exist as job/step env in `e2e.yml`; only
  `OUT_PATH` is new:

  ```yaml
          OUT_PATH=test-output/e2e/pull-request.json \
            node scripts/e2e-pr-snapshot.mjs
  ```

  Replace the inline temp-file assertions with a rewritten block that reads
  `pull-request.json` and checks labels, files, head ref, and state. (The previous
  step only checked the label and file list; the new block adds head ref and state.)

- [ ] **Step 4: Update workflow tests**

  In `test/e2e-workflow.test.ts`, replace string checks for the old inline
  REST/GraphQL commands with checks for:

  ```text
  node scripts/e2e-pr-snapshot.mjs
  OUT_PATH=test-output/e2e/pull-request.json
  ```

- [ ] **Step 5: Run validation**

  ```bash
  npm test -- test/github-api.test.ts test/e2e-pr-snapshot.test.ts test/e2e-workflow.test.ts
  npm run check
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add scripts/e2e-pr-snapshot.mjs test/e2e-pr-snapshot.test.ts .github/workflows/e2e.yml test/e2e-workflow.test.ts
  git commit -m "ci: script E2E pull request snapshot"
  ```

### Task 6: Extract downstream dispatch and wait helpers

**Files:**

- Create: `scripts/dispatch-downstream-suite.mjs`
- Create: `scripts/wait-downstream-suite.mjs`
- Create: `test/dispatch-downstream-suite.test.ts`
- Create: `test/wait-downstream-suite.test.ts`
- Modify: `.github/workflows/downstream-e2e.yml`
- Modify: `test/downstream-e2e-workflow.test.ts`

- [ ] **Step 1: Add dispatch helper tests**

  Tests must cover:

  - missing `GH_TOKEN` fails before dispatch
  - missing `ACTION_REF` fails before dispatch
  - missing `LIBRARY_REF` fails before dispatch
  - retry succeeds on attempt 2
  - retry exhaustion exits non-zero
  - replay JSON includes `action_ref`, `library_ref`, and `source_run_id`

- [ ] **Step 2: Add wait helper tests**

  Tests must cover:

  - matching child run found by `source_run_id`
  - missing child run exits non-zero
  - failed child run exits non-zero
  - successful child run exits zero

- [ ] **Step 3: Implement helpers**

  `dispatch-downstream-suite.mjs` accepts env:

  ```text
  GH_TOKEN
  TARGET_REPO
  TARGET_WORKFLOW
  ACTION_REF
  LIBRARY_REF
  SOURCE_RUN_ID
  SOURCE_WORKFLOW_RUN_ID
  SOURCE_SHA
  SOURCE_WORKFLOW
  ```

  `wait-downstream-suite.mjs` accepts env:

  ```text
  GH_TOKEN
  TARGET_REPO
  TARGET_WORKFLOW
  SOURCE_RUN_ID
  WAIT_FOR_RESULT
  ```

  Both scripts should use only Node standard library plus `child_process` to
  call `gh`. Poll loops inside these scripts must sleep at least 15 seconds
  between GitHub status/list calls.

- [ ] **Step 4: Wire workflow**

  Replace the dispatch and wait shell bodies in `.github/workflows/downstream-e2e.yml`
  with:

  ```yaml
      - uses: actions/setup-node@v6
        with:
          node-version: 24

      - name: Dispatch downstream suite
        run: node scripts/dispatch-downstream-suite.mjs

      - name: Wait for downstream suite
        run: node scripts/wait-downstream-suite.mjs
  ```

- [ ] **Step 5: Run tests**

  ```bash
  npm test -- test/dispatch-downstream-suite.test.ts test/wait-downstream-suite.test.ts test/downstream-e2e-workflow.test.ts
  npm run check
  ```

  Expected: all tests and check pass.

- [ ] **Step 6: Commit and push the workflow ref under test**

  ```bash
  git add scripts/dispatch-downstream-suite.mjs scripts/wait-downstream-suite.mjs test/dispatch-downstream-suite.test.ts test/wait-downstream-suite.test.ts .github/workflows/downstream-e2e.yml test/downstream-e2e-workflow.test.ts
  git commit -m "ci: script downstream dispatch and wait"
  git push origin HEAD
  ```

- [ ] **Step 7: Live validate**

  Dispatch `downstream-e2e.yml` from `contributors-please-action` and verify the
  wrapper and child suite both succeed. If this task is on a branch, dispatch the
  workflow with `--ref <branch>` so GitHub runs the changed workflow file.

### Task 7: Add cross-repo payload contract validation

**Files:**

- Create: `scripts/payload-contracts.mjs`
- Create: `test/payload-contracts.test.ts`
- Modify: `.github/workflows/sync-engine-release.yml`
- Modify: `.github/workflows/downstream-e2e.yml`
- Modify in engine repo: `../contributors-please/.github/workflows/publish.yml`

- [ ] **Step 1: Write contract tests**

  Cover:

  - valid engine release payload with `version`
  - accepted temporary alias `engine_ref`
  - accepted temporary alias `tag_name`
  - accepted temporary alias `release.tag_name`
  - missing engine version fails with `engine release payload requires version`
  - valid downstream payload with `action_ref`, `library_ref`, `source_run_id`
  - missing `library_ref` fails with `downstream payload requires library_ref`

- [ ] **Step 2: Implement validators**

  Implement:

  ```js
  function requiredString(value, message) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      throw new Error(message);
    }
    return normalized;
  }

  export function resolveEngineReleaseVersion(payload = {}) {
    return requiredString(
      payload.version ??
        payload.engine_ref ??
        payload.tag_name ??
        payload.release?.tag_name,
      "engine release payload requires version"
    );
  }

  export function validateDownstreamPayload(payload = {}) {
    return {
      action_ref: requiredString(
        payload.action_ref,
        "downstream payload requires action_ref"
      ),
      library_ref: requiredString(
        payload.library_ref,
        "downstream payload requires library_ref"
      ),
      source_run_id: requiredString(
        payload.source_run_id,
        "downstream payload requires source_run_id"
      ),
    };
  }
  ```

  Keep validation dependency-free.

- [ ] **Step 3: Wire action workflows**

  Use the validator before sync or dispatch logic runs. Fail early with the
  validator message.

- [ ] **Step 4: Wire engine publish workflow**

  Ensure the dispatch payload uses canonical `version`, and keep aliases only on
  the receiver side.

- [ ] **Step 5: Run tests**

  ```bash
  npm test -- test/payload-contracts.test.ts test/sync-engine-release.test.ts test/downstream-e2e-workflow.test.ts
  npm run check
  ```

- [ ] **Step 6: Commit per repo**

  In `contributors-please-action`:

  ```bash
  git add scripts/payload-contracts.mjs test/payload-contracts.test.ts .github/workflows/sync-engine-release.yml .github/workflows/downstream-e2e.yml
  git commit -m "ci: validate cross-repo payload contracts"
  ```

  In `contributors-please`:

  ```bash
  git add .github/workflows/publish.yml
  git commit -m "ci: send canonical action dispatch payload"
  ```

### Task 8: Add release propagation checker

**Files:**

- Create: `scripts/check-release-propagation.mjs`
- Create: `test/check-release-propagation.test.ts`
- Modify: `docs/RUNBOOK.md`

- [ ] **Step 1: Add state tests**

  Tests must cover these states:

  ```text
  no-tag
  tagged-not-published
  published-no-github-release
  github-release-no-action-dispatch
  action-sync-pr-open
  action-main-stale
  downstream-running
  complete
  ```

  Define the state predicates in the test file before implementing the checker:

  - `no-tag`: remote engine tag is absent.
  - `tagged-not-published`: tag exists but npm package version is absent.
  - `published-no-github-release`: npm exists but GitHub Release tag lookup is
    absent.
  - `github-release-no-action-dispatch`: GitHub Release exists but no action
    sync branch, PR, or recent sync workflow run exists for the version.
  - `action-sync-pr-open`: sync PR exists and action main is still stale.
  - `action-main-stale`: latest engine release is newer than action main and no
    current sync PR is open.
  - `downstream-running`: action main is current and downstream wrapper or child
    suite is in progress.
  - `complete`: npm, tag, GitHub Release, action main, and downstream checks all
    match the requested version.

- [ ] **Step 2: Implement read-only checker**

  The checker should accept:

  ```bash
  node scripts/check-release-propagation.mjs --version v1.3.1 --json
  ```

  Output JSON keys:

  ```json
  {
    "version": "v1.3.1",
    "state": "complete",
    "npm": {},
    "engine": {},
    "action": {},
    "downstream": {},
    "nextAction": "",
    "replayCommand": ""
  }
  ```

- [ ] **Step 3: Add human table output**

  Plain output must include npm, tag, GitHub Release, action ref, action PR,
  downstream wrapper, downstream orchestrator, and next action.

- [ ] **Step 4: Document in runbook**

  Add a runbook section:

  ```bash
  XDG_CACHE_HOME=/private/tmp/gh-cache node scripts/check-release-propagation.mjs --version v1.3.1
  ```

- [ ] **Step 5: Run tests and live read-only check**

  ```bash
  npm test -- test/check-release-propagation.test.ts
  XDG_CACHE_HOME=/private/tmp/gh-cache node scripts/check-release-propagation.mjs --version v1.3.1
  ```

  Expected for v1.3.1: state `complete`.

- [ ] **Step 6: Commit**

  ```bash
  git add scripts/check-release-propagation.mjs test/check-release-propagation.test.ts docs/RUNBOOK.md
  git commit -m "ci: add release propagation checker"
  ```

### Task 9: Split fast and full live testing lanes

**Files:**

- Modify: `.github/workflows/downstream-e2e.yml`
- Modify: `../contributors-please-test/.github/workflows/action-downstream-suite.yml`
- Modify: `../contributors-please-test/.github/workflows/live-adoption.yml`
- Modify: `docs/RUNBOOK.md`
- Modify: `../contributors-please-test/scripts/validate-workflows.mjs`

- [ ] **Step 1: Define lane inputs**

  Add an input named `suite_scope` with accepted values:

  ```text
  fast
  full
  ```

  Add it to both `workflow_dispatch` inputs and repository-dispatch payload
  handling where applicable. Default to `full` for release/main propagation and
  `fast` only for explicit PR/ref validation.

- [ ] **Step 2: Fast lane behavior**

  Fast lane must run:

  - bundle reproducibility
  - action-declared engine ref check
  - one `uses:` live smoke
  - downstream dispatch/wait contract

- [ ] **Step 3: Full lane behavior**

  Full lane must run:

  - all grouped downstream suites
  - live adoption side effects
  - generated artifact semantic checks
  - release propagation checker

- [ ] **Step 4: Update validators**

  `validate-workflows.mjs` must assert both `suite_scope` values and the required
  workflow names for each scope. Any run-discovery loop changed in this task must
  sleep at least 15 seconds between GitHub API/list calls.

- [ ] **Step 5: Run local validation**

  ```bash
  npm run check
  cd ../contributors-please-test
  node scripts/validate-workflows.mjs
  git diff --check
  ```

- [ ] **Step 6: Commit and push per repo**

  Commit action repo and test repo separately with:

  ```bash
  git add .github/workflows/downstream-e2e.yml docs/RUNBOOK.md
  git commit -m "ci: split downstream validation lanes"
  ```

  In `../contributors-please-test`:

  ```bash
  git add .github/workflows/action-downstream-suite.yml .github/workflows/live-adoption.yml scripts/validate-workflows.mjs
  git commit -m "ci: split downstream validation lanes"
  git push origin HEAD
  ```

- [ ] **Step 7: Live validate both lanes**

  Dispatch fast lane first, then full lane from the pushed ref. Poll no more
  often than every 15 seconds. Record run IDs in the final implementation note.

## Validation baseline for future changes

Local checks:

```bash
npm run check
```

For `contributors-please-test`:

```bash
node scripts/validate-workflows.mjs
git diff --check
```

Focused renderer proof when artifact semantics change. The renderer and its test
live in the **engine** repo, not this action repo, so run it there:

```bash
cd ../contributors-please && npm test -- test/engine/render.test.ts
```

Live checks:

```bash
suite_run_id="manual-$(date -u +%Y%m%d%H%M%S)"
gh workflow run live-adoption.yml \
  --repo smorinlabs/contributors-please-test \
  --ref main \
  -f action_ref=main \
  -f suite_run_id="$suite_run_id"
```

Monitoring rule:

- Do not poll GitHub checks more frequently than every 15 seconds.
- Prefer REST endpoints over GraphQL-backed `gh pr view` or `gh pr list` when
  rate limits are active.
- Use temp caches locally when needed:

  ```bash
  XDG_CACHE_HOME=/private/tmp/gh-cache
  npm_config_cache=/private/tmp/contributors-please-npm-cache
  ```

## Recommendation

Do the work in this order:

1. Add one `uses:` live adoption leg.
2. Finish artifact-content assertions across live adoption modes.
3. Strengthen downstream wait/correlation tests.
4. Extract GitHub API fallback helpers.
5. Migrate the first workflow API read path to a helper-backed script.
6. Extract dispatch/wait helpers.
7. Add payload contract validation.
8. Add release propagation checker and manifest.
9. Split live testing lanes.

The first two steps increase confidence in what the live tests actually prove.
The next three reduce brittleness in the workflows themselves. The final three
turn the multi-repo release process into explicit, reusable infrastructure.
