# Resilience plan — remediation fix plan

> **For agentic workers:** Companion to `contributors-please-action-resilience-analysis.md`
> (the original plan) and `contributors-please-action-resilience-analysis-review.md`
> (the review that produced these findings). This file is the *remediation* plan:
> it fixes the review's findings and corrects/extends the original plan before it is
> executed. Steps use checkbox (`- [ ]`) syntax. Each fix names the finding IDs it
> closes.

Date: 2026-06-16
Reviewed baseline: action repo `8a43887` (= `origin/main`); engine and test repos
verified against **their** `origin/main` (sibling checkouts on disk are stale —
`git fetch` and read `origin/main` before trusting cross-repo state).

**Scope decision (confirmed):** standalone remediation plan; **no code is changed by
this document** — including the security fixes, which are specified here for a later,
deliberate apply.

## Execution status (2026-06-16)

The fixes were subsequently executed in the recommended order. **Edits are applied to
the working trees but NOT committed** (commit when ready; the engine repo also needs
`src/types` + `dist` rebuilt-and-committed via `npm run build`):

- **FP-1 (SEC1/SEC2/SEC4) — APPLIED.** `client_payload.*` and `inputs.action_ref`
  routed through `env:` in `contributors-please-test` (`action-downstream-suite.yml`,
  `live-adoption.yml`); `validate-workflows.mjs` injection guards added (validator
  passes); `ci.yml` got `permissions: { contents: read }`. SEC3 = acceptance added to
  Tasks 4–8 in the plan.
- **FP-1.4 (BR1) — teardown APPLIED; structurally validated, pending one live
  dispatch.** `if: always()` teardown in `e2e.yml` and `live-adoption.yml`; runbook
  reset entry added; dry-run non-mutation confirmed (`src/index.ts:547`). Teardown
  logic passed YAML/validator/workflow tests but has not run against real GitHub.
  Scheduled GC of scratch `main` fixtures = tracked follow-up.
- **FP-2 (RC5) — APPLIED (engine), root cause covered.** `columnsPerRowWarnings`
  warns whenever an entry_template can't be space-joined at columns_per_row > 1
  (`|` delimiter, leading list/heading marker, or newline — including the default
  template), surfaced via the CLI stderr sink; schema documents the default; 6 render
  cases added. Full engine suite green (116 tests).
- **FP-3 (RC1/TR2), FP-4 (DOC1/TR1/TR3), FP-5, FP-6 — APPLIED as plan amendments**
  (the target scripts/tests don't exist until the original plan's tasks run), folded
  into `contributors-please-action-resilience-analysis.md` (Task 4 two-arg helper +
  status tests; Task 3 string tests dropped; Task 2 golden-file caution; Task 5
  snapshot/env wording; Task 1 dry-run/same-job notes; CD3/CD4/DOC6/DOC8 corrected;
  and a "Review remediations applied" section capturing RC2/RC3/RC4/DOC2/DOC3/DOC4).

## Priority ordering

| Pkg | Theme | Closes | Why this order |
|---|---|---|---|
| FP-1 | Security & blast radius | SEC1, SEC2, SEC3, SEC4, BR1 | Real attack surface + irreversible scratch-state risk; cheapest high-value wins; mostly independent of the original plan |
| FP-2 | Engine artifact root cause | RC5 | The one user-facing root cause no task touches; lives in a different repo |
| FP-3 | API fallback correctness | RC1, TR2 | The shipped helper is a regression vs. the plan's own design and its test can't catch it |
| FP-4 | Test strategy correction | DOC1, TR1, TR3 | Stops investing in string-sentinel tests the plan criticizes and Task 6 deletes |
| FP-5 | Plan-document corrections | CD2, CD3, CD4, DOC5, DOC6, DOC7, DOC8 | Factual/accuracy fixes so implementers don't hit dead ends |
| FP-6 | Framing, taxonomy, checker semantics | RC2, RC3, RC4, DOC2/TAX1, DOC3, DOC4 | Honesty of the "resilient" claim; traceability; correct "complete" definition |

FP-1 → FP-2 → FP-3 may proceed in parallel (different repos/files). FP-4–FP-6 are
edits to the plan/tests and should land before the corresponding original-plan tasks
are executed.

---

