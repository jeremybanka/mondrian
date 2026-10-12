import {
	array,
	ascii,
	createPdfDocument,
	rectangle,
	dictionary,
	indirectObject,
	name,
	parsePdf,
	reference,
	serializePdf,
	stream,
} from "mondrian.pdf"
import type {
	PdfCatalogDictionary,
	PdfDocument,
	PdfPageDictionary,
	PdfPagesDictionary,
} from "mondrian.pdf"
import {
	createPdfResolver,
	decodePdfInspectionStream,
	inspectPdf,
	inspectPdfContent,
	pdfInspectionSyntax,
} from "mondrian.pdf/inspect"
import { describe, expect, it } from "vite-plus/test"

describe("PDF graph inspection", () => {
	it("indexes authored identities, page usage, references, and effective paint colors", () => {
		const document: PdfDocument = {
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
						MediaBox: array(0, 0, 100, 200),
					}),
				),
				indirectObject(
					3,
					dictionary({
						Type: name("Page"),
						Parent: reference(2),
						Resources: dictionary({}),
						Contents: reference(4),
					}),
				),
				indirectObject(
					4,
					stream(
						{},
						ascii(
							"1 0 0 rg q 0 0 1 rg 0 0 10 10 re f Q 10 10 10 10 re f 0 1 0 rg",
						),
					),
				),
			],
		}
		const parsed = parsePdf(serializePdf(document)),
			index = inspectPdf(parsed)
		expect(index.pages).toEqual([
			{ id: "3:0", number: 1, box: [0, 0, 100, 200] },
		])
		expect(index.objects.find((object) => object.id === "4:0")).toMatchObject({
			role: "Content stream",
			pages: [1],
			referencedBy: [{ id: "3:0", path: "/Contents" }],
		})
		expect(index.colors.map((color) => color.components)).toEqual([
			[0, 0, 1],
			[1, 0, 0],
		])
		expect(index.colors.every((color) => color.uses[0]?.object === "4:0")).toBe(
			true,
		)
		expect(index.notices).toEqual([])
	})
	it("does not mistake empty text-showing operations for paint", () => {
		const pdf = createPdfDocument(),
			font = pdf.standardFont("Helvetica")
		pdf.setPages(
			pdf.page({
				mediaBox: rectangle(0, 0, 100, 100),
				content: [pdf.text((text) => text.font(font, 12).show(""))],
			}),
		)
		expect(inspectPdf(pdf.compile()).colors).toEqual([])
	})
	it("preserves typed operands and decoded offsets, including unknown operators", () => {
		const result = inspectPdfContent(
			ascii("%comment\n[12 (a b)] /Name << /Flag true >> Custom\nq"),
		)
		expect(result[0]).toMatchObject({
			offset: 9,
			operator: "Custom",
			operands: [
				{ kind: "array" },
				{ kind: "name", value: "Name" },
				{ kind: "dictionary" },
			],
		})
		expect(result[1]?.operator).toBe("q")
		expect(() => inspectPdfContent(ascii("BI /W 1 ID x EI"))).toThrow(
			"Inline image",
		)
	})
	it("decodes supported streams into independent buffers and reports codec limits", () => {
		const pdf = createPdfDocument()
		pdf.setPages(pdf.page({ mediaBox: rectangle(0, 0, 100, 100) }))
		const source = stream({}, ascii("q Q")),
			bytes = decodePdfInspectionStream(pdf.compile(), source)
		bytes[0] = 0
		expect(source.data[0]).toBe(113)
		expect(() =>
			decodePdfInspectionStream(
				pdf.compile(),
				stream({ Filter: name("DCTDecode") }, ascii("x")),
			),
		).toThrow("Unsupported")
		expect(() => decodePdfInspectionStream(pdf.compile(), source, 1)).toThrow(
			"limit",
		)
		expect(pdfInspectionSyntax(reference(17, 2))).toBe("17 2 R")
	})
	it("keeps generation numbers in reference resolution", () => {
		const document = {
			version: "1.7",
			root: reference<PdfCatalogDictionary>(1),
			objects: [indirectObject(9, name("Newest"), 2)],
		} satisfies PdfDocument
		expect(createPdfResolver(document)(reference(9, 0))).toBeUndefined()
		expect(createPdfResolver(document)(reference(9, 2))).toEqual(name("Newest"))
	})
})
