// SPDX-License-Identifier: MPL-2.0
// Original geometric outlines. No installed/downloaded font or font-generator dependency.
// Wire formats: Microsoft OpenType glyf/loca/sfnt and Adobe technical notes 5176/5177.
type Point = readonly [number, number]
type Contour = readonly Point[]
export interface GardenGlyph {
	readonly key: string
	readonly unicode: string
	readonly width: number
	readonly contours: readonly Contour[]
}

function stroke(points: readonly Point[], thickness = 58): Contour[] {
	return points.slice(1).map((end, index) => {
		const start = points[index]!
		const dx = end[0] - start[0],
			dy = end[1] - start[1]
		const length = Math.hypot(dx, dy)
		const x = Math.round((-dy * thickness) / length / 2)
		const y = Math.round((dx * thickness) / length / 2)
		return [
			[start[0] + x, start[1] + y],
			[end[0] + x, end[1] + y],
			[end[0] - x, end[1] - y],
			[start[0] - x, start[1] - y],
		]
	})
}
const path = (source: string, thickness = 58): Contour[] =>
	source.split(";").flatMap((line) =>
		stroke(
			line
				.trim()
				.split(" ")
				.map((point) => point.split(",").map(Number) as unknown as Point),
			thickness,
		),
	)

// Individually drawn letter skeletons; this is an intentionally angular original display face.
const latin: Record<string, string> = {
	A: "60,0 280,700 500,0;130,220 430,220",
	B: "70,0 70,700 320,700 490,540 300,370 70,370;300,370 500,190 320,0 70,0",
	C: "500,640 350,700 90,520 90,170 330,0 500,70",
	D: "70,0 70,700 300,700 500,510 500,180 300,0 70,0",
	E: "500,700 70,700 70,0 500,0;70,350 410,350",
	F: "70,0 70,700 500,700;70,370 420,370",
	G: "500,610 340,700 80,520 80,180 320,0 500,90 500,330 320,330",
	H: "70,0 70,700;500,0 500,700;70,350 500,350",
	I: "100,700 470,700;285,700 285,0;100,0 470,0",
	J: "100,700 500,700 500,170 330,0 100,170",
	K: "70,0 70,700;500,700 70,320 500,0",
	L: "70,700 70,0 500,0",
	M: "70,0 70,700 285,360 500,700 500,0",
	N: "70,0 70,700 500,0 500,700",
	O: "285,700 500,520 500,180 285,0 70,180 70,520 285,700",
	P: "70,0 70,700 320,700 500,540 320,350 70,350",
	Q: "285,700 500,520 500,180 285,0 70,180 70,520 285,700;330,170 540,-40",
	R: "70,0 70,700 320,700 500,540 320,350 70,350;300,350 530,0",
	S: "500,630 320,700 70,520 500,180 300,0 70,70",
	T: "30,700 540,700;285,700 285,0",
	U: "70,700 70,170 285,0 500,170 500,700",
	V: "50,700 285,0 520,700",
	W: "50,700 150,0 285,350 420,0 520,700",
	X: "50,700 520,0;520,700 50,0",
	Y: "50,700 285,360 520,700;285,360 285,0",
	Z: "70,700 500,700 70,0 500,0",
	"0": "285,700 500,520 500,180 285,0 70,180 70,520 285,700;100,140 470,550",
	"1": "100,500 285,700 285,0;100,0 470,0",
	"2": "70,570 285,700 500,550 70,0 500,0",
	"3": "70,630 320,700 500,530 285,350 500,170 320,0 70,70",
	"4": "440,0 440,700 50,220 540,220",
	"5": "500,700 70,700 70,370 330,370 500,190 330,0 70,70",
	"6": "470,700 100,390 70,150 285,0 500,170 350,390 100,390",
	"7": "70,700 500,700 160,0",
	"8": "285,350 70,530 285,700 500,530 285,350 70,170 285,0 500,170 285,350",
	"9": "470,310 220,310 70,530 285,700 500,550 470,310 100,0",
	"+": "70,350 500,350;285,130 285,570",
	"=": "70,230 500,230;70,470 500,470",
	"-": "70,350 500,350",
	"(": "420,750 170,500 170,200 420,-50",
	")": "150,750 400,500 400,200 150,-50",
	"/": "70,0 500,700",
	".": "270,0 290,0",
	Σ: "520,700 70,700 320,350 70,0 520,0",
	"∫": "520,700 390,750 285,570 285,100 180,-80 70,-20",
	"√": "40,260 160,340 270,0 430,700 570,700",
	α: "500,500 420,50 210,0 70,170 140,420 320,500 430,300 510,0",
	π: "50,490 520,490;170,490 150,0;420,490 420,60 520,0",
}
const cjk: Record<string, string> = {
	山: "110,570 110,70 790,70 790,570;450,780 450,70",
	川: "150,770 150,380 90,40;430,710 430,80;740,770 740,40",
	日: "180,50 180,760 720,760 720,50 180,50;180,410 720,410",
	月: "150,40 220,260 220,770 730,770 730,40 610,90;220,530 730,530;220,300 730,300",
	木: "80,560 820,560;450,810 450,20;450,510 260,240 70,100;450,510 640,240 830,100",
	火: "460,800 450,390 320,180 80,30;450,390 610,170 840,30;150,610 260,390;760,640 620,430",
	土: "170,490 730,490;450,790 450,70;70,70 830,70",
	水: "430,810 430,10 330,90;80,510 280,510 200,280 70,100;750,660 470,390 670,160 830,80",
	金: "60,540 450,820 840,540;250,540 650,540;130,350 770,350;450,540 450,50;230,260 300,130;680,260 610,130;100,50 800,50",
	の: "470,610 450,310 260,100 100,260 190,530 450,690 710,570 800,350 690,120 540,70",
	と: "300,800 400,430;720,550 260,340 180,180 330,60 740,80",
}

