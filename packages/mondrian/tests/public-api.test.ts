import { describe, expect, expectTypeOf, it } from "vite-plus/test"

import type {
	PdfCatalogDictionary,
	PdfDocument,
	PdfPageDictionary,
	PdfPagesDictionary,
} from "../src/index.ts"
import {
	array,
	createPdfDocument,
	createPdfObjectBuilder,
	dictionary,
	name,
	pageSizes,
	serializePdf,
} from "../src/index.ts"

describe("public API", () => {
	it("supports the semantic quick start through the package entrypoint", () => {
		const pdf = createPdfDocument({ metadata: { title: "Hello" } })
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
		const bytes = pdf.serialize()

		expect(asciiPrefix(bytes, 8)).toBe("%PDF-1.7")
		expectTypeOf(pdf.compile()).toEqualTypeOf<PdfDocument>()
	})

	it("supports a cyclic low-level page tree through the package entrypoint", () => {
		const objects = createPdfObjectBuilder()
		const pages = objects.reserve<PdfPagesDictionary>()
		const page = objects.add(
			dictionary({
				Type: name("Page"),
				Parent: pages.ref,
				MediaBox: array(0, 0, 612, 792),
				Resources: dictionary({}),
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

		expect(asciiPrefix(serializePdf(objects.build({ root })), 8)).toBe(
			"%PDF-1.7",
		)
	})
})

function asciiPrefix(bytes: Uint8Array, length: number): string {
	return String.fromCharCode(...bytes.slice(0, length))
}
