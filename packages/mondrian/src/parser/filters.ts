// SPDX-License-Identifier: MPL-2.0

/* eslint-disable no-control-regex -- NUL is PDF whitespace. */

import { Unzlib } from "fflate"
import { DecodeBudget } from "./limits.ts"
import type {
	PdfDictionary,
	PdfIndirectValue,
	PdfStream,
	PdfValue,
} from "../objects.ts"
import { PdfParseError } from "./error.ts"
import { binaryText, isKind } from "./syntax.ts"

type Resolve = (value: PdfValue | undefined) => PdfIndirectValue | undefined

/** Decode only structural streams. Page, font, and image streams retain their original encoding. */
export function decodeStructureStream(
	stream: PdfStream,
	resolve: Resolve,
	offset: number,
	budget = new DecodeBudget(),
): Uint8Array {
	const fail: (message: string) => never = (message) => {
		throw new PdfParseError(message, offset)
	}
	if (stream.entries.F != null)
		fail("External structural streams are not supported")
	const filter = resolve(stream.entries.Filter)
	const parameters = resolve(stream.entries.DecodeParms)
	const filters = isKind(filter, "array")
		? filter.items
		: filter == null
			? []
			: [filter]
	const params = isKind(parameters, "array") ? parameters.items : [parameters]
	const check = (bytes: number) => budget.check(bytes, offset)
	let bytes = stream.data
	if (filters.length === 0) budget.charge(bytes.length, offset)
	for (let index = 0; index < filters.length; index++) {
		const filter = resolve(filters[index] as PdfValue)
		const param = resolve(params[index] as PdfValue | undefined)
		if (!isKind(filter, "name"))
			fail("Expected a structural stream filter name")
		if (param != null && !isKind(param, "dictionary"))
			fail("Expected a DecodeParms dictionary")
		const settings = param ?? undefined
		switch (filter.value) {
			case "FlateDecode":
				try {
					bytes = inflate(bytes, check)
				} catch (error) {
					if (error instanceof PdfParseError) throw error
					fail("Invalid FlateDecode structural stream")
				}
				break
			case "LZWDecode":
				bytes = lzw(
					bytes,
					integer(settings, "EarlyChange", 1, resolve, fail),
					fail,
					check,
				)
				break
			case "ASCIIHexDecode": {
				const source = binaryText(bytes).replace(/[\x00\t\n\f\r ]/g, "")
				if (!/^[\da-f]*>$/i.test(source))
					fail("Invalid ASCIIHexDecode structural stream")
				let digits = source.slice(0, -1)
				if (digits.length % 2) digits += "0"
				check(digits.length / 2)
				bytes = Uint8Array.from({ length: digits.length / 2 }, (_, index) =>
					Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16),
				)
				break
			}
			case "ASCII85Decode":
				bytes = ascii85(bytes, fail, check)
				break
			case "RunLengthDecode":
				bytes = runLength(bytes, fail, check)
				break
			default:
				fail(`Unsupported structural stream filter /${filter.value}`)
		}
		budget.charge(bytes.length, offset)
		if (filter.value === "FlateDecode" || filter.value === "LZWDecode") {
			const predicted = predict(bytes, settings, resolve, fail, check)
			if (predicted !== bytes) budget.charge(predicted.length, offset)
			bytes = predicted
		}
	}
	return bytes
}

function integer(
	params: PdfDictionary | undefined,
	key: string,
	fallback: number,
	resolve: Resolve,
	fail: (message: string) => never,
): number {
	const value = resolve(params?.entries[key]) ?? fallback
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		fail(`Invalid ${key} decode parameter`)
	return value
}