const arabic: GardenGlyph[] = [
	{
		key: "seen.initial",
		unicode: "س",
		width: 600,
		contours: path(
			"0,200 90,200 150,320 180,200 280,200 330,330 360,200 470,200 520,350",
			48,
		),
	},
	{
		key: "lam_alef.final",
		unicode: "\uFEFC",
		width: 600,
		contours: path(
			"600,200 460,200 300,700;300,200 180,700;300,200 100,200 80,300 210,430 460,200",
			48,
		),
	},
	{
		key: "meem.isolated",
		unicode: "م",
		width: 600,
		contours: path(
			"470,200 470,390 320,450 220,320 340,200 470,200;220,320 150,120 150,-170",
			48,
		),
	},
	{
		key: "baa.initial",
		unicode: "ب",
		width: 600,
		contours: path("0,200 430,200 500,300 500,400;280,50 295,50", 48),
	},
	{
		key: "alef.final",
		unicode: "ا",
		width: 380,
		contours: path("380,200 170,200 120,700", 48),
	},
	{
		key: "baa.isolated",
		unicode: "ب",
		width: 700,
		contours: path(
			"100,350 100,230 190,150 550,150 620,230 620,350;350,10 365,10",
			48,
		),
	},
]

export const gardenGlyphs: readonly GardenGlyph[] = [
	{
		key: ".notdef",
		unicode: "\uFFFD",
		width: 650,
		contours: path("70,0 70,700 500,700 500,0 70,0;70,0 500,700", 45),
	},
	{ key: " ", unicode: " ", width: 340, contours: [] },
	...Object.entries(latin).map(([key, source]) => ({
		key,
		unicode: key,
		width: 650,
		contours: path(source),
	})),
	...Object.entries(cjk).map(([key, source]) => ({
		key,
		unicode: key,
		width: 900,
		contours: path(source, 48),
	})),
	...arabic,
	// Deliberately distinctive glyph makes accidental font substitution visually conspicuous.
	{
		key: "seal",
		unicode: "◇",
		width: 900,
		contours: path(
			"450,800 800,400 450,0 100,400 450,800;450,650 650,400 450,150;260,400 490,400",
			65,
		),
	},
]
export const glyphIndex = (key: string): number => {
	const index = gardenGlyphs.findIndex((glyph) => glyph.key === key)
	if (index < 0) throw new Error(`Unknown original glyph ${key}`)
	return index
}

