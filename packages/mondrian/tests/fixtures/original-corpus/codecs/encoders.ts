// SPDX-License-Identifier: MPL-2.0
// Narrow fixture encoders, not a general codec API. All authored samples are original.

function pack(bits: string): Uint8Array {
	return Uint8Array.from({ length: Math.ceil(bits.length / 8) }, (_, index) =>
		Number.parseInt(bits.slice(index * 8, index * 8 + 8).padEnd(8, "0"), 2),
	)
}

// ITU-T T.6 Table 2 terminating codewords, indexed by the factual run length.
const white =
	"00110101 000111 0111 1000 1011 1100 1110 1111 10011 10100 00111 01000 001000 000011 110100 110101 101010 101011 0100111 0001100 0001000 0010111 0000011 0000100 0101000 0101011 0010011 0100100 0011000 00000010 00000011 00011010 00011011 00010010 00010011 00010100 00010101 00010110 00010111 00101000 00101001 00101010 00101011 00101100 00101101 00000100 00000101 00001010 00001011 01010010 01010011 01010100 01010101 00100100 00100101 01011000 01011001 01011010 01011011 01001010 01001011 00110010 00110011 00110100".split(
		" ",
	)
const black =
	"0000110111 010 11 10 011 0011 0010 00011 000101 000100 0000100 0000101 0000111 00000100 00000111 000011000 0000010111 0000011000 0000001000 00001100111 00001101000 00001101100 00000110111 00000101000 00000010111 00000011000 000011001010 000011001011 000011001100 000011001101 000001101000 000001101001 000001101010 000001101011 000011010010 000011010011 000011010100 000011010101 000011010110 000011010111 000001101100 000001101101 000011011010 000011011011 000001010100 000001010101 000001010110 000001010111 000001100100 000001100101 000001010010 000001010011 000000100100 000000110111 000000111000 000000100111 000000101000 000001011000 000001011001 000000101011 000000101100 000001011010 000001100110 000001100111".split(
		" ",
	)

/** T.6 horizontal-mode Group 4 encoding of a 64-column monochrome raster. */
export function group4(pixels: Uint8Array, height: number): Uint8Array {
	if (pixels.length !== height * 8) throw new Error("Expected 64-column raster")
	let bits = ""
	for (let y = 0; y < height; y++) {
		let x = 0
		while (x < 64) {
			bits += "001" // horizontal: one white run followed by one black run
			for (const isWhite of [true, false]) {
				const start = x
				while (
					x < 64 &&
					Boolean(pixels[y * 8 + (x >> 3)]! & (128 >> (x % 8))) === isWhite
				)
					x++
				const length = x - start
				const table = isWhite ? white : black
				bits +=
					length === 64
						? (isWhite ? "11011" : "0000001111") + table[0]!
						: table[length]!
			}
		}
	}
	return pack(bits + "000000000001000000000001") // EOFB
}

/** ISO/IEC 14492 segment headers and a lossless generic MMR region, without a file header. */
export function jbig2(pixels: Uint8Array, height: number): Uint8Array {
	const segment = (number: number, type: number, data: Uint8Array) => {
		const header = Buffer.alloc(11)
		header.writeUInt32BE(number)
		header[4] = type
		header[6] = 1 // page association; no referenced segments
		header.writeUInt32BE(data.length, 7)
		return Buffer.concat([header, data])
	}
	const page = Buffer.alloc(19)
	page.writeUInt32BE(64)
	page.writeUInt32BE(height, 4)
	page[16] = 1 // lossless, default white, OR composition
	const region = Buffer.alloc(18)
	region.writeUInt32BE(64)
	region.writeUInt32BE(height, 4)
	region[17] = 1 // generic region uses MMR
	return Buffer.concat([
		segment(1, 48, page),
		segment(2, 39, Buffer.concat([region, group4(pixels, height)])),
		segment(3, 49, new Uint8Array()),
	])
}

/** PDF LZW with dictionary codes, 9–12 bit changes and a full-dictionary clear. */
export function lzw(pixels: Uint8Array, earlyChange: 0 | 1) {
	let dictionary = new Map<string, number>()
	let next = 258
	let width = 9
	let decoderNext = 258
	let previous = false
	let bits = ""
	const codes: number[] = []
	const widths = new Set<number>()
	const emit = (code: number) => {
		codes.push(code)
		widths.add(width)
		bits += code.toString(2).padStart(width, "0")
		if (code === 256) {
			width = 9
			decoderNext = 258
			previous = false
		} else if (code !== 257) {
			if (previous) {
				decoderNext++
				if (decoderNext + earlyChange === 1 << width && width < 12) width++
			}
			previous = true
		}
	}
	const reset = () => {
		dictionary = new Map(
			Array.from({ length: 256 }, (_, value) => [
				String.fromCharCode(value),
				value,
			]),
		)
		next = 258
		emit(256)
	}
	reset()
	let prefix = ""
	for (const byte of pixels) {
		const suffix = String.fromCharCode(byte)
		if (dictionary.has(prefix + suffix)) prefix += suffix
		else {
			emit(dictionary.get(prefix)!)
			if (next < 4096) dictionary.set(prefix + suffix, next++)
			else reset()
			prefix = suffix
		}
	}
	if (prefix) emit(dictionary.get(prefix)!)
	emit(257)
	return { bytes: pack(bits), codes, widths: [...widths] }
}
