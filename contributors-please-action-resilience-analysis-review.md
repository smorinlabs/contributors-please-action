# Resilience plan — quality review

Review of `contributors-please-action-resilience-analysis.md`, audited against the
actual repo at HEAD `8a43887` (= `origin/main`, the SHA the plan pins) plus the
sibling repos `../contributors-please` (engine) and `../contributors-please-test`.

Each finding has: ID, name, type, severity, validity, description, a
counter-argument (why it might *not* be a problem), and a recommendation.

Severity = impact if unaddressed. Validity = confidence it is real.

---

## A. Does the plan fix the root causes it names?

The plan's "Error taxonomy" names five root-cause categories. Verdict per category:

| Cause | Verdict | One-line reason |
|---|---|---|
| API quota / GraphQL paths | PARTIAL | Only one inline path migrated; helper is status-code-blind |
| Silent release propagation | PARTIAL | Claimed mitigations are verified present on engine `origin/main`; the remaining gap is the plan-acknowledged non-transactional publish→propagation window |
| Release-state ordering hazards | OBSERVABILITY-ONLY | Task 8 checker is read-only by design; reports orderings, prevents none |
| Downstream run correlation | PARTIAL | Genuinely hardened; residual fragility is partly an inherent GitHub API limit |
| Generated artifact semantics | NOT ADDRESSED (root cause) | Engine default `columns_per_row=6` (different repo) untouched; only the test fixture changed |

### RC1 — "REST-first" helper does not catch status-code-only rate limits
- **Type:** logic / consistency · **Severity:** high · **Validity:** definite
- The plan's architecture (line ~419) specifies `isRateLimitError(stderr, status)`
  (two args, so HTTP status is consulted). Task 4's implementation (lines
  ~1189–1206) ships `isRateLimitError(message)` — single arg, pure text regex
  `/rate limit|secondary rate|abuse detection/i`. A 403/429 with no rate-limit text
  in the body returns `false`, so the GraphQL fallback never fires and the call
  fails fatally — the exact failure mode E001/E019/E023/E024 the helper exists to
  prevent. The plan contradicts its own design and implements the weaker form.
- **Why it might not be a problem:** `gh api` usually echoes "API rate limit
  exceeded" in stderr, so the text match often suffices in practice.
- **Recommendation:** Implement the two-arg form from line ~419; treat bare
  403/429 (esp. with `Retry-After`) as rate-limit-shaped. Add a Task-4 test for a
  403 with empty message body.

### RC2 — silent-propagation mitigations are real; non-transactional window stays open
- **Type:** error-handling / resilience · **Severity:** medium · **Validity:** definite
- VERIFIED: the engine→action mitigations the plan lists as done are present on the
  engine's `origin/main` `publish.yml` — a "Preflight … dispatch token" step gates
  `test -n "${GH_TOKEN}"` *before* `npm publish`, and the notify/dispatch step is
  *fatal* (no `continue-on-error`), with a 3-attempt retry loop and a printed
  "Manual replay command". So the original silent-failure root cause (E009/E010) is
  genuinely closed, and Tasks 6/7 are *regression-locks* on that fix, not the fix
  itself. The residual gap is the one the plan already admits (lines 140–141):
  `npm publish` runs before the dispatch, so if the dispatch exhausts its retries
  *after* publish, npm is live while the action is stale — loudly, but still a
  split-brain. No task closes that window.
- **Why it might not be a problem:** A separate engine-sync workflow / cron retries
  the dispatch, so the split-brain self-heals in the common case; and the failure
  is now visible rather than silent.
- **Recommendation:** State plainly that Tasks 6/7 are regression-locks. If the
  non-transactional window matters, add a compensating control: gate "release
  complete" on the Task-8 checker, or create the GitHub Release only after action
  propagation verifies.

> **Note on a retracted finding:** an earlier draft flagged the engine `publish.yml`
> mitigation as "claimed but not in the code." That was based on a *stale on-disk
> checkout* of `../contributors-please` (HEAD `4529b8d`); the mitigation is present
> on `origin/main` (commits `02eb826` "require action dispatch token before publish",
> `18ad7f3` "harden release dispatch retries"). The plan's claim is accurate.

### RC3 — ordering hazards get observability, not prevention
- **Type:** consistency (framing) · **Severity:** medium · **Validity:** definite
- Seven E-numbers map to this category; the only fix is the Task-8 checker, which
  is read-only by design (line ~648). It emits state *names* (`action-main-stale`,
  `downstream-running`, …) but enforces no ordering. The "resilient" framing
  oversells it.
