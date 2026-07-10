import { describe, expect, expectTypeOf, it } from "vite-plus/test"

import { PdfValidationError } from "../src/diagnostics.ts"
import {
	createPdfObjectBuilder,
	type PdfObjectBuilder,
	type PdfObjectHandle,
} from "../src/object-builder.ts"
import type {
	PdfCatalogDictionary,
	PdfDictionary,
	PdfDocument,
	PdfPageDictionary,
	PdfPagesDictionary,
	PdfReference,
} from "../src/objects.ts"
import {
	array,
	ascii,
	dictionary,
	dictionaryEntry,
	name,
	nameBytes,
	stream,
} from "../src/objects.ts"
import { serializePdf } from "../src/serialize.ts"
import { validatePdf } from "../src/validate.ts"

describe("PdfObjectBuilder", () => {
	it("reserves typed references so cyclic page trees can be filled later", () => {
		const builder = createPdfObjectBuilder()
		const pages = builder.reserve<PdfPagesDictionary>()
		const contents = builder.add(stream({}, ascii("BT\nET")))
		const pageValue: PdfPageDictionary = dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 612, 792),
			Resources: dictionary({}),
			Contents: contents,
		})
		const page = builder.add(pageValue)

		pages.set(
			dictionary({
				Type: name("Pages"),
				Kids: array(page),
				Count: 1,
			}),
		)

		const catalog: PdfCatalogDictionary = dictionary({
			Type: name("Catalog"),
			Pages: pages.ref,
		})
		const root = builder.add(catalog)
		const document = builder.build({ root })

		expectTypeOf(pages.ref).toEqualTypeOf<PdfReference<PdfPagesDictionary>>()
		expectTypeOf(pages).not.toMatchTypeOf<PdfObjectHandle<PdfDictionary>>()
		expectTypeOf(page).toEqualTypeOf<PdfReference<PdfPageDictionary>>()
		expectTypeOf(root).toEqualTypeOf<PdfReference<PdfCatalogDictionary>>()
		expectTypeOf(root).not.toMatchTypeOf<PdfReference<PdfPageDictionary>>()
		expect(validatePdf(document)).toEqual([])
		expect(document.objects.map(({ objectNumber }) => objectNumber)).toEqual([
			1, 2, 3, 4,
		])
	})

	it("rejects setting a reserved object twice", () => {
		const builder = createPdfObjectBuilder()
		const handle = builder.reserve<PdfDictionary>()
		const value = dictionary({})

		handle.set(value)

		expect(() => handle.set(value)).toThrow("PDF object 1 has already been set")
	})

	it("rejects an unset reserved object when it is reachable", () => {
		const builder = createPdfObjectBuilder()
		const root = builder.reserve<PdfCatalogDictionary>()

		const error = captureValidationError(() =>
			builder.build({ root: root.ref }),
		)

		expect(error.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					severity: "error",
					code: "invalid-reference",
					path: "root",
				}),
			]),
		)
	})

	it("rejects references owned by another builder", () => {
		const first = createPdfObjectBuilder()
		const foreignRoot = first.reserve<PdfCatalogDictionary>()
		const second = createPdfObjectBuilder()

		const error = captureValidationError(() =>
			second.build({ root: foreignRoot.ref }),
		)

		expect(error.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					severity: "error",
					code: "foreign-reference",
					path: "root",
				}),
			]),
		)
	})

	it("garbage-collects allocated objects unreachable from Root or Info", () => {
		const builder = createPdfObjectBuilder()
		const unused = builder.add(stream({}, ascii("unused")))
		const document = buildOnePageDocument(builder)

		expect(unused.objectNumber).toBe(1)
		expect(document.objects.map(({ objectNumber }) => objectNumber)).toEqual([
			2, 3, 4, 5,
		])
		expect(validatePdf(document)).toEqual([])
		const serialized = String.fromCharCode(...serializePdf(document))
		expect(serialized).toContain(
			"xref\n0 6\n" + "0000000001 65535 f \n" + "0000000000 00000 f \n",
		)
	})

	it("traces references stored under arbitrary byte-name keys", () => {
		const builder = createPdfObjectBuilder()
		const extension = builder.add(dictionary({ Value: 1 }))
		const pages = builder.reserve<PdfPagesDictionary>()
		const page = builder.add(
			dictionary({
				Type: name("Page"),
				Parent: pages.ref,
				MediaBox: array(0, 0, 612, 792),
				Resources: dictionary({}),
			}),
		)
		pages.set(dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }))
		const root = builder.add(
			dictionary(
				{ Type: name("Catalog"), Pages: pages.ref },
				dictionaryEntry(nameBytes(Uint8Array.of(0xff)), extension),
			),
		)

		const document = builder.build({ root })
		expect(document.objects.map(({ objectNumber }) => objectNumber)).toContain(
			extension.objectNumber,
		)
		expect(String.fromCharCode(...serializePdf(document))).toContain(
			"/#FF 1 0 R",
		)
	})
})

function buildOnePageDocument(builder: PdfObjectBuilder): PdfDocument {
	const pages = builder.reserve<PdfPagesDictionary>()
	const contents = builder.add(stream({}, ascii("BT\nET")))
	const page: PdfPageDictionary = dictionary({
		Type: name("Page"),
		Parent: pages.ref,
		MediaBox: array(0, 0, 612, 792),
		Resources: dictionary({}),
		Contents: contents,
	})
	const pageReference = builder.add(page)
	pages.set(
		dictionary({
			Type: name("Pages"),
			Kids: array(pageReference),
			Count: 1,
		}),
	)
	const catalog: PdfCatalogDictionary = dictionary({
		Type: name("Catalog"),
		Pages: pages.ref,
	})

	return builder.build({ root: builder.add(catalog) })
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
