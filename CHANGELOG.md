# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are managed by [release-please](https://github.com/googleapis/release-please) from conventional commits on `main`.

## [1.3.0](https://github.com/smorinlabs/contributors-please-action/compare/v1.2.0...v1.3.0) (2026-06-14)


### Features

* **ci:** add engine sync check with actionable remediation ([#26](https://github.com/smorinlabs/contributors-please-action/issues/26)) ([3091ee5](https://github.com/smorinlabs/contributors-please-action/commit/3091ee5b667b8e8aedafb91cceeb330b5b5920dd))


### Bug Fixes

* **deps:** rebuild dist against contributors-please v1.2.0 ([#25](https://github.com/smorinlabs/contributors-please-action/issues/25)) ([1f1fb40](https://github.com/smorinlabs/contributors-please-action/commit/1f1fb40a7818ca592b15bda49a1386b9de90eb7a))
* govern [skip ci] via new skip-ci input with mode-aware defaults ([#23](https://github.com/smorinlabs/contributors-please-action/issues/23)) ([da344ce](https://github.com/smorinlabs/contributors-please-action/commit/da344cea1e2e2643c0b4f2a9cb0c510bb69c2803)), closes [#22](https://github.com/smorinlabs/contributors-please-action/issues/22)

## [1.2.0](https://github.com/smorinlabs/contributors-please-action/compare/v1.1.0...v1.2.0) (2026-06-08)


### Features

* error on conflicting workflow input + yaml config keys ([#21](https://github.com/smorinlabs/contributors-please-action/issues/21)) ([e991553](https://github.com/smorinlabs/contributors-please-action/commit/e991553f93c9dfd0ecbedf93f705b046f267f2b9))


### CI/CD

* add sync-dist job to release-please workflow ([#18](https://github.com/smorinlabs/contributors-please-action/issues/18)) ([ae81173](https://github.com/smorinlabs/contributors-please-action/commit/ae8117383b261ad81c149b864a550997751ff5cf))

## [1.1.0](https://github.com/smorinlabs/contributors-please-action/compare/v1.0.6...v1.1.0) (2026-06-08)


### Features

* **ci:** add release-please for automated version bumps + GitHub Releases ([#15](https://github.com/smorinlabs/contributors-please-action/issues/15)) ([cc1cd8f](https://github.com/smorinlabs/contributors-please-action/commit/cc1cd8f8aedac40ca44d4fc71a9cdd4ee01c36ba))


### Testing

* assert package.json version with semver shape, not literal ([#17](https://github.com/smorinlabs/contributors-please-action/issues/17)) ([720d199](https://github.com/smorinlabs/contributors-please-action/commit/720d19926b2d6723975e31e5cc32364b4c460ddf))

## 1.0.6

- Initial release-please-managed entry. Prior releases (v1.0.0 – v1.0.6) were cut manually via `chore: release vX.Y.Z` commits; see git tags for history.
