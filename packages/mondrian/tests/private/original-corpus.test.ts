import { inflateSync } from "node:zlib"
import { isDeepStrictEqual } from "node:util"
import { describe, expect, it } from "vite-plus/test"
import {
	parsePdf,
	PdfParseError,
	serializePdf,
	validatePdf,
} from "../../src/index.ts"
import type {
	PdfDocument,
	PdfIndirectValue,
	PdfValue,
} from "../../src/index.ts"
import {
	formScript,
	originalFixtures,
	receiptXml,
} from "../fixtures/original-corpus/documents.ts"
import { gardenProfile } from "../fixtures/original-corpus/color.ts"

function names(document: PdfDocument): Set<string> {
	const found = new Set<string>()
	const visit = (value: PdfIndirectValue | PdfValue | undefined): void => {
		if (value === null || typeof value !== "object") return
		if (value.kind === "name") found.add(value.value)
		if (value.kind === "dictionary" || value.kind === "stream")
			Object.values(value.entries).forEach(visit)
		if (value.kind === "array") value.items.forEach(visit)
	}
	document.objects.forEach((object) => visit(object.value))
	return found
}
function fixture(id: string) {
	const found = originalFixtures.find((item) => item.id === id)
	if (!found) throw new Error(`Unknown original fixture ${id}`)
	return found
}
function read(id: string): PdfDocument {
	const found = fixture(id)
	return parsePdf(found.build(), found.parseOptions)
}
function object(document: PdfDocument, number: number) {
	const value = document.objects.find(
		(item) => item.objectNumber === number,
	)?.value
	if (value === undefined) throw new Error(`Missing fixture object ${number}`)
	return value
}
function decodedStream(document: PdfDocument, number: number): Uint8Array {
	const value = object(document, number)
	if (value === null || typeof value !== "object" || value.kind !== "stream")
		throw new Error(`Fixture object ${number} is not a stream`)
	return value.entries.Filter === undefined
		? value.data
		: Uint8Array.from(inflateSync(value.data))
}

describe.each(originalFixtures)("original corpus: $id", (fixture) => {
	it("preserves the complete graph and serialized bytes after a strict reparse", () => {
		const source = fixture.build()
		expect(fixture.build()).toEqual(source)
		const warnings: string[] = []
		const document = parsePdf(source, {
			...fixture.parseOptions,
			onWarning: (warning) => warnings.push(warning.code),
		})
		expect(warnings).toEqual(fixture.recoveryWarnings ?? [])
		const diagnostics = validatePdf(document, fixture.validationOptions)
		expect(diagnostics.filter((item) => item.severity === "error")).toEqual([])
		expect(
			diagnostics.filter((item) => item.code === "invalid-info"),
		).toHaveLength(fixture.dateWarnings ?? 0)
		for (const expected of fixture.names)
			expect(names(document), expected).toContain(expected)
		const output = serializePdf(document, fixture.validationOptions)
		const reparsed = parsePdf(output)
		expect(isDeepStrictEqual(reparsed, document)).toBe(true)
		expect(serializePdf(reparsed, fixture.validationOptions)).toEqual(output)
	})
})

it("really exercises compressed objects, predicted xref streams, and hybrid lookup", () => {
	for (const id of ["streamed-ledger", "hybrid-ledger"]) {
		const source = Buffer.from(fixture(id).build()).toString("latin1")
		expect(source).toContain("/Type /ObjStm")
		expect(source).toContain("/Predictor 12")
		expect(source.includes("/XRefStm")).toBe(id === "hybrid-ledger")
		expect(source).not.toContain("5 0 obj\n")
		expect(object(read(id), 5)).toMatchObject({
			kind: "dictionary",
			entries: { Subtype: { value: "Type1" } },
		})
	}
})

it("applies the current catalog revision and inherits earlier objects", () => {
	const source = Buffer.from(fixture("incremental-garden").build()).toString(
		"latin1",
	)
	expect(source.match(/startxref/g)).toHaveLength(2)
	expect(source).toContain("%PDF-1.4")
	expect(read("incremental-garden").version).toBe("2.0")
	expect(
		Buffer.from(decodedStream(read("incremental-garden"), 4)).toString(),
	).toContain("A second season")
})

it("requires opt-in recovery and preserves the malformed-date bytes", () => {
	for (const id of ["prefixed-ticket", "metadata-quartz"])
		expect(() => parsePdf(fixture(id).build())).toThrow(PdfParseError)
	for (const id of ["metadata-historic", "metadata-quartz"]) {
		const document = read(id)
		expect(
			validatePdf(document).filter((item) => item.severity === "error"),
		).toHaveLength(1)
		expect(() => serializePdf(document)).toThrow()
		const before = object(document, 10)
		const after = object(
			parsePdf(serializePdf(document, { preserveInvalidDates: true })),
			10,
		)
		expect(after).toEqual(before)
	}
	for (const id of [
		"metadata-utf8",
		"metadata-utf16",
		"metadata-historic",
		"metadata-quartz",
	]) {
		const document = read(id)
		expect(object(document, 3)).toMatchObject({
			entries: { Contents: { kind: "reference", objectNumber: 6 } },
		})
		expect(object(document, 6)).toMatchObject({
			kind: "array",
			items: [{ objectNumber: 4 }, { objectNumber: 7 }],
		})
		expect(object(document, 8)).toMatchObject({
			entries: {
				Title: { objectNumber: 9 },
				CreationDate: { objectNumber: 10 },
				Trapped: { objectNumber: 11 },
			},
		})
	}
})

it("preserves extractable original attachments, form values, scripts, and tagging", () => {
	const document = read("parcel-receipt")
	expect(Buffer.from(decodedStream(document, 11)).toString()).toBe(receiptXml)
	const attachment = parsePdf(decodedStream(document, 19))
	expect(validatePdf(attachment)).toEqual([])
	expect(Buffer.from(decodedStream(attachment, 4)).toString()).toContain(
		"A ticket to nowhere",
	)
	expect(object(document, 7)).toMatchObject({
		entries: { V: { bytes: Uint8Array.from(Buffer.from("MOSS-007")) } },
	})
	expect(object(document, 15)).toMatchObject({
		entries: { JS: { bytes: Uint8Array.from(Buffer.from(formScript)) } },
	})
	expect(object(document, 17)).toMatchObject({
		entries: { K: 0, Pg: { objectNumber: 3 } },
	})
	expect(Buffer.from(decodedStream(document, 13)).toString()).toContain(
		"<parcel>MOSS-007</parcel>",
	)
})

it("preserves original bitmap glyphs, ToUnicode mappings, OCR, and ICC bytes", () => {
	const glyphs = read("glyph-garden")
	expect(decodedStream(glyphs, 11)).toEqual(
		Uint8Array.of(0, 0x7e, 0, 0x3c, 0, 0x7e, 0, 0),
	)
	expect(Buffer.from(decodedStream(glyphs, 10)).toString()).toContain(
		"<41> <5C71> <42> <4E09> <43> <0627>",
	)
	expect(
		Buffer.from(decodedStream(read("lantern-archive"), 4)).toString(),
	).toContain("3 Tr")
	expect(decodedStream(read("prism-workshop"), 15)).toEqual(gardenProfile())
})
