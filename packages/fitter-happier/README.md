# mondrian.fitter-happier

An isolated compilation bridge from a `fitter-happier` `LayoutNode` tree to a
typed, one-page `mondrian.pdf` `PdfDocument`.

```text
LayoutNode -> fitter-happier layout -> SolvedNode -> PdfDocument
                                                    ^ bridge boundary
```

The package deliberately stops at the low-level object graph. It does not
serialize bytes or write files. `mondrian.pdf` remains unaware of
`fitter-happier`, while callers are free to validate, transform, combine, or
serialize the returned document.

## Lower a LayoutNode

```ts
import { writeFile } from "node:fs/promises"
import { box, computeLayout, text } from "fitter-happier"
import { lowerLayoutNodeToPdf } from "mondrian.fitter-happier"
import { serializePdf } from "mondrian.pdf"

const root = box({
	style: {
		width: 420,
		height: 640,
		padding: 32,
		gap: 16,
		backgroundColor: "#fffdf8",
	},
	children: [
		text({
			text: "Fitter. Happier. More productive.",
			style: {
				fontSize: 24,
				fontWeight: 700,
				color: "#111827",
			},
		}),
	],
})

const { document, diagnostics } = await lowerLayoutNodeToPdf(root, {
	computeLayout,
	width: 420,
	height: 640,
})

// Serialization happens outside the bridge.
await writeFile("layout.pdf", serializePdf(document))
```

The successful result has exactly two fields:

- `document`: the `mondrian.pdf` `PdfDocument`
- `diagnostics`: non-fatal layout or fidelity warnings

Errors throw `LayoutNodePdfError` with source-level paths. The input options
are the injected fitter-happier `computeLayout` function, `width`, optional
`height` and `textMeasurer`, plus PDF `version`, `metadata`, and an optional
document-ID pair. Injecting the layout engine keeps the built bridge free of a
runtime import of fitter-happier's source-only package.

## Lower existing solved geometry

Call `lowerSolvedLayoutNodeToPdf()` when the caller already owns a
`fitter-happier` `SolvedNode`:

```ts
import { computeLayout } from "fitter-happier"
import { lowerSolvedLayoutNodeToPdf } from "mondrian.fitter-happier"

const layout = await computeLayout(root, { width: 420, height: 640 })
const { document } = lowerSolvedLayoutNodeToPdf(layout.root, {
	metadata: { title: "Solved layout" },
})
```

This is the pure geometry-to-object-graph seam. It does not rerun Yoga or
component resolution. The page size comes from the solved root. PDF 2.0 output
derives a deterministic 16-byte ID when one is not supplied.

## Lowering behavior

The bridge creates exactly one PDF page. It converts fitter-happier's top-left
coordinates into PDF's bottom-left coordinate system, discovers shared
resources, and uses `mondrian.pdf` to construct the catalog, page tree,
resource dictionaries, streams, metadata, and indirect references.

Supported input features include:

- Box backgrounds, borders, rounded corners, and nested clipping
- Leaf-node and color opacity through PDF extended graphics states
- Standard Helvetica, Times, and Courier font variants
- Deterministic text wrapping, explicit newlines, line height, and alignment
- Baseline, 8-bit grayscale or RGB JPEG data URIs

JPEG resources are validated and deduplicated. Progressive, CMYK, malformed,
and non-JPEG raster images are rejected rather than silently omitted. SVG is
also rejected until a dedicated vector lowering path exists.

Text uses the PDF Standard 14 fonts and WinAnsi encoding. Unrepresentable
characters fail with a source path. Unknown font families produce a warning
and fall back to Helvetica. Opacity on a node with children is rejected because
faithful element opacity requires isolated transparency-group compositing.

For PDF 1.0-1.3, the bridge emits legacy `/ProcSet` resources. PDF 2.0 text is
rejected because that version requires embedded, fully described fonts.

## Visual examples

From the workspace root:

```sh
pnpm --filter mondrian.fitter-happier examples
```

The example consumer explicitly serializes six stable one-page documents into
`output/pdf/`. They cover varied layouts, typography, nested coordinates,
clipping, opacity, and repeated JPEG placement.

## Package isolation

`mondrian.pdf` has no dependency on this package or on `fitter-happier`. This
bridge has one direct target dependency (`mondrian.pdf`) and one type-level
layout-engine peer (`fitter-happier`). The source-tree endpoint receives the
peer's `computeLayout` function explicitly. Its public exports are limited to
the two lowering functions, their option/result/diagnostic types, and
`LayoutNodePdfError`.

The package remains private while `fitter-happier` is a private prototype that
publishes raw TypeScript. A package-local declaration view quarantines that
upstream compiler incompatibility; integration tests execute the real sibling
package, and generated declarations retain the real peer module boundary.
