# Credentials: App vs PAT

The action accepts **either** a GitHub App (`app-id` + `private-key`) **or** a Personal Access Token (`pat`). When both are present, the App is preferred; the PAT is a fallback for repos that have not installed the App yet. This mirrors the action's internal `resolveCredentials` order.

## GitHub App (preferred)

Why preferred: commits are attributed to the App's bot identity, the token is short-lived (minted per run), and permissions are scoped to the installation.

Required inputs:

```yaml
app-id: ${{ secrets.CONTRIBUTORS_PLEASE_APP_ID }}
private-key: ${{ secrets.CONTRIBUTORS_PLEASE_PRIVATE_KEY }}
```

App installation needs these repository permissions:
- **Contents: read & write** — commit/push generated files.
- **Pull requests: read & write** — open/update the PR (pull-request mode).
- **Issues: read & write** — create/apply the `contributors-please: pending` label.

## PAT (fallback)

```yaml
pat: ${{ secrets.CONTRIBUTORS_PLEASE_PAT }}
```

A classic PAT with `repo` scope, or a fine-grained PAT with Contents + Pull requests + Issues read/write on the target repo. The action looks up the PAT's identity via `/user` to self-exclude the committer from contributor classification.

## Setting the secrets

Use the **`repo-secrets`** skill — it resolves the `release-please` and `contributors-please` GitHub App credentials from 1Password and pushes them as repo Actions secrets:

```
/repo-secrets   (or invoke the repo-secrets skill)
```

Secret names the workflow template expects:
- `CONTRIBUTORS_PLEASE_APP_ID`
- `CONTRIBUTORS_PLEASE_PRIVATE_KEY`
- `CONTRIBUTORS_PLEASE_PAT` (optional fallback)

## Required workflow permissions

Independent of credential type, the job needs:

```yaml
permissions:
  contents: write
  pull-requests: write
  issues: write
```

(The App/PAT grants the *ability*; `permissions:` grants the *workflow token* — both matter. With an App token the job permissions gate the App token's effective scope.)

## GitHub Enterprise / proxies

- Set `github-server-url` for GHE; REST and GraphQL URLs derive from it unless `github-api-url` / `github-graphql-url` are set.
- Standard `HTTPS_PROXY` / `NO_PROXY` are honored for API calls, App-token minting, and PAT identity lookup.
