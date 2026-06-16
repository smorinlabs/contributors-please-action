---
name: install-contributors-please-action
description: Use when onboarding a repository onto contributors-please-action — adding the Update Contributors workflow, choosing commit vs pull-request vs check mode, wiring App or PAT credentials, setting skip-ci and paths-ignore loop protection, or bootstrapping the initial .contributors.jsonl state. Triggers on "add contributors-please", "set up the contributors action", "install contributors-please-action", "contributors workflow".
metadata:
  type: reference
  repo: smorinlabs/contributors-please-action
---

# Install contributors-please-action

Onboard a repository onto [`contributors-please-action`](https://github.com/smorinlabs/contributors-please-action) — the GitHub Action that discovers contributors from commits + the GitHub API, classifies them by path, updates `.contributors.jsonl`, and renders contributor markdown.

**Core principle:** the calling workflow owns *operational* config (mode, paths, credentials, loop protection); `.contributors.yml` owns *project* config (rendering, classification). Setting a config-file-only key in both fails fast.

## Install in four steps

1. **Add `.contributors.yml`** (project config — see `references/config-reference.md`).
2. **Bootstrap state once** so the first run is incremental, not a cold start:
   ```bash
   npx contributors-please@1 init --non-interactive \
     --owner OWNER --repo REPO --config-file .contributors.yml
   ```
   Commit the generated `.contributors.jsonl` and rendered output file. (Or set `bootstrap: true` on the first action run instead.)
3. **Add the workflow** (`.github/workflows/contributors.yml`) — template below.
4. **Set credentials** — App (preferred) or PAT. Use the `repo-secrets` skill to push them from 1Password; see `references/credentials.md`.

## Workflow template

```yaml
name: Update Contributors
on:
  push:
    branches: [main]
    paths-ignore:        # loop protection — see "Loop protection" below
      - CONTRIBUTORS.md
      - .contributors.jsonl
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
  issues: write
jobs:
  contributors-please:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0          # REQUIRED — full history for commit discovery
      - uses: smorinlabs/contributors-please-action@v1
        with:
          app-id: ${{ secrets.CONTRIBUTORS_PLEASE_CLIENT_ID }}
          private-key: ${{ secrets.CONTRIBUTORS_PLEASE_PRIVATE_KEY }}
          pat: ${{ secrets.CONTRIBUTORS_PLEASE_PAT }}
          mode: pull-request
          output-file: CONTRIBUTORS.md
          state-file: .contributors.jsonl
          config-file: .contributors.yml
```

## Mode selection

| Mode | Effect | Use when |
|---|---|---|
| `pull-request` | Pushes `contributors-please/update`, opens/updates a PR, applies `contributors-please: pending` label | Default. Review before merge; base branch is protected |
| `commit` | Commits generated files directly to the current branch | Trusted automation; no review needed |
| `check` | Fails if generated files are stale; comments on PRs | CI gate to enforce contributors stay current |

## Loop protection (critical)

The action commits generated files, which can retrigger the workflow. Two mechanisms — **choose by mode**:

- **`commit` mode** → `skip-ci: true` (the default). The `[skip ci]` trailer stops the push from retriggering.
- **`pull-request` mode** → **`paths-ignore`** on the generated files (as in the template). Do **NOT** use `[skip ci]` here: it suppresses the required status checks on the PR's head commit, so the PR is stuck at "Expected — waiting for status to be reported" and never becomes mergeable. (`skip-ci` defaults to `false` in pull-request mode for this reason.)

See `references/loop-protection.md` for the full failure mode.

## Common mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Missing `fetch-depth: 0` | Few/no contributors discovered | Add it to `actions/checkout` |
| `[skip ci]` in pull-request mode | PR never mergeable, checks "Expected" | Use `paths-ignore` instead; leave `skip-ci` unset |
| Same key in workflow + `.contributors.yml` | `ConfigError: conflicting configuration` | Remove from one source (config file wins for rendering/classification) |
| No `paths-ignore` and `commit` mode without skip-ci | Infinite workflow loop | `skip-ci: true` (default) or add `paths-ignore` |
| No state bootstrap | First run treats everyone as new | Run `init` or `bootstrap: true` once |

## References

- `references/config-reference.md` — `.contributors.yml` keys and the config-source policy.
- `references/credentials.md` — App vs PAT, required permissions, `repo-secrets` skill.
- `references/loop-protection.md` — why `[skip ci]` blocks PRs; the issue #22 incident.
- Full input/output reference: the action's `action.yml`.