## FP-1 — Security & blast-radius hardening

Closes **SEC1, SEC2, SEC3, SEC4, BR1**. Independent of the original plan; can ship now.

### FP-1.1 Remove script-injection of dispatch-controlled values (SEC1, SEC2)
**Files (test repo, branch + diffs before commit):**
- `../contributors-please-test/.github/workflows/action-downstream-suite.yml`
- `../contributors-please-test/.github/workflows/live-adoption.yml`

- [ ] In `action-downstream-suite.yml` "Summarize downstream request", move
      `github.event.client_payload.source_repo` and `…source_workflow_run_id` into the
      step's `env:` block and reference `"${SOURCE_REPO}"` / `"${SOURCE_WORKFLOW_RUN_ID}"`
      in the `run:` body — match the safe `ACTION_REF`/`LIBRARY_REF`/`SUITE_RUN_ID`
      lines already in that step.
- [ ] In `live-adoption.yml` "Summarize live adoption evidence", move
      `inputs.action_ref` into `env:` and reference `"${ACTION_REF}"`.
- [ ] Grep both repos for the residual unsafe pattern and fix any others:
      `rg -n '\$\{\{ *github\.event' .github/workflows` and inspect each hit inside a
      `run:` body.

**Acceptance:**
- No `${{ github.event.* }}`, `${{ inputs.* }}`, or `${{ ...client_payload... }}`
  appears inside any `run:` shell body across the three repos; all such values flow
  through `env:`.
- `validate-workflows.mjs` gains an assert that the summarize steps reference
  `"${SOURCE_REPO}"`/`"${ACTION_REF}"` (env form), not the `${{ }}` form.

### FP-1.2 Forbid token leakage in new helper scripts (SEC3)
**Applies to:** every script the original plan creates (`github-api.mjs`,
`dispatch-/wait-downstream-suite.mjs`, `e2e-pr-snapshot.mjs`, `payload-contracts.mjs`,
`check-release-propagation.mjs`).

- [ ] Add to the acceptance criteria of original-plan Tasks 4–8: "Script never prints
      `process.env`, `argv`, or a raw token; any error output redacts token-shaped
      strings. Replay output prints `${GH_TOKEN}` as a literal reference, never its
      value."
- [ ] Add a unit test per script asserting that a forced failure path does not emit the
      token value.

### FP-1.3 Scope `ci.yml` token (SEC4)
- [ ] Add top-level `permissions: { contents: read }` to
      `.github/workflows/ci.yml`. **Acceptance:** `ci.yml` declares explicit
      `permissions`; CI still passes.

### FP-1.4 Teardown and GC for live legs (BR1)
**Files:** `../contributors-please-test/.github/workflows/{live-adoption,e2e}.yml`;
`docs/RUNBOOK.md`.

- [ ] Add an `if: always()` teardown job/step to `live-adoption.yml` and `e2e.yml`:
      close the `contributors-please/update` PR, delete the branch, remove the
      `contributors-please: pending` label. Do **not** wrap in `|| true`; log failures.
- [ ] Add a scheduled GC (or reset-to-pinned-baseline) workflow that prunes accumulated
      synthetic `main` commits in `smorinlabs/contributors-please-e2e`.
- [ ] Add a RUNBOOK "manual scratch reset" entry.
- [ ] Confirm against `src/index.ts` that `dry-run: true` blocks **all** write paths
      (commit, PR create, label apply), not only the commit path; record the result in
      original-plan Task 1.

**Acceptance:** a deliberately-failed live run leaves no open PR/branch/label; scratch
`main` does not grow unbounded; dry-run non-mutation is verified, not assumed.

---

## FP-2 — Fix the artifact-semantics root cause in the engine (RC5)

The malformed `CONTRIBUTORS.md` cause is the engine defaulting `columns_per_row` to
`6` when omitted. Original-plan Tasks 1–2 only change the **test fixture**; real
consumers who omit the field still get row concatenation. This belongs in the engine
repo and no current task touches it.

**Files (engine repo):** `contributors-please` renderer + config schema; tests.
**Confirm first:** the `columns_per_row=6` default was observed in the *bundled*
`dist/contributors-please-lib.js` (`numberValue(root.columns_per_row, 6)`); locate the
corresponding engine **source** file before editing — don't patch the bundle.

