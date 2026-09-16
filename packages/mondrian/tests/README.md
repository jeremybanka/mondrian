# Test contracts

`public/` defines behavior consumers can depend on across releases. Break Check
restores this entire directory from the latest release, including the independent
PDFium reader and TypeScript configuration. The public command
type-checks those tests before running them. Add assertions here only when a
failure means an existing consumer capability has broken.

The independent reader lives in `public/harness/`, with its own pinned dependency
manifest and lockfile. Test commands install that isolated dependency graph with
`--ignore-workspace --frozen-lockfile --ignore-scripts`, including after Break
Check restores a released suite. The reader, its WASM, and its compatible types
therefore travel with the historical tests rather than tracking Mondrian's
production renderer dependency. Keep observation helpers and their dependencies
inside this restored boundary.

Keep document setup inline in each public test and limited to the behavior it
asserts. If a test needs repeated construction, use a local helper named for that
specific scenario. Avoid shared, generic example documents: unrelated tests
should not inherit an arbitrary document's shape as part of their contract.

The initial contracts cover page order, geometry, rotation, text and metadata
preservation; explicit PDF versions; deterministic output; interoperability
between the builders, validator, and serializer; reserved references; and
rejection of invalid page ownership and reuse. Public tests import `mondrian.pdf`
through its package exports, using the built JavaScript and declarations. Build,
type-check, and test commands prepare those artifacts before resolving consumer
imports. Moving source files without changing package imports does not change
these contracts.

`private/` contains implementation tests, source-entrypoint smoke tests, and
visual regressions. These can evolve without certifying a breaking change. The
visual proof for nested pages and escaped text has its own inline setup here so
renderer versions and exact pixel baselines do not become API compatibility
promises.

Run `pnpm --filter mondrian.pdf test:once:public` for the public suite. Normal
test and coverage commands run both directories. Run `pnpm test:semver` from a
clean checkout for current public tests followed by release compatibility.

The command invokes the `break-check` CLI directly and preserves its failure
behavior for missing tests and other inconclusive checks. Release
`mondrian.pdf@0.1.0` predates this directory, so the release comparison fails
until a release includes the public suite. The current public tests run before
the release comparison.
