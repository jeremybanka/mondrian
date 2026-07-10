import { describe, expect, expectTypeOf, it } from "vite-plus/test"

import { PdfValidationError } from "../src/diagnostics.ts"
import type {
	PdfCatalogDictionary,
	PdfDictionary,
	PdfDocument,
	PdfPageDictionary,
	PdfPagesDictionary,
	PdfStream,
	PdfValue,
} from "../src/objects.ts"
import {
	array,
	ascii,
	dictionary,
	dictionaryEntry,
	hexString,
	indirectObject,
	literalString,
	name,
	nameBytes,
	reference,
	stream,
} from "../src/objects.ts"
import { serializePdf, serializePdfObjectBody } from "../src/serialize.ts"
import { validatePdf } from "../src/validate.ts"

describe("PDF values", () => {
	it.each([
		[null, "null"],
		[true, "true"],
		[false, "false"],
		[42, "42"],
		[-0, "0"],
		[1e-7, "0.0000001"],
		[1e21, "1000000000000000000000"],
	] as const)("serializes %j", (value, expected) => {
		expect(asciiText(serializePdfObjectBody(value))).toBe(expected)
	})

	it("encodes each lexical primitive without exposing PDF syntax", () => {
		expect(asciiText(serializePdfObjectBody(name("sp ace/#é")))).toBe(
			"/sp#20ace#2F#23#C3#A9",
		)
		expect(
			asciiText(
				serializePdfObjectBody(
					literalString(
						Uint8Array.of(0x28, 0x29, 0x5c, 0x0a, 0x00, 0xff, 0x41),
					),
				),
			),
		).toBe("(\\(\\)\\\\\\n\\000\\377A)")
		expect(
			asciiText(
				serializePdfObjectBody(hexString(Uint8Array.of(0x00, 0xaf, 0xe1))),
			),
		).toBe("<00AFE1>")
		expect(
			asciiText(
				serializePdfObjectBody(array(null, true, name("N"), reference(7))),
			),
		).toBe("[null true /N 7 0 R]")
		expect(
			asciiText(
				serializePdfObjectBody(
					dictionary({
						B: 2,
						Missing: undefined,
						"A A": literalString(ascii("x")),
					}),
				),
			),
		).toBe("<< /B 2 /A#20A (x) >>")
		expect(
			asciiText(
				serializePdfObjectBody(
					dictionary(
						{},
						dictionaryEntry(
							nameBytes(Uint8Array.of(0xff, 0x2f, 0x41)),
							nameBytes(Uint8Array.of(0x80)),
						),
					),
				),
			),
		).toBe("<< /#FF#2FA /#80 >>")
	})

	it("rejects unpaired surrogates in names", () => {
		expect(() => name(String.fromCharCode(0xd800))).toThrow(
			"A PDF name cannot contain an unpaired surrogate",
		)
		expect(() => name(String.fromCharCode(0xdc00))).toThrow(
			"A PDF name cannot contain an unpaired surrogate",
		)
	})

	it("writes binary stream bytes verbatim and derives Length", () => {
		const source = Uint8Array.of(0x00, 0xff, 0x0a, 0x0d)
		const value = stream({ Subtype: name("Data") }, source)
		source.fill(0x41)

		const expected = concatBytes(
			ascii("<< /Subtype /Data /Length 4 >>\nstream\n"),
			Uint8Array.of(0x00, 0xff, 0x0a, 0x0d),
			ascii("\nendstream"),
		)

		expect(serializePdfObjectBody(value)).toEqual(expected)
		expect(() =>
			stream(
				{},
				new Uint8Array(),
				dictionaryEntry(nameBytes(ascii("Length")), 1),
			),
		).toThrow("Stream Length is derived during serialization")
	})

	it("allows streams only as indirect-object values", () => {
		expectTypeOf(stream({}, new Uint8Array())).not.toMatchTypeOf<PdfValue>()

		const invalid = {
			kind: "dictionary",
			entries: { Nested: stream({}, new Uint8Array()) },
		} as unknown as PdfDictionary
		expect(() => serializePdfObjectBody(invalid)).toThrow(
			"A PDF stream must be an indirect object",
		)
	})
})