- [ ] Decide the fix shape (see "Open decision" below) and implement one of:
      (a) emit a warning when `entry_template` contains a row-internal delimiter (e.g.
      `|`) **and** effective `columns_per_row > 1`; or (b) make `columns_per_row`
      default to `1` when an `entry_template` with a delimiter is configured; or (c)
      require explicit `columns_per_row` whenever a delimited `entry_template` is set.
- [ ] Document the `columns_per_row` default explicitly in the config schema and README.
- [ ] Add an engine unit test for the delimiter × `columns_per_row > 1` interaction.
- [ ] Add a task entry to the original plan (new "Task 0" / engine package) so the
      engine fix is tracked, not just the test-side assertion.

**Acceptance:** a config with a pipe-delimited `entry_template` and omitted
`columns_per_row` no longer silently concatenates rows (warns or defaults safely);
behavior is covered by an engine test.

**Open decision (needs maintainer call):** default 6 may be intentional for grid
layouts, so do **not** blindly flip it — the hazard is the *interaction*. Prefer (a)
warning + explicit doc, escalating to (b)/(c) only if telemetry shows users keep
hitting it.

---

## FP-3 — Correct the rate-limit helper and its test (RC1, TR2)

**Files (original-plan Task 4):** `scripts/github-api.mjs`, `test/github-api.test.ts`.

- [ ] Change `isRateLimitError` to the two-arg form from the plan's own architecture
      (line ~419): `isRateLimitError(message, status)`. Return true when the message
      matches the existing regex **or** `status` is `403`/`429` (treat bare 403 with
      `Retry-After`/empty body as rate-limit-shaped).
- [ ] Update `withRateLimitFallback` to pass the HTTP status from the failed REST call
      into `isRateLimitError`.
- [ ] Add tests that the string-only test cannot cover: `isRateLimitError("", 429)` →
      true; `isRateLimitError("", 403)` → true; a `403` with a genuine "not authorized"
      body that is **not** a rate limit → false (guard against over-fallback); and a
      fallback fixture built from **real** `gh` rate-limit stderr, not a string authored
      to match the regex.

**Acceptance:** fallback fires on status-only rate limits; the detection test fails if
the helper reverts to message-only matching; over-fallback on genuine 403s is guarded.

---

## FP-4 — Replace string-sentinel tests with behavior tests (DOC1, TR1, TR3)

- [ ] **Drop original-plan Task 3's YAML `toContain` assertions.** They prove only that
      the workflow file contains literals it was authored to contain, do not simulate
      child-run discovery/failure, and are deleted when Task 6 moves the logic into
      scripts. Fold Task 3's *intent* into Task 6: test `wait-downstream-suite.mjs`
      directly with a mocked `gh` for child-found / child-missing / child-failed →
      correct exit code. (If a regression net is wanted before Task 6 lands, keep a
      single assert that the `Wait for downstream suite` step *exists*, not its contents.)
- [ ] **Golden-file the Task 2 renderer assertion (TR3).** Replace the in-test
      reimplementation of the renderer (filter/sort/template/join) with an assertion
      against a small golden `CONTRIBUTORS.md` checked into the fixture; regenerate the
      golden only on intentional template changes. This avoids shared-bug blind spots
      and template drift.
- [ ] For Task 6/8 mocked-`gh` tests, require the mock to replay **realistic** `gh`
      output (captured samples), and add at least one assertion on observable behavior
      (exit code / written artifact), not just that a function was called.

**Acceptance:** downstream wait/correlation is proven by script behavior under mocked
`gh`, not by YAML string matches; artifact semantics are checked against a golden file.

---

## FP-5 — Plan-document accuracy corrections (CD2, CD3, CD4, DOC5–DOC8)

Edits to `contributors-please-action-resilience-analysis.md` so implementers don't hit
dead ends. Each is a wording/spec fix, not a behavior change.

- [ ] **CD2** — Task 5: stop claiming the new `e2e-pr-snapshot.mjs` mirrors a shape
      "currently consumed." The current `Verify pull request and label` step writes
      three `/tmp/pull-request-*.json` temp files and checks only the pending label and
      file list. Reword to "create a new combined snapshot consumed by a rewritten
      assertion block," and enumerate the fields the new assertions check.
