# mondrian.pdf

<a aria-label="NPM version" href="https://www.npmjs.com/package/mondrian.pdf">
	<img
		alt="NPM Version"
		src="https://img.shields.io/npm/v/mondrian.pdf?style=for-the-badge"
	>
</a>
<a
	aria-label="Dependencies 3"
	href="https://github.com/jeremybanka/mondrian/blob/main/packages/mondrian/package.json"
>
	<img
		alt="Dependencies 3"
		src="https://img.shields.io/badge/dependencies-3-blue?style=for-the-badge"
	>
</a>
<a aria-label="Coverage" href="https://recoverage.cloud/">
	<img
		alt="Coverage"
		src="https://img.shields.io/endpoint?url=https%3A%2F%2Frecoverage.cloud%2Fshields%2F7SNBWB_Aesq2QClC7jZrL%2Fmondrian"
	>
</a>

A strongly typed TypeScript interface for constructing PDF files.

Use the semantic document builder for normal authoring. It owns the page tree,
tracks content resources, and derives redundant PDF fields. Drop down to the
object builder when you need direct control over PDF names, dictionaries,
arrays, streams, and indirect references.

## Install

```sh
pnpm add mondrian.pdf
```

## Create a PDF

```ts
import { writeFile } from "node:fs/promises"
import { createPdfDocument, pageSizes } from "mondrian.pdf"

const pdf = createPdfDocument({
	metadata: {
		title: "Hello",
	},
})

const helvetica = pdf.standardFont("Helvetica")

const page = pdf.page({
	mediaBox: pageSizes.letter,
	content: [
		pdf.text((text) =>
			text.font(helvetica, 12).moveText(72, 720).show("Hello, PDF!"),
		),
	],
})

pdf.setPages(page)

await writeFile("hello.pdf", pdf.serialize())
```

## Visual artifact testing

Import `mondrian.pdf/vitest` to register a matcher that renders serialized PDF
bytes and maintains reviewable PNG artifacts:

```ts
import { expect, it } from "vitest"
import "mondrian.pdf/vitest"

it("renders the invoice", async () => {
	const invoice = createInvoice()

	await expect(invoice.serialize()).toMatchPdfArtifact("invoice")
})
```

Local test runs update the artifact directory beside the test file and pass once
the PDF renders successfully. Review the resulting PNG and manifest changes in
Git, then commit or revert them. When `CI` is truthy, the matcher instead fails
on changed pixels or rendering settings and on added or removed artifacts.
The manifest records the renderer version and WASM hash as provenance. Renderer
upgrades alone do not fail verification or rewrite matching baselines; the
recorded renderer identifies the engine that originally produced the baseline.
A failure report containing the actual PDF, expected and actual page images,
pixel diffs, and an HTML contact sheet is written under `artifacts/pdf/`.

Set `MONDRIAN_PDF_ARTIFACT_MODE=update` or `verify` to override environment
detection. Matcher options can also select the mode, resolution, background,
annotation rendering, and artifact roots explicitly.

For individual ink proofs, `previewPdfPlates(pdf.compile())` returns a colored `PdfDocument` for each CMYK and named spot plate, preserving knockout and overprint. See [print plate previews](docs/print-plates.md) for options, supported painting, and examples.

The runner-neutral `mondrian.pdf/testing` submodule exports `renderPdf()`,
`checkPdfArtifact()`, and their associated types for other test runners and
custom workflows:

```ts
import { checkPdfArtifact } from "mondrian.pdf/testing"

const result = await checkPdfArtifact(invoice.serialize(), {
	directory: "test-artifacts/invoice",
	failureDirectory: "artifacts/pdf/invoice",
})
```

## Inspect serialized PDFs

Use the independent readers from `mondrian.pdf/testing` to assert what a PDF
contains, alongside visual artifact tests:

```ts
import { readPdf, readPdfMetadata, readPdfObject } from "mondrian.pdf/testing"

const observed = await readPdf(invoice.serialize())
expect(observed.pages[0]).toMatchObject({ width: 612, height: 792 })
expect(observed.pageFonts[0]).toContainEqual({ text: "I", font: "Helvetica" })

const metadata = await readPdfMetadata(invoice.serialize())
expect(metadata.title).toBe("Invoice")

// A standalone PDF object body; equivalent encodings decode to the same values.
const value = readPdfObject(new TextEncoder().encode("[true 17 2 R <00FF>]"))
expect(value).toEqual([true, { reference: [17, 2] }, { bytes: [0, 255] }])
```

