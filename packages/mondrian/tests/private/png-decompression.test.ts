import { crc32, deflateSync } from "node:zlib"
import { PNG } from "pngjs"
import { expect, it, vi } from "vite-plus/test"
import { decodeImage } from "../../src/print/decode-image.ts"

it.each([
	[24, 0],
	[25, 1],
	[26, 1],
	[27, 1],
	[28, 2],
])(
	"rejects invalid header fields before deriving the scanline budget: %j",
	(offset, value) => {
		const input = png(1, 1, 8, 6, 0, Uint8Array.of(0, 0, 0, 0, 255))
		input[offset] = value
		input.writeUInt32BE(crc32(input.subarray(12, 29)), 29)
		expect(() => decodeImage(input)).toThrow(/Unsupported PNG encoding/)
	},
)

function chunk(kind: string, data: Uint8Array) {
	const result = Buffer.alloc(12 + data.length)
	result.writeUInt32BE(data.length)
	result.write(kind, 4)
	result.set(data, 8)
	result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4)
	return result
}

it.each(["oversized", "duplicate"])(
	"rejects %s palettes before the decoder can expand their entries",
	(kind) => {
		const input = png(1, 1, 8, 3, 0, Uint8Array.of(0, 0))
		const palette = chunk(
			"PLTE",
			new Uint8Array(kind === "oversized" ? 257 * 3 : 3),
		)
		const bytes = Buffer.concat([
			input.subarray(0, 33),
			palette,
			...(kind === "duplicate" ? [palette] : []),
			input.subarray(33),
		])
		const decoder = vi.spyOn(PNG.sync, "read")
		try {
			expect(() => decodeImage(bytes)).toThrow()
			expect(decoder).not.toHaveBeenCalled()
		} finally {
			decoder.mockRestore()
		}
	},
)

function png(
	width: number,
	height: number,
	depth: number,
	type: number,
	interlace: number,
	data: Uint8Array,
	split = false,
) {
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width)
	header.writeUInt32BE(height, 4)
	header[8] = depth
	header[9] = type
	header[12] = interlace
	const compressed = deflateSync(data)
	const boundary = Math.floor(compressed.length / 2)
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		...(split
			? [
					chunk("IDAT", compressed.subarray(0, boundary)),
					chunk("IDAT", compressed.subarray(boundary)),
				]
			: [chunk("IDAT", compressed)]),
		chunk("IEND", new Uint8Array()),
	])
}

it.each([0, 1])(
	"bounds scanline expansion before invoking the PNG decoder (interlace %s)",
	(interlace) => {
		const input = png(1, 1, 8, 6, interlace, new Uint8Array(256 * 1024), true)
		const decoder = vi.spyOn(PNG.sync, "read")
		try {
			let failure: unknown
			try {
				decodeImage(input)
			} catch (error) {
				failure = error
			}
			expect(failure).toMatchObject({ code: "ERR_BUFFER_TOO_LARGE" })
			expect(decoder).not.toHaveBeenCalled()
		} finally {
			decoder.mockRestore()
		}
	},
)

it.each([0, 1])(
	"requires the exact scanline length (interlace %s)",
	(interlace) => {
		for (const length of [4, 6])
			expect(() =>
				decodeImage(png(1, 1, 8, 6, interlace, new Uint8Array(length))),
			).toThrow()
		expect(
			decodeImage(png(1, 1, 8, 6, interlace, Uint8Array.of(0, 10, 20, 30, 40)))
				.rgba,
		).toEqual(Buffer.from([10, 20, 30, 40]))
	},
)

it("decodes all Adam7 passes, edge passes, and packed grayscale rows within their bounds", () => {
	// PNG's independent 8x8 pass-assignment grid, tiled over a 9x9 image.
	const passes = [
		[1, 6, 4, 6, 2, 6, 4, 6],
		[7, 7, 7, 7, 7, 7, 7, 7],
		[5, 6, 5, 6, 5, 6, 5, 6],
		[7, 7, 7, 7, 7, 7, 7, 7],
		[3, 6, 4, 6, 3, 6, 4, 6],
		[7, 7, 7, 7, 7, 7, 7, 7],
		[5, 6, 5, 6, 5, 6, 5, 6],
		[7, 7, 7, 7, 7, 7, 7, 7],
	]
	const scanlines: number[] = []
	for (let pass = 1; pass <= 7; pass++)
		for (let y = 0; y < 9; y++) {
			const pixels = Array.from({ length: 9 }, (_, x) => x).filter(
				(x) => passes[y % 8]![x % 8] === pass,
			)
			if (pixels.length === 0) continue
			scanlines.push(0)
			for (let offset = 0; offset < pixels.length; offset += 8) {
				let byte = 0
				for (let bit = 0; bit < 8 && offset + bit < pixels.length; bit++)
					byte |= ((pixels[offset + bit]! + y) % 2) << (7 - bit)
				scanlines.push(byte)
			}
		}
	const decoded = decodeImage(
		png(9, 9, 1, 0, 1, Uint8Array.from(scanlines), true),
	)
	expect(Array.from(decoded.rgba)).toEqual(
		Array.from({ length: 81 }, (_, pixel) => {
			const value = (pixel % 2) * 255
			return [value, value, value, 255]
		}).flat(),
	)
})
