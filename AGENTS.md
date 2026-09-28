# mondrian workspace

## Source Conventions

- Prefer `.ts` for source files and Node scripts. Do not create `.js`, `.cjs`, `.mjs`, or `.mts` source files; modern Node can run erasable TypeScript directly.

## Vite Plus Upgrades

Use the target release's official `vp migrate --no-interactive` for Vite Plus upgrades. Preserve the old lockfile until migration runs, and let the migrator own toolchain version alignment and supported source/configuration changes. Review its manual migration findings and run the repository's formatter and checks; do not maintain a separate dependency synchronization implementation.

## Changesets

Add or update a changeset whenever a change affects the functionality of a published package. Changesets should consolidate the consumer-visible differences between the current ref and the last release tag for that package.

Update existing changesets to describe the finished consumer-visible behavior as unshipped features evolve. A shipped feature is expected to work; defects fixed during its development are immaterial to consumers and should not be mentioned in changesets.

For packages below version 1.0.0:

- use a patch bump for non-breaking changes, including features and fixes
- use a minor bump for breaking changes

## Markdown

Do not manually wrap Markdown prose at a fixed line width. Keep each paragraph and each list item's prose on a single source line. Preserve structural line breaks for headings, lists, tables, and code blocks.

## Repository commands

Use the canonical command names in `docs/commands.md`: `fmt` writes formatting, `check` aggregates `check:*` validators, and `test` runs once. Coverage commands use the `cov` prefix where implemented. Keep CI and documentation references aligned when changing commands.
