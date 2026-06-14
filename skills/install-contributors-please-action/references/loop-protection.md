# Loop protection: `[skip ci]` vs `paths-ignore`

The action commits generated files (`CONTRIBUTORS.md`, `.contributors.jsonl`). Without protection, that commit retriggers the workflow → infinite loop. There are two mechanisms, and **using the wrong one for the mode is a known footgun.**

## The `skip-ci` input

- `skip-ci: true` appends a `[skip ci]` trailer to the generated commit message; GitHub then skips `push`/`pull_request` workflow triggers on that commit.
- Per-mode defaults (don't re-encode them — leave `skip-ci` unset to inherit):
  - `commit` mode → defaults **`true`** (loop guard for direct pushes).
  - `pull-request` mode → defaults **`false`** (see below).
- The `commit-message` default is `docs: update contributors` (no trailer). The trailer is governed by `skip-ci`, not the message. A custom `commit-message` already containing `[skip ci]` is never double-appended.

## Why `[skip ci]` is wrong in pull-request mode (issue #22)

A `[skip ci]` trailer on a PR's head commit suppresses every `push`/`pull_request` workflow trigger on that commit. If the base branch has **required status checks** backed by those workflows, the checks never report and the PR is permanently stuck:

> `mergeable_state: blocked` — "Expected — waiting for status to be reported"

Nothing errors; the PR just never becomes mergeable. Real-world occurrence: `smorinlabs/py-launch-blueprint#394` — bot PR green on every visible check (CLA, CodeQL — both immune to `[skip ci]`) yet blocked because none of the repo's CI workflows ever started on the head commit.

**Therefore:** in `pull-request` mode, leave `skip-ci` unset (defaults to `false`) and protect against loops with `paths-ignore` on the generated files in the calling workflow:

```yaml
on:
  push:
    branches: [main]
    paths-ignore:
      - CONTRIBUTORS.md
      - .contributors.jsonl
```

## Decision table

| Mode | Loop protection | `skip-ci` |
|---|---|---|
| `commit` | `[skip ci]` trailer | leave unset (true) |
| `pull-request` | `paths-ignore` on generated files | leave unset (false) — do NOT force true |
| `check` | n/a (no commit) | n/a |
