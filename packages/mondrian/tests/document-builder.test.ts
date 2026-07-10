import { describe, expect, it } from "vite-plus/test"

import type { PdfGraphicsBuilder, PdfTextBuilder } from "../src/content.ts"
import { createPdfDocument, pageSizes } from "../src/document-builder.ts"
import { PdfValidationError } from "../src/diagnostics.ts"
import type {
	PdfDictionary,
	PdfDocument,
	PdfIndirectValue,
	PdfPageDictionary,
	PdfPagesDictionary,
	PdfReference,
	PdfStream,
	PdfValue,
} from "../src/objects.ts"
import { literalString } from "../src/objects.ts"
import { rgbJpeg } from "./fixtures.ts"

describe("PdfDocumentBuilder", () => {
	it("compiles one-page text with scoped BT/ET and automatic font resources", () => {
		const builder = createPdfDocument()
		const helvetica = builder.standardFont("Helvetica")
		const content = builder.text((text) => {
			text.font(helvetica, 12).moveText(72, 720).show("Hello (PDF)")
		})
		builder.setPages(
			builder.page({ mediaBox: pageSizes.letter, content: [content] }),
		)

		const document = builder.compile()
		const page = firstPage(document)
		const resources = directDictionary(page.entries.Resources)
		const fonts = dictionaryValue(resources.entries.Font)
		const fontReference = referenceValue(fonts.entries.F0)
		const font = resolve(document, fontReference)
		const contents = pageContent(document, page)

		expect(font).toMatchObject({
			kind: "dictionary",
			entries: {
				Type: { kind: "name", value: "Font" },
				Subtype: { kind: "name", value: "Type1" },
				BaseFont: { kind: "name", value: "Helvetica" },
				Encoding: { kind: "name", value: "WinAnsiEncoding" },
			},
		})
		expect(asciiText(contents.data)).toBe(
			"BT\n/F0 12 Tf\n72 720 Td\n(Hello \\(PDF\\)) Tj\nET\n",
		)
	})

	it("derives immediate Parents and recursive Counts for nested page trees", () => {
		const builder = createPdfDocument()
		const first = builder.page({ mediaBox: pageSizes.letter })
		const second = builder.page({ mediaBox: pageSizes.a4 })
		const third = builder.page({ mediaBox: pageSizes.legal })
		const nested = builder.pages(second, third)
		builder.setPages(first, nested)

		const document = builder.compile()
		const catalog = resolve(document, document.root)
		const rootReference = catalog.entries.Pages
		const root = resolve(document, rootReference)
		const firstReference = root.entries.Kids
			.items[0] as PdfReference<PdfPageDictionary>
		const nestedReference = root.entries.Kids
			.items[1] as PdfReference<PdfPagesDictionary>
		const firstPageValue = resolve(document, firstReference)
		const nestedPages = resolve(document, nestedReference)
		const secondPage = resolve(
			document,
			nestedPages.entries.Kids.items[0] as PdfReference<PdfPageDictionary>,
		)
		const thirdPage = resolve(
			document,
			nestedPages.entries.Kids.items[1] as PdfReference<PdfPageDictionary>,
		)

		expect(root.entries.Count).toBe(3)
		expect(root.entries.Parent).toBeUndefined()
		expect(firstPageValue.entries.Parent).toEqual(rootReference)
		expect(nestedPages.entries.Count).toBe(2)
		expect(nestedPages.entries.Parent).toEqual(rootReference)
		expect(secondPage.entries.Parent).toEqual(nestedReference)
		expect(thirdPage.entries.Parent).toEqual(nestedReference)
	})

	it("reports the exact source path when a page node is reused", () => {
		const builder = createPdfDocument()
		const repeated = builder.page({ mediaBox: pageSizes.letter })
		const group = builder.pages(repeated, repeated)
		builder.setPages(group)

		const error = captureValidationError(() => builder.compile())

		expect(error.diagnostics).toEqual([
			{
				severity: "error",
				code: "page-node-reused",
				path: "pages[0].children[1]",
				message: "A page-tree node can have only one structural parent",
				related: [
					{
						path: "pages[0].children[0]",
						message: "The node was first used here",
					},
				],
			},
		])
	})

	it("requires a page tree before compilation", () => {
		const error = captureValidationError(() => createPdfDocument().compile())

		expect(error.diagnostics).toEqual([
			{
				severity: "error",
				code: "missing-page-tree",
				path: "pages",
				message: "Set at least one page-tree node before compiling the PDF",
			},
		])
	})

	it("rejects content, fonts, images, and page nodes from another document", () => {
		const first = createPdfDocument()
		const firstFont = first.standardFont("Helvetica")
		const firstContent = first.text((text) => {
			text.font(firstFont, 12).show("first")
		})
		const firstImage = first.jpeg(rgbJpeg())
		const firstPage = first.page({ mediaBox: pageSizes.letter })
		const second = createPdfDocument()

		expect(() =>
			second.page({ mediaBox: pageSizes.letter, content: [firstContent] }),
		).toThrow("PDF content belongs to another document builder")
		expect(() => second.text((text) => text.font(firstFont, 12))).toThrow(
			"PDF font belongs to another document builder",
		)
		expect(() =>
			second.graphics((graphics) => graphics.drawImage(firstImage, 0, 0, 1, 1)),
		).toThrow("PDF image belongs to another document builder")
		expect(() => second.setPages(firstPage)).toThrow(
			"PDF page-tree node belongs to another document builder",
		)
	})

	it("requires a font before show and rejects non-WinAnsi text", () => {
		const builder = createPdfDocument()

		expect(() => builder.text((text) => text.show("No font"))).toThrow(
			"PDF text requires a font before text can be shown",
		)

		const helvetica = builder.standardFont("Helvetica")
		expect(() =>
			builder.text((text) => text.font(helvetica, 12).show("☃")),
		).toThrow("Character U+2603 is not available in WinAnsiEncoding")

		const symbol = builder.standardFont("Symbol")
		expect(() =>
			builder.text((text) => text.font(symbol, 12).show("alpha")),
		).toThrow(
			"Symbol and ZapfDingbats text must be supplied as an encoded PDF literal string",
		)
		expect(() =>
			builder.text((text) =>
				text.font(symbol, 12).show(literalString(Uint8Array.of(0x61))),
			),
		).not.toThrow()
	})

	it("expires scoped text and graphics builders after their callbacks", () => {
		const builder = createPdfDocument()
		let textBuilder: PdfTextBuilder | undefined
		let graphicsBuilder: PdfGraphicsBuilder | undefined

		builder.text((text) => {
			textBuilder = text
		})
		builder.graphics((graphics) => {
			graphicsBuilder = graphics
		})

		expect(() => (textBuilder as PdfTextBuilder).moveText(0, 0)).toThrow(
			"A PDF text builder cannot be used outside its callback",
		)
		expect(() => (graphicsBuilder as PdfGraphicsBuilder).moveTo(0, 0)).toThrow(
			"A PDF graphics builder cannot be used outside its callback",
		)
	})

	it("scopes graphics with q/Q and automatically registers image resources", () => {
		const builder = createPdfDocument()
		expect(() => builder.jpeg(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9))).toThrow(
			"JPEG data does not contain a supported frame header",
		)
		expect(() =>
			builder.jpeg(
				Uint8Array.of(
					0xff,
					0xd8,
					0xff,
					0xdb,
					0x00,
					0x02,
					0xff,
					0xc4,
					0x00,
					0x02,
					0xff,
					0xc0,
					0x00,
					0x0b,
					0x08,
					0x00,
					0x01,
					0x00,
					0x01,
					0x01,
					0x01,
					0x11,
					0x00,
					0xff,
					0xda,
					0x00,
					0x08,
					0x01,
					0x01,
					0x00,
					0x00,
					0x3f,
					0x00,
					0x01,
					0xff,
					0xd9,
				),
			),
		).toThrow("JPEG scan references an undefined component or table")
		const jpegBytes = rgbJpeg()
		const image = builder.jpeg(jpegBytes)
		const graphics = builder.graphics((value) => {
			value.drawImage(image, 30, 40, 20, 10)
		})
		builder.setPages(
			builder.page({ mediaBox: pageSizes.letter, content: [graphics] }),
		)

		const document = builder.compile()
		const page = firstPage(document)
		const resources = directDictionary(page.entries.Resources)
		const xObjects = dictionaryValue(resources.entries.XObject)
		const imageStream = resolve(document, referenceValue(xObjects.entries.Im0))

		expect(asciiText(pageContent(document, page).data)).toBe(
			"q\nq\n20 0 0 10 30 40 cm\n/Im0 Do\nQ\nQ\n",
		)
		expect(imageStream).toMatchObject({
			kind: "stream",
			entries: {
				Type: { kind: "name", value: "XObject" },
				Subtype: { kind: "name", value: "Image" },
				Width: 2,
				Height: 3,
				ColorSpace: { kind: "name", value: "DeviceRGB" },
				BitsPerComponent: 8,
				Filter: { kind: "name", value: "DCTDecode" },
			},
			data: jpegBytes,
		})
	})

	it("serializes deterministically across repeated calls", () => {
		const builder = createPdfDocument()
		const font = builder.standardFont("Courier")
		const text = builder.text((value) => {
			value.font(font, 10).moveText(20, 30).show("stable")
		})
		builder.setPages(builder.page({ mediaBox: pageSizes.a4, content: [text] }))

		const first = builder.serialize()
		const second = builder.serialize()

		expect(second).toEqual(first)
		expect(second).not.toBe(first)
	})

	it("lowers metadata into an Info dictionary using UTF-16BE strings", () => {
		const builder = createPdfDocument({
			metadata: {
				title: "AΩ",
				author: "Mondrian",
				modificationDate: new Date("2026-07-10T04:00:00Z"),
			},
		})
		builder.setPages(builder.page({ mediaBox: pageSizes.letter }))

		const document = builder.compile()
		const infoReference = document.info
		if (infoReference === undefined) {
			throw new Error("Expected an Info reference")
		}

		const info = resolve(document, infoReference)
		const title = info.entries.Title
		if (title?.kind !== "hex-string") {
			throw new Error("Expected a hexadecimal Title string")
		}

		expect(title.bytes).toEqual(
			Uint8Array.of(0xfe, 0xff, 0x00, 0x41, 0x03, 0xa9),
		)
		expect(info.entries.Author).toMatchObject({ kind: "hex-string" })
		expect(info.entries.ModDate).toMatchObject({ kind: "literal-string" })
		const serialized = asciiText(builder.serialize())
		expect(serialized).toContain("/Title <FEFF004103A9>")
		expect(serialized).toContain("/ModDate (D:20260710040000Z)")
		expect(serialized).toMatch(/\/Info \d+ 0 R/)
		expect(() =>
			createPdfDocument({
				metadata: { creationDate: new Date(Number.NaN) },
			}),
		).toThrow("creationDate must be a valid Date")
		const distant = new Date(0)
		distant.setUTCFullYear(10_000)
		expect(() =>
			createPdfDocument({ metadata: { modificationDate: distant } }),
		).toThrow("year must fit the four-digit PDF date format")
	})

	it.each(["1.0", "1.1", "1.2", "1.3"] as const)(
		"emits ProcSet for PDF %s content resources",
		(version) => {
			const builder = createPdfDocument({ version })
			const font = builder.standardFont("Helvetica")
			const content = builder.text((text) =>
				text.font(font, 12).show("versioned"),
			)
			builder.setPages(
				builder.page({ mediaBox: pageSizes.letter, content: [content] }),
			)

			const resources = directDictionary(
				firstPage(builder.compile()).entries.Resources,
			)
			expect(resources.entries.ProcSet).toMatchObject({
				kind: "array",
				items: [
					{ kind: "name", value: "PDF" },
					{ kind: "name", value: "Text" },
				],
			})
		},
	)

	it("omits obsolete ProcSet in PDF 1.4 and later", () => {
		const builder = createPdfDocument({ version: "1.4" })
		builder.setPages(builder.page({ mediaBox: pageSizes.letter }))

		const resources = directDictionary(
			firstPage(builder.compile()).entries.Resources,
		)
		expect(resources.entries.ProcSet).toBeUndefined()
	})

	it("gates IDs and Unicode metadata by declared PDF version", () => {
		const identifier = new Uint8Array(16)
		const withId = createPdfDocument({
			version: "1.0",
			id: [identifier, identifier],
		})
		withId.setPages(withId.page({ mediaBox: pageSizes.letter }))
		expect(captureValidationError(() => withId.compile()).diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "unsupported-version-feature",
					path: "id",
				}),
			]),
		)

		const unicode = createPdfDocument({
			version: "1.1",
			metadata: { title: "Ω" },
		})
		unicode.setPages(unicode.page({ mediaBox: pageSizes.letter }))
		expect(captureValidationError(() => unicode.compile()).diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "unsupported-version-feature",
					path: "metadata.title",
				}),
			]),
		)
	})

	it("enforces PDF 2.0 IDs and rejects abbreviated standard fonts", () => {
		const missingId = createPdfDocument({ version: "2.0" })
		missingId.setPages(missingId.page({ mediaBox: pageSizes.letter }))
		expect(
			captureValidationError(() => missingId.compile()).diagnostics,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "invalid-document-id",
					path: "id",
				}),
			]),
		)

		const identifier = new Uint8Array(16)
		const withFont = createPdfDocument({
			version: "2.0",
			id: [identifier, identifier],
		})
		const font = withFont.standardFont("Helvetica")
		const content = withFont.text((text) => text.font(font, 12).show("PDF 2.0"))
		withFont.setPages(
			withFont.page({ mediaBox: pageSizes.letter, content: [content] }),
		)
		expect(
			captureValidationError(() => withFont.compile()).diagnostics,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "unsupported-version-feature",
					path: "pages[0].content",
				}),
			]),
		)

		const supported = createPdfDocument({
			version: "2.0",
			id: [identifier, identifier],
		})
		supported.setPages(supported.page({ mediaBox: pageSizes.letter }))
		expect(supported.compile().version).toBe("2.0")
	})
})