- **Why it might not be a problem:** For a small team, a clear read-only state
  report plus a runbook may be sufficient resilience in practice; full enforcement
  may be over-engineering.
- **Recommendation:** Either relabel as "observability for ordering hazards," or
  add a task that runs the checker as a *required gate* between propagation steps.

### RC4 — run correlation hardened but residual fragility remains (partly inherent)
- **Type:** concurrency / api · **Severity:** medium · **Validity:** definite
- Task 6's `wait-downstream-suite.mjs` correlates on `source_run_id` with
  created-at windows — a real upgrade over display-title matching. But the
  "more deterministic REST lookup" (line ~399) stays optional, and GitHub's
  dispatch APIs do not return the created run ID, so some heuristic correlation is
  unavoidable.
- **Why it might not be a problem:** The residual fragility is a GitHub API
  limitation, not a plan defect; the source-marker + window approach is reasonable.
- **Recommendation:** Promote the window+marker correlation to a tested contract
  (assert it rejects a same-window run with the *wrong* marker). Document the
  "no run ID returned" limitation in the runbook.

### RC5 — artifact-semantics root cause lives in the engine and is untouched
- **Type:** logic · **Severity:** high · **Validity:** highly-likely
- The malformed `CONTRIBUTORS.md` root cause is the engine defaulting
  `columns_per_row` to `6` when the field is omitted (config schema declares no
  default). Tasks 1–2 only set the **fixture** to `columns_per_row: 1` and add a
  live assertion — and they live in `contributors-please-test`, not the engine.
  Every real consumer who omits the field still gets 6-wide concatenation. The
  symptom is caught for one fixture; the user-facing cause persists.
- **Why it might not be a problem:** Default 6 is plausibly intentional (grid
  layouts); the corruption is the *interaction* of a pipe-delimited entry template
  with `columns_per_row > 1`, so blindly changing the default would be wrong.
- **Recommendation:** Add an engine-side guard/warning when `entry_template`
  contains a row-internal delimiter (`|`) **and** `columns_per_row > 1`; or document
  default 6 in the schema/README. Route a task to the `contributors-please` repo —
  no current task touches it.

---

## B. Code-vs-plan discrepancies (factual accuracy of the plan)

### CD1 — (RETRACTED) engine `publish.yml` mitigation — verified accurate
- **Type:** consistency (docs vs code) · **Severity:** n/a · **Validity:** retracted
- A subagent read a stale on-disk checkout and reported the silent-propagation
  mitigation as missing. Re-checked against engine `origin/main`: the mitigation is
  present and matches the plan (token preflight before `npm publish`; fatal dispatch
  with 3 retries + manual replay command). Plan lines 132–136 are accurate. See the
  note under RC2. No action required. **Lesson for implementers:** the sibling repos
  (`../contributors-please`, `../contributors-please-test`) may be stale on disk —
  `git fetch` and read `origin/main` before trusting cross-repo claims.

### CD2 — Task 5 misdescribes the current `e2e.yml` snapshot shape
- **Type:** consistency (docs vs code) · **Severity:** medium · **Validity:** definite
- Task 5 (lines ~1280–1306) says the new `e2e-pr-snapshot.mjs` must write "the same
  JSON shape currently consumed by the `Verify pull request and label` step"
  (`files, headRefName, labels, state, title, url`) and to "keep the existing
  assertion block that checks labels, files, head ref, and state." The actual step
  (`.github/workflows/e2e.yml` lines ~147–208) writes three `/tmp/pull-request-*.json`
  temp files and asserts inline; it checks only the pending **label** and the
  **file list** — it never reads `headRefName`, `state`, `title`, or `url`. The new
  script would *introduce* a richer shape, not mirror an existing one.
- **Why it might not be a problem:** Introducing a richer combined snapshot is fine
  on its own; only the "same shape currently consumed" premise is wrong.
- **Recommendation:** Reword Task 5 to "create a new combined snapshot consumed by a
  rewritten assertion block," and enumerate exactly which fields the new assertions
  check.

### CD3 — `test/engine/render.test.ts` does not exist in this repo
- **Type:** consistency (docs vs code) · **Severity:** medium · **Validity:** definite
- The validation baseline (line ~1717) documents `npm test -- test/engine/render.test.ts`
  as a "focused renderer proof." There is no `test/engine/` dir or `render.test.ts`
  in `contributors-please-action`; the renderer lives in the engine repo. The
  command fails in the repo the plan targets.
