# Test contracts

`public/` defines behavior consumers can depend on across releases. Break Check
restores this entire directory from the latest release, including the independent
PDFium and object readers and TypeScript configuration. The public command
type-checks those tests before running them. Add assertions here only when a
failure means an existing consumer capability has broken.

The independent readers live in `public/harness/`, with their own pinned dependency
manifest and lockfile. Test commands install that isolated dependency graph with
`--ignore-workspace --frozen-lockfile --ignore-scripts`, including after Break
Check restores a released suite. PDFium, its WASM and compatible types, and the pdf-lib object decoder
therefore travel with the historical tests rather than tracking Mondrian's
production renderer dependency. Keep observation helpers and their dependencies
inside this restored boundary.

Keep document setup inline in each public test and limited to the behavior it
asserts. If a test needs repeated construction, use a local helper named for that
specific scenario. Avoid shared, generic example documents: unrelated tests
should not inherit an arbitrary document's shape as part of their contract.

The contracts cover page order, geometry, rotation, text placement and metadata;
explicit versions and identifiers; deterministic output; manually described
object graphs and object primitives; validation failures; graphics and JPEG
placement, independent fonts and images on shared pages; and the rendering,
annotation, artifact verification, and Vitest entrypoints. Object-builder
contracts preserve ownership, reachable reservations, and single assignment.
Artifact verification compares changed painted content with identical render
options and preserves baselines regardless of their directory layout.
The reader also rejects cross-reference tables that required repair. Expected
values come from each description or PDF semantics, rather than comparing two
paths through the implementation. Graphics assertions sample solid interiors
and allow JPEG color variation; exact rendered pages remain private proofs. Public tests import `mondrian.pdf`
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
