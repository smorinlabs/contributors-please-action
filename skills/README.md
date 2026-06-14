# contributors-please skills

Claude Code skills for operating the `contributors-please` three-repo system
([engine](https://github.com/smorinlabs/contributors-please) →
[action](https://github.com/smorinlabs/contributors-please-action) →
[test harness](https://github.com/smorinlabs/contributors-please-test)).

| Skill | Use when |
|---|---|
| [`install-contributors-please-action`](install-contributors-please-action/SKILL.md) | Onboarding a repo onto the action — workflow YAML, mode choice, credentials, loop protection, bootstrap |
| [`monitor-multi-repo-ci`](monitor-multi-repo-ci/SKILL.md) | Watching or diagnosing the CI cascade — a stuck merge, a failed downstream suite, a workflow that never triggered, rate-limit errors |
| [`update-multi-repo-ci`](update-multi-repo-ci/SKILL.md) | Changing/repairing CI plumbing and proving it — version bumps, the `CONTRIBUTORS_PLEASE_LIBRARY_REF` pin, dist rebuilds, the `sync-dist` fix, cross-repo dispatch |

They compose: **monitor** diagnoses a failure → hands off to **update** for the fix → **install** is the standalone onboarding guide. **monitor** holds the shared topology and failure catalog the other two reference.

## Install (Claude Code)

These skills live in this repo under `skills/`. To use them as personal skills:

```bash
mkdir -p ~/.claude/skills
for s in install-contributors-please-action monitor-multi-repo-ci update-multi-repo-ci; do
  mkdir -p ~/.claude/skills/$s/references
  curl -sL "https://raw.githubusercontent.com/smorinlabs/contributors-please-action/v1/skills/$s/SKILL.md" \
    > ~/.claude/skills/$s/SKILL.md
done
# references/ files: copy the same way per skill (see each SKILL.md's References section)
```

Claude Code auto-discovers skills from `~/.claude/skills/`. Or, if this repo is your working directory, project skills under `skills/` are discovered directly.

## Related

- The `repo-secrets` skill sets the GitHub App secrets these workflows need (referenced by `install-contributors-please-action`).
- The action's `docs/RUNBOOK.md` covers acceptance/release procedures and the engine-sync check.
