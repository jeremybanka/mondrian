import { describe, expect, it } from "vite-plus/test"

import {
	array,
	createPdfDocument,
	createPdfObjectBuilder,
	dictionary,
	name,
	pageSizes,
	PdfValidationError,
	rectangle,
	serializePdf,
	validatePdf,
} from "../../src/index.ts"
import type {
	PdfCatalogDictionary,
	PdfDocument,
	PdfPageDictionary,
	PdfPagesDictionary,
	PdfVersion,
} from "../../src/index.ts"
import { readPdf } from "./read-pdf.ts"

describe("document compatibility", () => {
	it("preserves nested page order, dimensions, rotation, text, and metadata", async () => {
		const pdf = createPdfDocument({
			metadata: { title: "Résumé — 2026", author: "M. Example" },
		})
		const font = pdf.standardFont("Helvetica")
		const cover = pdf.page({
			mediaBox: rectangle(0, 0, 240, 180),
			content: [
				pdf.text((text) =>
					text
						.font(font, 12)
						.moveText(20, 140)
						.show("Invoice (paid) \\ café €"),
				),
			],
		})
		const appendix = pdf.page({
			mediaBox: rectangle(0, 0, 180, 240),
			rotation: 90,
			content: [
				pdf.text((text) =>
					text.font(font, 12).moveText(20, 200).show("Appendix"),
				),
			],
		})
		const end = pdf.page({
			mediaBox: rectangle(0, 0, 120, 120),
			content: [
				pdf.text((text) => text.font(font, 12).moveText(20, 80).show("End")),
			],
		})
		pdf.setPages(cover, pdf.pages(appendix, end))

		const result = await readPdf(pdf.serialize())

		expect(result.title).toBe("Résumé — 2026")
		expect(result.author).toBe("M. Example")
		expect(result.pages).toEqual([
			{
				width: 240,
				height: 180,
				rotation: 0,
				text: "Invoice (paid) \\ café €",
			},
			{ width: 240, height: 180, rotation: 90, text: "Appendix" },
			{ width: 120, height: 120, rotation: 0, text: "End" },
		])
	})

	it("allows compiled documents to be validated and serialized independently", async () => {
		const builder = createPdfDocument()
		builder.setPages(builder.page({ mediaBox: pageSizes.letter }))
		const document: PdfDocument = builder.compile()
		expect(validatePdf(document)).toEqual([])
		expect(await readPdf(serializePdf(document))).toEqual(
			await readPdf(builder.serialize()),
		)
	})

	it("serializes a letter page with fixed metadata deterministically", () => {
		function createLetterPageWithFixedMetadata() {
			const pdf = createPdfDocument({ metadata: { title: "Letter page" } })
			pdf.setPages(pdf.page({ mediaBox: pageSizes.letter }))
			return pdf
		}

		const builder = createLetterPageWithFixedMetadata()
		const first = builder.serialize()
		expect(builder.serialize()).toEqual(first)
		expect(createLetterPageWithFixedMetadata().serialize()).toEqual(first)
	})

	it.each<PdfVersion>(["1.4", "1.7", "2.0"])(
		"honors an explicitly requested PDF %s version",
		(version) => {
			const pdf = createPdfDocument({
				version,
				id: [new Uint8Array(16).fill(1), new Uint8Array(16).fill(2)],
			})
			pdf.setPages(pdf.page({ mediaBox: pageSizes.letter }))
			expect(new TextDecoder().decode(pdf.serialize().slice(0, 8))).toBe(
				`%PDF-${version}`,
			)
		},
	)

	it("serializes a low-level page tree constructed with reserved references", async () => {
		const objects = createPdfObjectBuilder()
		const pages = objects.reserve<PdfPagesDictionary>()
		const page = objects.add(
			dictionary({
				Type: name("Page"),
				Parent: pages.ref,
				MediaBox: array(0, 0, 96, 144),
				Resources: dictionary({}),
			}) satisfies PdfPageDictionary,
		)
		pages.set(dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }))
		const root = objects.add(
			dictionary({
				Type: name("Catalog"),
				Pages: pages.ref,
			}) satisfies PdfCatalogDictionary,
		)
		const document = objects.build({ root, version: "1.4" })
		expect(validatePdf(document)).toEqual([])
		const result = await readPdf(serializePdf(document))
		expect(result.pages).toEqual([
			{ width: 96, height: 144, rotation: 0, text: "" },
		])
	})

	it("rejects an empty document with an actionable diagnostic", () => {
		expect(() => createPdfDocument().serialize()).toThrow(PdfValidationError)
		expect(() => createPdfDocument().serialize()).toThrow(
			expect.objectContaining({
				diagnostics: expect.arrayContaining([
					expect.objectContaining({
						severity: "error",
						code: "missing-page-tree",
						path: "pages",
					}),
				]),
			}),
		)
	})

	it("rejects reusing a page in two positions instead of silently duplicating it", () => {
		const pdf = createPdfDocument()
		const page = pdf.page({ mediaBox: pageSizes.letter })
		pdf.setPages(page, page)
		expect(() => pdf.serialize()).toThrow(PdfValidationError)
	})

	it("rejects pages and content owned by a different document", () => {
		const source = createPdfDocument()
		const destination = createPdfDocument()
		expect(() =>
			destination.setPages(source.page({ mediaBox: pageSizes.letter })),
		).toThrow()
		const font = source.standardFont("Helvetica")
		const content = source.text((text) => text.font(font, 12).show("Foreign"))
		expect(() =>
			destination.page({ mediaBox: pageSizes.letter, content: [content] }),
		).toThrow()
	})
})
