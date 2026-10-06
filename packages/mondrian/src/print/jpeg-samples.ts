// SPDX-License-Identifier: MPL-2.0
import { imagePixelCount } from "../print-image.ts"

const zigzag = [
	0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
	48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
	22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
	47, 55, 62, 63,
]
const basis = Array.from({ length: 8 }, (_, x) =>
	Array.from(
		{ length: 8 },
		(_, u) =>
			(u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16),
	),
)
const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
interface Component {
	id: number
	h: number
	v: number
	quant: number
	dc: number
	ac: number
	previous: number
	stride: number
	samples: Uint8Array
}
type Huffman = Map<number, number>[]

/** Baseline, interleaved DCT samples. No display RGB projection or CMYK inversion. */
export function decodeJpegSamples(
	input: Uint8Array,
	width: number,
	height: number,
	channels: number,
	colorTransform?: 0 | 1,
): Uint8Array {
	imagePixelCount(width, height)
	if (input.length > 256 * 1024 * 1024 || input[0] !== 255 || input[1] !== 216)
		throw new TypeError("Invalid DCT image")
	let offset = 2,
		restart = 0,
		adobe: number | undefined
	let components: Component[] = [],
		maxH = 1,
		maxV = 1,
		columns = 0,
		rows = 0
	const quants = new Map<number, Float64Array>()
	const tables = new Map<number, Huffman>()
	const word = (at: number) => input[at]! * 256 + input[at + 1]!
	let scanned = false
	while (offset < input.length) {
		if (input[offset++] !== 255) throw new TypeError("Invalid DCT marker")
		while (input[offset] === 255) offset++
		const marker = input[offset++]!
		if (marker === 217) {
			if (!scanned || offset !== input.length)
				throw new TypeError("Invalid DCT end")
			break
		}
		const length = word(offset),
			start = offset + 2,
			end = offset + length
		if (length < 2 || end > input.length)
			throw new TypeError("Truncated DCT segment")
		if (
			marker === 238 &&
			String.fromCharCode(...input.subarray(start, start + 5)) === "Adobe"
		) {
			if (length !== 14 || input[start + 11]! > 2)
				throw new TypeError("Unsupported DCT Adobe transform")
			if (adobe !== undefined && adobe !== input[start + 11])
				throw new TypeError("Conflicting DCT transforms")
			adobe = input[start + 11]!
		} else if (marker === 219) {
			for (let at = start; at < end;) {
				const spec = input[at++]!,
					precision = spec >> 4
				if (precision > 1 || (spec & 15) > 3 || at + 64 * (precision + 1) > end)
					throw new TypeError("Invalid DCT quantization table")
				const quant = new Float64Array(64)
				for (let i = 0; i < 64; i++) {
					const value = precision ? word(at) : input[at]!
					at += precision + 1
					if (!value) throw new TypeError("Invalid DCT quantizer")
					quant[zigzag[i]!] = value
				}
				quants.set(spec & 15, quant)
			}
		} else if (marker === 196) {
			for (let at = start; at < end;) {
				const spec = input[at++]!
				if (spec >> 4 > 1 || (spec & 15) > 3 || at + 16 > end)
					throw new TypeError("Invalid DCT Huffman table")
				const counts = input.subarray(at, at + 16)
				at += 16
				const table: Huffman = Array.from({ length: 16 }, () => new Map())
				let code = 0
				for (let n = 1; n <= 16; n++) {
					const count = counts[n - 1]!
					if (code + count >= 2 ** n || at + count > end)
						throw new TypeError("Invalid DCT Huffman codes")
					for (let i = 0; i < count; i++)
						table[n - 1]!.set(code++, input[at++]!)
					code *= 2
				}
				tables.set(spec, table)
			}
		} else if (marker === 192) {
			if (
				components.length ||
				input[start] !== 8 ||
				word(start + 1) !== height ||
				word(start + 3) !== width ||
				input[start + 5] !== channels ||
				length !== 8 + channels * 3
			)
				throw new TypeError(
					"DCT frame must match the image's 8-bit component geometry",
				)
			for (let i = 0; i < channels; i++) {
				const at = start + 6 + i * 3,
					id = input[at]!,
					h = input[at + 1]! >> 4,
					v = input[at + 1]! & 15
				if (
					h < 1 ||
					h > 4 ||
					v < 1 ||
					v > 4 ||
					components.some((c) => c.id === id)
				)
					throw new TypeError("Invalid DCT sampling factors")
				maxH = Math.max(maxH, h)
				maxV = Math.max(maxV, v)
				components.push({
					id,
					h,
					v,
					quant: input[at + 2]!,
					dc: 0,
					ac: 0,
					previous: 0,
					stride: 0,
					samples: new Uint8Array(),
				})
			}
			if (components.reduce((n, c) => n + c.h * c.v, 0) > 10)
				throw new TypeError("Unsupported DCT MCU sampling")
			columns = Math.ceil(width / (maxH * 8))
			rows = Math.ceil(height / (maxV * 8))
			const bytes = components.reduce(
				(n, c) => n + columns * c.h * 8 * rows * c.v * 8,
				0,
			)
			if (bytes > 256 * 1024 * 1024)
				throw new RangeError("DCT sample allocation exceeds 256 MiB")
			for (const c of components) {
				c.stride = columns * c.h * 8
				c.samples = new Uint8Array(c.stride * rows * c.v * 8)
			}
		} else if (
			marker >= 193 &&
			marker <= 207 &&
			![196, 200, 204].includes(marker)
		)
			throw new TypeError(
				"DCT plate samples support only baseline sequential JPEG; progressive and arithmetic JPEG are unsupported",
			)
		else if (marker === 221) {
			if (length !== 4) throw new TypeError("Invalid DCT restart interval")
			restart = word(start)
		} else if (marker === 218) {
			if (
				scanned ||
				components.length !== channels ||
				input[start] !== channels ||
				length !== 6 + 2 * channels ||
				input[end - 3] !== 0 ||
				input[end - 2] !== 63 ||
				input[end - 1] !== 0
			)
				throw new TypeError("DCT requires a single interleaved baseline scan")
			const scan: Component[] = []
			for (let i = 0; i < channels; i++) {
				const c = components.find((c) => c.id === input[start + 1 + 2 * i])
				if (!c || scan.includes(c))
					throw new TypeError("Invalid DCT scan components")
				c.dc = input[start + 2 + 2 * i]! >> 4
				c.ac = input[start + 2 + 2 * i]! & 15
				scan.push(c)
			}
			offset = end
			let bits = 0,
				current = 0,
				restartIndex = 0
			const bit = () => {
				if (!bits) {
					if (offset >= input.length)
						throw new TypeError("Truncated DCT entropy data")
					current = input[offset++]!
					if (current === 255 && input[offset++] !== 0)
						throw new TypeError("Unexpected DCT entropy marker")
					bits = 8
				}
				return (current >> --bits) & 1
			}
			const symbol = (table: Huffman | undefined) => {
				if (!table) throw new TypeError("Missing DCT Huffman table")
				let code = 0
				for (let n = 0; n < 16; n++) {
					code = code * 2 + bit()
					const value = table[n]!.get(code)
					if (value !== undefined) return value
				}
				throw new TypeError("Invalid DCT Huffman symbol")
			}
			const value = (size: number) => {
				if (size > 11) throw new TypeError("Invalid DCT coefficient size")
				let v = 0
				for (let i = 0; i < size; i++) v = v * 2 + bit()
				return size && v < 2 ** (size - 1) ? v - (2 ** size - 1) : v
			}
			const coeff = new Float64Array(64),
				temp = new Float64Array(64)
			for (let mcu = 0; mcu < columns * rows; mcu++) {
				if (restart && mcu && mcu % restart === 0) {
					bits = 0
					if (
						input[offset++] !== 255 ||
						input[offset++] !== 208 + (restartIndex++ % 8)
					)
						throw new TypeError("Invalid DCT restart marker")
					for (const c of components) c.previous = 0
				}
				for (const c of scan)
					for (let y = 0; y < c.v; y++)
						for (let x = 0; x < c.h; x++) {
							const quant = quants.get(c.quant)
							if (!quant) throw new TypeError("Missing DCT quantization table")
							coeff.fill(0)
							c.previous += value(symbol(tables.get(c.dc)))
							coeff[0] = c.previous * quant[0]!
							for (let i = 1; i < 64;) {
								const s = symbol(tables.get(16 + c.ac)),
									run = s >> 4,
									size = s & 15
								if (!size) {
									if (run === 0) break
									if (run !== 15) throw new TypeError("Invalid DCT zero run")
									i += 16
									if (i > 64) throw new TypeError("DCT coefficient overflow")
									continue
								}
								if (size > 10 || (i += run) >= 64)
									throw new TypeError("Invalid DCT AC coefficient")
								const at = zigzag[i++]!
								coeff[at] = value(size) * quant[at]!
							}
							// Separable reference IDCT. Keep rounding until the final sample.
							for (let v = 0; v < 8; v++)
								for (let xx = 0; xx < 8; xx++) {
									let sum = 0
									for (let u = 0; u < 8; u++)
										sum += coeff[v * 8 + u]! * basis[xx]![u]!
									temp[v * 8 + xx] = sum
								}
							const blockX = ((mcu % columns) * c.h + x) * 8,
								blockY = (Math.floor(mcu / columns) * c.v + y) * 8
							for (let yy = 0; yy < 8; yy++)
								for (let xx = 0; xx < 8; xx++) {
									let sum = 0
									for (let v = 0; v < 8; v++)
										sum += temp[v * 8 + xx]! * basis[yy]![v]!
									c.samples[(blockY + yy) * c.stride + blockX + xx] = byte(
										128 + sum / 4,
									)
								}
						}
			}
			scanned = true
			continue
		}
		offset = end
	}
	if (!scanned || input[offset - 1] !== 217)
		throw new TypeError("DCT image is missing its complete scan or EOI")
	// PDF 1.7 Table 3.11: APP14 takes precedence over DecodeParms.
	const transform =
		adobe === undefined
			? (colorTransform ?? (channels === 3 ? 1 : 0))
			: adobe === 0
				? 0
				: 1
	if ((channels === 3 && adobe === 2) || (channels === 4 && adobe === 1))
		throw new TypeError("DCT transform disagrees with component count")
	const output = new Uint8Array(width * height * channels)
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const at = (y * width + x) * channels
			for (let i = 0; i < channels; i++) {
				const c = components[i]!
				output[at + i] =
					c.samples[
						Math.floor((y * c.v) / maxV) * c.stride +
							Math.floor((x * c.h) / maxH)
					]!
			}
			if (transform && channels >= 3) {
				const Y = output[at]!,
					Cb = output[at + 1]! - 128,
					Cr = output[at + 2]! - 128
				const values = [
					byte(Y + 1.402 * Cr),
					byte(Y - 0.3441363 * Cb - 0.71413636 * Cr),
					byte(Y + 1.772 * Cb),
				]
				for (let i = 0; i < 3; i++)
					output[at + i] = channels === 4 ? 255 - values[i]! : values[i]!
			}
		}
	return output
}