const u16 = (number: number) => {
	const out = Buffer.alloc(2)
	out.writeUInt16BE(number & 65535)
	return out
}
const u32 = (number: number) => {
	const out = Buffer.alloc(4)
	out.writeUInt32BE(number >>> 0)
	return out
}
const join = (...bytes: Uint8Array[]) => Buffer.concat(bytes)
const words = (...numbers: number[]) => join(...numbers.map(u16))
const align = (bytes: Buffer) =>
	join(bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4))
export function fontChecksum(bytes: Uint8Array): number {
	const padded = align(Buffer.from(bytes))
	let sum = 0
	for (let offset = 0; offset < padded.length; offset += 4)
		sum = (sum + padded.readUInt32BE(offset)) >>> 0
	return sum
}

function outlineBounds(
	contours: readonly Contour[],
): readonly [number, number, number, number] {
	const points = contours.flat()
	return points.length
		? [
				Math.min(...points.map(([x]) => x)),
				Math.min(...points.map(([, y]) => y)),
				Math.max(...points.map(([x]) => x)),
				Math.max(...points.map(([, y]) => y)),
			]
		: [0, 0, 0, 0]
}

/** Tight bounds from actual outlines, also used by the CFF and PDF descriptors. */
export function gardenFontBounds(
	blank = false,
): readonly [number, number, number, number] {
	return outlineBounds(
		blank ? [] : gardenGlyphs.flatMap((glyph) => glyph.contours),
	)
}

