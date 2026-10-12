import {
	array,
	ascii,
	cmyk,
	createPdfDocument,
	dictionary,
	indirectObject,
	name,
	nameBytes,
	literalString,
	rectangle,
	reference,
	separation,
	stream,
} from "mondrian.pdf"
import type { PdfCatalogDictionary, PdfDocument, PdfValue } from "mondrian.pdf"
import {
	inspectPdf,
	pdfDictionaryEntries,
	inspectPdfContent,
	pdfInspectionSyntax,
	pdfValueName,
} from "mondrian.pdf/inspect"
import { expect, it } from "vite-plus/test"

it("follows inherited resources and shares graphics state across a Contents array", () => {
	const document = {
		version: "1.7",
		root: reference<PdfCatalogDictionary>(1),
		objects: [
			indirectObject(
				1,
				dictionary({ Type: name("Catalog"), Pages: reference(2) }),
			),
			indirectObject(
				2,
				dictionary({
					Type: name("Pages"),
					Kids: array(reference(3)),
					Count: 1,
					MediaBox: array(0, 0, 100, 100),
					Resources: dictionary({ XObject: dictionary({ Fm: reference(6) }) }),
				}),
			),
			indirectObject(
				3,
				dictionary({
					Type: name("Page"),
					Parent: reference(2),
					Contents: array(reference(4), reference(5)),
				}),
			),
			indirectObject(
				4,
				stream({}, ascii("1 0 0 rg q 0 0 1 rg 0 0 10 10 re f")),
			),
			indirectObject(5, stream({}, ascii("Q 0 0 10 10 re f /Fm Do"))),
			indirectObject(
				6,
				stream(
					{
						Type: name("XObject"),
						Subtype: name("Form"),
						BBox: array(0, 0, 10, 10),
					},
					ascii("0 0 10 10 re f"),
				),
			),
		],
	} satisfies PdfDocument
	const index = inspectPdf(document)
	expect(index.notices).toEqual([])
	expect(index.objects.find((entry) => entry.id === "6:0")).toMatchObject({
		role: "Form XObject",
		pages: [1],
	})
	expect(
		index.colors
			.find((color) => color.components.join() === "1,0,0")
			?.uses.map((use) => use.object),
	).toEqual(["5:0", "6:0"])
})

it("indexes CMYK, grayscale, named spot paint, stroking text, and stream representations", () => {
	const pdf = createPdfDocument(),
		font = pdf.standardFont("Helvetica")
	const ink = separation("Brand Ink", {
		type: "exponential",
		zero: cmyk(0, 0, 0, 0),
		full: cmyk(0, 1, 0, 0),
		exponent: 1,
	})
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 100, 100),
			content: [
				pdf.graphics((g) =>
					g
						.cmykFill(1, 0, 0, 0)
						.rgbStroke(0, 1, 0)
						.rectangle(0, 0, 10, 10)
						.fillAndStroke()
						.spotFill(ink, 0.5)
						.rectangle(10, 10, 10, 10)
						.fill()
						.grayStroke(0.2)
						.rectangle(20, 20, 10, 10)
						.stroke(),
				),
				pdf.text((text) =>
					text
						.font(font, 10)
						.cmykStroke(0, 0, 0, 1)
						.renderingMode(1)
						.show("Stroke"),
				),
			],
		}),
	)
	const document = pdf.compile(),
		index = inspectPdf(document)
	expect(index.colors.map((color) => color.space)).toEqual(
		expect.arrayContaining([
			"DeviceCMYK",
			"DeviceRGB",
			"DeviceGray",
			"Separation /Brand Ink",
		]),
	)
	const content = document.objects.find(
		(object) =>
			object.value &&
			typeof object.value === "object" &&
			object.value.kind === "stream",
	)!
	expect(pdfInspectionSyntax(content.value)).toContain("encoded bytes")
	expect(pdfValueName(nameBytes(Uint8Array.of(255)))).toBe("ÿ")
	expect(
		pdfInspectionSyntax(array(...Array.from({ length: 100 }, (_, i) => i))),
	).not.toContain("99")
})

