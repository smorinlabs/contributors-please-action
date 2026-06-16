# `check-engine-sync.mjs` reference

Location: `scripts/check-engine-sync.mjs` (action repo). Asserts the relevant engine version references agree for the selected policy mode and prints actionable remediation on mismatch.

## What it gathers

| Field | Source |
|---|---|
| `embedded` | `VERSION` from `dist/contributors-please-lib.js` (dynamic `import()` — stable, unlike grepping the minified bundle) |
| `lockfile` | `package-lock.json` → `packages["../contributors-please"].version` |
| `trackedRef` | `.contributors-please-engine-ref` |
| `localEngine` | `../contributors-please/package.json` version (when the sibling checkout exists) |
| `pin` | explicit env `CONTRIBUTORS_PLEASE_LIBRARY_REF` compatibility override, when present |
| `latestRelease` | engine repo's `releases/latest` |

## Modes

- `node scripts/check-engine-sync.mjs` / `--trusted` — trusted check (needs network; uses `GITHUB_TOKEN`/`GH_TOKEN` if present). `npm run check:sync:trusted`.
- `node scripts/check-engine-sync.mjs --local` — offline subset (embedded vs lockfile vs tracked ref vs sibling engine). `npm run check:sync:local`. Used by the pre-commit hook and regular CI.
- `node scripts/check-engine-sync.mjs --release` — strict release gate for action tag releases. `npm run check:sync:release`.

## Diagnosis rules (`diagnose()` — pure, unit-tested)

| id | condition | remedy emitted |
|---|---|---|
| `embedded-vs-lockfile` | embedded ≠ lockfile | rebuild + commit dist & lockfile |
| `embedded-vs-local-engine` | embedded ≠ sibling engine checkout | rebuild |
| `tracked-ref-vs-lockfile` | tracked ref ≠ lockfile | rebuild against tracked ref |
| `tracked-ref-vs-embedded` | tracked ref ≠ embedded | rebuild against tracked ref |
| `tracked-ref-vs-local-engine` | tracked ref ≠ sibling engine checkout | materialize the tracked ref |
| `tracked-ref-vs-latest-release` | trusted/release mode: tracked ref ≠ latest release | update `.contributors-please-engine-ref`, then rebuild |
| `pin-vs-latest-release` | explicit compatibility pin is a semver tag ≠ latest release | unset the override or set it to the tracked/latest release |
| `embedded-vs-latest-release` | trusted/release mode: embedded ≠ latest release | rebuild against `<latest>` + commit |
| (note) | pin is a branch name (e.g. `main`) | non-fatal note: floating ref, pin a tag for reproducible CI |

`diagnose()` is separated from I/O so it is unit-testable without network. Output goes to stdout, `::error` annotations, and `$GITHUB_STEP_SUMMARY`.

## Triggers (`engine-sync.yml`)

- `pull_request` + `push: main` — catch drift you're about to merge.
- `schedule` (daily cron) — catch drift that happens *to* you (engine releases while the action repo is idle). This is the backstop that would have caught the months-stale `v1.0.2` pin.
- `repository_dispatch: contributors-please-released` — event-driven; the engine's `publish.yml` sends it after `npm publish`. `sync-engine-release.yml` also consumes this event to open/update the sync PR.
- `workflow_dispatch` — manual.

## Extending it

- New reference to check: add to `gather()` and a rule in `diagnose()`; add a unit test in `test/engine-sync.test.ts` first (TDD).
- Keep `diagnose()` pure (inputs → `{ok, failures, notes}`); never put network calls in it.
- Don't grep the minified bundle for the version — `import()` the built lib and read `VERSION`.
