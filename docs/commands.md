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
- `check:eslint`: `vp run -r check:eslint`; the guide uses the npm `atom.io/eslint-plugin` and `lasertag/eslint-plugin` with typed parsing and import checks.
- `check:public-types`: `vp run -r check:public-types`.
- `check:lasertag`: `vp run -r check:lasertag`; checks component-owned CSS Modules against their render structure.
- `check:vp`: `vp check --no-fmt && vp run -r check:tsc`.

`check:vp` invokes the configured Vite Plus validation pipeline and package TypeScript checks. Formatting, ESLint, and Lasertag each have a separate CI job and canonical command.

## Command notes

The private PDF field guide in `apps/pdf-guide` provides `dev` and `preview` for the Vite development server and built-site preview. Run `pnpm --filter @mondrian/pdf-guide dev` from the root; it builds the Mondrian dependency first. Its `check` command aggregates `check:eslint`, `check:tsc`, and `check:lasertag`. ESLint follows atom.io’s flat-config approach, including a compatibility bridge in `.pnpmfile.mjs` that gives TypeScript ESLint v8 the TypeScript 6 compiler API while the repository’s `tsc` remains on TypeScript 7.

Release compatibility checks need access to the Git remote and release tags.

Coverage comparison requires a captured default-branch baseline or access to the hosted baseline through `RECOVERAGE_CLOUD_TOKEN`. Coverage comparison retains the existing Recoverage capture-and-diff behavior; this repository does not expose a separate upload-only command.

## Migration

Use `check:fmt` for formatting validation and `check:<tool>` for static checks. Use the canonical commands directly; superseded names have been removed.
