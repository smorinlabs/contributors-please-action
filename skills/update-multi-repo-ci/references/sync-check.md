# `check-engine-sync.mjs` reference

Location: `scripts/check-engine-sync.mjs` (action repo). Asserts the four version references agree and prints actionable remediation on mismatch.

## What it gathers

| Field | Source |
|---|---|
| `embedded` | `VERSION` from `dist/contributors-please-lib.js` (dynamic `import()` — stable, unlike grepping the minified bundle) |
| `lockfile` | `package-lock.json` → `packages["../contributors-please"].version` |
| `localEngine` | `../contributors-please/package.json` version (when the sibling checkout exists) |
| `pin` | env `CONTRIBUTORS_PLEASE_LIBRARY_REF`, else the repo variable via the API |
| `latestRelease` | engine repo's `releases/latest` |

## Modes

- `node scripts/check-engine-sync.mjs` — full check (needs network; uses `GITHUB_TOKEN`/`GH_TOKEN` if present). `npm run check:sync`.
- `node scripts/check-engine-sync.mjs --local` — offline subset (embedded vs lockfile vs sibling engine only). `npm run check:sync:local`. Used by the pre-commit hook.

## Diagnosis rules (`diagnose()` — pure, unit-tested)

| id | condition | remedy emitted |
|---|---|---|
| `embedded-vs-lockfile` | embedded ≠ lockfile | rebuild + commit dist & lockfile |
| `embedded-vs-local-engine` | embedded ≠ sibling engine checkout | rebuild |
| `pin-vs-latest-release` | pin is a semver tag ≠ latest release | `gh api --method PATCH … LIBRARY_REF -f value=<latest>` |
| `embedded-vs-latest-release` | embedded ≠ latest release | rebuild against `<latest>` + commit |
| (note) | pin is a branch name (e.g. `main`) | non-fatal note: floating ref, pin a tag for reproducible CI |

`diagnose()` is separated from I/O so it is unit-testable without network. Output goes to stdout, `::error` annotations, and `$GITHUB_STEP_SUMMARY`.

## Triggers (`engine-sync.yml`)

- `pull_request` + `push: main` — catch drift you're about to merge.
- `schedule` (daily cron) — catch drift that happens *to* you (engine releases while the action repo is idle). This is the backstop that would have caught the months-stale `v1.0.2` pin.
- `repository_dispatch: contributors-please-released` — event-driven; the engine's `publish.yml` sends it after `npm publish`.
- `workflow_dispatch` — manual.

## Extending it

- New reference to check: add to `gather()` and a rule in `diagnose()`; add a unit test in `test/engine-sync.test.ts` first (TDD).
- Keep `diagnose()` pure (inputs → `{ok, failures, notes}`); never put network calls in it.
- Don't grep the minified bundle for the version — `import()` the built lib and read `VERSION`.