- **Why it might not be a problem:** The author may have meant "run this in the
  engine repo."
- **Recommendation:** Either remove the line or qualify it as an engine-repo command
  (e.g. `cd ../contributors-please && npm test -- …`).

### CD4 — `gh workflow run` does not return a run URL/ID (Task 1 Step 7)
- **Type:** api misuse · **Severity:** medium · **Validity:** highly-likely
- Task 1 Step 7 (lines ~973–979) does
  `run_url="$(gh workflow run live-adoption.yml …)"` then
  `run_id="${run_url##*/}"`. `gh workflow run` prints only a confirmation to stderr
  and nothing useful to stdout, so `run_url` is empty and `run_id` is garbage; the
  subsequent `gh run view "$run_id"` fails.
- **Why it might not be a problem:** An operator running interactively would notice
  the empty value and fall back to `gh run list`; it only bites an unattended agent.
- **Recommendation:** Replace with a poll: after dispatch, `gh run list --workflow
  live-adoption.yml --json databaseId,headBranch,createdAt …` filtered by the
  `suite_run_id` marker, then watch that id.

---

## C. Document-internal bugs, ambiguities, inconsistencies

### DOC1 — Task 3 invests in string-sentinel tests that Task 6 then deletes
- **Type:** consistency (task ordering) · **Severity:** medium · **Validity:** definite
- Task 3 adds assertions against the *inline YAML* wait/dispatch shell (`gh run
  watch`, `--interval 15`, `client_payload[...]`, "Could not find downstream suite
  run"). All match the current YAML. But Task 6 *replaces those shell bodies* with
  `node …mjs` scripts, deleting the very strings Task 3 asserts — so the Task 3
  tests break and must be rewritten three tasks later. The plan half-acknowledges
  this ("Prefer moving wait logic into a script before adding many more string
  checks," line ~374) yet still orders Task 3 first.
- **Why it might not be a problem:** Task 3 provides a regression net for the live
  v1.3.x workflow *now*, and rewriting its assertions in Task 6 is expected churn.
- **Recommendation:** Either fold Task 3's intent into Task 6 (test the script, not
  the YAML strings), or explicitly note in Task 3 that its assertions are temporary
  and will be replaced by Task 6.

### DOC2 — E-numbers (E001–E028) are referenced but never defined
- **Type:** traceability / ambiguity · **Severity:** medium · **Validity:** definite
- E001…E028 appear only as bare "Related errors" references (lines 104, 124, 146,
  163) and in the Task 7 rationale. Nothing in the document or repo maps any E### to
  a concrete symptom, run ID, or commit, so a reader cannot resolve what (e.g.) E017
  was. This is false precision in a document whose stated goal is to be
  "explainable."
- **Why it might not be a problem:** The author may hold the mapping in a separate
  notebook; the prose descriptions per category give the gist without the IDs.
- **Recommendation:** Add an error-catalog appendix (E### → symptom → run/PR/commit →
  root cause), or drop the numbers and reference failures by description.

### DOC3 — "complete" checker state conflates engine version with action version
- **Type:** logic / ambiguity · **Severity:** medium · **Validity:** likely
- Task 8's `complete` predicate (line ~1567) requires "npm, tag, GitHub Release,
  action main, and downstream checks all match the requested version," and the
  acceptance says `--version v1.3.1` ⇒ `complete`. But the action package
  (`package.json`) is already at `1.3.4` while `.contributors-please-engine-ref` is
  `v1.3.1`. The plan never distinguishes "engine library version" from "action
  package version," so it is ambiguous whether `--version` refers to the engine ref
  (still v1.3.1 on main → could be complete) or the action release (v1.3.4). Once
  main moves to a newer engine ref, a literal "action main matches requested
  version" check would report an old-but-fully-propagated release as *not* complete.
- **Why it might not be a problem:** If `--version` is consistently the engine ref
  and `complete` means "≥ requested," the acceptance holds; the conflation may be
  only in the prose.
- **Recommendation:** Define the two version axes explicitly. Make `complete` mean
  "engine ref present and propagated, action main ≥ requested," not strict equality.

### DOC4 — Checker state ordering (`action-sync-pr-open` before `action-main-stale`) is not linear
- **Type:** logic / ambiguity · **Severity:** low · **Validity:** possible
- The state list (lines ~672–681) and predicates (lines ~1560–1566) order
  `action-sync-pr-open` before `action-main-stale`, but `action-main-stale` is
  defined as "release newer than main and *no* current sync PR" — logically that is
  *earlier* (PR not yet opened) or a *stuck* state, not a later one. The linear
  ordering may mislead the checker's "next expected action."
- **Why it might not be a problem:** These are labels, not a strict sequence; the
  predicates are mutually exclusive so classification still works.
- **Recommendation:** Document the state graph (which states are linear vs.
  terminal/stuck) rather than implying a single chain.

### DOC5 — Task 5 workflow wiring sets only `OUT_PATH`; other required env unspecified
- **Type:** ambiguity · **Severity:** low · **Validity:** likely
- The script requires `TARGET_OWNER, TARGET_REPO, PR_NUMBER, OUT_PATH` (line ~1273),
  but the wiring snippet (lines ~1300–1301) sets only `OUT_PATH` inline. Whether the
  other three are already in workflow scope is assumed, not stated.
- **Why it might not be a problem:** Those vars likely already exist as job-level env
  in `e2e.yml`.
- **Recommendation:** State explicitly that `TARGET_OWNER/TARGET_REPO/PR_NUMBER` come
  from existing job env, or pass them in the snippet.

### DOC6 — Task 1 Step 1 verification list omits `dry-run`
- **Type:** consistency · **Severity:** low · **Validity:** definite
- Step 1 verifies `repository, mode, output-file, state-file, config-file, bootstrap,
  unignore, pat` but Step 2 immediately uses `dry-run: true`. The input *does* exist
  in `action.yml` (line 96), so nothing breaks — it is a completeness gap in the
  verification step. (Outputs `changed` and `contributors-json` used in Step 3 both
  exist — those are fine.)
- **Why it might not be a problem:** `dry-run` exists, so the step succeeds anyway.
- **Recommendation:** Add `dry-run` to the Step 1 expected-inputs list.

### DOC7 — Local `uses: ./.github/actions/contributors-please-action` requires same-job checkout
- **Type:** ambiguity · **Severity:** low · **Validity:** definite
- Task 1 Step 2's local-action `uses:` resolves only because `live-adoption.yml`
  checks the action out to `${ACTION_PATH}` (= `.github/actions/contributors-please-action`)
  at runtime. That path does not exist statically in the test repo. The plan does not
  state the new `uses:` step must sit in the *same job* after that checkout.
- **Why it might not be a problem:** The author clearly knows the harness; an
  implementer following the file will likely place it correctly.
- **Recommendation:** Add a one-line note: "must run in the same job as, and after,
  the action checkout to `${ACTION_PATH}`."

### DOC8 — `## Execution preconditions` is nested under the wrong heading level
- **Type:** consistency (structure) · **Severity:** low · **Validity:** definite
- "Agentic implementation task checklist" (`##`, line 839) is immediately followed by
  "Execution preconditions" (`##`, line 845) and then the `###` tasks — so the
  preconditions are a *sibling* of the checklist header rather than a child, and the
  checklist header has no body before the next `##`.
- **Why it might not be a problem:** Purely cosmetic; renders fine.
- **Recommendation:** Demote "Execution preconditions" to `###`, or move it above the
  checklist header.

---

## D. Security review of the workflows (GitHub Actions attack surface)

Audited triggers, token flow, and shell interpolation across the action, test, and
engine workflows. Headline: **no workflow runs untrusted PR code with a write
token** (no `pull_request_target` / `issue_comment` anywhere; `workflow_run` runs
against base/main SHAs with `contents: read`). The residual risk is **script
injection of dispatch-controlled values into `run:` bodies**, amplified by tokens
in scope — privilege-gated (an attacker needs repo write to fire the dispatch) but
real.

### SEC1 — `client_payload.*` interpolated directly into a `run:` shell body
- **Type:** security (script injection) · **Severity:** medium · **Validity:** definite · **Origin:** pre-existing
- `../contributors-please-test/.github/workflows/action-downstream-suite.yml`
  "Summarize downstream request" step echoes
  `${{ github.event.client_payload.source_repo || 'manual' }}` and
  `…source_workflow_run_id…` **directly** into the shell. `client_payload.*` is
  attacker-settable on `repository_dispatch`; a value like `$(...)` or a quote-break
  executes arbitrary commands in a job holding `actions: write` + `GH_TOKEN`. The
  plan adds *more* run-discovery/title matching and new `client_payload` fields, so
  this surface grows.
- **Why it might not be a problem:** Gated — firing `repository_dispatch` already
  requires a token with repo write; the same step handles `ACTION_REF`/`LIBRARY_REF`
  safely, so the unsafe fields are an inconsistency, not a pattern.
- **Recommendation:** Route `source_repo` and `source_workflow_run_id` through
  `env:` and reference `"${SOURCE_REPO}"` / `"${SOURCE_WORKFLOW_RUN_ID}"`, matching
  the safe lines already in that step. **Independently actionable now.**

### SEC2 — `inputs.action_ref` interpolated into a `run:` body
- **Type:** security (script injection) · **Severity:** medium · **Validity:** definite · **Origin:** pre-existing
- `../contributors-please-test/.github/workflows/live-adoption.yml` "Summarize live
  adoption evidence" echoes `${{ inputs.action_ref || 'main' }}` straight into shell.
  `action_ref` is influenceable through the dispatch chain.
- **Why it might not be a problem:** It is a ref string and privilege-gated like SEC1.
- **Recommendation:** Pass `action_ref` via `env:` and reference `"${ACTION_REF}"`.

### SEC3 — new helper scripts may print tokens on error
- **Type:** security (secret exposure) · **Severity:** low · **Validity:** likely · **Origin:** plan-introduced
- The plan's scripts (`github-api.mjs`, `dispatch-/wait-downstream-suite.mjs`,
  `e2e-pr-snapshot.mjs`, `check-release-propagation.mjs`) read `GH_TOKEN` from env and
  print replay/error output, but the plan never forbids dumping `process.env`/`argv`/
  full `stderr`. A naive error handler could echo the token; `gh` masking does not
  cover a token re-printed by Node.
