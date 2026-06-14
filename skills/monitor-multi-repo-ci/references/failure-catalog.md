# Failure catalog

Each entry: **tell** (how to recognize), **cause**, **remedy**. Drawn from real incidents.

## 1. Lost webhook event (CI never triggered)

- **Tell:** A PR was opened / commit pushed but there is **no workflow run** for that head SHA. `gh api repos/{repo}/commits/{sha}/check-suites` shows third-party apps (copilot, codecov, cursor) `queued` but **no `github-actions` suite**.
- **Cause:** GitHub Actions event-delivery hiccup (platform-side), not a repo problem. The `22:35` pushes triggered fine; a later one didn't.
- **Remedy:** Re-trigger — push an empty commit (`git commit --allow-empty`) or re-run from the Actions UI / `gh run rerun`. If `main` has no required checks, it isn't blocking; verify locally with `npm run check` in the meantime.

## 2. Stale CI pin (`CONTRIBUTORS_PLEASE_LIBRARY_REF`)

- **Tell:** Action CI / `sync-dist` fails at the **build** step with `TS2307: Cannot find module 'contributors-please'` or `TS2345: ... 'string | undefined' is not assignable` (old engine types).
- **Cause:** `ci.yml` checks out the engine at `vars.CONTRIBUTORS_PLEASE_LIBRARY_REF`. If that variable lags the engine API the action's source now uses, types don't resolve. (Real: pin sat at `v1.0.2` for months.)
- **Remedy:** `npm run check:sync` prints the exact `gh api --method PATCH … CONTRIBUTORS_PLEASE_LIBRARY_REF -f value=vX.Y.Z`. PATCH it, then re-run failed CI. → **update-multi-repo-ci** skill.
- **Note:** the variable is repo *settings*, not a file — changing it is an authenticated API write, often gated by permission prompts.

## 3. Embedded version drift (CP-GHA-038)

- **Tell:** CP-GHA-038 "reproducible bundles" fails; rebuilding `dist` yields a one-line change to `dist/contributors-please-lib.js` (`{"rE":"1.1.1"}` → `{"rE":"1.2.0"}`).
- **Cause:** Engine released a new version; the action's committed lib bundle still embeds the old `VERSION` literal.
- **Remedy:** With `../contributors-please` at the new release: `npm install && npm run build && npm test`, then commit `dist` + `package-lock.json`. → **update-multi-repo-ci** skill.

## 4. Config-source conflict (CP-GHA-044 class)

- **Tell:** `contributors-please-action: conflicting configuration for keys "entry_template", "min_contributions"`.
- **Cause:** A config-file-only key set in **both** `.contributors.yml` and workflow inputs (the action fails fast even if values agree).
- **Remedy:** Remove the key from one source — the config file wins for rendering/classification. (Real: CP-GHA-044 fixture set both; fix deleted the redundant `INPUT_ENTRY-TEMPLATE`/`INPUT_MIN-CONTRIBUTIONS`.)

## 5. GraphQL rate-limit exhaustion

- **Tell:** `gh pr create/merge/ready` fails `GraphQL: API rate limit already exceeded`, while `gh api repos/...` still works.
- **Cause:** `gh`'s GraphQL and REST quotas are separate buckets; GraphQL (~5000/hr) exhausts fast under PR operations.
- **Remedy:** Use REST equivalents: `gh api repos/{repo}/pulls` to create, `gh api --method PUT .../merge` to merge. Draft→ready is GraphQL-only — wait for reset (`gh api rate_limit --jq '.resources.graphql'`). These calls are shared across all agents in the session.

## 6. `live-adoption` flake

- **Tell:** `live-adoption` fails at a **setup** step ("Prepare clean live adoption baseline") with `GraphQL: API rate limit already exceeded for user ID NNN` — before any action logic runs.
- **Cause:** The live suite uses the shared bot account's GraphQL quota, which heavy session activity (your own `gh` calls) can starve. Environmental, **not** a regression.
- **Remedy:** Re-run after the GraphQL quota resets (~minutes); confirm the deterministic suites are green (they're the real gate). Don't block a release on this.

## 7. `sync-dist` job red on release PRs (known bug)

- **Tell:** `release-please` workflow: `release-please` job succeeds (PR created) but `sync-dist` job fails "Build dist bundle" with `TS2307: Cannot find module 'contributors-please'`.
- **Cause:** `sync-dist` runs `npm ci && npm run build` without first checking out and linking `../contributors-please` like `ci.yml` does. Pre-existing; non-blocking (the release PR's dist is already correct from main).
- **Remedy:** Add the engine checkout + symlink + `npm ci --prefix` steps before `npm run build`, mirroring `ci.yml`. → **update-multi-repo-ci** skill.

## 8. Engine-release self-drift

- **Tell:** Right after publishing an engine release, `engine-sync` starts failing: pin / embedded `< latest release`.
- **Cause:** Releasing the engine moves "latest release" ahead of the action's pin and embedded lib — the sync check correctly flags it.
- **Remedy:** Decide deliberately: only release the engine when consumers need it, because it forces an action re-pin + rebuild + release cycle. If you do, follow through immediately. → **update-multi-repo-ci** skill.

## 9. Concurrent/superseded downstream sweeps

- **Tell:** Two `downstream E2E` runs for different action SHAs run at once; suites appear twice in monitor output.
- **Cause:** Each push to action `main` triggers a sweep; older SHAs are superseded but still run. They **serialize** through the test repo's per-ref concurrency group (not a race).
- **Remedy:** Treat the **newest** SHA's run as authoritative; ignore/cancel superseded ones. Don't read a superseded run's flake as a real failure.
