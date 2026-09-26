import { deflateSync, inflateSync } from "node:zlib"
import { expect, it } from "vitest"
import { array, ascii, dictionary, name, stream } from "../../src/objects.ts"
import type { PdfDictionaryEntries, PdfValue } from "../../src/objects.ts"
import { decodeStructureStream } from "../../src/parser/filters.ts"
import { PdfParseError } from "../../src/parse.ts"

const resolve = (value: PdfValue | undefined) => {
	if (typeof value === "object" && value?.kind === "reference")
		throw new Error("Unexpected reference")
	return value
}

function decode(
	filter: string,
	bytes: Uint8Array,
	params: PdfDictionaryEntries = {},
): Uint8Array {
	return decodeStructureStream(
		stream({ Filter: name(filter), DecodeParms: dictionary(params) }, bytes),
		resolve,
		42,
	)
}

it("decodes structural filter chains with per-filter parameters", () => {
	const encoded =
		Buffer.from(deflateSync(ascii("structure"))).toString("hex") + ">"
	const result = decodeStructureStream(
		stream(
			{
				Filter: array(name("ASCIIHexDecode"), name("FlateDecode")),
				DecodeParms: array(null, dictionary({ Predictor: 1 })),
			},
			ascii(encoded),
		),
		resolve,
		42,
	)
	expect(result).toEqual(ascii("structure"))
})

it.each(["payload", "checksum"])("rejects Flate %s corruption", (damage) => {
	const bytes = deflateSync("4 0 << /Answer 42 >>", { level: 0 })
	if (damage === "payload") bytes[bytes.indexOf("42")] = "5".charCodeAt(0)
	else bytes[bytes.length - 1]! ^= 1
	expect(() => inflateSync(bytes)).toThrow(/data check/)
	expect(() => decode("FlateDecode", bytes)).toThrow(
		new PdfParseError("Invalid FlateDecode structural stream", 42),
	)
})

it.each([0, 1, 64, 5552, 65536])(
	"verifies Flate checksums across %s decoded bytes",
	(length) => {
		const input = Uint8Array.from({ length }, (_, index) => index % 251)
		expect(decode("FlateDecode", deflateSync(input))).toEqual(input)
	},
)

it.each([
	["ASCIIHexDecode", ascii("61\t6 2\n6>"), Uint8Array.of(97, 98, 96)],
	[
		"ASCII85Decode",
		ascii('z !!!!" !! ~>'),
		Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 1, 0),
	],
	[
		"RunLengthDecode",
		Uint8Array.of(2, 65, 66, 67, 254, 68, 128),
		ascii("ABCDDD"),
	],
	[
		"LZWDecode",
		packCodes([256, 65, 66, 258, 260, 257].map((code) => [code, 9])),
		ascii("ABABABA"),
	],
])("decodes %s structure bytes", (filter, input, expected) => {
	expect(decode(filter, input)).toEqual(expected)
})

it.each([0, 1])(
	"decodes LZW width changes with EarlyChange %s",
	(earlyChange) => {
		const count = 255 - earlyChange
		const codes: [number, number][] = [[256, 9]]
		for (let index = 0; index < count; index++) codes.push([index, 9])
		codes.push([65, 10], [256, 10], [66, 9], [257, 9])
		expect(
			decode("LZWDecode", packCodes(codes), { EarlyChange: earlyChange }),
		).toEqual(
			Uint8Array.from([
				...Array.from({ length: count }, (_, index) => index),
				65,
				66,
			]),
		)
	},
)

it.each([
	[0, [10, 20, 30, 40]],
	[1, [10, 10, 10, 10]],
	[2, [9, 18, 27, 36]],
	[3, [10, 14, 19, 23]],
	[4, [9, 10, 10, 10]],
])("decodes PNG predictor row type %s", (filter, row) => {
	const input = Uint8Array.from([0, 1, 2, 3, 4, filter, ...row])
	expect(
		decode("FlateDecode", deflateSync(input), { Predictor: 15, Columns: 4 }),
	).toEqual(Uint8Array.of(1, 2, 3, 4, 10, 20, 30, 40))
})

it.each([
	[1, 1, 4, [0xe0], [0xb0]],
	[2, 1, 4, [0x55], [0x6c]],
	[4, 1, 3, [0x12, 0x30], [0x13, 0x60]],
	[8, 3, 2, [1, 2, 3, 4, 5, 6], [1, 2, 3, 5, 7, 9]],
	[16, 1, 2, [0, 255, 0, 2], [0, 255, 1, 1]],
])(
	"decodes TIFF prediction with %s-bit samples",
	(bits, colors, columns, input, output) => {
		expect(
			decode("FlateDecode", deflateSync(Uint8Array.from(input)), {
				Predictor: 2,
				BitsPerComponent: bits,
				Colors: colors,
				Columns: columns,
			}),
		).toEqual(Uint8Array.from(output))
	},
)

it.each([
	["FlateDecode", Uint8Array.of(1), {}],
	["FlateDecode", deflateSync(Uint8Array.of(0, 1)), { Predictor: 7 }],
	[
		"FlateDecode",
		deflateSync(Uint8Array.of(0, 1)),
		{ Predictor: 12, Columns: 3 },
	],
	["FlateDecode", deflateSync(Uint8Array.of(5, 1)), { Predictor: 12 }],
	[
		"FlateDecode",
		deflateSync(Uint8Array.of(0, 1)),
		{ Predictor: 12, Colors: 0 },
	],
	["ASCIIHexDecode", ascii("zz>"), {}],
	["ASCII85Decode", ascii("!!"), {}],
	["ASCII85Decode", ascii("!~>"), {}],
	["ASCII85Decode", ascii("v~>"), {}],
	["ASCII85Decode", ascii("uuuuu~>"), {}],
	["RunLengthDecode", Uint8Array.of(0), {}],
	["RunLengthDecode", Uint8Array.of(255), {}],
	["RunLengthDecode", Uint8Array.of(0, 1), {}],
	[
		"LZWDecode",
		packCodes([
			[256, 9],
			[258, 9],
		]),
		{},
	],
	["LZWDecode", new Uint8Array(), {}],
	["LZWDecode", new Uint8Array(), { EarlyChange: 2 }],
	["Crypt", new Uint8Array(), {}],
])("reports damaged or unsupported %s streams %#", (filter, bytes, params) => {
	expect(() => decode(filter, bytes, params)).toThrow(PdfParseError)
	try {
		decode(filter, bytes, params)
	} catch (error) {
		expect(error).toHaveProperty("offset", 42)
	}
})

function packCodes(codes: [number, number][]): Uint8Array {
	const bits = codes
		.map(([code, width]) => code.toString(2).padStart(width, "0"))
		.join("")
	return Uint8Array.from({ length: Math.ceil(bits.length / 8) }, (_, index) =>
		Number.parseInt(bits.slice(index * 8, index * 8 + 8).padEnd(8, "0"), 2),
	)
}