/** Standalone TrueType, long loca, Unicode cmap, no hinting or borrowed glyph outlines. */
export function gardenTrueType(blank = false): Uint8Array {
	const tables = new Map<string, Buffer>()
	const locations: number[] = [0]
	const descriptions = gardenGlyphs.map((glyph) => {
		const contours = blank ? [] : glyph.contours
		return { contours, bounds: outlineBounds(contours), width: glyph.width }
	})
	const outlined = descriptions.filter((glyph) => glyph.contours.length)
	const bounds = gardenFontBounds(blank)
	const glyphs = descriptions.map(({ contours, bounds }) => {
		const points = contours.flat()
		const xs = points.map((point) => point[0]),
			ys = points.map((point) => point[1])
		let pointCount = 0
		const ends = contours.map((contour) => (pointCount += contour.length) - 1)
		const deltas = (values: number[]) =>
			values.map((value, index) => value - (values[index - 1] ?? 0))
		const bytes = align(
			join(
				words(contours.length, ...bounds, ...ends, 0),
				Buffer.alloc(points.length, 1),
				words(...deltas(xs), ...deltas(ys)),
			),
		)
		locations.push(locations.at(-1)! + bytes.length)
		return bytes
	})
	tables.set("glyf", join(...glyphs))
	tables.set("loca", join(...locations.map(u32)))
	const head = Buffer.alloc(54)
	head.writeUInt32BE(0x10000, 0)
	head.writeUInt32BE(0x10000, 4)
	head.writeUInt32BE(0x5f0f3cf5, 12)
	head.writeUInt16BE(1000, 18)
	head.writeUInt32BE(3800000000, 24)
	head.writeUInt32BE(3800000000, 32)
	bounds.forEach((value, index) => head.writeInt16BE(value, 36 + index * 2))
	head.writeUInt16BE(8, 46)
	head.writeInt16BE(2, 48)
	head.writeInt16BE(1, 50)
	tables.set("head", head)
	const hhea = Buffer.alloc(36)
	hhea.writeUInt32BE(0x10000)
	hhea.writeInt16BE(900, 4)
	hhea.writeInt16BE(-200, 6)
	hhea.writeUInt16BE(Math.max(...descriptions.map((glyph) => glyph.width)), 10)
	hhea.writeInt16BE(
		outlined.length ? Math.min(...outlined.map((glyph) => glyph.bounds[0])) : 0,
		12,
	)
	hhea.writeInt16BE(
		outlined.length
			? Math.min(...outlined.map((glyph) => glyph.width - glyph.bounds[2]))
			: 0,
		14,
	)
	hhea.writeInt16BE(
		outlined.length ? Math.max(...outlined.map((glyph) => glyph.bounds[2])) : 0,
		16,
	)
	hhea.writeInt16BE(1, 18)
	hhea.writeUInt16BE(gardenGlyphs.length, 34)
	tables.set("hhea", hhea)
	tables.set(
		"hmtx",
		join(...descriptions.map((glyph) => words(glyph.width, glyph.bounds[0]))),
	)
	tables.set(
		"maxp",
		join(
			u32(0x10000),
			words(
				gardenGlyphs.length,
				Math.max(...descriptions.map((glyph) => glyph.contours.flat().length)),
				Math.max(...descriptions.map((glyph) => glyph.contours.length)),
				0,
				0,
				1,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
			),
		),
	)
	const chars = new Map<number, number>()
	gardenGlyphs.forEach((glyph, index) => {
		if (glyph.unicode.length === 1 && !chars.has(glyph.unicode.charCodeAt(0)))
			chars.set(glyph.unicode.charCodeAt(0), index)
	})
	const mappings = [...chars].sort(([a], [b]) => a - b)
	const count = mappings.length + 1,
		power = 2 ** Math.floor(Math.log2(count))
	const cmap = join(
		words(
			4,
			16 + 8 * count,
			0,
			2 * count,
			2 * power,
			Math.log2(power),
			2 * count - 2 * power,
		),
		words(...mappings.map(([code]) => code), 65535, 0),
		words(...mappings.map(([code]) => code), 65535),
		words(...mappings.map(([code, id]) => id - code), 1),
		Buffer.alloc(2 * count),
	)
	tables.set("cmap", join(words(0, 1, 3, 1), u32(12), cmap))
	const labels = [
		[1, "Moss Geometry"],
		[2, "Regular"],
		[4, "Moss Geometry Regular"],
		[6, "MossGeometry-Regular"],
	] as const
	let nameOffset = 0
	const nameBytes = labels.map(([, value]) =>
		Buffer.from(value, "utf16le").swap16(),
	)
	tables.set(
		"name",
		join(
			words(0, labels.length, 6 + labels.length * 12),
			...labels.map(([id], index) => {
				const bytes = nameBytes[index]!
				const record = words(3, 1, 0x409, id, bytes.length, nameOffset)
				nameOffset += bytes.length
				return record
			}),
			...nameBytes,
		),
	)
	tables.set("post", join(u32(0x30000), Buffer.alloc(28)))
	const os2 = Buffer.alloc(78)
	const widths = descriptions
		.map((glyph) => glyph.width)
		.filter((width) => width > 0)
	os2.writeInt16BE(
		Math.round(widths.reduce((sum, width) => sum + width, 0) / widths.length),
		2,
	)
	os2.writeUInt16BE(400, 4)
	os2.writeUInt16BE(5, 6)
	os2.write("MOSS", 58)
	os2.writeUInt16BE(0x40, 62)
	os2.writeUInt16BE(32, 64)
	os2.writeUInt16BE(0xfffd, 66)
	os2.writeInt16BE(900, 68)
	os2.writeInt16BE(-200, 70)
	os2.writeUInt16BE(900, 74)
	os2.writeUInt16BE(200, 76)
	tables.set("OS/2", os2)
	const ordered = [...tables].sort(([a], [b]) => (a < b ? -1 : 1))
	const tableCount = ordered.length,
		tablePower = 2 ** Math.floor(Math.log2(tableCount))
	let offset = 12 + tableCount * 16,
		headOffset = 0
	const records = ordered.map(([tag, bytes]) => {
		const record = join(
			Buffer.from(tag),
			u32(fontChecksum(bytes)),
			u32(offset),
			u32(bytes.length),
		)
		if (tag === "head") headOffset = offset
		offset += align(bytes).length
		return record
	})
	const font = join(
		u32(0x10000),
		words(
			tableCount,
			tablePower * 16,
			Math.log2(tablePower),
			tableCount * 16 - tablePower * 16,
		),
		...records,
		...ordered.map(([, bytes]) => align(bytes)),
	)
	font.writeUInt32BE((0xb1b0afba - fontChecksum(font)) >>> 0, headOffset + 8)
	return font
}

