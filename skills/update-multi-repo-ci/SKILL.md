---
name: update-multi-repo-ci
description: Use when changing or repairing CI plumbing in the contributors-please three-repo system and proving it works — bumping the engine version the action builds against, fixing a stale CONTRIBUTORS_PLEASE_LIBRARY_REF pin, rebuilding dist after an engine release, fixing the sync-dist job, or adding cross-repo dispatch. Triggers on "bump the engine", "rebuild dist", "fix the pin", "sync the action with the engine", "engine-sync failing", "update the CI".
metadata:
  type: technique
  repos: smorinlabs/contributors-please, contributors-please-action, contributors-please-test
---

# Update multi-repo CI (and verify it works)

Make a change to the CI plumbing between the engine, the action, and the test harness — then **prove** it holds before declaring done. The backbone is the engine-sync check; the discipline is verify-before-claiming.

**Core principle:** the action and engine stay in sync across **four version references** (embedded lib `VERSION`, lockfile snapshot, `CONTRIBUTORS_PLEASE_LIBRARY_REF` pin, latest engine release). Every plumbing change either keeps them equal or is incomplete. Verify with `npm run check:sync`, never by eyeballing.

> Diagnosis lives in the **monitor-multi-repo-ci** skill; this skill is the fix + verification. Use TDD: a workflow/script test that fails first (superpowers:test-driven-development).

## The sync invariant

Run from the action repo:
```bash
npm run check:sync        # full (needs network/GITHUB_TOKEN); compares all four refs
npm run check:sync:local  # offline subset (pre-commit): embedded vs lockfile vs sibling engine
```
On mismatch it prints the **exact** remediation command for the diverged pair. CI runs it in `engine-sync.yml` (PR, daily cron, `contributors-please-released` dispatch). Pre-commit runs the offline subset.

## Playbooks

### A. Stale CI pin (`CONTRIBUTORS_PLEASE_LIBRARY_REF`)
1. `npm run check:sync` → copy the printed PATCH command.
2. `gh api --method PATCH repos/smorinlabs/contributors-please-action/actions/variables/CONTRIBUTORS_PLEASE_LIBRARY_REF -f name=CONTRIBUTORS_PLEASE_LIBRARY_REF -f value=vX.Y.Z`
3. Re-run failed CI: `gh run rerun <id>`.
4. **Verify:** `engine-sync` job green; CI build no longer `TS2307/TS2345`.
- The variable is repo *settings* (not a file) — an authenticated API write, often permission-gated. Prefer a tagged release over `main` for reproducible CI.

### B. Rebuild dist after an engine release
1. Check out `../contributors-please` at the new release tag (a sibling worktree resolves the `file:../contributors-please` path).
2. `npm install && npm run build && npm test` in the action repo.
3. Expect a small diff: the embedded `VERSION` literal in `dist/contributors-please-lib.js` and the lockfile snapshot.
4. **Verify:** `npm run check:sync:local` passes; fresh-clone `npm ci && npm run build` leaves `git diff --exit-code -- dist` clean (this is what CP-GHA-038 enforces).
5. Commit `dist` + `package-lock.json`; PR it.

### C. Fix the `sync-dist` job (known bug)
The `sync-dist` job in `release-please.yml` runs `npm run build` without materializing the engine dep, so it fails `TS2307`. Mirror `ci.yml`: before the build, add steps to checkout `smorinlabs/contributors-please` at `vars.CONTRIBUTORS_PLEASE_LIBRARY_REF` into `.deps/contributors-please`, symlink it to `../contributors-please`, and `npm ci --prefix .deps/contributors-please`.
- **Verify:** the next release PR's `sync-dist` job is green.

### D. Engine-release decision (avoid self-inflicted drift)
Releasing the engine moves "latest release" ahead of the action's pin, so `engine-sync` will (correctly) flag the action as stale, forcing a re-pin → rebuild (B) → re-release cycle. **Only release the engine when consumers need the new version.** A CI-only engine change (e.g. a dispatch step) does not need a release. If you do release, immediately follow with playbook A then B on the action.

### E. Add a cross-repo dispatch
To make a downstream repo react to an upstream event, add a `gh api --method POST repos/{target}/dispatches -f event_type=<name>` step (reuse an existing cross-repo token; `continue-on-error: true` so it can't fail the upstream job), and a `repository_dispatch: { types: [<name>] }` trigger on the target workflow. Pattern in `publish.yml` (`contributors-please-released`) and `downstream-e2e.yml` (`contributors-please-action-updated`).

## Verify-before-claiming checklist

Before saying a plumbing change works:
- [ ] `npm run check:sync` passes (or only reports an intended, separately-tracked drift).
- [ ] `npm run check` passes (test + build + `git diff --exit-code -- dist`).
- [ ] The changed workflow actually ran green on a real SHA — not just "should pass". Confirm with `gh run view`.
- [ ] If the change is cross-repo, the downstream side received the event and ran (check the target repo's runs).
- [ ] No new drift introduced (e.g. didn't release the engine without re-syncing the action).

## References

- `references/sync-check.md` — what `check-engine-sync.mjs` checks and how to extend it.
- For the repo topology, trigger map, and the four version references, see the **monitor-multi-repo-ci** skill (its topology reference).
