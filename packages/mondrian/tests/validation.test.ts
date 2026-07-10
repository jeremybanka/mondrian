import { describe, expect, expectTypeOf, it } from "vite-plus/test"

import { PdfValidationError } from "../src/diagnostics.ts"
import type {
	PdfCatalogDictionary,
	PdfDateString,
	PdfDictionary,
	PdfDocument,
	PdfGenerationNumber,
	PdfInfoDictionary,
	PdfPageDictionary,
	PdfPagesDictionary,
	PdfStream,
	PdfTextString,
} from "../src/objects.ts"
import {
	array,
	ascii,
	dictionary,
	dictionaryEntry,
	generationNumber,
	hexString,
	indirectObject,
	name,
	nameBytes,
	literalString,
	reference,
	stream,
} from "../src/objects.ts"
import { serializePdf } from "../src/serialize.ts"
import { validatePdf } from "../src/validate.ts"

describe("semantic PDF validation", () => {
	it("accepts MediaBox and Resources inherited from a Pages ancestor", () => {
		const root = reference<PdfCatalogDictionary>(1)
		const pages = reference<PdfPagesDictionary>(2)
		const page = reference<PdfPageDictionary>(3)
		const document: PdfDocument = {
			version: "1.7",
			root,
			objects: [
				indirectObject(1, dictionary({ Type: name("Catalog"), Pages: pages })),
				indirectObject(
					2,
					dictionary({
						Type: name("Pages"),
						Kids: array(page),
						Count: 1,
						MediaBox: array(0, 0, 612, 792),
						Resources: dictionary({}),
					}),
				),
				indirectObject(3, dictionary({ Type: name("Page"), Parent: pages })),
			],
		}

		expect(validatePdf(document)).toEqual([])
	})

	it("rejects pages with neither direct nor inherited required attributes", () => {
		const diagnostics = validatePdf(onePageDocument({}))

		expect(diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "missing-page-attribute",
					path: "pages.Kids[0].MediaBox",
				}),
				expect.objectContaining({
					code: "missing-page-attribute",
					path: "pages.Kids[0].Resources",
				}),
			]),
		)
	})

	it("checks Contents, Resources, and Info reference target kinds", () => {
		const root = reference<PdfCatalogDictionary>(1)
		const pages = reference<PdfPagesDictionary>(2)
		const page = reference<PdfPageDictionary>(3)
		const contents = reference<PdfStream>(4)
		const resources = reference<PdfDictionary>(5)
		const info = reference<PdfInfoDictionary>(6)
		const document: PdfDocument = {
			version: "1.7",
			root,
			info,
			objects: [
				indirectObject(1, dictionary({ Type: name("Catalog"), Pages: pages })),
				indirectObject(
					2,
					dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }),
				),
				indirectObject(
					3,
					dictionary({
						Type: name("Page"),
						Parent: pages,
						MediaBox: array(0, 0, 612, 792),
						Resources: resources,
						Contents: contents,
					}),
				),
				indirectObject(4, dictionary({ Wrong: true })),
				indirectObject(5, stream({}, new Uint8Array())),
				indirectObject(6, stream({}, new Uint8Array())),
			],
		}

		const diagnostics = validatePdf(document)
		expect(diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "incorrect-reference-target",
					path: "pages.Kids[0].Contents",
				}),
				expect.objectContaining({
					code: "incorrect-reference-target",
					path: "pages.Kids[0].Resources",
				}),
				expect.objectContaining({
					code: "incorrect-reference-target",
					path: "info",
				}),
			]),
		)
	})

	it("rejects generation 65535 for in-use objects and references", () => {
		expect(() => generationNumber(65_535)).toThrow("0 through 65534")

		const document = onePageDocument({
			MediaBox: array(0, 0, 612, 792),
			Resources: dictionary({}),
		})
		const invalidGeneration = 65_535 as PdfGenerationNumber
		const invalid: PdfDocument = {
			...document,
			root: { ...document.root, generation: invalidGeneration },
			objects: document.objects.map((object, index) =>
				index === 0 ? { ...object, generation: invalidGeneration } : object,
			),
		}

		expect(validatePdf(invalid)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "invalid-generation-number" }),
			]),
		)
	})

	it("surfaces the classic-xref gap limit during validation", () => {
		const base = 1_000_005
		const root = reference<PdfCatalogDictionary>(base)
		const pages = reference<PdfPagesDictionary>(base + 1)
		const page = reference<PdfPageDictionary>(base + 2)
		const document: PdfDocument = {
			version: "1.7",
			root,
			objects: [
				indirectObject(
					base,
					dictionary({ Type: name("Catalog"), Pages: pages }),
				),
				indirectObject(
					base + 1,
					dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }),
				),
				indirectObject(
					base + 2,
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
					code: "excessive-xref-gaps",
					path: "objects",
				}),
			]),
		)
		expect(() => serializePdf(document)).toThrow(PdfValidationError)
	})

	it("returns diagnostics instead of throwing for malformed dictionaries", () => {
		const document = onePageDocument({
			MediaBox: array(0, 0, 612, 792),
			Resources: dictionary({}),
		})
		const malformed: PdfDocument = {
			...document,
			objects: [
				{
					...document.objects[0]!,
					value: { kind: "dictionary", entries: null } as never,
				},
				...document.objects.slice(1),
			],
		}

		expect(() => validatePdf(malformed)).not.toThrow()
		expect(validatePdf(malformed)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "invalid-dictionary" }),
				expect.objectContaining({ code: "invalid-root" }),
			]),
		)
	})

	it("does not throw on malformed interchange container shapes", () => {
		const valid = onePageDocument({
			MediaBox: array(0, 0, 612, 792),
			Resources: dictionary({}),
		})
		const malformedKids: PdfDocument = {
			...valid,
			objects: valid.objects.map((object, index) =>
				index === 1
					? {
							...object,
							value: dictionary({
								Type: name("Pages"),
								Kids: { kind: "array", items: null } as never,
								Count: 1,
							}),
						}
					: object,
			),
		}
		const malformedByteEntries: PdfDocument = {
			...valid,
			objects: [
				...valid.objects,
				indirectObject(4, {
					kind: "stream",
					entries: {},
					byteEntries: [null, [null, 1]],
					data: new Uint8Array(),
				} as never),
			],
		}
		const malformedDictionaryKey: PdfDocument = {
			...valid,
			objects: [
				...valid.objects,
				indirectObject(4, dictionary({ [String.fromCharCode(0xd800)]: true })),
			],
		}
		const malformedDocuments = [
			{ ...valid, objects: null } as unknown as PdfDocument,
			{ ...valid, objects: [null] } as unknown as PdfDocument,
			{ ...valid, root: null } as unknown as PdfDocument,
			malformedKids,
			malformedByteEntries,
			malformedDictionaryKey,
		]

		for (const document of malformedDocuments) {
			expect(() => validatePdf(document)).not.toThrow()
			expect(validatePdf(document).length).toBeGreaterThan(0)
		}
		expect(() => validatePdf(null as unknown as PdfDocument)).not.toThrow()
		expect(validatePdf(malformedByteEntries)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "invalid-dictionary",
					path: "objects[3].value.byteEntries[0]",
				}),
				expect.objectContaining({
					code: "invalid-name",
					path: "objects[3].value.byteEntries[1].key",
				}),
			]),
		)
	})

	it("validates inherited Rotate and Info value types", () => {
		const document = onePageDocument({
			MediaBox: array(0, 0, 612, 792),
			Resources: dictionary({}),
		})
		const pages = document.objects[1]!
		const pagesEntries =
			typeof pages.value === "object" &&
			pages.value !== null &&
			pages.value.kind === "dictionary"
				? pages.value.entries
				: {}
		const invalidInfo = reference<PdfInfoDictionary>(4)
		const invalid: PdfDocument = {
			...document,
			info: invalidInfo,
			objects: [
				document.objects[0]!,
				{
					...pages,
					value: dictionary({
						...pagesEntries,
						Rotate: 45,
					}),
				},
				document.objects[2]!,
				indirectObject(4, dictionary({ Custom: 123 })),
			],
		}

		expect(validatePdf(invalid)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "invalid-page-tree",
					path: "pages.Rotate",
				}),
				expect.objectContaining({
					code: "invalid-info",
					path: "info.Custom",
				}),
			]),
		)
	})

	it("validates Info text encodings and PDF date syntax", () => {
		expectTypeOf(literalString(ascii("raw"))).not.toMatchTypeOf<PdfTextString>()
		expectTypeOf(
			literalString(ascii("D:2026")),
		).not.toMatchTypeOf<PdfDateString>()

		const document = onePageDocument({
			MediaBox: array(0, 0, 612, 792),
			Resources: dictionary({}),
		})
		const info = reference<PdfInfoDictionary>(4)
		const invalid: PdfDocument = {
			...document,
			info,
			objects: [
				...document.objects,
				indirectObject(
					4,
					dictionary(
						{
							Title: hexString(
								Uint8Array.of(0xfe, 0xff, 0xd8, 0x00, 0x00, 0x41),
							),
							CreationDate: literalString(ascii("garbage")),
						},
						dictionaryEntry(
							nameBytes(ascii("ModDate")),
							literalString(ascii("also garbage")),
						),
					),
				),
			],
		}

		expect(validatePdf(invalid)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "invalid-info",
					path: "info.Title",
				}),
				expect.objectContaining({
					code: "invalid-info",
					path: "info.CreationDate",
				}),
				expect.objectContaining({
					code: "invalid-info",
					path: "info.byteEntries[0].value",
				}),
			]),
		)
	})

	it("detects duplicate dictionary keys across string and byte entries", () => {
		const document = onePageDocument({
			MediaBox: array(0, 0, 612, 792),
			Resources: dictionary({}),
		})
		const pages = reference<PdfPagesDictionary>(2)
		const duplicate: PdfDocument = {
			...document,
			objects: [
				indirectObject(
					1,
					dictionary(
						{ Type: name("Catalog"), Pages: pages },
						dictionaryEntry(nameBytes(ascii("Type")), name("Catalog")),
					),
				),
				...document.objects.slice(1),
			],
		}

		expect(validatePdf(duplicate)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "duplicate-dictionary-key",
					path: "objects[0].value.byteEntries[0]",
				}),
			]),
		)
	})
})

function onePageDocument(
	pageEntries: Readonly<Record<string, unknown>>,
): PdfDocument {
	const root = reference<PdfCatalogDictionary>(1)
	const pages = reference<PdfPagesDictionary>(2)
	const page = reference<PdfPageDictionary>(3)
	return {
		version: "1.7",
		root,
		objects: [
			indirectObject(1, dictionary({ Type: name("Catalog"), Pages: pages })),
			indirectObject(
				2,
				dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }),
			),
			indirectObject(
				3,
				dictionary({
					Type: name("Page"),
					Parent: pages,
					...pageEntries,
				} as never),
			),
		],
	}
}
