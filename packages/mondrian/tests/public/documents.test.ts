import { describe, expect, it } from "vite-plus/test"

import {
	array,
	createPdfDocument,
	createPdfObjectBuilder,
	dictionary,
	generationNumber,
	name,
	objectNumber,
	pageSizes,
	PdfValidationError,
	rectangle,
	serializePdf,
	validatePdf,
} from "mondrian.pdf"
import type {
	PdfCatalogDictionary,
	PdfDocument,
	PdfMetadata,
	PdfPageDictionary,
	PdfPagesDictionary,
	PdfReference,
	PdfVersion,
} from "mondrian.pdf"
import { readPdf, readPdfMetadata } from "mondrian.pdf/testing"

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
		// Baselines are page-space coordinates, independent of glyph outlines or pixels.
		expect(result.pageCharacters.map((characters) => characters[0])).toEqual([
			{ text: "I", x: 20, y: 140 },
			{ text: "A", x: 20, y: 200 },
			{ text: "E", x: 20, y: 80 },
		])
	})

	it("allows compiled documents to be validated and serialized independently", async () => {
		const builder = createPdfDocument()
		builder.setPages(builder.page({ mediaBox: pageSizes.letter }))
		const document: PdfDocument = builder.compile()
		expect(validatePdf(document)).toEqual([])
		const expected = {
			pages: [{ width: 612, height: 792, rotation: 0, text: "" }],
			title: "",
			author: "",
		}
		expect(await readPdf(serializePdf(document))).toMatchObject(expected)
		expect(await readPdf(builder.serialize())).toMatchObject(expected)
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
		async (version) => {
			const pdf = createPdfDocument({
				version,
				id: [new Uint8Array(16).fill(1), new Uint8Array(16).fill(2)],
			})
			pdf.setPages(pdf.page({ mediaBox: pageSizes.letter }))
			expect(new TextDecoder().decode(pdf.serialize().slice(0, 8))).toBe(
				`%PDF-${version}`,
			)
			expect((await readPdf(pdf.serialize())).fileIds).toEqual([
				new Uint8Array(16).fill(1),
				new Uint8Array(16).fill(2),
			])
		},
	)

	it("accepts a manually described object graph with inherited page geometry", async () => {
		const rootNumber = objectNumber(19)
		const pagesNumber = objectNumber(5)
		const pageNumber = objectNumber(41)
		const generation = generationNumber(0)
		const pages: PdfReference<PdfPagesDictionary> = {
			kind: "reference",
			objectNumber: pagesNumber,
			generation,
		}
		const document: PdfDocument = {
			version: "1.4",
			root: { kind: "reference", objectNumber: rootNumber, generation },
			objects: [
				{
					objectNumber: pageNumber,
					generation,
					value: {
						kind: "dictionary",
						entries: { Type: { kind: "name", value: "Page" }, Parent: pages },
					},
				},
				{
					objectNumber: rootNumber,
					generation,
					value: {
						kind: "dictionary",
						entries: { Type: { kind: "name", value: "Catalog" }, Pages: pages },
					},
				},
				{
					objectNumber: pagesNumber,
					generation,
					value: {
						kind: "dictionary",
						entries: {
							Type: { kind: "name", value: "Pages" },
							Kids: {
								kind: "array",
								items: [
									{ kind: "reference", objectNumber: pageNumber, generation },
								],
							},
							Count: 1,
							MediaBox: { kind: "array", items: [0, 0, 300, 200] },
							Resources: { kind: "dictionary", entries: {} },
						},
					},
				},
			],
		}
		expect(validatePdf(document)).toEqual([])
		expect((await readPdf(serializePdf(document))).pages).toEqual([
			{ width: 300, height: 200, rotation: 0, text: "" },
		])
	})

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
		expect(() => {
			pdf.setPages(page, page)
			pdf.serialize()
		}).toThrow(PdfValidationError)
	})

	it("rejects pages and content owned by a different document", () => {
		const source = createPdfDocument()
		const destination = createPdfDocument()
		expect(() => {
			destination.setPages(source.page({ mediaBox: pageSizes.letter }))
			destination.serialize()
		}).toThrow()
		const font = source.standardFont("Helvetica")
		const content = source.text((text) => text.font(font, 12).show("Foreign"))
		expect(() => {
			destination.setPages(
				destination.page({ mediaBox: pageSizes.letter, content: [content] }),
			)
			destination.serialize()
		}).toThrow()
	})
})

it("preserves explicitly supplied descriptive metadata and timestamps", async () => {
	const metadata: PdfMetadata = {
		title: "Quarterly statement",
		author: "Accounting",
		subject: "Quarterly résumé",
		keywords: "invoice, café",
		creator: "Invoice authoring tool",
		producer: "Accounting export",
		creationDate: new Date("2026-01-02T03:04:05Z"),
		modificationDate: new Date("2026-02-03T04:05:06Z"),
	}
	const pdf = createPdfDocument({ metadata })
	pdf.setPages(pdf.page({ mediaBox: pageSizes.letter }))
	expect(await readPdfMetadata(pdf.serialize())).toEqual({
		title: "Quarterly statement",
		author: "Accounting",
		subject: "Quarterly résumé",
		keywords: "invoice, café",
		creator: "Invoice authoring tool",
		producer: "Accounting export",
		creationDate: "2026-01-02T03:04:05.000Z",
		modificationDate: "2026-02-03T04:05:06.000Z",
	})
})
