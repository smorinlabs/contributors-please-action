# `.contributors.yml` and the config-source policy

`.contributors.yml` is the **project config** — how contributor pages look and how contributors are classified. Place it at the repo root.

## Minimal example

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

## Config-source policy (single source of truth)

Each setting belongs in exactly one place. The action **fails fast with a `ConfigError`** if a config-file-only key is set in both `.contributors.yml` and the workflow inputs — even when the values agree.

**Config-file-only keys** (must NOT also be workflow inputs):
`in_place`, `in_place_marker_start`, `in_place_marker_end`, `columns_per_row`, `entry_template`, `header`, `footer`, `template_file`, `template_placeholder`, `empty_text`, `sort`, `min_contributions`, `pin_warn_on_stale`, `ignore`, `unignore`, `classification`, `identity_map`.

**Operational keys** (workflow inputs, not the config file): paths (`output-file`, `state-file`, `config-file`), `mode`, `dry-run`, `branch`, `commit-message`, `skip-ci`, credentials.

> This is exactly what broke the test repo's CP-GHA-044 fixture: it set `entry_template` and `min_contributions` in *both* the config file and the workflow inputs, so every run failed with `conflicting configuration for keys "entry_template", "min_contributions"`. The fix was deleting the redundant workflow inputs (the config file is the source of truth for rendering).

## Composable inputs default to empty

Rendering/classification inputs that *can* be forwarded (e.g. `output-file`, `columns-per-row`, `sort`) have an **empty** `action.yml` default on purpose: a non-empty default would make `getInput` always return a value and silently override the config file. Leave them unset in the workflow to let `.contributors.yml` drive them.