- [ ] **CD3** — Validation baseline (line ~1717): the renderer proof
      `test/engine/render.test.ts` does not exist in `contributors-please-action`.
      Either remove it or qualify it as an engine-repo command
      (`cd ../contributors-please && npm test -- …`).
- [ ] **CD4** — Task 1 Step 7: `gh workflow run` does not return a run URL/ID. Replace
      the `run_url=$(gh workflow run …)` / `run_id="${run_url##*/}"` pattern with a poll:
      after dispatch, `gh run list --workflow live-adoption.yml --json databaseId,…`
      filtered by the `suite_run_id` marker, then watch that id.
- [ ] **DOC5** — Task 5 wiring: state that `TARGET_OWNER`/`TARGET_REPO`/`PR_NUMBER` come
      from existing job env, or pass them in the snippet alongside `OUT_PATH`.
- [ ] **DOC6** — Task 1 Step 1: add `dry-run` to the expected-inputs list (Step 2 uses
      it; it exists in `action.yml:96`).
- [ ] **DOC7** — Task 1 Step 2: note the new `uses:` step must run in the **same job**
      as, and after, the action checkout to `${ACTION_PATH}`.
- [ ] **DOC8** — Demote "Execution preconditions" from `##` to `###` (or move it above
      the checklist header) so heading nesting is correct.

**Acceptance:** every command/path in the plan resolves in the repo it targets; Task 1
Step 7 produces a usable run id.

---

## FP-6 — Framing, taxonomy, and checker semantics (RC2, RC3, RC4, DOC2/TAX1, DOC3, DOC4)

- [ ] **RC2** — In the taxonomy, relabel Tasks 6/7 as *regression-locks* on the
      already-landed silent-failure fix, not the fix itself. Decide and record whether
      the non-transactional publish→propagation window is **accepted** (documented as a
      known, self-healing-via-sync gap) or **closed** (gate "release complete" on the
      Task 8 checker, or create the GitHub Release only after propagation verifies).
- [ ] **RC3** — Relabel the "Release-state ordering hazards" category as
      *observability for ordering hazards* (Task 8 is read-only and prevents nothing),
      **or** add a task that runs the Task 8 checker as a *required gate* between
      propagation steps. Don't let the "resilient" framing imply prevention it doesn't do.
- [ ] **RC4** — Promote the `source_run_id` + created-at-window correlation to a tested
      contract (assert it *rejects* a same-window run carrying the wrong source marker),
      and document in the RUNBOOK that GitHub's dispatch APIs return no run ID, so some
      heuristic correlation is inherent.
- [ ] **DOC2/TAX1** — Ship the error catalog as an appendix mapping each E### → symptom
      → run/PR/commit → status, **or** renumber contiguously. The referenced set is
      non-contiguous (missing E004–E006, E008, E014, E020–E022, E025–E027); make the
      gaps read as "deferred," not "lost."
- [ ] **DOC3** — In Task 8, define the two version axes (engine library ref vs. action
      package version). Make `complete` mean "engine ref present and propagated, action
      main ≥ requested," not strict equality, so an old-but-fully-propagated release is
      not reported incomplete once main advances.
- [ ] **DOC4** — Document the checker state graph (which states are linear vs.
      terminal/stuck); `action-main-stale` (no PR) is earlier-or-stuck, not later than
      `action-sync-pr-open`.

**Acceptance:** the executive framing distinguishes detection from prevention; the
E-numbers are traceable; the checker's `complete` definition is version-correct.

---

## Validation for this fix plan

- Plan-doc edits (FP-5, FP-6): `git diff --check`; re-read the touched sections.
- Test edits (FP-3, FP-4): `npm run check` plus the targeted `npm test -- <file>` runs
  named in the original tasks.
- Security/teardown (FP-1, FP-1.4): `node scripts/validate-workflows.mjs` in
  `contributors-please-test`; a deliberately-failed live dispatch leaves no residue.
- Engine fix (FP-2): engine repo `npm run check` + the new interaction test.
- Cross-repo rule: `git fetch` and read `origin/main` before validating any sibling-repo
  claim; commit each repo separately; do not live-dispatch `--ref main` until the
  changed workflow is on `main` (per the original plan's execution preconditions).
