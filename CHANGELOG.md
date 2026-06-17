# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are managed by [release-please](https://github.com/googleapis/release-please) from conventional commits on `main`.

## [1.3.5](https://github.com/smorinlabs/contributors-please-action/compare/v1.3.4...v1.3.5) (2026-06-17)


### Documentation

* **ci:** document CONTRIBUTORS_PLEASE_TEST_DISPATCH_TOKEN purpose and scope ([#35](https://github.com/smorinlabs/contributors-please-action/issues/35)) ([568da22](https://github.com/smorinlabs/contributors-please-action/commit/568da228d46a360d3060e21dce3da6f2b51ee329))
* **skills:** align monitor skill with live-adoption blocking policy ([#43](https://github.com/smorinlabs/contributors-please-action/issues/43)) ([7bb6238](https://github.com/smorinlabs/contributors-please-action/commit/7bb6238750782f07702fc13112eb02ef9ee017e0))
* **skills:** mark sync-dist fixed and add multi-repo CI playbook hardening ([#42](https://github.com/smorinlabs/contributors-please-action/issues/42)) ([c1a1b47](https://github.com/smorinlabs/contributors-please-action/commit/c1a1b47930e4a62f6495097ffb4b587f225f842d))
* update stale *_APP_ID references to *_CLIENT_ID ([#40](https://github.com/smorinlabs/contributors-please-action/issues/40)) ([b2a7a8b](https://github.com/smorinlabs/contributors-please-action/commit/b2a7a8b64cc2e2c3f4df0e6cb2090bd107f1cb57))


### CI/CD

* accept release dispatch version payload ([78e01ca](https://github.com/smorinlabs/contributors-please-action/commit/78e01cafa371ceed748a4e5db1f80d651c908012))
* harden contributors-please engine sync ([9176dd1](https://github.com/smorinlabs/contributors-please-action/commit/9176dd1773e335e16e1c5ec3927ac5e11344be5d))
* prefer REST for workflow PR operations ([ca864f8](https://github.com/smorinlabs/contributors-please-action/commit/ca864f8b65dd17f207ba4b20c3a8f64db200f910))
* test downstream against declared engine ref ([fe72765](https://github.com/smorinlabs/contributors-please-action/commit/fe727656ea55d3fbd893cfb49b9861ee1ce338b9))

## [1.3.4](https://github.com/smorinlabs/contributors-please-action/compare/v1.3.3...v1.3.4) (2026-06-16)


### CI/CD

* migrate e2e.yml from app-id to client-id ([#38](https://github.com/smorinlabs/contributors-please-action/issues/38)) ([86f325c](https://github.com/smorinlabs/contributors-please-action/commit/86f325cd0a73ee4560aea7a2d5b2714527e17a86))
* probe RELEASE_PLEASE_CLIENT_ID auth path ([8ce051d](https://github.com/smorinlabs/contributors-please-action/commit/8ce051d94eb6ca1bbc0d75624ea0f2332a8c1e8d))

## [1.3.3](https://github.com/smorinlabs/contributors-please-action/compare/v1.3.2...v1.3.3) (2026-06-16)


### Bug Fixes

* **deps:** rebuild dist against contributors-please v1.3.0 ([#33](https://github.com/smorinlabs/contributors-please-action/issues/33)) ([be46756](https://github.com/smorinlabs/contributors-please-action/commit/be467567d28207a2d2123a591c0ea212b88bf6ce))


### CI/CD

* disable credential persistence on release-please engine checkout ([#32](https://github.com/smorinlabs/contributors-please-action/issues/32)) ([32758e9](https://github.com/smorinlabs/contributors-please-action/commit/32758e929e2bbe3a4628178a9f6e267c168fae71))

## [1.3.2](https://github.com/smorinlabs/contributors-please-action/compare/v1.3.1...v1.3.2) (2026-06-15)


### Bug Fixes

* **ci:** materialize engine dep before sync-dist build ([#29](https://github.com/smorinlabs/contributors-please-action/issues/29)) ([2988f81](https://github.com/smorinlabs/contributors-please-action/commit/2988f81af862b083cc369fa3ae2cbfa6ff627d3c))


### CI/CD

* disable credential persistence on read-only engine checkouts ([#30](https://github.com/smorinlabs/contributors-please-action/issues/30)) ([ac67c5d](https://github.com/smorinlabs/contributors-please-action/commit/ac67c5dfdf2926476e5acbb61025106cebfe778f))

## [1.3.1](https://github.com/smorinlabs/contributors-please-action/compare/v1.3.0...v1.3.1) (2026-06-14)


### Documentation

* **skills:** add three Claude Code skills for the multi-repo system ([#27](https://github.com/smorinlabs/contributors-please-action/issues/27)) ([7794967](https://github.com/smorinlabs/contributors-please-action/commit/7794967adbc386c42e0cdd0588130ceada46bf28))

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
