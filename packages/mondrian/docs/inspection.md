# Inspecting a PDF

Run `mondrian` and choose **Inspect a PDF**, or drag a file onto the application. Parsing runs in a browser worker and preserves the original bytes alongside a Mondrian `PdfDocument`. One file of up to 32 MiB can be open at a time. Password retry and supported header/xref recovery are explicit; recovery warnings remain visible.

The object stream presents one module per indirect identity, ordered by object number and generation. Search by role, identity, or dictionary key; click references to jump to their modules and use browser Back to return. A persistent detail pane explains fields and shows the parsed model, bounded generated syntax, encoded/decoded stream data, and supported content operands/operators. Generated syntax and decoded offsets are representations of the parsed graph, not original file offsets or a revision history. Long displays are truncated without altering the input.

The palette records source colors active at supported fill, stroke, and text-paint operators, with links to those operations. Image pixel distributions, shading programs, and unsupported inline images are not flattened into a finite palette. Notices mark partial inventories. Display swatches are approximations. CMYK and named Separation entries can open their full ink plate; the separate ink view preserves the library’s supported knockout/overprint semantics. DeviceGray-to-black interpretation is opt-in, and RGB or other unsupported plate semantics remain explicit capability errors. No destination color conversion is performed.

The bitmap panel inventories Image XObjects, including soft masks and unused resources. It shows dimensions, bit depth, encoding, color space, profile references, and transparency. Thumbnails support the established 8-bit unfiltered/Flate/baseline JPEG subset in DeviceRGB, DeviceGray, DeviceCMYK, and supported ICCBased spaces. ICC-tagged thumbnails convert to sRGB for display; unprofiled thumbnails are explicitly labelled approximations. Profile details expose descriptions and header characteristics. Unsupported codecs or settings do not hide the object’s metadata or bytes.

Page previews render the original uploaded file independently of structural validation. The preview service accepts only requests from this application, holds up to three document sessions in memory, and never writes uploads to disk. Sessions expire after 30 minutes of inactivity when the next request is handled, or when explicitly closed. Preview requests send the PDF bytes to the application server; the default `mondrian` server is on loopback. Individual page and bitmap previews are capped at four million pixels. Heavy rendering requests are serialized and loaded on demand.

Graph indexing is capped at 100,000 objects. Resource/color associations are indexed for the first 1,000 pages, with a visible notice when truncated; all object modules remain searchable. Content decoding uses bounded filter/predictor support, with an eight-MiB per-stream and 32-MiB aggregate color-analysis budget and a 200,000-operation budget. Unsupported capabilities report their own errors rather than preventing inspection of a successfully parsed graph.

## Library API

The browser-safe `mondrian.pdf/inspect` entrypoint exposes the semantic index and decoding utilities:

```ts
import { parsePdf } from "mondrian.pdf"
import {
	inspectPdf,
	decodePdfInspectionStream,
	inspectPdfContent,
} from "mondrian.pdf/inspect"

const document = parsePdf(bytes)
const inspection = inspectPdf(document)
// inspection.objects / pages / bitmaps / colors / notices

const source = document.objects.find(
	(object) =>
		typeof object.value === "object" &&
		object.value !== null &&
		object.value.kind === "stream",
)
if (
	source &&
	typeof source.value === "object" &&
	source.value?.kind === "stream"
) {
	const decoded = decodePdfInspectionStream(document, source.value)
	const operations = inspectPdfContent(decoded)
}
```

Content operands retain PDF value types, and operations retain decoded-stream offsets. Unknown operator names are preserved. Inline-image programs currently require inspecting the decoded bytes rather than an operator listing. Inspection does not certify PDF/X, PDF/A, or arbitrary rendering semantics; use the structural diagnostics and preview capability results together.
