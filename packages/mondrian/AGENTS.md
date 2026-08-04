# Working with mondrian.pdf

`mondrian.pdf` is a strongly typed TypeScript interface for constructing PDF
files. Its job is to deliver a valid PDF correctly **as described**. The
description is the source of truth: Mondrian should encode it faithfully,
derive the bookkeeping that follows from it, reject contradictions, and avoid
silently inventing intent.

## Philosophy

### Describe intent; derive mechanics

Callers should state independent facts and intent. Mondrian should own
redundant and layout-dependent mechanics such as page parents and descendant
counts, resource names, stream lengths, cross-reference offsets, trailer size,
and `startxref`. Requiring callers to keep those values synchronized would
create multiple sources of truth.

Prefer APIs that make invalid descriptions difficult to express. Use types to
guide construction, opaque handles to preserve document ownership, and runtime
validation for constraints that TypeScript cannot prove. Reject malformed or
contradictory input with useful diagnostics; do not repair it invisibly.

### Use the highest useful level of abstraction

The semantic document builder is the normal authoring surface. It owns the
page tree, scopes content resources, derives redundant fields, and validates
the result. This is where common PDF productions should become concise and
hard to misuse.

The object builder is an intentional escape hatch for features the semantic
layer does not model. It exposes PDF's object graph without exposing raw syntax
or abandoning types, ownership, reachability checks, and validation. Dropping
down a layer should increase control, not disable correctness.

If a low-level pattern becomes common, prefer raising it into a semantic API
over teaching every consumer to reproduce the same object graph.

### Be faithful, deterministic, and inspectable

The same description and inputs should produce the same bytes. Determinism
makes failures reproducible, diffs meaningful, caches useful, and proofs
reviewable. Avoid ambient state and platform-dependent behavior in production
and test paths.

The PDF object model remains available when exact control matters. Generated
files should be explainable in terms of their description, and validation
should identify the relevant path when the graph is wrong.

### Correct construction and correct appearance are separate

A PDF can be valid and faithfully encode the requested operators while still
looking wrong because the description itself is wrong. Conversely, a page can
look plausible while hiding a malformed graph or incorrect metadata. Every
important production therefore has two independent obligations:

1. It is structurally correct and faithfully represents the description.
2. Its rendered pages look right to a human reviewer.

Mondrian owns the first obligation. Its testing tools help consumers prove the
second without weakening it. Do not use visual artifacts as a substitute for
structural assertions, or structural assertions as a substitute for proofing
the rendered document.

## Document lifecycle

1. Define the document contract before implementing it. Record the expected
   page count, page sizes and rotations, metadata, fonts, images, and any other
   observable requirements.
2. Prefer the semantic document builder. Reach for low-level PDF objects only
   when the semantic API cannot express the requirement, and let Mondrian
   derive fields it owns.
3. Serialize the document and treat validation diagnostics as defects in the
   description, not as output to work around.
4. Test the document's structure and behavior. Assert the properties that
   constitute its contract, including expected failures for invalid input.
5. Add a visual artifact test for every materially visible PDF production.
6. Review visual artifacts locally, then run the same tests in verification
   mode before pushing.

Keep productions deterministic. Fix dates, identifiers, random values, input
ordering, and fixture data. Do not generate proofing inputs at test time with
platform-native PDF tools, system fonts, network resources, or other
environment-dependent facilities.

## Structural testing

Structural tests should be specific enough to explain what broke. Depending on
the production, cover:

- serialization and validation;
- page count, dimensions, and rotation;
- metadata and document-level relationships;
- fonts, images, resources, and relevant content operators;
- stable ordering and deterministic output; and
- diagnostics for malformed or unsupported descriptions.

Assert public behavior where possible. Avoid snapshots of incidental internal
objects that make harmless implementation changes expensive.

## Visual proofing with Vitest

Register the matcher once in a Vitest setup file or import it from the test:

```ts
import "mondrian.pdf/vitest"
```

Then render a production and give it a stable, descriptive artifact name:

```ts
import { expect, it } from "vitest"

it("renders the invoice", async () => {
	const pdf = buildInvoice(fixedInvoiceFixture)

	await expect(pdf.serialize()).toMatchPdfArtifact("invoice", {
		resolution: 96,
	})
})
```

Outside CI, the matcher updates artifacts by default. In CI, it verifies them
and fails if any artifact would be added, changed, or removed. The mode can be
made explicit:

```sh
MONDRIAN_PDF_ARTIFACT_MODE=update pnpm test
MONDRIAN_PDF_ARTIFACT_MODE=verify pnpm test
```

Use the project's own test command if it is not `pnpm test`.

Artifacts live beside the test under `__pdf_artifacts__`. Commit the test, the
production change, and its reviewed artifacts together. On failure, inspect
the generated report and expected, actual, and diff images under
`artifacts/pdf`; do not approve a change from filenames or checksums alone.

Mondrian rasterizes through pinned PDFium WebAssembly and compares decoded
pixels exactly. The proof is therefore independent of the host operating
system and does not use a tolerance that can hide small regressions. Renderer
identity, resolution, background, and annotation settings are part of the
visual contract. Treat changes to them as deliberate baseline migrations and
review every resulting page.

For another test runner, use the primitives from `mondrian.pdf/testing` and
preserve the same local-update/CI-verify policy.

## Proofing cycle

For each intentional visual change:

1. Run the focused test locally in update mode.
2. Inspect every changed page at a useful zoom. Check text legibility and
   clipping, font selection, image scaling, transforms, strokes, fills,
   clipping paths, page boundaries, and annotations.
3. Investigate unexpected differences before accepting any new baseline.
4. Revert artifacts unrelated to the intended change.
5. Run the focused test in verify mode.
6. Run the broader test suite and commit the reviewed artifacts with the code.

A refactor intended to be visually neutral should not update artifacts. If it
does, determine why before proceeding. Conversely, a visible feature is not
complete until its proof artifact exists and has been reviewed.

## CI policy

- Never run artifact tests in update mode in CI.
- Fail on missing, changed, or obsolete artifacts.
- Upload `artifacts/pdf` as a CI failure artifact when practical so reviewers
  can inspect the report without reproducing the run.
- Keep renderer dependencies and test fixtures pinned.
- Run verification on every platform you support; identical decoded pixels
  should be expected on each one.

## Review checklist

- The PDF serializes and validates without unexpected diagnostics.
- Structural assertions cover the document's stated contract.
- Page count, geometry, metadata, resources, and content are correct.
- Every visible production has a stable visual artifact test.
- All changed pages were inspected, not merely regenerated.
- No unrelated artifact changed.
- Artifact verification passes locally.
- Tests, proof artifacts, documentation, and release metadata describe the
  same behavior.

## When changing mondrian.pdf itself

Keep public entry points small and explicit, add focused unit tests for
behavior, and add or update visual regressions for rendering changes. Before
submitting a change, run formatting, type checks, the build, unit and visual
tests in verification mode, and coverage. Add an appropriately scoped
changeset for published behavior. Prefer removing unreachable code over
excluding it from coverage, but do not contort clear code solely to reach an
arbitrary percentage.
