import { describe, expect, it } from "vite-plus/test"

import type { PdfDiagnosticCode } from "../src/diagnostics.ts"
import type {
	PdfCatalogDictionary,
	PdfDocument,
	PdfInfoDictionary,
	PdfPageDictionary,
	PdfPagesDictionary,
	PdfValue,
} from "../src/objects.ts"
import {
	array,
	dictionary,
	hexString,
	indirectObject,
	literalString,
	name,
	reference,
} from "../src/objects.ts"
import { validatePdf } from "../src/validate.ts"

describe("low-level validation edge cases", () => {
	it("diagnoses malformed document envelopes", () => {
		const valid = onePageDocument()
		const cases: readonly {
			readonly name: string
			readonly document: PdfDocument
			readonly code: PdfDiagnosticCode
			readonly path: string
		}[] = [
			{
				name: "version",
				document: { ...valid, version: "9.9" } as unknown as PdfDocument,
				code: "invalid-version",
				path: "version",
			},
			{
				name: "object number",
				document: {
					...valid,
					objects: [
						{ ...valid.objects[0]!, objectNumber: 0 },
						...valid.objects.slice(1),
					],
				} as unknown as PdfDocument,
				code: "invalid-object-number",
				path: "objects[0].objectNumber",
			},
			{
				name: "duplicate object",
				document: {
					...valid,
					objects: [...valid.objects, valid.objects[2]!],
				},
				code: "duplicate-object-number",
				path: "objects[3].objectNumber",
			},
			{
				name: "root generation",
				document: {
					...valid,
					root: { ...valid.root, generation: 1 },
				} as PdfDocument,
				code: "reference-generation-mismatch",
				path: "root",
			},
			{
				name: "Info reference",
				document: { ...valid, info: 42 } as unknown as PdfDocument,
				code: "invalid-reference",
				path: "info",
			},
			{
				name: "ID shape",
				document: {
					...valid,
					id: [hexString(Uint8Array.of(1))],
				} as unknown as PdfDocument,
				code: "invalid-document-id",
				path: "id",
			},
			{
				name: "PDF 2.0 short ID",
				document: {
					...valid,
					version: "2.0",
					id: [hexString(Uint8Array.of(1)), hexString(Uint8Array.of(2))],
				},
				code: "invalid-document-id",
				path: "id",
			},
		]

		for (const testCase of cases) {
			expect(validatePdf(testCase.document), testCase.name).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ code: testCase.code, path: testCase.path }),
				]),
			)
		}
	})

	it("diagnoses every malformed direct-value family without throwing", () => {
		const cycle = { kind: "dictionary", entries: {} } as {
			kind: "dictionary"
			entries: Record<string, unknown>
		}
		cycle.entries.Self = cycle
		const cases: readonly {
			readonly name: string
			readonly value: unknown
			readonly code: PdfDiagnosticCode
		}[] = [
			{
				name: "number",
				value: Number.POSITIVE_INFINITY,
				code: "invalid-number",
			},
			{ name: "primitive", value: "not a PDF value", code: "invalid-object" },
			{
				name: "byte string",
				value: { kind: "literal-string", bytes: [] },
				code: "invalid-byte-string",
			},
			{
				name: "array",
				value: { kind: "array", items: null },
				code: "invalid-object",
			},
			{
				name: "stream",
				value: { kind: "stream", entries: { Length: 1 }, data: "bytes" },
				code: "invalid-stream",
			},
			{
				name: "unknown kind",
				value: { kind: "mystery" },
				code: "invalid-object",
			},
			{
				name: "direct stream",
				value: {
					kind: "dictionary",
					entries: {
						Nested: { kind: "stream", entries: {}, data: new Uint8Array() },
					},
				},
				code: "stream-must-be-indirect",
			},
			{ name: "cycle", value: cycle, code: "direct-object-cycle" },
		]

		for (const testCase of cases) {
			const document = withExtraValue(testCase.value)
			expect(() => validatePdf(document), testCase.name).not.toThrow()
			expect(validatePdf(document), testCase.name).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ code: testCase.code }),
				]),
			)
		}

		expect(
			validatePdf(
				withExtraValue({
					kind: "stream",
					entries: { Length: 1 },
					data: "bytes",
				}),
			),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "stream-length-is-derived" }),
			]),
		)
	})

	it("validates string and byte dictionary names across PDF versions", () => {
		const document = withExtraValue({
			kind: "dictionary",
			entries: { "": true, "sp ace": true },
			byteEntries: [
				[{ kind: "byte-name", bytes: new Uint8Array() }, true],
				[{ kind: "byte-name", bytes: Uint8Array.of(0x41, 0) }, true],
			],
		})
		const diagnostics = validatePdf({ ...document, version: "1.1" })

		expect(diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "invalid-dictionary-key" }),
				expect.objectContaining({ code: "invalid-name" }),
				expect.objectContaining({ code: "unsupported-version-feature" }),
			]),
		)
	})

	it("diagnoses malformed page attributes and contents", () => {
		const document = onePageDocument()
		const invalid: PdfDocument = {
			...document,
			objects: document.objects.map((object, index) =>
				index === 2
					? {
							...object,
							value: dictionary({
								Type: name("Page"),
								Parent: reference<PdfPagesDictionary>(2),
								MediaBox: array(0, 0, 612),
								Resources: 42,
								Contents: array(42),
								Rotate: 45,
							}),
						}
					: object,
			),
		}

		expect(validatePdf(invalid)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "invalid-page-tree",
					path: "pages.Kids[0].MediaBox",
				}),
				expect.objectContaining({
					code: "invalid-page-tree",
					path: "pages.Kids[0].Resources",
				}),
				expect.objectContaining({
					code: "invalid-page-tree",
					path: "pages.Kids[0].Contents[0]",
				}),
				expect.objectContaining({
					code: "invalid-page-tree",
					path: "pages.Kids[0].Rotate",
				}),
			]),
		)
	})

	it("diagnoses malformed catalog and Pages topology", () => {
		const valid = onePageDocument()
		const cases: readonly {
			readonly name: string
			readonly document: PdfDocument
			readonly code: PdfDiagnosticCode
			readonly path: string
		}[] = [
			{
				name: "Catalog Pages",
				document: {
					...valid,
					objects: valid.objects.map((object, index) =>
						index === 0
							? {
									...object,
									value: dictionary({ Type: name("Catalog"), Pages: 42 }),
								}
							: object,
					),
				},
				code: "invalid-root",
				path: "root.Pages",
			},
			{
				name: "Pages Type",
				document: replacePages(
					valid,
					dictionary({ Type: name("Other"), Kids: array(), Count: 0 }),
				),
				code: "invalid-page-tree",
				path: "pages.Type",
			},
			{
				name: "root Parent",
				document: replacePages(
					valid,
					dictionary({
						Type: name("Pages"),
						Parent: reference<PdfPagesDictionary>(2),
						Kids: array(reference<PdfPageDictionary>(3)),
						Count: 1,
					}),
				),
				code: "incorrect-page-parent",
				path: "pages.Parent",
			},
			{
				name: "Kids value",
				document: replacePages(
					valid,
					dictionary({ Type: name("Pages"), Kids: array(42), Count: 0 }),
				),
				code: "invalid-page-tree",
				path: "pages.Kids[0]",
			},
		]

		for (const testCase of cases) {
			expect(validatePdf(testCase.document), testCase.name).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ code: testCase.code, path: testCase.path }),
				]),
			)
		}
	})

	it("distinguishes page-tree cycles from reused nodes", () => {
		const root = reference<PdfCatalogDictionary>(1)
		const pages = reference<PdfPagesDictionary>(2)
		const nested = reference<PdfPagesDictionary>(3)
		const cyclic: PdfDocument = {
			version: "1.7",
			root,
			objects: [
				indirectObject(1, dictionary({ Type: name("Catalog"), Pages: pages })),
				indirectObject(
					2,
					dictionary({
						Type: name("Pages"),
						Kids: array(nested),
						Count: 0,
						MediaBox: array(0, 0, 612, 792),
						Resources: dictionary({}),
					}),
				),
				indirectObject(
					3,
					dictionary({
						Type: name("Pages"),
						Parent: pages,
						Kids: array(pages),
						Count: 0,
					}),
				),
			],
		}
		expect(validatePdf(cyclic)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "page-tree-cycle" }),
			]),
		)

		const reused = onePageDocument()
		const reusedPage = reference<PdfPageDictionary>(3)
		const repeated: PdfDocument = {
			...reused,
			objects: reused.objects.map((object, index) =>
				index === 1
					? {
							...object,
							value: dictionary({
								Type: name("Pages"),
								Kids: array(reusedPage, reusedPage),
								Count: 2,
							}),
						}
					: object,
			),
		}
		expect(validatePdf(repeated)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "page-tree-node-reused" }),
			]),
		)
	})

	it("checks UTF-16 variants and calendar-aware PDF dates", () => {
		const textDocument = withInfo({
			Title: hexString(Uint8Array.of(0xff, 0xfe, 0x41, 0)),
			Author: hexString(Uint8Array.of(0xfe, 0xff, 0)),
			Subject: hexString(Uint8Array.of(0xfe, 0xff, 0xdc, 0x00)),
			Keywords: hexString(Uint8Array.of(0xfe, 0xff, 0xd8, 0x00)),
		})
		for (const path of [
			"info.Title",
			"info.Author",
			"info.Subject",
			"info.Keywords",
		]) {
			expect(validatePdf(textDocument)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ code: "invalid-info", path }),
				]),
			)
		}

		const dateCases = [
			["D:20240229010203Z", true],
			["D:20230229010203Z", false],
			["D:20261301010203Z", false],
			["D:20260431240000Z", false],
			["D:20260430120000+08'60'", false],
		] as const
		for (const [value, valid] of dateCases) {
			const diagnostics = validatePdf(
				withInfo({ CreationDate: literalString(asciiBytes(value)) }),
			).filter(({ path }) => path === "info.CreationDate")
			expect(diagnostics, value).toHaveLength(valid ? 0 : 1)
		}
		expect(
			validatePdf(
				withInfo({
					CreationDate: literalString(Uint8Array.of(0x44, 0x3a, 0xff)),
				}),
			),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "invalid-info",
					path: "info.CreationDate",
				}),
			]),
		)
	})
})

function onePageDocument(): PdfDocument {
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
					MediaBox: array(0, 0, 612, 792),
					Resources: dictionary({}),
				}),
			),
		],
	}
}

function withExtraValue(value: unknown): PdfDocument {
	const document = onePageDocument()
	return {
		...document,
		objects: [
			...document.objects,
			{ objectNumber: 4, generation: 0, value } as never,
		],
	}
}

function withInfo(entries: Readonly<Record<string, PdfValue>>): PdfDocument {
	const document = onePageDocument()
	const info = reference<PdfInfoDictionary>(4)
	return {
		...document,
		info,
		objects: [...document.objects, indirectObject(4, dictionary(entries))],
	}
}

function replacePages(document: PdfDocument, value: PdfValue): PdfDocument {
	return {
		...document,
		objects: document.objects.map((object, index) =>
			index === 1 ? { ...object, value: value as never } : object,
		),
	}
}

function asciiBytes(value: string): Uint8Array {
	return Uint8Array.from(value, (character) => character.charCodeAt(0))
}