it("reports content decoding failures, cyclic Forms, and malformed instruction limits", () => {
	const document = {
		version: "1.7",
		root: reference<PdfCatalogDictionary>(1),
		objects: [
			indirectObject(
				1,
				dictionary({ Type: name("Catalog"), Pages: reference(2) }),
			),
			indirectObject(
				2,
				dictionary({
					Type: name("Pages"),
					Kids: array(reference(3)),
					Count: 1,
				}),
			),
			indirectObject(
				3,
				dictionary({
					Type: name("Page"),
					Parent: reference(2),
					Resources: dictionary({
						XObject: dictionary({ Loop: reference(4) }),
					}),
					Contents: array(reference(4), reference(5)),
				}),
			),
			indirectObject(4, stream({ Subtype: name("Form") }, ascii("/Loop Do"))),
			indirectObject(5, stream({ Filter: name("UnknownCodec") }, ascii("x"))),
		],
	} satisfies PdfDocument
	const notices = inspectPdf(document)
		.notices.map((notice) => notice.message)
		.join(" ")
	expect(notices).toContain("Cyclic Form")
	expect(notices).toContain("UnknownCodec")
	expect(() => inspectPdfContent(ascii("q Q"), 1)).toThrow("limit")
	expect(() => inspectPdfContent(ascii("1 2"))).toThrow("without an operator")
	expect(() => inspectPdfContent(ascii("}"))).toThrow(
		"Expected a content operator",
	)
	expect(() => inspectPdfContent(ascii(`${"1 ".repeat(4097)}X`))).toThrow(
		"too many operands",
	)
})

it("retains byte dictionary keys and bounds deeply nested/string displays", () => {
	const value = dictionary({}, [
		nameBytes(Uint8Array.of(255)),
		literalString(ascii("x".repeat(300))),
	])
	expect(pdfDictionaryEntries(value)[0]?.[0]).toBe("ÿ")
	expect(pdfInspectionSyntax(value)).toContain("/#FF")
	expect(pdfInspectionSyntax(value)).not.toContain("x".repeat(300))
	let nested: PdfValue = array(1)
	for (let index = 0; index < 15; index++) nested = array(nested)
	expect(pdfInspectionSyntax(nested)).toContain("null")
	expect(value.byteEntries?.[0]?.[1]).toMatchObject({
		bytes: ascii("x".repeat(300)),
	})
})

it("reports incomplete color programs and identifies profiles/fonts without decoding them", () => {
	const document = {
		version: "1.7",
		root: reference<PdfCatalogDictionary>(1),
		objects: [
			indirectObject(
				1,
				dictionary({
					Type: name("Catalog"),
					Pages: reference(2),
					OutputIntents: array(dictionary({ DestOutputProfile: reference(7) })),
				}),
			),
			indirectObject(
				2,
				dictionary({
					Type: name("Pages"),
					Kids: array(reference(3), reference(3)),
					Count: 1,
					Resources: dictionary({
						Font: dictionary({ F1: reference(8) }),
						XObject: dictionary({ Img: reference(6) }),
					}),
				}),
			),
			indirectObject(
				3,
				dictionary({
					Type: name("Page"),
					Parent: reference(2),
					Contents: reference(4),
				}),
			),
			indirectObject(4, stream({}, ascii("/Shade sh Q"))),
			indirectObject(
				6,
				stream(
					{
						Subtype: name("Image"),
						Width: 1,
						Height: 1,
						ColorSpace: name("DeviceGray"),
						BitsPerComponent: 8,
						Filter: array(name("FlateDecode")),
					},
					Uint8Array.of(0),
				),
			),
			indirectObject(7, stream({ N: 3 }, ascii("profile bytes"))),
			indirectObject(
				8,
				dictionary({ Type: name("FontDescriptor"), FontFile2: reference(9) }),
			),
			indirectObject(9, stream({}, ascii("font bytes"))),
		],
	} satisfies PdfDocument
	const index = inspectPdf(document)
	expect(index.objects.find((o) => o.id === "9:0")?.role).toBe("Font program")
	expect(index.objects.find((o) => o.id === "7:0")?.role).toBe("ICC profile")
	expect(index.bitmaps[0]?.filters).toBe("FlateDecode")
	expect(index.pages).toHaveLength(1)
	expect(index.notices.map((n) => n.message).join(" ")).toMatch(
		/Shading.*Unbalanced/,
	)
})

