import { expect, it } from "vite-plus/test"
import {
	array,
	createPdfObjectBuilder,
	dictionary,
	name,
	PdfValidationError,
	serializePdf,
} from "mondrian.pdf"
import type {
	PdfCatalogDictionary,
	PdfDictionary,
	PdfObjectBuilder,
	PdfObjectHandle,
	PdfPagesDictionary,
} from "mondrian.pdf"

it("rejects assigning a reserved object more than once", () => {
	const builder: PdfObjectBuilder = createPdfObjectBuilder()
	const handle: PdfObjectHandle<PdfDictionary> =
		builder.reserve<PdfDictionary>()
	handle.set(dictionary({ Value: 1 }))
	// Single assignment is explicitly promised for reserved handles.
	expect(() => handle.set(dictionary({ Value: 2 }))).toThrow()
})

it("rejects a reachable reservation that has not been assigned", () => {
	const builder = createPdfObjectBuilder()
	const root = builder.reserve<PdfCatalogDictionary>()
	expect(() => serializePdf(builder.build({ root: root.ref }))).toThrow(
		expect.objectContaining({
			diagnostics: expect.arrayContaining([
				expect.objectContaining({
					severity: "error",
					code: "invalid-reference",
					path: "root",
				}),
			]),
		}),
	)
})

it("rejects foreign references even when their object number resolves locally", () => {
	const foreign = createPdfObjectBuilder()
	const foreignRoot = foreign.reserve<PdfCatalogDictionary>()
	const builder = createPdfObjectBuilder()
	const root = builder.reserve<PdfCatalogDictionary>()
	const pages = builder.reserve<PdfPagesDictionary>()
	const page = builder.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 20, 20),
			Resources: dictionary({}),
		}),
	)
	pages.set(dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }))
	root.set(dictionary({ Type: name("Catalog"), Pages: pages.ref }))
	// The local graph is valid; an equally numbered foreign handle is not its root.
	expect(() => serializePdf(builder.build({ root: root.ref }))).not.toThrow()
	expect(() => serializePdf(builder.build({ root: foreignRoot.ref }))).toThrow(
		PdfValidationError,
	)
})