function predict(
	bytes: Uint8Array,
	params: PdfDictionary | undefined,
	resolve: Resolve,
	fail: (message: string) => never,
	check: (bytes: number) => void,
): Uint8Array {
	const predictor = integer(params, "Predictor", 1, resolve, fail)
	if (predictor === 1) return bytes
	if (predictor !== 2 && (predictor < 10 || predictor > 15))
		fail("Unsupported stream predictor")
	const colors = integer(params, "Colors", 1, resolve, fail)
	const bits = integer(params, "BitsPerComponent", 8, resolve, fail)
	const columns = integer(params, "Columns", 1, resolve, fail)
	if (colors === 0 || columns === 0 || ![1, 2, 4, 8, 16].includes(bits))
		fail("Invalid predictor geometry")
	const rowBytes = Math.ceil((colors * columns * bits) / 8)
	const pixelBytes = Math.ceil((colors * bits) / 8)
	const stride = rowBytes + (predictor === 2 ? 0 : 1)
	if (!Number.isSafeInteger(stride) || bytes.length % stride)
		fail("Truncated predictor row")
	const length = (bytes.length / stride) * rowBytes
	check(length)
	const output = new Uint8Array(length)
	if (predictor === 2) {
		output.set(bytes)
		// TIFF differences are between component samples, including packed 1/2/4-bit samples.
		const sample = (row: number, index: number) => {
			let value = 0
			for (let bit = 0; bit < bits; bit++) {
				const position = index * bits + bit
				value =
					value * 2 +
					((output[row + (position >>> 3)]! >>> (7 - (position % 8))) & 1)
			}
			return value
		}
		for (let row = 0; row < output.length; row += rowBytes) {
			for (let index = colors; index < colors * columns; index++) {
				const value =
					(sample(row, index) + sample(row, index - colors)) % 2 ** bits
				for (let bit = 0; bit < bits; bit++) {
					const position = index * bits + bit
					const byte = row + (position >>> 3)
					const shift = 7 - (position % 8)
					output[byte] =
						(output[byte]! & ~(1 << shift)) |
						(((value >>> (bits - bit - 1)) & 1) << shift)
				}
			}
		}
		return output
	}
	for (
		let input = 0, row = 0;
		input < bytes.length;
		input += stride, row += rowBytes
	) {
		const filter = bytes[input]!
		if (filter > 4) fail("Invalid PNG predictor filter")
		for (let index = 0; index < rowBytes; index++) {
			const left = index < pixelBytes ? 0 : output[row + index - pixelBytes]!
			const above = row === 0 ? 0 : output[row + index - rowBytes]!
			const upperLeft =
				row === 0 || index < pixelBytes
					? 0
					: output[row + index - rowBytes - pixelBytes]!
			let prediction = 0
			if (filter === 1) prediction = left
			else if (filter === 2) prediction = above
			else if (filter === 3) prediction = Math.floor((left + above) / 2)
			else if (filter === 4) {
				const estimate = left + above - upperLeft
				const a = Math.abs(estimate - left),
					b = Math.abs(estimate - above),
					c = Math.abs(estimate - upperLeft)
				prediction = a <= b && a <= c ? left : b <= c ? above : upperLeft
			}
			output[row + index] = bytes[input + index + 1]! + prediction
		}
	}
	return output
}

function ascii85(
	bytes: Uint8Array,
	fail: (message: string) => never,
	check: (bytes: number) => void,
): Uint8Array {
	const source = binaryText(bytes).replace(/[\x00\t\n\f\r ]/g, "")
	if (!source.endsWith("~>")) fail("Missing ASCII85Decode end marker")
	const output: number[] = []
	let group: number[] = []
	const emit = (count: number) => {
		check(output.length + count)
		while (group.length < 5) group.push(84)
		const value = group.reduce((value, digit) => value * 85 + digit, 0)
		if (value > 0xffff_ffff) fail("Invalid ASCII85Decode group")
		for (let byte = 0; byte < count; byte++)
			output.push((value >>> (24 - byte * 8)) & 255)
		group = []
	}
	for (const character of source.slice(0, -2)) {
		if (character === "z" && group.length === 0) {
			check(output.length + 4)
			output.push(0, 0, 0, 0)
		} else {
			const digit = character.charCodeAt(0) - 33
			if (digit < 0 || digit > 84) fail("Invalid ASCII85Decode character")
			group.push(digit)
			if (group.length === 5) emit(4)
		}
	}
	if (group.length === 1) fail("Invalid final ASCII85Decode group")
	if (group.length > 1) emit(group.length - 1)
	return Uint8Array.from(output)
}