function firstPage(document: PdfDocument): PdfPageDictionary {
	const catalog = resolve(document, document.root)
	const pages = resolve(document, catalog.entries.Pages)
	const first = pages.entries.Kids.items[0]
	if (first === undefined) {
		throw new Error("Expected a page")
	}

	return resolve(document, first as PdfReference<PdfPageDictionary>)
}

function pageContent(
	document: PdfDocument,
	page: PdfPageDictionary,
): PdfStream {
	const contents = page.entries.Contents
	if (contents === undefined || contents.kind !== "reference") {
		throw new Error("Expected one content stream")
	}

	return resolve(document, contents)
}

function resolve<TValue extends PdfIndirectValue>(
	document: PdfDocument,
	reference: PdfReference<TValue>,
): TValue {
	const object = document.objects.find(
		(candidate) =>
			candidate.objectNumber === reference.objectNumber &&
			candidate.generation === reference.generation,
	)
	if (object === undefined) {
		throw new Error(`Missing PDF object ${reference.objectNumber}`)
	}

	return object.value as TValue
}

function directDictionary(
	value: PdfDictionary | PdfReference<PdfDictionary> | undefined,
): PdfDictionary {
	if (value?.kind !== "dictionary") {
		throw new Error("Expected a direct dictionary")
	}

	return value
}

function dictionaryValue(value: PdfValue | undefined): PdfDictionary {
	if (
		value === undefined ||
		typeof value !== "object" ||
		value === null ||
		value.kind !== "dictionary"
	) {
		throw new Error("Expected a dictionary")
	}

	return value
}

function referenceValue(value: PdfValue | undefined): PdfReference {
	if (
		value === undefined ||
		typeof value !== "object" ||
		value === null ||
		value.kind !== "reference"
	) {
		throw new Error("Expected an indirect reference")
	}

	return value
}

function captureValidationError(callback: () => unknown): PdfValidationError {
	try {
		callback()
	} catch (error) {
		expect(error).toBeInstanceOf(PdfValidationError)
		return error as PdfValidationError
	}

	throw new Error("Expected PDF validation to fail")
}

function asciiText(bytes: Uint8Array): string {
	return String.fromCharCode(...bytes)
}
