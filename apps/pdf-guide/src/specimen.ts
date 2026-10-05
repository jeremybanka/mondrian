import {
	array,
	ascii,
	dictionary,
	indirectObject,
	name,
	reference,
	serializePdf,
	serializePdfObjectBody,
	stream,
} from "mondrian.pdf"
import type {
	PdfCatalogDictionary,
	PdfDocument,
	PdfPageDictionary,
	PdfPagesDictionary,
	PdfStream,
} from "mondrian.pdf"

// A deliberately uncompressed, one-page PDF: the lesson inspects these exact bytes.
export function createSpecimen(x = 48): PdfDocument {
	return {
		version: "1.7",
		root: reference<PdfCatalogDictionary>(1),
		objects: [
			indirectObject(
				1,
				dictionary({
					Type: name("Catalog"),
					Pages: reference<PdfPagesDictionary>(2),
				}),
			),
			indirectObject(
				2,
				dictionary({
					Type: name("Pages"),
					Kids: array(reference<PdfPageDictionary>(3)),
					Count: 1,
				}),
			),
			indirectObject(
				3,
				dictionary({
					Type: name("Page"),
					Parent: reference<PdfPagesDictionary>(2),
					MediaBox: array(0, 0, 300, 360),
					Resources: dictionary({ Font: dictionary({ F1: reference(5) }) }),
					Contents: reference<PdfStream>(4),
				}),
			),
			indirectObject(
				4,
				stream({}, ascii(drawingCommands(x).join("\n") + "\n")),
			),
			indirectObject(
				5,
				dictionary({
					Type: name("Font"),
					Subtype: name("Type1"),
					BaseFont: name("Helvetica"),
				}),
			),
		],
	}
}

export function drawingCommands(x: number): string[] {
	return [
		"q",
		"0.76 0.73 0.91 rg",
		`${x} 152 120 120 re`,
		"f",
		"Q",
		"BT",
		"/F1 16 Tf",
		"48 64 Td",
		"(Hello, PDF.) Tj",
		"ET",
	]
}

export function byteText(bytes: Uint8Array): string {
	// One code unit per byte keeps displayed positions equal to PDF byte offsets.
	return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")
}

export function specimenBytes(x = 48): Uint8Array {
	return serializePdf(createSpecimen(x))
}

export function objectSyntax(id: number, x = 48): string {
	const object = createSpecimen(x).objects.find(
		(entry) => entry.objectNumber === id,
	)
	if (!object) throw new Error(`Unknown specimen object ${id}`)
	return `${id} 0 obj\n${byteText(serializePdfObjectBody(object.value))}\nendobj`
}

export function objectModel(id: number, x = 48): string {
	const object = createSpecimen(x).objects.find(
		(entry) => entry.objectNumber === id,
	)
	return JSON.stringify(
		object,
		(_key, value: unknown) =>
			value instanceof Uint8Array
				? { bytes: Array.from(value), ascii: byteText(value) }
				: value,
		2,
	)
}

export function fileSections(x = 48) {
	const source = byteText(specimenBytes(x))
	const objects = source.indexOf("1 0 obj")
	const xref = source.indexOf("\nxref\n") + 1
	const trailer = source.indexOf("\ntrailer\n") + 1
	const ending = source.indexOf("\nstartxref\n") + 1
	return [
		{
			id: "header",
			label: "Header",
			start: 0,
			end: objects,
			note: "The version declaration, followed by a comment containing binary bytes. A PDF is a byte file; decoding the whole thing as UTF-8 can corrupt it.",
		},
		{
			id: "objects",
			label: "Objects",
			start: objects,
			end: xref,
			note: "Five numbered objects describe our document. Their numbers identify them; they do not have to appear in page order.",
		},
		{
			id: "xref",
			label: "Cross-reference",
			start: xref,
			end: trailer,
			note: "The address book. Each in-use row gives a byte offset and generation number. Object 0 is a special free entry; the following rows locate objects 1–5.",
		},
		{
			id: "trailer",
			label: "Trailer",
			start: trailer,
			end: ending,
			note: "The entry point. /Root references the catalog; /Size is one greater than the highest object number, including the reserved object 0.",
		},
		{
			id: "ending",
			label: "File ending",
			start: ending,
			end: source.length,
			note: "startxref gives the byte offset of the cross-reference section. Readers normally start here, near the end, then follow /Root into the document.",
		},
	].map((section) => ({
		...section,
		syntax: source.slice(section.start, section.end),
	}))
}

export function downloadSpecimen(x: number): void {
	const bytes = Uint8Array.from(specimenBytes(x))
	const url = URL.createObjectURL(
		new Blob([bytes], { type: "application/pdf" }),
	)
	const anchor = document.createElement("a")
	anchor.href = url
	anchor.download = "hello-mondrian.pdf"
	anchor.click()
	window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