- **Why it might not be a problem:** GitHub masks registered secrets in logs, and the
  existing inline replay command prints `${GH_TOKEN}` *references*, never the value.
- **Recommendation:** Add to each script's acceptance criteria: "never print env,
  argv, or raw token; redact tokens from any error output."

### SEC4 — `ci.yml` has no `permissions:` block
- **Type:** security (over-broad token) · **Severity:** low · **Validity:** definite · **Origin:** pre-existing
- `.github/workflows/ci.yml` declares no `permissions:`, so `GITHUB_TOKEN` defaults
  broad. Other workflows scope correctly (`release-please.yml` uses `permissions: {}`;
  `e2e`/`engine-sync`/`downstream-e2e` use `contents: read`).
- **Why it might not be a problem:** CI does not push; no current step is exploitable.
- **Recommendation:** Add top-level `permissions: { contents: read }`.

### SEC5 — passing `pat:` into the new `uses:` leg (checked — acceptable)
- **Type:** security · **Severity:** informational · **Origin:** plan-introduced
- Task 1 passes `pat: ${{ secrets.CONTRIBUTORS_PLEASE_E2E_TOKEN }}` into the `uses:`
  step. This matches existing `e2e.yml` practice; secrets are masked and the action is
  a local node24 JS action. Acceptable **contingent on the action body not logging the
  pat** — worth a one-time confirmation. Note: Task 1's "Verify … smoke outputs" step
  correctly routes `contributors-json` (the one attacker-influenceable output, sourced
  from git history) through `env:` and `process.env` — a good pattern, not a finding.

