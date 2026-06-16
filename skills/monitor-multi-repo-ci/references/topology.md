# Three-repo topology and trigger map

## Repos and roles

| Repo | Role | Key workflows |
|---|---|---|
| `smorinlabs/contributors-please` | **engine/library** (npm package) | `ci.yml`, `publish.yml` (on tag → npm publish + dispatch), `release-please.yml` |
| `smorinlabs/contributors-please-action` | **the action** (consumes engine via `file:../contributors-please`) | `ci.yml`, `engine-sync.yml`, `release-please.yml` (+ `sync-dist` job), `e2e.yml`, `downstream-e2e.yml`, `release.yml` |
| `smorinlabs/contributors-please-test` | **downstream harness** | `action-downstream-suite.yml` (dispatcher) + `CP-GHA-*` suite workflows |

## Trigger edges

1. **Engine release → action sync.** Engine `publish.yml` runs on tag `v*.*.*`, publishes to npm, then sends `repository_dispatch` type **`contributors-please-released`** to the action repo. The action repo runs `engine-sync.yml` and `sync-engine-release.yml`; the latter opens or updates the action rebuild PR.
2. **Action CI → downstream suite.** Action `ci.yml` runs on push/PR. On success, `downstream-e2e.yml` (trigger `workflow_run`) sends `repository_dispatch` type **`contributors-please-action-updated`** to the test repo, whose `action-downstream-suite.yml` fans out the `CP-GHA-*` suites.
3. **Action release → E2E.** Merging the release-please PR tags the action; `release.yml`/`e2e.yml` run the action against the scratch repo `contributors-please-e2e`, and the `v1` major tag advances to the new release.

## The four version references (must stay in sync)

The action embeds a built copy of the engine, so four references must agree:

| # | Reference | Location |
|---|---|---|
| 1 | embedded engine build | `VERSION` exported by `dist/contributors-please-lib.js` |
| 2 | lockfile snapshot | `package-lock.json` → `"../contributors-please".version` |
| 3 | tracked engine ref | `.contributors-please-engine-ref` |
| 4 | latest engine release | GitHub releases on the engine repo |

`scripts/check-engine-sync.mjs` (action repo) asserts these agree; `engine-sync.yml` runs the trusted policy and `sync-engine-release.yml` opens the rebuild PR when latest moves. When they drift, use the **update-multi-repo-ci** skill.

## Suite taxonomy (test repo)

- **Deterministic suites** (`auth-and-discovery`, `classification-and-state`, `rendering`, `modes-and-labels`, `outputs-selection-config`, `network-ghe-security`, `bootstrap-cli-api-build`, `acceptance-loopguards`): use **fake** APIs (local fixtures) — reproducible, no rate-limit exposure.
  - `bootstrap-cli-api-build` contains **CP-GHA-038** (dist reproducibility) and **CP-GHA-044** (CLI/Action parity).
- **Live suite** (`live-adoption`): hits **real** GitHub APIs against a scratch repo; rate-limit-sensitive, so setup-step failures are usually environmental in *cause*. **It is still a blocking gate** (`contributors-please-test/CLAUDE.md`) — both the deterministic suites and `live-adoption` are watched with `--exit-status` and must pass.

## Credentials / variables that gate the cascade

- `.contributors-please-engine-ref` (tracked file) — engine release the action builds against.
- `CONTRIBUTORS_PLEASE_LIBRARY_TOKEN` (action secret, optional) — read token for private/restricted engine clones.
- `CONTRIBUTORS_PLEASE_ACTION_TOKEN` (engine secret) — used by `publish.yml` to checkout the action and to send the `contributors-please-released` dispatch.
- `CONTRIBUTORS_PLEASE_TEST_DISPATCH_TOKEN` (action secret) — used by `downstream-e2e.yml` to dispatch the test suite.
