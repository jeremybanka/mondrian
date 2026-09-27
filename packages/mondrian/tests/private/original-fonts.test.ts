import { inflateSync } from "node:zlib"
import { expect, it } from "vite-plus/test"
import { parsePdf, serializePdf, validatePdf } from "../../src/index.ts"
import { embeddedFontNotebook } from "../fixtures/original-corpus/fonts.ts"
import {
	fontChecksum,
	gardenCff,
	gardenGlyphs,
	gardenTrueType,
} from "../fixtures/original-corpus/font-programs.ts"

it("preserves both embedded font programs and the complete multilingual graph", () => {
	const bytes = embeddedFontNotebook()
	expect(embeddedFontNotebook()).toEqual(bytes)
	const document = parsePdf(bytes)
	expect(validatePdf(document)).toEqual([])
	const output = serializePdf(document)
	expect(parsePdf(output)).toEqual(document)
	expect(serializePdf(parsePdf(output))).toEqual(output)
	for (const [number, expected] of [
		[13, gardenTrueType()],
		[23, gardenCff()],
	] as const) {
		const value = document.objects.find(
			(object) => object.objectNumber === number,
		)!.value
		if (value === null || typeof value !== "object" || value.kind !== "stream")
			throw new Error("Missing original embedded font stream")
		expect(Uint8Array.from(inflateSync(value.data))).toEqual(
			Uint8Array.from(expected),
		)
	}
	const unicode = document.objects.find(
		(object) => object.objectNumber === 7,
	)!.value
	if (
		unicode === null ||
		typeof unicode !== "object" ||
		unicode.kind !== "stream"
	)
		throw new Error("Missing ToUnicode")
	expect(inflateSync(unicode.data).toString()).toContain("<fefc>")
})

it("authors a complete TrueType directory with consistent table and whole-font checksums", () => {
	const bytes = Buffer.from(gardenTrueType())
	expect(fontChecksum(bytes)).toBe(0xb1b0afba)
	const count = bytes.readUInt16BE(4)
	const tables = new Map<string, Buffer>()
	for (let index = 0; index < count; index++) {
		const base = 12 + index * 16
		const tag = bytes.toString("ascii", base, base + 4)
		const offset = bytes.readUInt32BE(base + 8),
			length = bytes.readUInt32BE(base + 12)
		const table = Buffer.from(bytes.subarray(offset, offset + length))
		expect(offset % 4).toBe(0)
		expect(table).toHaveLength(length)
		tables.set(tag, Buffer.from(table))
		if (tag === "head") table.writeUInt32BE(0, 8)
		expect(fontChecksum(table), tag).toBe(bytes.readUInt32BE(base + 4))
	}
	expect([...tables.keys()]).toEqual([
		"OS/2",
		"cmap",
		"glyf",
		"head",
		"hhea",
		"hmtx",
		"loca",
		"maxp",
		"name",
		"post",
	])
	expect(tables.get("maxp")!.readUInt16BE(4)).toBe(gardenGlyphs.length)
	expect(tables.get("loca")!.readUInt32BE(gardenGlyphs.length * 4)).toBe(
		tables.get("glyf")!.length,
	)
	expect(tables.get("hmtx")!.length).toBe(gardenGlyphs.length * 4)
})