const cffInteger = (value: number): Buffer =>
	join(Buffer.from([28]), u16(value))
const dictInteger = (value: number): Buffer =>
	join(Buffer.from([29]), u32(value))
function cffIndex(items: readonly Uint8Array[]): Buffer {
	if (!items.length) return words(0)
	let offset = 1
	const offsets = [
		u32(offset),
		...items.map((item) => u32((offset += item.length))),
	]
	return join(words(items.length), Buffer.from([4]), ...offsets, ...items)
}

/** CFF 1, CID-keyed Type 2 charstrings with one FD/private dictionary. */
export function gardenCff(blank = false): Uint8Array {
	const name = cffIndex([Buffer.from("MossGeometry-CID")])
	const strings = cffIndex([Buffer.from("Adobe"), Buffer.from("Identity")])
	const globalSubrs = words(0)
	const charset = join(
		Buffer.from([0]),
		words(...gardenGlyphs.slice(1).map((_, index) => index + 1)),
	)
	const select = Buffer.alloc(gardenGlyphs.length + 1)
	const charstrings = cffIndex(
		gardenGlyphs.map((glyph) => {
			let x = 0,
				y = 0
			const code: Buffer[] = [cffInteger(glyph.width)]
			for (const contour of blank ? [] : glyph.contours) {
				const start = contour[0]!
				code.push(
					cffInteger(start[0] - x),
					cffInteger(start[1] - y),
					Buffer.from([21]),
				)
				x = start[0]
				y = start[1]
				for (const point of [...contour.slice(1), start]) {
					code.push(
						cffInteger(point[0] - x),
						cffInteger(point[1] - y),
						Buffer.from([5]),
					)
					x = point[0]
					y = point[1]
				}
			}
			code.push(Buffer.from([14]))
			return join(...code)
		}),
	)
	const privateDict = join(
		cffInteger(0),
		Buffer.from([20]),
		cffInteger(0),
		Buffer.from([21]),
	)
	const top = (
		charsetOffset: number,
		charsOffset: number,
		fdOffset: number,
		selectOffset: number,
	) =>
		cffIndex([
			join(
				dictInteger(391),
				dictInteger(392),
				dictInteger(0),
				Buffer.from([12, 30]),
				dictInteger(gardenGlyphs.length),
				Buffer.from([12, 34]),
				...gardenFontBounds(blank).map(dictInteger),
				Buffer.from([5]),
				dictInteger(charsetOffset),
				Buffer.from([15]),
				dictInteger(charsOffset),
				Buffer.from([17]),
				dictInteger(fdOffset),
				Buffer.from([12, 36]),
				dictInteger(selectOffset),
				Buffer.from([12, 37]),
			),
		])
	const fd = (offset: number) =>
		cffIndex([
			join(
				dictInteger(privateDict.length),
				dictInteger(offset),
				Buffer.from([18]),
			),
		])
	const charsetOffset =
		4 +
		name.length +
		top(0, 0, 0, 0).length +
		strings.length +
		globalSubrs.length
	const selectOffset = charsetOffset + charset.length
	const charsOffset = selectOffset + select.length
	const fdOffset = charsOffset + charstrings.length
	return join(
		Buffer.from([1, 0, 4, 4]),
		name,
		top(charsetOffset, charsOffset, fdOffset, selectOffset),
		strings,
		globalSubrs,
		charset,
		select,
		charstrings,
		fd(fdOffset + fd(0).length),
		privateDict,
	)
}
