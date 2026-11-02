# Processing-step layers

Processing-step classification, proof visibility, and ink output are independent descriptions. A cutting layer can be visible in a proof while being excluded from every print plate. Selection uses OCG identity and processing-step metadata, never layer names, spot names, or alternate display colors.

## Authoring

The semantic builder supports the `Structural/Cutting` and `Structural/Creasing` classification subset of [ISO 19593-1:2026](https://www.iso.org/standard/90532.html). These classifications map to PDF names in `GTS_Metadata` on an Optional Content Group (OCG). The underlying PDF optional-content mechanism requires PDF 1.5 or later.

```ts
import {
	cmyk,
	createPdfDocument,
	rectangle,
	separation,
	selectPdfOptionalContent,
	serializePdf,
} from "mondrian.pdf"
import {
	previewPdfPlates,
	renderPdf,
	renderPdfPlateCoverage,
} from "mondrian.pdf/testing"

const pdf = createPdfDocument()
const cutting = pdf.optionalContentGroup({
	name: "Die cutting",
	processingStep: { group: "Structural", type: "Cutting" },
})
const cutInk = separation("CutContour", {
	type: "exponential",
	zero: cmyk(0, 0, 0, 0),
	full: cmyk(0, 1, 0, 0),
	exponent: 1,
})
const artwork = pdf.graphics((g) => {
	g.cmykFill(1, 0, 0, 0).rectangle(20, 20, 160, 100).fill()
})
const cutline = pdf.graphics((g) => {
	g.paintState({
		fillOverprint: true,
		strokeOverprint: true,
		overprintMode: 1,
	})
		.spotStroke(cutInk, 1)
		.lineWidth(0.5)
		.rectangle(15, 15, 170, 110)
		.stroke()
})

pdf.setOptionalContentConfiguration({
	baseState: "ON",
	off: [],
	order: [cutting],
})
pdf.setPages(
	pdf.page({
		mediaBox: rectangle(0, 0, 200, 150),
		content: [artwork, pdf.optionalContent(cutting, [cutline])],
	}),
)
const document = pdf.compile()
```

The OCG handle belongs to its builder. Mondrian registers groups in catalog `OCProperties/OCGs`, emits the default `D` configuration, assigns `Properties` resource names, and encloses member fragments in `/OC /resource BDC … EMC`. Each graphics fragment retains its own `q/Q` state scope. Group names are display labels and need not be unique. Metadata and references remain ordinary PDF objects when parsed and reserialized.

Structural content in this initial subset consists of vector paths and supported Form content. Every painted channel must use an ordinary Separation spot color, full opacity, overprint, and Normal blending, with no soft mask or clipping. Mondrian rejects contradictory descriptions rather than substituting colors or changing paint state. Cutting and creasing paths must have a stroke; filling in addition to stroking is permitted when both painted channels satisfy these requirements. Finishing geometry remains the described vector contour. Text, images, and arbitrary PDF features inside structural membership remain explicitly unsupported.

## Reusable Forms and transforms

```ts
const form = pdf.form({
	bbox: rectangle(0, 0, 200, 150),
	content: [artwork, pdf.optionalContent(cutting, [cutline])],
})
const placed = pdf.transform([0.5, 0, 0, 0.5, 100, 0], [form])
// A page can use [form, placed], retaining one authored Form XObject.
```

`form()` returns reusable content backed by a Form XObject with explicit resources, `BBox`, and an optional `matrix`. `transform()` emits a scoped `q/cm/Q` placement around its content. Membership can surround a Form invocation or occur within its stream. Selection resolves each invocation in its membership and inherited paint context, so a shared Form can be printable in one invocation and technical in another. Technical paths must lie wholly within their Form's bounding box; the conservative check includes curve control points. Nested Forms carrying technical geometry are rejected when ancestor clipping cannot be established safely.

## Proof selection

```ts
const shown = selectPdfOptionalContent(document, { baseState: "ON" })
const hidden = selectPdfOptionalContent(document, {
	baseState: "ON",
	off: [cutting],
})
await renderPdf(serializePdf(shown))
await renderPdf(serializePdf(hidden))
```

`selectPdfOptionalContent()` explicitly resolves supported membership into a derived document, removes the resolved optional-content configuration, and leaves the original document intact. `on` and `off` override the selection's `baseState`; duplicate or contradictory selections are errors. Builder handles work with their originating compiled document. For a parsed document, supply indirect OCG references from its catalog `OCProperties/OCGs` array instead. References preserve group identity even when labels are identical.

`setOptionalContentConfiguration()` describes initial PDF visibility through `BaseState`, `ON`, `OFF`, and flat `Order`. It is separate from explicit proof selection. A viewer can apply its own user settings or optional-content policies. Viewer-specific usage applications, `Usage` dictionaries, alternate configurations, radio groups, and locked groups are outside this selection subset. `PrintState OFF` alone is not a universal guarantee of exclusion from a RIP or other downstream output.

## Ink output

```ts
const inkOutput = {
	processingSteps: {
		default: "error",
		rules: [
			{ group: "Structural", type: "Cutting", action: "exclude" },
			{ group: "Structural", type: "Creasing", action: "exclude" },
		],
	},
} as const

const previews = previewPdfPlates(document, { inkOutput })
const coverage = await renderPdfPlateCoverage(document, {
	inkOutput,
	resolution: 144,
})
```

Both plate functions use the same selection before discovering inks or projecting paint. Excluded technical content produces no ink, no knockout holes, and no technical-only spot plate. Ordinary printable content using the same spot colorant remains printable. Neither the source document's initial visibility nor a proof selection changes this policy. Rules may explicitly `include` a supported classification for diagnostic output. Documents without optional content retain their existing plate behavior without requiring a policy.

An output rule is required for every registered processing-step group in a layered document. Missing rules, unsupported classifications, and unclassified OCGs fail explicitly. To resolve ordinary optional layers before plate generation, create a derived document with explicit proof selection. Do not treat every processing step as nonprinting: classifications such as white and varnish can describe physical printing operations, and are outside the initial supported authoring/ink-policy subset.

## Supported boundaries and verification

Selection supports direct registered OCG membership through named `Properties` resources and Form `OC` references. Optional fragments must contain complete paths and balanced `q/Q` graphics scopes; state changes cannot escape membership. It supports page content arrays, inherited page resources, and unfiltered or FlateDecode page/Form streams without decode parameters. Optional-content membership dictionaries (OCMDs), visibility expressions, optional-content annotations and images, recursive Forms, transparency-group Forms, reference Forms, and unsupported structural paint produce diagnostics, including when the content is selected for exclusion.

This is encoding and rendering support for a documented subset, not certification of ISO 19593, PDF/X conformance, cutter operation, or a downstream RIP's interpretation. The standard also covers production requirements outside this API's validation. Accepting a shared printable/technical colorant establishes Mondrian's selection behavior; it does not establish compliance with all of the standard's colorant and production constraints. Confirm the receiving workflow's processing-step support independently.

The synthetic regression fixture in `tests/public/processing-steps.test.ts` crosses CMYK and printable spot artwork with cutting and creasing paths, reuses a Form at different transforms, and shares a colorant between printable and technical objects. It verifies metadata round trips, explicit proof visibility, exact retained plate coverage, absence of technical-only plates, and unchanged source bytes. Reviewed proof images live beside the test under `__pdf_artifacts__`.
