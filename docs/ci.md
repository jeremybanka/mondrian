# Dagger CI

The TypeScript module in `.dagger/modules/ci/src/index.ts` runs the repository's canonical commands in containers. Node and pnpm versions come from the root `package.json`, and Bun comes from `mise.toml`; `pnpm-lock.yaml` is installed with `--frozen-lockfile`. `mise.toml` also pins the Dagger CLI, and `dagger.lock` pins resolved SDK and container references. Commit the generated module bindings and both lockfiles.

The CLI currently uses mise's HTTP backend for the pinned 1.0 beta. Dagger's [release implementation](https://github.com/dagger/dagger/blob/main/.dagger/modules/cli-dev/publish.go) publishes stable CLI releases to GitHub but distributes prereleases through `dl.dagger.io`. Return to the normal mise `dagger` registry entry when a compatible release is available there; the older 0.21 series cannot run this 1.0 workspace unchanged.

## Run before pushing

Install the tools with `mise install` and start a Docker-compatible container runtime. From the repository root:

```sh
dagger check -l
dagger check
dagger check
```

The second unchanged run should reuse successful work from the first run. Use `dagger check --progress=plain -v` to inspect cached operations. Keep the same engine running between calls; a fresh engine does not inherit another engine's local cache automatically. Initial downloads, SDK generation, and dependency installation make the first run slower.

| Check             | Repository command                                               |
| ----------------- | ---------------------------------------------------------------- |
| `ci:format`       | `pnpm run check:fmt`                                             |
| `ci:eslint`       | `pnpm run check:eslint`                                          |
| `ci:lasertag`     | `pnpm run check:lasertag`                                        |
| `ci:vite-plus`    | `pnpm run check:vp`                                              |
| `ci:public-types` | `pnpm run build`, then `pnpm run check:public-types`             |
| `ci:test`         | `pnpm run build`, then `pnpm run test`                           |
| `ci:build`        | `pnpm run build`, then `pnpm --filter mondrian.pdf test:package` |

Run only a relevant check during development, then the full suite before pushing:

```sh
dagger check --ci
dagger check 'ci:test'
dagger check 'ci:vite-plus'
dagger check
```

`--ci` selects the seven repository checks and omits the SDK's generated-binding drift check. Use it for the normal edit/test loop; run the unfiltered command before pushing, especially after editing the Dagger module. Even when every repository command is cached, SDK loading and drift validation can take additional time.

The module does not hide untracked source files. Unformatted experiments or output files in your working tree can fail the formatting check even when a clean checkout passes. Keep local scratch output outside the checkout or apply the repository's normal ignore/formatting policy deliberately.

## Debug and maintain the pipeline

```sh
# Inspect the same dependency and source environment used by the checks.
dagger api call ci container terminal

# After changing the TypeScript module, regenerate its dispatch and client files.
dagger generate --auto-apply

# Review available updates before refreshing specific locked dependencies.
dagger lock list
dagger lock update github.com/dagger/typescript-sdk@refs/tags/v1.0.4
```

The SDK owns `clients/`, `entrypoint/`, `__dagger.dispatch.ts`, and the module's `dagger-module.toml`, `package.json`, and `tsconfig.json`; do not hand-edit or reformat them. These generated files are excluded from dprint. Authored module source remains formatted by dprint. The Dagger module has its own TypeScript configuration and decorators, so the application's Vite Plus checks exclude `.dagger/`. Dagger checks generated bindings for drift by default.

## GitHub Actions

The `Check` workflow runs `dagger check` on pushes to `main` and on pull requests. It includes the seven repository checks and SDK generated-binding validation. A standard Ubuntu runner starts the pinned Dagger engine locally; no Dagger Cloud account, token, or subscription is needed. Coverage, Breakage, and release automation retain their existing workflows. Build and Vitest no longer execute in separate jobs.

The repository currently requires statuses named `Vitest`, `Vite Plus`, `Dprint`, and `Breakage`. Three lightweight compatibility jobs report the aggregate Dagger result under the first three names, without rerunning their commands. Once the repository rules require `Dagger checks` and `Breakage` instead, remove the compatibility jobs. A failed, cancelled, or skipped Dagger job cannot pass these gates.

Dagger Cloud Checks should remain off to avoid duplicate executions. Check or disable them from an authenticated checkout with:

```sh
dagger cloud checks status
dagger cloud checks off
```

Disabling checks does not cancel a Cloud subscription. Local runs use a Docker-compatible runtime; an existing Cloud login may still upload traces. Use `dagger cloud logout` if you do not want that account used locally.

## Cache persistence and measurements

GitHub runners start with empty local state. The workflow uses `actions/cache` to restore a compressed snapshot before starting Dagger. After successful checks, it stops the engine cleanly and archives `/var/lib/dagger`, preserving ownership, hard links, ACLs, and extended attributes. An unclean shutdown can cause this beta to discard its persisted cache. Never archive a running engine.

Cache keys separate the snapshot format, OS, architecture, and exact Dagger version. Each commit has an immutable snapshot key with a version-compatible fallback; Dagger decides which restored operations are still valid. Fork pull requests can restore available caches but do not upload snapshots. Engine garbage collection targets a 6 GB cache with 2 GB of free disk space. Snapshots count against GitHub's repository cache allowance and can be evicted. Cache download, extraction, archival, or upload failures do not turn successful checks into failures: missing or unusable snapshots fall back to fresh execution, and only cleanly stopped successful runs can save a snapshot.

This is a snapshot workaround, not a native Dagger remote-cache backend. A cache hit from GitHub alone does not prove Dagger reused work. The workflow uploads check and engine logs as the `dagger-checks` artifact for three days; inspect `Container.withExec CACHED` entries. The job summary reports check and archive timings. Compare total job duration, including image pulls and cache transfers, when deciding whether caching helps.

For a fresh-engine comparison, select **Actions → Check → Run workflow** and disable the cache option. With caching enabled, run twice on the same commit, then repeat after a source change. The manual input only controls the manual run; push and pull-request runs use caching automatically. The workflow cancels superseded runs on the same ref and does not save snapshots from cancelled or failed checks.

A local Linux ARM64 experiment with Dagger `1.0.0-beta.21` passed all seven repository checks and 1,038 tests in 68.7 seconds from a fresh engine. After clean shutdown, archiving took 9.8 seconds and produced a 1.59 GB compressed snapshot. Extracting into a separate engine volume took 9.7 seconds; the unchanged checks then passed in 6.6 seconds with all repository executions cached. These measurements predate the latest dependency updates, exclude SDK binding-drift validation, GitHub upload/download, and engine image pull time, and do not establish hosted-runner performance. Most source edits invalidate this module's whole-repository check inputs, although dependency installation can remain cached, so unchanged reruns represent the best case.

[Garden Snail](https://github.com/pkarolyi/garden-snail) implements Turborepo's remote artifact API. It is not compatible with Dagger's engine cache protocol. For persistent Dagger caching without whole-state transfers, the documented alternative is a [self-hosted engine with a persistent disk](https://docs.dagger.io/self-hosting/) that GitHub Actions connects to.

## Faster feedback with bounded work

Dependency installation depends on manifests, the lockfile, and toolchain configuration, rather than every source edit. All checks share that installed container. The build is shared by tests, consumer type checks, and installed-package verification. Independent checks can run concurrently, while Dagger caches successful operations by their declared inputs. Unchanged work can be reused; changed source still needs validation. Cache eviction, different platforms, changed images, and different engines can produce misses.

The repository commands use `disableDaggerInDagger: true`: they do not need Dagger API access. With the pinned beta engine, this also avoids the module execution context invalidating their caches between runs. The SDK's own module execution and generated-binding validation still have overhead.

Use a focused check while editing and the complete suite at the integration boundary. Avoid running duplicate CI jobs alongside the Dagger workflow. For an agent, provide the failing check, its diagnostic, and a trace link instead of repeatedly pasting full successful logs or asking it to rediscover the environment. These checks execute ordinary tools and do not call an LLM. Token savings come from fewer retries and less repeated context, not from Dagger making every agent interaction free. Parallelism reduces elapsed time but does not by itself reduce CPU work; caching and avoiding duplicate runs do that.

Official references: [self-hosting](https://docs.dagger.io/self-hosting/), [checking code](https://docs.dagger.io/using/checking/), and [GitHub cache behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).
