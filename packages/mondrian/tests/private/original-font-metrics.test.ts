import { expect, it } from "vite-plus/test"
import { parsePdf } from "../../src/index.ts"
import {
	gardenCff,
	gardenTrueType,
} from "../fixtures/original-corpus/font-programs.ts"
import { embeddedFontNotebook } from "../fixtures/original-corpus/fonts.ts"

// Independent wire inspection: expected metrics come from serialized glyph coordinates
// and hmtx, never from the generator's outline arrays or metric helpers.
function inspectTrueType(blank: boolean) {
	const bytes = Buffer.from(gardenTrueType(blank))
	const tables = new Map<string, Buffer>()
	for (let i = 0; i < bytes.readUInt16BE(4); i++) {
		const base = 12 + 16 * i
		const offset = bytes.readUInt32BE(base + 8),
			length = bytes.readUInt32BE(base + 12)
		tables.set(
			bytes.toString("ascii", base, base + 4),
			bytes.subarray(offset, offset + length),
		)
	}
	const head = tables.get("head")!,
		hhea = tables.get("hhea")!,
		maxp = tables.get("maxp")!,
		os2 = tables.get("OS/2")!
	const loca = tables.get("loca")!,
		glyf = tables.get("glyf")!,
		hmtx = tables.get("hmtx")!
	expect(head.readInt16BE(50)).toBe(1)
	const glyphCount = maxp.readUInt16BE(4)
	expect(hhea.readUInt16BE(34)).toBe(glyphCount)
	const glyphs = Array.from({ length: glyphCount }, (_, index) => {
		const glyph = glyf.subarray(
			loca.readUInt32BE(index * 4),
			loca.readUInt32BE((index + 1) * 4),
		)
		const contours = glyph.readInt16BE(0)
		expect(contours).toBeGreaterThanOrEqual(0)
		const pointCount = contours ? glyph.readUInt16BE(8 + 2 * contours) + 1 : 0
		const instructionLength = glyph.readUInt16BE(10 + 2 * contours)
		expect(instructionLength).toBe(0)
		const flags = 12 + 2 * contours
		expect([...glyph.subarray(flags, flags + pointCount)]).toEqual(
			Array<number>(pointCount).fill(1),
		)
		const points: [number, number][] = []
		let x = 0,
			y = 0
		for (let p = 0; p < pointCount; p++) {
			x += glyph.readInt16BE(flags + pointCount + p * 2)
			y += glyph.readInt16BE(flags + pointCount * 3 + p * 2)
			points.push([x, y])
		}
		const bounds = points.length
			? [
					Math.min(...points.map((p) => p[0])),
					Math.min(...points.map((p) => p[1])),
					Math.max(...points.map((p) => p[0])),
					Math.max(...points.map((p) => p[1])),
				]
			: [0, 0, 0, 0]
		expect([2, 4, 6, 8].map((offset) => glyph.readInt16BE(offset))).toEqual(
			bounds,
		)
		return {
			contours,
			pointCount,
			bounds,
			advance: hmtx.readUInt16BE(index * 4),
			lsb: hmtx.readInt16BE(index * 4 + 2),
		}
	})
	const outlined = glyphs.filter((glyph) => glyph.contours > 0)
	const bounds = outlined.length
		? [
				Math.min(...outlined.map((g) => g.bounds[0]!)),
				Math.min(...outlined.map((g) => g.bounds[1]!)),
				Math.max(...outlined.map((g) => g.bounds[2]!)),
				Math.max(...outlined.map((g) => g.bounds[3]!)),
			]
		: [0, 0, 0, 0]
	return { head, hhea, maxp, os2, glyphs, outlined, bounds }
}

it.each([false, true])(
	"derives TrueType global metrics from serialized glyphs (blank=%s)",
	(blank) => {
		const { head, hhea, maxp, os2, glyphs, outlined, bounds } =
			inspectTrueType(blank)
		expect
			.soft([36, 38, 40, 42].map((offset) => head.readInt16BE(offset)))
			.toEqual(bounds)
		expect
			.soft(hhea.readUInt16BE(10))
			.toBe(Math.max(...glyphs.map((g) => g.advance)))
		expect
			.soft(hhea.readInt16BE(12))
			.toBe(outlined.length ? Math.min(...outlined.map((g) => g.lsb)) : 0)
		expect
			.soft(hhea.readInt16BE(14))
			.toBe(
				outlined.length
					? Math.min(
							...outlined.map(
								(g) => g.advance - g.lsb - g.bounds[2]! + g.bounds[0]!,
							),
						)
					: 0,
			)
		expect
			.soft(hhea.readInt16BE(16))
			.toBe(
				outlined.length
					? Math.max(
							...outlined.map((g) => g.lsb + g.bounds[2]! - g.bounds[0]!),
						)
					: 0,
			)
		expect
			.soft(maxp.readUInt16BE(6))
			.toBe(Math.max(...glyphs.map((g) => g.pointCount)))
		expect
			.soft(maxp.readUInt16BE(8))
			.toBe(Math.max(...glyphs.map((g) => g.contours)))
		// No composite glyphs, hint programs, instruction storage, or twilight zone.
		expect([...maxp.subarray(10, 32)]).toEqual([
			0,
			0,
			0,
			0,
			0,
			1,
			...Array<number>(16).fill(0),
		])
		const widths = glyphs.map((g) => g.advance).filter((width) => width > 0)
		expect
			.soft(os2.readInt16BE(2))
			.toBe(
				Math.round(
					widths.reduce((sum, width) => sum + width, 0) / widths.length,
				),
			)
	},
)

function cffBoundingBox(blank: boolean): number[] {
	const bytes = Buffer.from(gardenCff(blank))
	// CFF INDEX offset width and counts are read independently; Top DICT follows Name INDEX.
	function index(at: number) {
		const count = bytes.readUInt16BE(at),
			size = bytes[at + 2]!
		const data = at + 3 + (count + 1) * size
		const offsets = Array.from({ length: count + 1 }, (_, n) =>
			bytes.readUIntBE(at + 3 + n * size, size),
		)
		return {
			end: data + offsets[count]! - 1,
			first: bytes.subarray(data + offsets[0]! - 1, data + offsets[1]! - 1),
		}
	}
	const top = index(index(bytes[2]!).end).first
	let operands: number[] = []
	for (let offset = 0; offset < top.length;) {
		const op = top[offset++]!
		if (op === 29) {
			operands.push(top.readInt32BE(offset))
			offset += 4
			continue
		}
		if (op === 5) return operands
		if (op === 12) offset++
		operands = []
	}
	throw new Error("Missing CFF FontBBox")
}

it.each([false, true])(
	"keeps CFF and PDF font bounds consistent with actual shared outlines (blank=%s)",
	(blank) => {
		const { bounds } = inspectTrueType(blank)
		expect.soft(cffBoundingBox(blank)).toEqual(bounds)
		for (const [font, descriptor] of [
			["truetype", 12],
			["cff", 22],
		] as const) {
			const document = parsePdf(embeddedFontNotebook(blank ? font : undefined))
			const value = document.objects.find(
				(object) => object.objectNumber === descriptor,
			)!.value
			if (!value || typeof value !== "object" || value.kind !== "dictionary")
				throw new Error("Missing font descriptor")
			expect
				.soft(value.entries.FontBBox)
				.toMatchObject({ kind: "array", items: bounds })
		}
	},
)