## E. Error-taxonomy completeness (extends DOC2)

### TAX1 — E-number set is non-contiguous, not just undefined
- **Type:** traceability · **Severity:** medium · **Validity:** definite
- Referenced: E001–E003, E007, E009–E013, E015–E019, E023, E024, E028 (17 IDs).
  **Never referenced anywhere:** E004, E005, E006, E008, E014, E020, E021, E022, E025,
  E026, E027 (11 gaps within the 1–28 range). So either a source catalog exists and
  ~40% of it was dropped from this document, or the numbering is arbitrary. Combined
  with DOC2 (none are defined), a reader cannot tell which.
- **Why it might not be a problem:** The gaps may be errors the team triaged as
  out-of-scope; the prose per category still conveys the substance.
- **Recommendation:** Ship the source catalog as an appendix (E### → symptom → run/PR/
  commit → status: fixed/deferred/wontfix), or renumber contiguously. Decide and state
  which, so gaps read as "deferred" rather than "lost."

## F. Toolchain / command existence (mostly cleared)

### TC1 — toolchain references verified present
- **Type:** consistency · **Severity:** low (cleared) · **Validity:** definite
- Verified: `npm run check` exists in `package.json` scripts. `actions/setup-node@v6`
  and `node-version: 24` are already used in 5 existing action workflows (ci,
  release, release-please, engine-sync, sync-engine-release), so Task 6's choices are
  consistent, not invented. `validate-workflows.mjs` implements an
  `assert(text.includes("<marker>"))` pattern, so the "add markers" tasks are feasible.
