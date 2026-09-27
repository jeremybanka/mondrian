import { createHash } from "node:crypto"
import { describe, expect, it } from "vite-plus/test"
import { parsePdf, serializePdf, validatePdf } from "../../src/index.ts"
import type { PdfDocument } from "../../src/index.ts"
import {
	codecDocument,
	codecFixtures,
} from "../fixtures/original-corpus/codecs/documents.ts"
import { lzw } from "../fixtures/original-corpus/codecs/encoders.ts"
import { colorPixels } from "../fixtures/original-corpus/codecs/pixels.ts"

function image(document: PdfDocument) {
	const value = document.objects.find(
		(object) => object.objectNumber === 6,
	)?.value
	if (typeof value !== "object" || value === null || value.kind !== "stream")
		throw new Error("Missing fixture image")
	return value
}

describe.each(codecFixtures)("original $id image", (fixture) => {
	it("preserves encoded bytes, decode parameters and the visible resource through strict reparsing", () => {
		const source = codecDocument(fixture)
		expect(codecDocument(fixture)).toEqual(source)
		const document = parsePdf(source)
		expect(validatePdf(document)).toEqual([])
		const before = image(document)
		expect(before.entries).toMatchObject({
			Filter: { kind: "name", value: fixture.filter },
			Width: 64,
			Height: 64,
		})
		expect(before.data).toEqual(Uint8Array.from(fixture.encoded()))
		const output = serializePdf(document)
		const reparsed = parsePdf(output)
		expect(image(reparsed)).toEqual(before)
		expect(serializePdf(reparsed)).toEqual(output)
		const content = document.objects.find(
			(object) => object.objectNumber === 4,
		)!.value
		expect(content).toMatchObject({ kind: "stream" })
		if (
			typeof content !== "object" ||
			content === null ||
			content.kind !== "stream"
		)
			throw new Error("Missing content")
		expect(Buffer.from(content.data).toString()).toContain("/Picture Do")
	})
})

it.each([0, 1] as const)(
	"uses LZW dictionary codes, all code widths and dictionary clears with EarlyChange %s",
	(earlyChange) => {
		const { codes, widths } = lzw(colorPixels(), earlyChange)
		expect(Math.max(...codes)).toBeGreaterThan(2047)
		expect(widths).toEqual([9, 10, 11, 12])
		expect(codes.filter((code) => code === 256).length).toBeGreaterThan(1)
		expect(codes.at(-1)).toBe(257)
	},
)

it("pins the independently encoded original JPEG 2000 asset", () => {
	expect(
		createHash("sha256").update(codecFixtures[0].encoded()).digest("hex"),
	).toBe("40bfc670eda7ecacbefd6e614d1003c6b756f03b668f3998a285874a310a62ff")
})