it("bounds page associations while retaining every object module", () => {
	const pdf = createPdfDocument()
	const first = pdf.page({ mediaBox: rectangle(0, 0, 10, 10) })
	pdf.setPages(
		first,
		...Array.from({ length: 1000 }, () =>
			pdf.page({ mediaBox: rectangle(0, 0, 10, 10) }),
		),
	)
	const document = pdf.compile(),
		index = inspectPdf(document)
	expect(index.pages).toHaveLength(1001)
	expect(index.objects).toHaveLength(document.objects.length)
	expect(index.notices.some((n) => n.message.includes("1,000 pages"))).toBe(
		true,
	)
})

it("retains the graph when an indirect Contents array refers to itself", () => {
	const document = {
		version: "1.7",
		root: reference<PdfCatalogDictionary>(1),
		objects: [
			indirectObject(
				1,
				dictionary({ Type: name("Catalog"), Pages: reference(2) }),
			),
			indirectObject(
				2,
				dictionary({
					Type: name("Pages"),
					Kids: array(reference(3)),
					Count: 1,
				}),
			),
			indirectObject(
				3,
				dictionary({
					Type: name("Page"),
					Parent: reference(2),
					Contents: reference(4),
				}),
			),
			indirectObject(4, array(reference(4))),
		],
	} satisfies PdfDocument
	const inspection = inspectPdf(document)
	expect(inspection.objects).toHaveLength(4)
	expect(inspection.notices).toContainEqual({
		object: "4:0",
		message: "Cyclic content array; color traversal stopped",
	})
})

it("reports bounded analysis without dropping modules at deeply nested Form invocations", () => {
	const document = {
		version: "1.7",
		root: reference<PdfCatalogDictionary>(1),
		objects: [
			indirectObject(
				1,
				dictionary({ Type: name("Catalog"), Pages: reference(2) }),
			),
			indirectObject(
				2,
				dictionary({
					Type: name("Pages"),
					Kids: array(reference(3)),
					Count: 1,
					Parent: reference(2),
				}),
			),
			indirectObject(
				3,
				dictionary({
					Type: name("Page"),
					Parent: reference(2),
					Contents: reference(4),
					Resources: dictionary({
						XObject: dictionary({ Next: reference(5) }),
					}),
				}),
			),
			...Array.from({ length: 132 }, (_, index) =>
				indirectObject(
					4 + index,
					stream(
						{
							Subtype: name("Form"),
							Resources: dictionary({
								XObject: dictionary({ Next: reference(5 + index) }),
							}),
						},
						ascii("/Next Do"),
					),
				),
			),
		],
	} satisfies PdfDocument
	const inspection = inspectPdf(document)
	expect(inspection.objects).toHaveLength(document.objects.length)
	expect(inspection.notices.some((n) => n.message.includes("128 levels"))).toBe(
		true,
	)
	expect(() =>
		inspectPdf({
			...document,
			objects: Array.from({ length: 100001 }, () => document.objects[0]!),
		}),
	).toThrow("100,000 objects")
})

it("caps the aggregate content-operation budget across multiple streams", () => {
	const document = {
		version: "1.7",
		root: reference<PdfCatalogDictionary>(1),
		objects: [
			indirectObject(
				1,
				dictionary({ Type: name("Catalog"), Pages: reference(2) }),
			),
			indirectObject(
				2,
				dictionary({
					Type: name("Pages"),
					Kids: array(reference(3)),
					Count: 1,
				}),
			),
			indirectObject(
				3,
				dictionary({
					Type: name("Page"),
					Parent: reference(2),
					Contents: array(reference(4), reference(5)),
				}),
			),
			indirectObject(4, stream({}, ascii("X ".repeat(200000)))),
			indirectObject(5, stream({}, ascii("X"))),
		],
	} satisfies PdfDocument
	expect(inspectPdf(document).notices).toContainEqual({
		object: "5:0",
		message: "Color inspection operation budget exceeded",
	})
})