- **Residual nuance:** markers in `validate-workflows.mjs` are hand-written `assert`
  calls in file/section-specific blocks (plus one `for (const marker of […])` loop for
  the orchestrator), not a single global list. Tasks 1/2/9 that say "add markers" must
  insert asserts in the correct block.
- **Recommendation:** No blocking issue. In the marker tasks, specify *where* in
  `validate-workflows.mjs` the new asserts go.

## G. Rollback / blast radius of live dispatches

### BR1 — no teardown; scratch-repo state accumulates; no rollback guidance
- **Type:** resilience / operability · **Severity:** medium · **Validity:** definite
- The live legs mutate `smorinlabs/contributors-please-e2e`: commit synthetic files to
  `main` (`src/e2e-*.py`, `docs/`, `tests/`, `live-fixtures/*-seed.md`, `*-pr.md`,
  plus `.contributors.*`/`CONTRIBUTORS.md`), create branch `contributors-please/update`,
  open a PR, apply a `contributors-please: pending` label. Cleanup happens only at the
  *next* run's start (`git reset --hard origin/main`, branch delete, stale-PR close) and
  is wrapped in `|| true`, so failures are swallowed. There is **no `if: always()`
  teardown**: a mid-run failure (including the plan's new `uses:` leg or a failed
  assertion) leaves an open PR + branch + label until the next dispatch. The synthetic
  **main-branch commits are never pruned** — the scratch repo's `main` grows every run.
  The plan is forward-validation only and provides no rollback runbook; Task 8's checker
  is read-only and does not reset scratch state.
- **Why it might not be a problem:** The next run self-heals branches/PRs/labels, and a
  scratch repo is disposable by design, so accumulation is low-stakes.
- **Recommendation:** (a) Add `if: always()` teardown to `live-adoption.yml` and
  `e2e.yml` (close PR, delete branch, remove label). (b) Add a scheduled GC or
  reset-to-pinned-baseline to prune accumulated `main` commits. (c) Stop `|| true`-
  swallowing cleanup failures so a wedged state is visible. (d) Add a manual-reset
  runbook entry. (e) Confirm against `src/index.ts` that `dry-run: true` blocks **all**
  write paths (commit, PR, label), not just the commit — the plan only asserts it
  avoids the staleness failure.

## H. Test rigor (are the new tests tautological?)

### TR1 — Task 3's `toContain` tests repeat the very weakness the plan names
- **Type:** test rigor · **Severity:** medium · **Validity:** definite
- Task 3's assertions (`expect(dispatch?.run).toContain("client_payload[source_run_id]=…")`,
  `toContain("gh run watch")`, etc.) prove only that the YAML file contains literals it
  was authored to contain. They do not simulate child-run discovery or failure
  propagation. The plan itself lists "string-sentinel workflow tests" and "tests that
  do not fully simulate child-run discovery failure" as weaknesses (lines 91, 220) —
  Task 3 reproduces them. Compounds DOC1 (Task 6 then deletes these strings).
- **Why it might not be a problem:** As a cheap regression net against accidental
  deletion of a wait step, low-rigor string checks have some value.
- **Recommendation:** Skip the YAML string tests; go straight to Task 6's script-level
  behavior tests (mocked `gh`: child found / missing / failed → correct exit code).

### TR2 — `isRateLimitError` test is circular and misses the real failure shape
- **Type:** test rigor · **Severity:** medium · **Validity:** definite (ties RC1)
- Task 4's detection test feeds hand-picked strings chosen to match the regex
  (`"API rate limit exceeded"` matches `/rate limit/`), proving the regex matches its
  own inputs. It never tests a real-shaped failure: a 403/429 status with no rate-limit
  text — exactly the case RC1 shows the single-arg helper mishandles.
