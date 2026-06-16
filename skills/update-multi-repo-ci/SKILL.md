---
name: update-multi-repo-ci
description: Use when changing or repairing CI plumbing in the contributors-please three-repo system and proving it works — bumping the tracked engine ref, rebuilding dist after an engine release, fixing the sync-dist job, or adding cross-repo dispatch. Triggers on "bump the engine", "rebuild dist", "sync the action with the engine", "engine-sync failing", "update the CI".
metadata:
  type: technique
  repos: smorinlabs/contributors-please, contributors-please-action, contributors-please-test
---

# Update multi-repo CI (and verify it works)

Make a change to the CI plumbing between the engine, the action, and the test harness — then **prove** it holds before declaring done. The backbone is the engine-sync check; the discipline is verify-before-claiming.

**Core principle:** the action and engine stay in sync across **four version references** (embedded lib `VERSION`, lockfile snapshot, `.contributors-please-engine-ref`, latest engine release). Every plumbing change either keeps them equal or is incomplete. Verify with `npm run check:sync:trusted`, never by eyeballing.

> Diagnosis lives in the **monitor-multi-repo-ci** skill; this skill is the fix + verification. Use TDD: a workflow/script test that fails first (superpowers:test-driven-development).

## The sync invariant

Run from the action repo:
```bash
npm run check:sync        # trusted default (needs network/GITHUB_TOKEN)
npm run check:sync:trusted # trusted network check: tracked ref vs latest release
npm run check:sync:local  # offline subset (pre-commit): embedded vs lockfile vs tracked ref vs sibling engine
```
On mismatch it prints the **exact** remediation command for the diverged pair. CI runs it in `engine-sync.yml` (PR, daily cron, `contributors-please-released` dispatch). Pre-commit runs the offline subset.

## Playbooks

### A. Tracked ref lags latest engine release
1. Run `.github/workflows/sync-engine-release.yml` with `engine_ref=vX.Y.Z`, or wait for the `contributors-please-released` dispatch from the engine release.
2. Review the sync PR. It should update `.contributors-please-engine-ref`, `package-lock.json`, and `dist/contributors-please-lib.js`.
3. **Verify:** `npm run check:sync:trusted` and `npm run check` pass on the PR.

### B. Rebuild dist after an engine release
Prefer playbook A: the sync workflow handles the tracked ref, lockfile, and dist rebuild together. Manual rebuilds are only for fixing that automation.

1. Materialize the engine at the new release tag in the sibling dir `file:../contributors-please` expects. It may not exist (worktrees get cleaned up) — create it:
   `git -C <engine-repo> worktree add --detach ../contributors-please vX.Y.Z` (path relative to the action checkout's parent). Confirm with `node -p "require('../contributors-please/package.json').version"`.
2. `printf '%s\n' vX.Y.Z > .contributors-please-engine-ref`, then `npm install && npm run build && npm test` in the action repo.
3. Expect a small diff: the embedded `VERSION` literal in `dist/contributors-please-lib.js` and the lockfile snapshot.
4. **Verify:** `npm run check:sync:trusted` passes; fresh-clone `npm ci && npm run build` leaves `git diff --exit-code -- dist` clean (this is what CP-GHA-038 enforces).
5. Commit `.contributors-please-engine-ref`, `dist`, and `package-lock.json`; PR it. Merge → release-please cuts the next patch release; merging that advances `@v1`.

### C. Any workflow that builds the action must materialize the engine first
This is the recurring lesson (it bit `ci.yml`, then `sync-dist`). `npm run build` (ncc) can't resolve `file:../contributors-please` unless the engine is checked out and linked. Use the shared helper before the build:

```yaml
- name: Setup local library dependency
  env:
    CONTRIBUTORS_PLEASE_LIBRARY_TOKEN: ${{ secrets.CONTRIBUTORS_PLEASE_LIBRARY_TOKEN }}
    GITHUB_TOKEN: ${{ github.token }}
  run: node scripts/setup-engine-dep.mjs
```

If you add a new build job, apply the same helper step and run the appropriate sync gate.
- **Verify:** the build job is green and uses `node scripts/setup-engine-dep.mjs`.

### D. Engine-release decision (avoid self-inflicted drift)
Releasing the engine moves "latest release" ahead of the action's tracked ref, so `engine-sync` will (correctly) flag the action as stale and the sync workflow should open a rebuild PR. **Only release the engine when consumers need the new version.** A CI-only engine change (e.g. a dispatch step) does not need a release. If you do release, make sure the sync PR lands.

### E. Add a cross-repo dispatch
To make a downstream repo react to an upstream event, add a `gh api --method POST repos/{target}/dispatches -f event_type=<name>` step (reuse an existing cross-repo token; `continue-on-error: true` so it can't fail the upstream job), and a `repository_dispatch: { types: [<name>] }` trigger on the target workflow. Pattern in `publish.yml` (`contributors-please-released`) and `downstream-e2e.yml` (`contributors-please-action-updated`). Set `persist-credentials: false` on any read-only checkout the dispatch step doesn't push through.

## Verify-before-claiming checklist

Before saying a plumbing change works:
- [ ] `npm run check:sync:trusted` passes (or only reports an intended, separately-tracked drift).
- [ ] `npm run check` passes (test + build + `git diff --exit-code -- dist`).
- [ ] The changed workflow actually ran green on a real SHA — not just "should pass". Confirm with `gh run view`.
- [ ] If the change is cross-repo, the downstream side received the event and ran (check the target repo's runs).
- [ ] No new drift introduced (e.g. didn't release the engine without re-syncing the action).

## References

- `references/sync-check.md` — what `check-engine-sync.mjs` checks and how to extend it.
- For the repo topology, trigger map, and the four version references, see the **monitor-multi-repo-ci** skill (its topology reference).