function runLength(
	bytes: Uint8Array,
	fail: (message: string) => never,
	check: (bytes: number) => void,
): Uint8Array {
	const output: number[] = []
	for (let index = 0; index < bytes.length;) {
		const length = bytes[index++]!
		if (length === 128) return Uint8Array.from(output)
		check(output.length + (length < 128 ? length + 1 : 257 - length))
		if (length < 128) {
			if (index + length + 1 > bytes.length)
				fail("Truncated RunLengthDecode literal")
			for (let count = 0; count <= length; count++) output.push(bytes[index++]!)
		} else {
			if (index === bytes.length) fail("Truncated RunLengthDecode repeat")
			for (let count = 0; count < 257 - length; count++)
				output.push(bytes[index]!)
			index++
		}
	}
	return fail("Missing RunLengthDecode end marker")
}

function lzw(
	bytes: Uint8Array,
	earlyChange: number,
	fail: (message: string) => never,
	check: (bytes: number) => void,
): Uint8Array {
	if (earlyChange !== 0 && earlyChange !== 1)
		fail("Invalid LZW EarlyChange parameter")
	let table: number[][] = []
	let width = 9,
		next = 258,
		bit = 0
	let previous: number[] | undefined
	const output: number[] = []
	const reset = () => {
		table = Array.from({ length: 256 }, (_, index) => [index])
		width = 9
		next = 258
		previous = undefined
	}
	reset()
	while (bit + width <= bytes.length * 8) {
		let code = 0
		for (let index = 0; index < width; index++, bit++)
			code = (code << 1) | ((bytes[bit >>> 3]! >>> (7 - (bit % 8))) & 1)
		if (code === 256) {
			reset()
			continue
		}
		if (code === 257) return Uint8Array.from(output)
		const entry =
			table[code] ??
			(code === next && previous !== undefined
				? [...previous, previous[0]!]
				: undefined)
		if (entry === undefined) fail("Invalid LZW code")
		check(output.length + entry.length)
		for (const byte of entry) output.push(byte)
		if (previous !== undefined && next < 4096) {
			table[next++] = [...previous, entry[0]!]
			if (width < 12 && next + earlyChange === 2 ** width) width++
		}
		previous = entry
	}
	return fail("Missing LZWDecode end marker")
}

/** Fixed-size compressed chunks keep each synchronous inflate step bounded, including its internal buffer. */
function inflate(
	bytes: Uint8Array,
	check: (bytes: number) => void,
): Uint8Array {
	const chunks: Uint8Array[] = []
	let length = 0
	let low = 1
	let high = 0
	const decoder = new Unzlib((chunk) => {
		check(length + chunk.length)
		// RFC 1950 Adler-32, reduced in blocks to keep the sums bounded.
		for (let start = 0; start < chunk.length; start += 5552) {
			const end = Math.min(start + 5552, chunk.length)
			for (let index = start; index < end; index++) {
				low += chunk[index]!
				high += low
			}
			low %= 65521
			high %= 65521
		}
		if (chunk.length) chunks.push(chunk)
		length += chunk.length
	})
	// DEFLATE back-references expand at most 258 bytes per symbol. Feeding just
	// 64 compressed bytes bounds transient expansion independently of input size;
	// fflate retains only its 32 KiB history between pushes (plus a stored block).
	for (
		let position = 0;
		position < bytes.length || position === 0;
		position += 64
	) {
		decoder.push(
			bytes.subarray(position, position + 64),
			position + 64 >= bytes.length,
		)
	}
	// fflate validates the zlib header, but discards its checksum unchecked.
	const checksum = new DataView(
		bytes.buffer,
		bytes.byteOffset + bytes.length - 4,
		4,
	).getUint32(0)
	if (high * 65536 + low !== checksum) throw new Error("Invalid zlib checksum")
	const output = new Uint8Array(length)
	let position = 0
	for (const chunk of chunks) {
		output.set(chunk, position)
		position += chunk.length
	}
	return output
}