- `readPdf()` returns page sizes, rotation, extracted text, character origins,
  font names, both document IDs, title, and author. Coordinates use PDF page
  space, in points. It rejects files requiring cross-reference repair; this is
  an inspection aid rather than a complete PDF conformance validator.
- `readPdfMetadata()` reads the Info fields, including UTC ISO date strings.
  Absent fields are `undefined`.
- `readPdfObject()` decodes a standalone primitive, array, or dictionary body.
  Names and strings retain their bytes; references retain object and generation
  numbers. Dictionaries are maps keyed by hexadecimal name bytes, preserving
  arbitrary keys without a Unicode conversion. The exported `DecodedPdfObject`
  type describes these values. Streams are outside this reader's scope.

For a nested page tree, compose owned nodes explicitly:

```ts
pdf.setPages(pdf.pages(cover, pdf.pages(chapterOne, chapterTwo)))
```

## Two API layers

### Semantic document builder

`createPdfDocument()` is the recommended API. It provides:

- An owned page tree through `page()`, `pages()`, and `setPages()`
- Document-local handles for fonts and JPEG images
- Typed, automatically scoped text and graphics operations
- Automatic page resource discovery and naming
- Derived page parents and descendant counts
- Validation before bytes are returned

Because page-tree nodes are owned and resources are referenced by opaque
handles, callers do not manually synchronize `/Parent`, `/Count`, or resource
dictionary names.

`jpeg()` accepts valid baseline, 8-bit grayscale or RGB JPEG bytes. It parses
the frame and table structure and derives width, height, color space, and bit
depth; those redundant values are never caller-supplied. Progressive and CMYK
JPEGs remain available through the low-level stream API.

The semantic builder emits required legacy `/ProcSet` resources for PDF
1.0-1.3. PDF 2.0 documents require 16-byte document IDs, and their fonts must
be fully described through the low-level API; the abbreviated Standard 14 font
dictionaries are intentionally limited to PDF 1.x.

### PDF object builder

`createPdfObjectBuilder()` exposes PDF's object model directly:

- Names, strings, arrays, dictionaries, and streams
- Typed indirect references
- `reserve()` for cyclic graphs
- `add()` for completed indirect objects
- Reachability tracing from `/Root` and `/Info`
- Graph validation before serialization

Use it when implementing a PDF feature that the semantic layer does not yet
model.

```ts
import { writeFile } from "node:fs/promises"
import type {
	PdfCatalogDictionary,
	PdfPageDictionary,
	PdfPagesDictionary,
} from "mondrian.pdf"
import {
	array,
	ascii,
	createPdfObjectBuilder,
	dictionary,
	name,
	serializePdf,
	stream,
} from "mondrian.pdf"

const objects = createPdfObjectBuilder()

// Reserve the page-tree root before its children so both directions can refer
// to one another.
const pages = objects.reserve<PdfPagesDictionary>()

const font = objects.add(
	dictionary({
		Type: name("Font"),
		Subtype: name("Type1"),
		BaseFont: name("Helvetica"),
	}),
)

const contents = objects.add(
	stream({}, ascii("BT\n/F1 12 Tf\n72 720 Td\n(Hello, PDF!) Tj\nET\n")),
)

const page = objects.add(
	dictionary({
		Type: name("Page"),
		Parent: pages.ref,
		MediaBox: array(0, 0, 612, 792),
		Resources: dictionary({
			Font: dictionary({
				F1: font,
			}),
		}),
		Contents: contents,
	}) satisfies PdfPageDictionary,
)

pages.set(
	dictionary({
		Type: name("Pages"),
		Kids: array(page),
		Count: 1,
	}) satisfies PdfPagesDictionary,
)

const root = objects.add(
	dictionary({
		Type: name("Catalog"),
		Pages: pages.ref,
	}) satisfies PdfCatalogDictionary,
)

const document = objects.build({
	version: "1.7",
	root,
})

await writeFile("hello-low-level.pdf", serializePdf(document))
```

`reserve()` makes the page-tree cycle ergonomic without exposing an incomplete
object. A handle may be set exactly once, and references from another builder
are rejected.

String-backed dictionary keys cover normal schema authoring. For truly raw PDF
names, `nameBytes()` preserves arbitrary non-NUL bytes and
`dictionaryEntry()` attaches them without a UTF-8 round trip. Semantic Info
values use `textString()`, `asciiTextString()`, and `dateString()` so text and
date fields cannot be confused with arbitrary PDF byte strings.

## Parsing existing PDFs

