# mondrian.pdf

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