describe("PDF documents", () => {
	it("serializes an exact four-object PDF with correct xref offsets", () => {
		const bytes = serializePdf(minimalDocument())
		const expected = concatBytes(
			ascii("%PDF-1.7\n%"),
			Uint8Array.of(0xe2, 0xe3, 0xcf, 0xd3),
			ascii(
				"\n" +
					"1 0 obj\n" +
					"<< /Type /Catalog /Pages 2 0 R >>\n" +
					"endobj\n" +
					"2 0 obj\n" +
					"<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n" +
					"endobj\n" +
					"3 0 obj\n" +
					"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>\n" +
					"endobj\n" +
					"4 0 obj\n" +
					"<< /Length 5 >>\n" +
					"stream\n" +
					"BT\nET\n" +
					"endstream\n" +
					"endobj\n" +
					"xref\n" +
					"0 5\n" +
					"0000000000 65535 f \n" +
					"0000000015 00000 n \n" +
					"0000000064 00000 n \n" +
					"0000000121 00000 n \n" +
					"0000000225 00000 n \n" +
					"trailer\n" +
					"<< /Size 5 /Root 1 0 R >>\n" +
					"startxref\n" +
					"279\n" +
					"%%EOF\n",
			),
		)

		expect(bytes).toEqual(expected)
		expect(indexOfBytes(bytes, ascii("1 0 obj\n"))).toBe(15)
		expect(indexOfBytes(bytes, ascii("2 0 obj\n"))).toBe(64)
		expect(indexOfBytes(bytes, ascii("3 0 obj\n"))).toBe(121)
		expect(indexOfBytes(bytes, ascii("4 0 obj\n"))).toBe(225)
		expect(indexOfBytes(bytes, ascii("xref\n"))).toBe(279)
	})

	it("reports graph errors at useful source paths before serialization", () => {
		const root = reference<PdfCatalogDictionary>(1)
		const pages = reference<PdfPagesDictionary>(2)
		const page = reference<PdfPageDictionary>(3)
		const wrongParent = reference<PdfPagesDictionary>(1)
		const missingContents = reference<PdfStream>(99)
		const document: PdfDocument = {
			version: "1.7",
			root,
			objects: [
				indirectObject(
					1,
					dictionary({
						Type: name("Catalog"),
						Pages: pages,
					}) satisfies PdfCatalogDictionary,
				),
				indirectObject(
					2,
					dictionary({
						Type: name("Pages"),
						Kids: array(page),
						Count: 2,
					}) satisfies PdfPagesDictionary,
				),
				indirectObject(
					3,
					dictionary({
						Type: name("Page"),
						Parent: wrongParent,
						MediaBox: array(0, 0, 612, 792),
						Resources: dictionary({}),
						Contents: missingContents,
					}) satisfies PdfPageDictionary,
				),
				indirectObject(4, stream({}, ascii("unreachable"))),
			],
		}

		const diagnostics = validatePdf(document)

		expect(diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					severity: "error",
					code: "invalid-reference",
					path: "objects[2].value.Contents",
				}),
				expect.objectContaining({
					severity: "error",
					code: "incorrect-page-parent",
					path: "pages.Kids[0].Parent",
				}),
				expect.objectContaining({
					severity: "error",
					code: "incorrect-page-count",
					path: "pages.Count",
				}),
				expect.objectContaining({
					severity: "warning",
					code: "unreachable-object",
					path: "object 4",
				}),
			]),
		)
		expect(() => serializePdf(document)).toThrow(PdfValidationError)
	})
})

function minimalDocument(): PdfDocument {
	const root = reference<PdfCatalogDictionary>(1)
	const pages = reference<PdfPagesDictionary>(2)
	const page = reference<PdfPageDictionary>(3)
	const contents = reference<PdfStream>(4)

	return {
		version: "1.7",
		root,
		objects: [
			indirectObject(
				1,
				dictionary({
					Type: name("Catalog"),
					Pages: pages,
				}) satisfies PdfCatalogDictionary,
			),
			indirectObject(
				2,
				dictionary({
					Type: name("Pages"),
					Kids: array(page),
					Count: 1,
				}) satisfies PdfPagesDictionary,
			),
			indirectObject(
				3,
				dictionary({
					Type: name("Page"),
					Parent: pages,
					MediaBox: array(0, 0, 612, 792),
					Resources: dictionary({}),
					Contents: contents,
				}) satisfies PdfPageDictionary,
			),
			indirectObject(4, stream({}, ascii("BT\nET"))),
		],
	}
}

function asciiText(bytes: Uint8Array): string {
	return String.fromCharCode(...bytes)
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(
		parts.reduce((length, part) => length + part.length, 0),
	)
	let offset = 0
	for (const part of parts) {
		result.set(part, offset)
		offset += part.length
	}

	return result
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
	outer: for (
		let offset = 0;
		offset <= haystack.length - needle.length;
		offset += 1
	) {
		for (let index = 0; index < needle.length; index += 1) {
			if (haystack[offset + index] !== needle[index]) {
				continue outer
			}
		}

		return offset
	}

	return -1
}
