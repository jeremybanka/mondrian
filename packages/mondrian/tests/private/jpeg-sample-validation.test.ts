import { readFileSync } from "node:fs"
import { expect, it } from "vite-plus/test"
import { decodeJpegSamples } from "../../src/print/jpeg-samples.ts"

const original = readFileSync(
	new URL("../public/fixtures/mixed-color/cmyk.jpg", import.meta.url),
)
const marker = (bytes: Uint8Array, id: number) =>
	Buffer.from(bytes).indexOf(Buffer.from([255, id]))
const segment = (id: number, data: Uint8Array) => {
	const header = Buffer.alloc(4)
	header[0] = 255
	header[1] = id
	header.writeUInt16BE(data.length + 2, 2)
	return Buffer.concat([header, data])
}
const append = (part: Uint8Array) =>
	Buffer.concat([original.subarray(0, 2), part, original.subarray(2)])
const adobe = (transform: number) =>
	segment(
		238,
		Uint8Array.from([65, 100, 111, 98, 101, 0, 100, 0, 0, 0, 0, transform]),
	)

it.each([
	(bytes: Buffer) => Buffer.concat([bytes, Uint8Array.of(0)]),
	(bytes: Buffer) => {
		bytes.writeUInt16BE(65535, marker(bytes, 219) + 2)
		return bytes
	},
	(bytes: Buffer) => {
		bytes[marker(bytes, 219) + 4] = 32
		return bytes
	},
	(bytes: Buffer) => {
		bytes[marker(bytes, 219) + 5] = 0
		return bytes
	},
	(bytes: Buffer) => {
		bytes[marker(bytes, 196) + 4] = 32
		return bytes
	},
	(bytes: Buffer) => {
		bytes[marker(bytes, 196) + 5] = 255
		return bytes
	},
	(bytes: Buffer) => {
		bytes[marker(bytes, 192) + 11] = 0
		return bytes
	},
	(bytes: Buffer) => {
		const f = marker(bytes, 192)
		bytes[f + 11] = 68
		bytes[f + 14] = 68
		return bytes
	},
	(bytes: Buffer) => {
		bytes[marker(bytes, 218) + 4] = 3
		return bytes
	},
	(bytes: Buffer) => {
		bytes[marker(bytes, 218) + 5] = 99
		return bytes
	},
	(bytes: Buffer) => {
		bytes[marker(bytes, 218) + 5] = bytes[marker(bytes, 218) + 7]!
		return bytes
	},
	(bytes: Buffer) => {
		bytes[marker(bytes, 218) + 2 + bytes.readUInt16BE(marker(bytes, 218) + 2)] =
			255
		return bytes
	},
	(bytes: Buffer) =>
		Buffer.concat([
			bytes.subarray(0, -2),
			Uint8Array.of(
				255,
				238,
				0,
				14,
				65,
				100,
				111,
				98,
				101,
				0,
				100,
				0,
				0,
				0,
				0,
				0,
			),
		]),
])(
	"rejects corrupted component, table, entropy, and scan declarations (%#)",
	(change) => {
		expect(() =>
			decodeJpegSamples(change(Buffer.from(original)), 8, 8, 4),
		).toThrow()
	},
)

it("rejects unsupported and contradictory APP14 and restart declarations", () => {
	expect(() => decodeJpegSamples(append(adobe(3)), 8, 8, 4)).toThrow(
		/Adobe transform/,
	)
	expect(() =>
		decodeJpegSamples(append(Buffer.concat([adobe(0), adobe(2)])), 8, 8, 4),
	).toThrow(/Conflicting/)
	expect(() => decodeJpegSamples(append(adobe(1)), 8, 8, 4)).toThrow(
		/component count/,
	)
	expect(() =>
		decodeJpegSamples(append(segment(221, Uint8Array.of(0))), 8, 8, 4),
	).toThrow(/restart interval/)
})

it("rejects undecodable Huffman prefixes and invalid AC coefficient sizes", () => {
	const scan = marker(original, 218),
		entropy = scan + 2 + original.readUInt16BE(scan + 2)
	const invalidCode = Buffer.from(original)
	invalidCode.fill(254, entropy, invalidCode.length - 2)
	expect(() => decodeJpegSamples(invalidCode, 8, 8, 4)).toThrow(
		/Huffman symbol/,
	)
	const invalidAc = Buffer.from(original),
		huffman = marker(invalidAc, 196)
	invalidAc[huffman + 1 + invalidAc.readUInt16BE(huffman + 2)] = 11
	expect(() => decodeJpegSamples(invalidAc, 8, 8, 4)).toThrow(/AC coefficient/)
})

it("decodes restart-separated MCUs and 16-bit quantization tables without losing component identity", () => {
	const frame = marker(original, 192),
		scan = marker(original, 218),
		entropy = scan + 2 + original.readUInt16BE(scan + 2)
	const header = Buffer.from(original.subarray(0, scan))
	header.writeUInt16BE(16, frame + 7)
	const encoded = Buffer.concat([
		header,
		segment(221, Uint8Array.of(0, 1)),
		original.subarray(scan, entropy),
		original.subarray(entropy, -2),
		Uint8Array.of(255, 208),
		original.subarray(entropy, -2),
		Uint8Array.of(255, 217),
	])
	const expected = Uint8Array.from(
		{ length: 16 * 8 * 4 },
		(_, i) => [24, 80, 136, 200][i % 4]!,
	)
	expect(decodeJpegSamples(encoded, 16, 8, 4)).toEqual(expected)
	const broken = Buffer.from(encoded)
	broken[marker(broken, 208) + 1] = 209
	expect(() => decodeJpegSamples(broken, 16, 8, 4)).toThrow(/restart marker/)
	const quant = Buffer.alloc(129)
	quant[0] = 16
	for (let i = 0; i < 64; i++) quant.writeUInt16BE(1, 1 + i * 2)
	const at = marker(original, 219),
		end = at + 2 + original.readUInt16BE(at + 2)
	const sixteen = Buffer.concat([
		original.subarray(0, at),
		segment(219, quant),
		original.subarray(end),
	])
	expect(decodeJpegSamples(sixteen, 8, 8, 4)).toEqual(
		expected.slice(0, 8 * 8 * 4),
	)
})
