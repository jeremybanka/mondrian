# Repository commands

Run these commands from the repository root with `pnpm run <command>`. `mise.toml` selects the toolchain. Package-level commands keep the same meaning while narrowing their scope.

Following the [mise Node.js cookbook](https://mise.jdx.dev/mise-cookbook/nodejs.html#add-node-modules-binaries-to-the-path), mise adds the repository root’s `node_modules/.bin` to `PATH`. With shell activation or `mise exec -- <tool>`, installed dependency CLIs are available from the root and package directories.

| Command            | Contract                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `fmt`              | Apply the repository formatting policy.                                                                                  |
| `check:fmt`        | Validate formatting without rewriting maintained files; language-specific validators are listed below.                   |
| `check`            | Run every static check listed below. Generated prerequisites and caches may be written; source fixes are explicit.       |
| `test`             | Run the normal test suite once and return a failing status when tests fail.                                              |
| `test:watch`       | Watch the available interactive test suites.                                                                             |
| `build`            | Build distributable artifacts.                                                                                           |
| `change`           | Author pending release notes.                                                                                            |
| `release:version`  | Prepare versions and release metadata without publishing.                                                                |
| `release:publish`  | Build as required by the release pipeline and publish packages.                                                          |
| `workflows:update` | Update pinned workflow tooling references.                                                                               |
| `cov`              | Run instrumented tests and generate local coverage reports.                                                              |
| `cov:check`        | Generate coverage and enforce the existing baseline policy; Recoverage may synchronize hosted baselines when configured. |

## Static checks

- `check:fmt`: `dprint check`.
- `check:public-types`: `vp run -r check:public-types`; validates public consumer imports against source.
- `check:vp`: `vp check --no-fmt`.

`check:vp` invokes the configured Vite Plus validation pipeline; `check:fmt` handles formatting separately.

## Command notes

`test:semver` runs released public tests against source without a build or current-test preflight. `test:public` only runs public tests; `check:public-types` checks their consumer imports separately. Build, current tests, consumer type checks, and release compatibility run as separate CI jobs. Compatibility checks need access to the Git remote and release tags.

Coverage comparison requires a captured default-branch baseline or access to the hosted baseline through `RECOVERAGE_CLOUD_TOKEN`. Coverage comparison retains the existing Recoverage capture-and-diff behavior; this repository does not expose a separate upload-only command.

## Migration

Use `check:fmt` for formatting validation and `check:<tool>` for static checks. Use the canonical commands directly; superseded names have been removed.