`parsePdf(rawPdfText)` reads raw PDF file text into a `PdfDocument`. It also accepts a `Uint8Array`, which is the preferred input when reading a binary file:

```ts
import { readFile } from "node:fs/promises"
import { parsePdf, serializePdf, validatePdf } from "mondrian.pdf"

const document = parsePdf(await readFile("input.pdf"))
console.log(document.version, document.root, document.objects)
const diagnostics = validatePdf(document)
const bytes = serializePdf(document)
```

String input must contain one code unit per original byte, as produced by `Buffer.toString("latin1")`. ASCII PDF text works directly. Do not decode binary PDFs as UTF-8 or with `TextDecoder("latin1")`: those conversions can change bytes and invalidate offsets. Characters above U+00FF are rejected.

The parser reads unencrypted PDF 1.0–2.0 files with classic cross-reference tables, cross-reference streams, hybrid references, and incremental revisions. It selects the latest live object definitions and expands compressed objects into `document.objects`, ordered by object number. Structural streams support Flate, LZW, ASCIIHex, ASCII85, and RunLength filters, including TIFF and PNG prediction for Flate and LZW.

Names and strings preserve their decoded bytes; non-UTF-8 names use `PdfByteName` and dictionary `byteEntries`. Ordinary stream data and filters remain encoded, and direct or indirect `/Length` entries are consumed because serialization derives lengths. The document preserves the effective version, catalog and info references, and file identifiers. A direct PDF 2.0 information dictionary is normalized into a new indirect object beyond the original object-number range. Object-stream containers remain available for inspection and may produce unreachable-object warnings during validation. Consumed cross-reference streams are file bookkeeping and are excluded from the returned graph, so historical trailer references cannot introduce dangling references into the current document.

Parsing reads the object graph without applying Mondrian's authoring validation rules. Use `validatePdf()` separately when preparing a parsed document for serialization. Syntax errors and unsupported structural encodings throw `PdfParseError`, whose `offset` identifies a byte in the original input (the container offset for errors in compressed objects). The parser rejects encryption, external structural streams, malformed cross-references, and nesting deeper than 256 levels; it does not attempt file repair.

`parsePdf(input, options)` limits each structural decoding output to 8 MiB and cumulative structural decoding to 32 MiB by default. Set `maxDecodedStreamBytes` and `maxTotalDecodedBytes` to non-negative safe integers to change these limits. Every intermediate filter and predictor output counts toward the cumulative limit, as do unfiltered structural streams. Decoding stops with `PdfParseError` when a limit is exceeded; Flate is processed in bounded chunks, and other decoders check before growing their output. These are decoded-byte limits, not a bound on the complete input or object graph memory.

Reserializing rebuilds the file layout and cross-reference table. It does not preserve revision history, signature validity, or additional trailer fields outside the `PdfDocument` model.

## Derived fields

Do not supply values that depend on the final graph or byte layout.

The semantic layer derives:

- Page and page-tree `/Parent`
- Page-tree `/Count`
- Content resource names and resource dictionaries

Serialization derives:

- Stream `/Length`
- Cross-reference offsets
- Trailer `/Size`
- `startxref`

The low-level `stream()` constructor therefore rejects an explicit `Length`
entry.

## Validation

Both builders validate their output, and `serializePdf()` validates again
before writing bytes. Validation covers malformed direct objects, missing or
foreign references, page-tree cycles and reuse, incorrect parents and counts,
and invalid roots.

Validation failures throw `PdfValidationError`, whose `diagnostics` property
contains stable codes, paths, messages, and related locations.

For inspection or interchange, the underlying `PdfDocument` data format and
`validatePdf()` are also exported. Constructing that representation manually
is possible, but `createPdfObjectBuilder()` is the safer low-level entry point.

## License

Mondrian is licensed under the [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/). The MPL is permissive about use and
integration: you may use Mondrian for any purpose, including in commercial or
proprietary software, and combine it with code under other licenses. New files
may remain under terms of your choice.

If you distribute modifications to Mondrian's MPL-covered files, you must make
the source for those files available under MPL 2.0. Private and internal
modifications do not need to be published. This is file-level sharing, not
whole-program copyleft. See [Mozilla's official MPL 2.0 FAQ](https://www.mozilla.org/MPL/2.0/FAQ/) for details.

## Process and named spot colors

Use typed gray/RGB/CMYK and Separation paint in graphics, live text, or cached
object-builder content. See the [color API and migration guide](docs/print-colors.md)
and [executable examples](examples/print-colors.ts) for units, resource binding,
overprint, and supported transparency boundaries.