- **Why it might not be a problem:** The control-flow tests for `withRateLimitFallback`
  (REST-only on success, GraphQL on rate-limit, throw on fatal) ARE genuine and useful.
- **Recommendation:** Add a status-code case (`isRateLimitError("", 403)` → true after
  the two-arg fix) and a fixture built from real `gh` rate-limit stderr, not a string
  authored to match.

### TR3 — Task 2 commit-mode assertion re-implements the renderer
- **Type:** test rigor · **Severity:** medium · **Validity:** likely
- The Task 2 node assertion recomputes `expected` from `.contributors.jsonl` using the
  renderer's own logic (filter `[bot]`, sort by `localeCompare`, map to a hardcoded
  `${login} | ${title} | ${commits}` template, join `\n`, append `\n`). It then asserts
  the engine output equals this reimplementation. A renderer bug shared by both, or
  drift between the hardcoded template and the fixture's `entry_template`, yields false
  passes or false failures. The plan flags this risk itself (line 352).
- **Why it might not be a problem:** It does catch the specific row-grouping bug (test
  joins with `\n`, engine with a space when `columns_per_row > 1`), which was the point.
- **Recommendation:** Assert against a small **golden file** checked into the fixture,
  not a reimplementation; regenerate the golden only on intentional template changes.

### TR4 — Task 1 Step 3 smoke assertion is near-tautological (acceptable)
- **Type:** test rigor · **Severity:** low · **Validity:** definite
- `if (!Array.isArray(contributors)) process.exit(1)` plus non-empty checks pass for any
  JSON array; it proves outputs are wired, not that the action produced correct content.
- **Why it might not be a problem:** It is explicitly a *metadata smoke* leg; proving the
  `uses:` output path emits a parseable array is its stated job.
- **Recommendation:** Keep as-is, but name it a smoke check in the plan so it is not
  mistaken for semantic coverage (the semantic coverage is Task 2's job).

---

## Summary

28 findings total; 26 active (CD1 retracted after verification; SEC5 informational and TC1 cleared are listed for completeness).
- **By severity:** high 2 (RC1, RC5) · medium 16 (RC2, RC3, RC4, CD2, CD3, CD4, DOC1, DOC2, DOC3, TAX1, SEC1, SEC2, BR1, TR1, TR2, TR3) · low 9 (DOC4, DOC5, DOC6, DOC7, DOC8, SEC3, SEC4, TC1, TR4) · informational 1 (SEC5).
- **By dimension:** root-cause coverage RC1–RC5 · code-vs-plan CD2–CD4 · doc-internal DOC1–DOC8 · security SEC1–SEC5 · taxonomy TAX1 · toolchain TC1 · blast-radius BR1 · test-rigor TR1–TR4.
- **Highest-leverage fixes, in order:**
  1. **SEC1/SEC2** — route dispatch-controlled values through `env:` (script-injection
     fix). Independently actionable now; lowest cost, real attack surface.
  2. **RC5** — route a task to the engine repo (`contributors-please`) for the
     `columns_per_row` default; the live assertion only protects one fixture, and this
     is the one user-facing root cause no task touches.
  3. **RC1/TR2** — fix `isRateLimitError` to consult HTTP status (403/429) per the
     plan's own architecture, and add a status-code test; the shipped one-arg form is a
     regression that its test cannot catch.
  4. **BR1** — add `if: always()` teardown + scratch-repo GC + a reset runbook.
  5. **DOC1/TR1** — drop Task 3's string tests; go straight to Task 6's script-behavior
     tests (resolves both the churn and the tautology).
  6. **RC2 / RC3 / DOC2/TAX1 / DOC3 / TR3** — relabel regression-locks vs. fixes, ship
     the E-number catalog, disambiguate engine-vs-action version, golden-file the
     renderer assertion.
- **Overall:** The plan is well-structured, honest about residual risk, and — verified
  against the *remote* main of each repo — its file/path references and "current
  mitigation" claims check out (including the engine silent-propagation hardening).
  Its real weaknesses: (a) tasks that add *detection* around root causes the prose
  implies are *fixed* (categories 3, 5); (b) the top user-facing root cause (engine
  `columns_per_row` default) in a repo no task touches; (c) no security/injection pass
  despite adding run-discovery on dispatch-controlled values; (d) no rollback/teardown
  for the live legs that mutate the scratch repo; (e) several new tests that repeat the
  string-sentinel weakness the plan itself criticizes.
