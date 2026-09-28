# Repository commands

Run these commands from the repository root with `pnpm run <command>`. `mise.toml` selects the toolchain. Package-level commands keep the same meaning while narrowing their scope.

| Command            | Contract                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `fmt`              | Apply the repository formatting policy.                                                                                  |
| `check:fmt`        | Validate formatting without rewriting maintained files; language-specific validators are listed below.                   |
| `check`            | Run every static check listed below. Generated prerequisites and caches may be written; source fixes are explicit.       |
| `test`             | Run the normal test suite once and return a failing status when tests fail.                                              |
| `test:watch`       | Watch the available interactive test suites.                                                                             |
| `build`            | Build distributable artifacts.                                                                                           |
| `verify`           | Run the repository checks, tests, builds, and implemented coverage or compatibility gates.                               |
| `change`           | Author pending release notes.                                                                                            |
| `release:version`  | Prepare versions and release metadata without publishing.                                                                |
| `release:publish`  | Build as required by the release pipeline and publish packages.                                                          |
| `workflows:update` | Update pinned workflow tooling references.                                                                               |
| `cov`              | Run instrumented tests and generate local coverage reports.                                                              |
| `cov:check`        | Generate coverage and enforce the existing baseline policy; Recoverage may synchronize hosted baselines when configured. |

## Static checks

- `check:fmt`: `dprint check`.
- `check:vp`: `pnpm run build && vp check --no-fmt`.

`check:vp` invokes the configured Vite Plus validation pipeline; `check:fmt` handles formatting separately.

## Verification

`pnpm run verify` executes `pnpm run check && pnpm run test && pnpm run build && pnpm run test:semver && pnpm run cov:check`. CI can run these constituent commands in separate jobs. Check failures must propagate to the caller.

Release compatibility checks need access to the Git remote and release tags.

Coverage comparison requires a captured default-branch baseline or access to the hosted baseline through `RECOVERAGE_CLOUD_TOKEN`. Coverage comparison retains the existing Recoverage capture-and-diff behavior; this repository does not expose a separate upload-only command.

## Migration

Use `check:fmt` for formatting validation and `check:<tool>` for static checks. Existing non-conflicting aliases remain available, but CI and maintainer documentation use the canonical commands.
