# Test contracts

`public/` defines behavior consumers can depend on across releases. Break Check
restores both the released tests and the inspection source used to read their
output. Its pattern is `{tests/public,src/testing/inspection}/**/*`. The public
command builds the package, type-checks consumer imports, then runs the tests.
Add assertions here only when a failure means an existing consumer capability
has broken.

The independent readers ship through `mondrian.pdf/testing` and live in
`src/testing/inspection/`. Break Check restores that source alongside historical
assertions and rebuilds it, so changing today's reader does not silently change
yesterday's observations. Rendering and artifact comparison remain current
implementations under test. All dependencies use the package's ordinary manifest
and workspace lockfile; there is no separate harness installation. Dependency
upgrades must keep the restored inspection source runnable.

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

## Plate preview contracts

`public/plates.test.ts` covers discovery order and ink identity, permitted color spaces, per-plate color components and tints, knockout/overprint semantics, and deterministic output. `public/plate-documents.test.ts` covers document versions, identifiers, metadata, page geometry/order, live text placement and fonts, independent fill/stroke coverage, and ownership of mutable preview buffers. These assertions describe consumer capabilities rather than particular resource names, object numbers, stream layouts, or error wording.

The public color tests share a small independent PDF reader in `public/helpers/painted-fills.ts`. It resolves resource aliases and decodes streams through `pdf-lib`; expected ink components come from the fixture's description. Keeping this helper under `public/` includes it in Break Check's historical replay. Public fixtures remain local to their tests and use package exports; they must not depend on private fixtures or source implementation helpers. Interior spot-color samples allow renderer rounding, while exact page pixels remain private proofs.

Private plate tests are split into `plate-colors`, `plate-content`, `plate-forms`, `plate-graphics-state`, `plate-resources`, `plate-scalability`, `plate-text`, and `plate-validation` suites, alongside the internal `plate-types` contracts. Their reusable low-level setup lives in `private/fixtures/plates.ts`. Operator sequences, planner state, cache work counts, object retention, heap/size thresholds, diagnostic details, and current unsupported-feature boundaries stay private. A future implementation can change those details or support more PDF constructs without turning this test organization into a new compatibility promise. Each visual baseline lives beside the suite that owns it.

## Running compatibility checks

Run `pnpm --filter mondrian.pdf test:once:public` for the public suite. Normal
test and coverage commands run both directories. Run `pnpm test:semver` from a
clean checkout for current public tests followed by release compatibility.

The command invokes the `break-check` CLI directly and preserves its failure
behavior for missing tests and other inconclusive checks. Release
`mondrian.pdf@0.1.0` predates this directory, so the release comparison fails
until a release includes the public suite. The current public tests run before
the release comparison.
