import { readFileSync } from "node:fs"
import { crc32, deflateSync } from "node:zlib"
import { expect, it } from "vite-plus/test"
import { decodeImage } from "../../src/print/decode-image.ts"

const fixture = (file: string) =>
	readFileSync(
		new URL(`../public/fixtures/print-images/${file}`, import.meta.url),
	)

it.each(["rgb", "gray"])(
	"retains transparent %s source channels while expanding tRNS",
	(kind) => {
		const actual = decodeImage(fixture(`${kind}-trns.png`))
		const expected = decodeImage(fixture(`${kind}-trns-reference.png`))
		expect(actual.rgba).toEqual(expected.rgba)
	},
)

function chunk(kind: string, data: Uint8Array) {
	const result = Buffer.alloc(data.length + 12)
	result.writeUInt32BE(data.length)
	result.write(kind, 4)
	result.set(data, 8)
	result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4)
	return result
}

function grayPng(
	depth: number,
	interlace: number,
	transparency: Buffer[],
	highBits = 0,
) {
	const max = 2 ** depth - 1
	const transparent = max - 1
	const header = Buffer.alloc(13)
	header.writeUInt32BE(2)
	header.writeUInt32BE(1, 4)
	header[8] = depth
	header[12] = interlace
	const key = Buffer.alloc(2)
	key.writeUInt16BE(transparent | highBits)
	const scanline = interlace
		? [0, transparent << (8 - depth), 0, max << (8 - depth)]
		: depth === 8
			? [0, transparent, max]
			: [0, (transparent << (8 - depth)) | (max << (8 - 2 * depth))]
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		...(transparency.length ? transparency : [chunk("tRNS", key)]),
		chunk("IDAT", deflateSync(Uint8Array.from(scanline))),
		chunk("IEND", new Uint8Array()),
	])
}

it.each([1, 2, 4, 8])(
	"preserves packed grayscale color keys at depth %s before rescaling",
	(depth) => {
		const max = 2 ** depth - 1
		const expected = Math.round(((max - 1) * 255) / max)
		for (const interlace of [0, 1])
			for (const highBits of [0, 0x8000]) {
				const image = decodeImage(grayPng(depth, interlace, [], highBits))
				expect(Array.from(image.rgba)).toEqual([
					expected,
					expected,
					expected,
					0,
					255,
					255,
					255,
					255,
				])
			}
	},
)

it("rejects duplicate and incorrectly sized grayscale transparency keys", () => {
	const valid = chunk("tRNS", Uint8Array.of(0, 254))
	for (const chunks of [
		[valid, valid],
		[chunk("tRNS", Uint8Array.of(254))],
		[chunk("tRNS", Uint8Array.of(0, 254, 0))],
	])
		expect(() => decodeImage(grayPng(8, 0, chunks))).toThrow()
})

it("matches every RGB channel and masks unused transparency-key bits", () => {
	for (const highBits of [0, 0x8000]) {
		const input = fixture("rgb-trns.png")
		for (let offset = 8; offset < input.length;) {
			const end = offset + input.readUInt32BE(offset) + 12
			if (input.toString("ascii", offset + 4, offset + 8) === "tRNS") {
				for (let channel = 0; channel < 3; channel++)
					input.writeUInt16BE(
						input.readUInt16BE(offset + 8 + channel * 2) | highBits,
						offset + 8 + channel * 2,
					)
				input.writeUInt32BE(crc32(input.subarray(offset + 4, end - 4)), end - 4)
			}
			offset = end
		}
		expect(decodeImage(input).rgba).toEqual(
			decodeImage(fixture("rgb-trns-reference.png")).rgba,
		)
	}
})

it("rejects transparency keys after image data before stripping the chunk", () => {
	const input = grayPng(8, 0, [])
	const lateKey = Buffer.concat([
		input.subarray(0, 33),
		input.subarray(47, -12),
		input.subarray(33, 47),
		input.subarray(-12),
	])
	expect(() => decodeImage(lateKey)).toThrow(/must precede image data/)
})
