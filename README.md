# contributors-please-action

GitHub Action wrapper for
[`contributors-please`](https://www.npmjs.com/package/contributors-please).
It discovers contributors from commits and the GitHub API, classifies them by
path, updates `.contributors.jsonl`, and renders contributor markdown.

## Usage

```yaml
name: Update Contributors

on:
  push:
    branches: [main]
    paths-ignore:
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
          fetch-depth: 0

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

App credentials are preferred when both App and PAT inputs are present. The PAT
is a fallback for repositories that have not installed the App yet.

## Modes

- `commit`: write generated files and commit directly to the current branch.
- `pull-request`: push `contributors-please/update`, create or update a PR, and
  apply the `contributors-please: pending` label unless `skip-labeling` is true.
- `check`: fail when generated files are stale; on pull requests, post or update
  a single contributors-please check comment.

`dry-run: true` computes outputs and logs skipped side effects without writing,
committing, pushing, labeling, opening PRs, failing check mode, or commenting.

### Commit messages and `[skip ci]`

- `commit-message` defaults to `docs: update contributors`. The `[skip ci]`
  trailer is controlled by the `skip-ci` input, not the message.
- `skip-ci` appends a `[skip ci]` trailer to the generated commit message. It
  defaults to `true` in `commit` mode (loop guard for commits pushed to the
  default branch) and `false` in `pull-request` mode. A custom `commit-message`
  that already contains `[skip ci]` is never double-appended.

> [!WARNING]
> In `mode: pull-request`, a `[skip ci]` trailer (from `skip-ci: true` or a
> custom `commit-message` containing it) is incompatible with required status
> checks on the base branch: the suppressed workflows never report, and the PR
> stays at "Expected — waiting for status to be reported" forever. For loop
> protection in pull-request flows, use `paths-ignore` on the generated files
> (e.g. `CONTRIBUTORS.md`, `.contributors.jsonl`) in the calling workflow
> instead of `[skip ci]`.

## Configuration

Create `.contributors.yml` in the repository:

```yaml
classifier: path
output_file: CONTRIBUTORS.md
state_file: .contributors.jsonl
in_place: true
in_place_marker_start: "<!-- contributors-please:start -->"
in_place_marker_end: "<!-- contributors-please:end -->"
entry_template: "- [{{name}}]({{profile}}) - {{title}} ({{commits}} commits)"

classification:
  categories:
    - id: docs
      label: Documentation Contributor
      paths:
        - "docs/**"
        - "*.md"
  default:
    id: code
    label: Code Contributor
```

Run the CLI once to bootstrap state:

```bash
npx contributors-please@1 init \
  --non-interactive \
  --owner OWNER \
  --repo REPO \
  --config-file .contributors.yml
```

### Configuration source policy

The Action enforces a single source of truth for each setting:

- `.contributors.yml` owns **project configuration** — how contributor pages
  look and how contributors are classified. This includes `in_place` (and its
  marker pair), `columns_per_row`, `entry_template`, `header`, `footer`,
  `template_file`, `template_placeholder`, `empty_text`, `sort`,
  `min_contributions`, `pin_warn_on_stale`, `ignore`, `unignore`,
  `classification`, and `identity_map`.
- Workflow inputs own **operational configuration** — how the Action runs in
  CI. This includes paths (`output-file`, `state-file`, `config-file`),
  execution `mode`, `dry-run`, branch and commit metadata, and credentials.

If any *config-file-only* key (the list above) is set in both
`.contributors.yml` and the workflow inputs, the Action fails fast with a
`ConfigError` naming each conflicting key and both source values — even when
the values agree. Remove the value from one source before re-running.

## GitHub Enterprise And Proxies

For GitHub Enterprise, set `github-server-url` when the default
`${{ github.server_url }}` is not enough. REST and GraphQL endpoints are derived
from that value unless `github-api-url` or `github-graphql-url` are set.

The Action honors standard `HTTPS_PROXY` and `NO_PROXY` environment variables
for GitHub API calls, App-token minting, and PAT identity lookup.

## Outputs

- `changed`
- `added-logins`
- `promoted-logins`
- `contributors-count`
- `token-source`
- `committer-login`
- `contributors-json`
- `pr-opened`
- `pr-number`
- `pr-url`
- `commit-sha`

See `action.yml` for the full input and output reference.
