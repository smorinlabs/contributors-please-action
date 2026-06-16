# contributors-please Action Acceptance Runbook

Use this runbook before tagging `smorinlabs/contributors-please-action@v1`.
The E2E workflow can be run manually, runs nightly, and also runs for
`v*.*.*` release tags.

## Prerequisites

- `contributors-please@1.0.1` is published to npm.
- `smorinlabs/contributors-please-action@v1.0.2` is tagged and points at a
  commit with a reproducible `dist/index.js`; the release workflow has moved
  the major `v1` tag to the same commit for Action consumers.
- The `smorinlabs/contributors-please-bot` GitHub App is installed on the test
  repository.
- These secrets are configured in the `smorinlabs/contributors-please-action`
  repository, which runs the E2E workflow against the test repository:
  - `CONTRIBUTORS_PLEASE_CLIENT_ID`
  - `CONTRIBUTORS_PLEASE_PRIVATE_KEY`
  - `CONTRIBUTORS_PLEASE_PAT`
- If `smorinlabs/contributors-please` is private in a fork or restricted
  release setup, configure `CONTRIBUTORS_PLEASE_LIBRARY_TOKEN` in
  `smorinlabs/contributors-please-action` with read access to the library repo.
  Public sibling checkouts fall back to `github.token`.
- The action CI workflow checks out
  `vars.CONTRIBUTORS_PLEASE_LIBRARY_REF` when set, otherwise
  `main`.
- For the optional scheduled GitHub Enterprise smoke job:
  - a self-hosted runner labeled `contributors-please-ghe`
  - repository variables on `smorinlabs/contributors-please-action`:
    `GHE_SERVER_URL`, `GHE_TARGET_OWNER`, and `GHE_TARGET_REPO`
  - optional variables `GHE_API_URL` and `GHE_GRAPHQL_URL` when the Enterprise
    deployment does not use `/api/v3` and `/api/graphql`
  - secret `GHE_CONTRIBUTORS_PLEASE_PAT` on
    `smorinlabs/contributors-please-action`

## py-launch-blueprint Cutover

Run this on a fresh fork or throwaway branch of
`smorinlabs/py-launch-blueprint` before merging the production cutover.

1. Close any open legacy `update-contributors` pull request.
2. Delete the legacy `update-contributors` branch from origin.
3. Apply the py-launch-blueprint cutover changes in one PR:
   - `.github/workflows/update-contributors.yml` uses
     `smorinlabs/contributors-please-action@v1`.
   - `scripts/update_contributors.py` is deleted.
   - `.contributors.yml` is present.
   - `.contributors.jsonl` is present and non-empty.
   - `CONTRIBUTORS.md` uses the contributors-please in-place markers.
4. Bootstrap or refresh state with the published CLI:

   ```bash
   npx contributors-please@1 init \
     --non-interactive \
     --owner smorinlabs \
     --repo py-launch-blueprint \
     --config-file .contributors.yml
   ```

5. Confirm each `source: "commit"` record in `.contributors.jsonl` has
   `first_seen` equal to that author's earliest non-merge commit date, not the
   bootstrap date.
6. Run the local quality gate:

   ```bash
   UV_CACHE_DIR=$PWD/.uv-cache UV_TOOL_DIR=$PWD/.uv-tools just check
   ```

7. Merge the cutover PR to `main`.

## Loop Guard Verification

1. Wait for the next `push` workflow on `main`.
2. Confirm exactly one PR opens on `contributors-please/update`.
3. Confirm the PR has the `contributors-please: pending` label.
4. Confirm the PR updates only `CONTRIBUTORS.md` and `.contributors.jsonl`.
5. Merge the bot PR.
6. Confirm the merge push does not start another contributors workflow run. The
   merge commit should contain only files covered by `paths-ignore`.
7. Manually run `workflow_dispatch` on the contributors workflow.
8. Confirm no second PR opens and the action output `changed` is `false`.
9. Confirm the step summary shows the self-excluded committer notice.
10. Optionally replay a generated-files-only push in a throwaway branch or fork
    and confirm `paths-ignore` skips the contributors workflow. Do not use an
    arbitrary source or docs commit for this check; normal commits intentionally
    change contributor history and may require a new contributors update.

## Failure Handling

- If the update branch contains human commits, stop and resolve it manually; the
  action must not force-push over human work.
- If the label is missing, rerun `mode: pull-request`; the action should create
  or reapply `contributors-please: pending`.
- If `changed` is true on a manual re-run with no source changes, inspect the
  `.contributors.jsonl` diff for non-idempotent fields before tagging v1.

## Engine Sync Check

The action must stay in sync with the `contributors-please` engine across four
version references: the `VERSION` embedded in `dist/contributors-please-lib.js`,
the `package-lock.json` snapshot of the `file:../contributors-please`
dependency, the `CONTRIBUTORS_PLEASE_LIBRARY_REF` repository variable that CI
builds against, and the latest engine release.

`scripts/check-engine-sync.mjs` asserts all four agree and prints the exact
remediation command for whichever pair diverged:

- `npm run check:sync` — full check (needs network; uses `GITHUB_TOKEN` if set).
- `npm run check:sync:local` — offline subset (embedded vs lockfile vs the
  sibling `../contributors-please` checkout); wired as a pre-commit hook via
  `.pre-commit-config.yaml` (`pre-commit install` to enable).

CI runs the full check in `.github/workflows/engine-sync.yml` on every PR and
push to main, on a daily schedule (catches engine releases while this repo is
idle), and on a `contributors-please-released` repository dispatch sent by the
engine's release workflow. Typical failures:

- **Pin lags latest release** — PATCH the repository variable (the failure
  output contains the exact `gh api` command), then re-run failed CI.
- **Embedded lib lags latest release** — rebuild against the new engine and
  commit `dist` + `package-lock.json` (commands in the failure output).
