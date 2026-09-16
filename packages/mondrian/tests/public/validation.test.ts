import { describe, expect, it } from "vite-plus/test"
import {
	array,
	dictionary,
	indirectObject,
	name,
	PdfValidationError,
	reference,
	serializePdf,
	validatePdf,
} from "mondrian.pdf"
import type {
	PdfCatalogDictionary,
	PdfDocument,
	PdfPageDictionary,
	PdfPagesDictionary,
} from "mondrian.pdf"

describe("validation of caller-supplied object graphs", () => {
	it("reports a dangling root and refuses to serialize it", () => {
		const document: PdfDocument = {
			version: "1.7",
			root: reference<PdfCatalogDictionary>(9),
			objects: [],
		}
		expect(validatePdf(document)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					severity: "error",
					code: "invalid-reference",
					path: "root",
				}),
			]),
		)
		expect(() => serializePdf(document)).toThrow(PdfValidationError)
	})

	it("reports contradictory page counts without silently repairing them", () => {
		const root = reference<PdfCatalogDictionary>(7)
		const pages = reference<PdfPagesDictionary>(3)
		const page = reference<PdfPageDictionary>(11)
		const document: PdfDocument = {
			version: "1.7",
			root,
			objects: [
				indirectObject(7, dictionary({ Type: name("Catalog"), Pages: pages })),
				indirectObject(
					3,
					dictionary({ Type: name("Pages"), Kids: array(page), Count: 2 }),
				),
				indirectObject(
					11,
					dictionary({
						Type: name("Page"),
						Parent: pages,
						MediaBox: array(0, 0, 612, 792),
						Resources: dictionary({}),
					}),
				),
			],
		}
		expect(validatePdf(document)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					severity: "error",
					code: "incorrect-page-count",
					path: "pages.Count",
				}),
			]),
		)
		expect(() => serializePdf(document)).toThrow(PdfValidationError)
	})
})
