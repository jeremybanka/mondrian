// SPDX-License-Identifier: MPL-2.0
import { crc32, inflateSync } from "node:zlib"
import { PNG } from "pngjs"
import jpeg from "jpeg-js"
import { imagePixelCount } from "../print-image.ts"

export interface DecodedImage {
	readonly width: number
	readonly height: number
	readonly rgba: Uint8Array
	readonly gray: boolean
	readonly sourceProfile?: Uint8Array | "srgb"
}

export function decodeImage(input: Uint8Array): DecodedImage {
	if (!(input instanceof Uint8Array) || input.length > 256 * 1024 * 1024)
		throw new TypeError("Expected PNG or JPEG bytes of at most 256 MiB")
	const bytes = Buffer.from(input)
	if (
		bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	)
		return decodePng(bytes)
	if (bytes[0] === 255 && bytes[1] === 216) return decodeJpeg(bytes)
	throw new TypeError("Print image preparation supports PNG and JPEG files")
}

function decodePng(bytes: Buffer): DecodedImage {
	if (bytes.length < 33 || bytes.toString("ascii", 12, 16) !== "IHDR")
		throw new TypeError("Invalid PNG header")
	const width = bytes.readUInt32BE(16)
	const height = bytes.readUInt32BE(20)
	imagePixelCount(width, height)
	const depth = bytes[24]!
	const type = bytes[25]!
	if (depth > 8)
		throw new TypeError(
			"Print preparation supports PNG sample depths up to 8 bits",
		)
	let profile: Uint8Array | undefined
	let srgb = false
	let cicp = false
	let ended = false
	const singletons = new Set<string>()
	for (let offset = 8; offset < bytes.length;) {
		if (offset + 12 > bytes.length) throw new TypeError("Truncated PNG chunk")
		const length = bytes.readUInt32BE(offset)
		const end = offset + length + 12
		if (end > bytes.length) throw new TypeError("Truncated PNG chunk")
		const kind = bytes.toString("ascii", offset + 4, offset + 8)
		const data = bytes.subarray(offset + 8, end - 4)
		if (
			crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
		)
			throw new TypeError("Invalid PNG chunk checksum")
		if (["IHDR", "iCCP", "sRGB", "gAMA", "cHRM", "cICP"].includes(kind)) {
			if (singletons.has(kind))
				throw new TypeError(`Duplicate PNG ${kind} chunk`)
			singletons.add(kind)
		}
		if (kind === "acTL")
			throw new TypeError("Animated PNGs are unsupported in print preparation")
		if (kind === "iCCP") {
			const separator = data.indexOf(0)
			if (separator < 1 || separator > 79 || data[separator + 1] !== 0)
				throw new TypeError("Invalid PNG ICC profile chunk")
			profile = inflateSync(data.subarray(separator + 2), {
				maxOutputLength: 16 * 1024 * 1024,
			})
		}
		if (kind === "sRGB") {
			if (data.length !== 1 || data[0]! > 3)
				throw new TypeError("Invalid PNG sRGB chunk")
			srgb = true
		}
		if (kind === "cICP") cicp = true
		if (kind === "IEND") {
			if (length !== 0 || end !== bytes.length)
				throw new TypeError("Invalid PNG end")
			ended = true
		}
		offset = end
	}
	if (!ended) throw new TypeError("PNG is missing IEND")
	if (profile !== undefined && srgb)
		throw new TypeError("PNG contains conflicting ICC and sRGB declarations")
	// The decoder expands palettes/tRNS and grayscale, without applying gamma,
	// profiles, background matting, or premultiplication to the stored samples.
	const decoded = PNG.sync.read(bytes)
	const sourceProfile = cicp
		? undefined
		: (profile ?? (srgb ? "srgb" : undefined))
	return {
		width,
		height,
		rgba: decoded.data,
		gray: type === 0 || type === 4,
		...(sourceProfile === undefined ? {} : { sourceProfile }),
	}
}

function decodeJpeg(bytes: Buffer): DecodedImage {
	const chunks = new Map<number, Uint8Array>()
	let total: number | undefined
	let gray = false
	let width = 0
	let height = 0
	for (let offset = 2; offset < bytes.length;) {
		if (bytes[offset++] !== 255) throw new TypeError("Invalid JPEG marker")
		while (bytes[offset] === 255) offset++
		const marker = bytes[offset++]
		if (marker === 0xda || marker === 0xd9) break
		if (
			marker === 0x01 ||
			(marker !== undefined && marker >= 0xd0 && marker <= 0xd7)
		)
			continue
		if (offset + 2 > bytes.length) throw new TypeError("Truncated JPEG marker")
		const length = bytes.readUInt16BE(offset)
		if (length < 2 || offset + length > bytes.length)
			throw new TypeError("Invalid JPEG marker length")
		const data = bytes.subarray(offset + 2, offset + length)
		if (
			marker === 0xe2 &&
			data.subarray(0, 12).toString("ascii") === "ICC_PROFILE\0"
		) {
			const sequence = data[12]
			const count = data[13]
			if (
				!sequence ||
				!count ||
				sequence > count ||
				(total !== undefined && total !== count) ||
				chunks.has(sequence)
			)
				throw new TypeError("Invalid JPEG ICC profile sequence")
			total = count
			chunks.set(sequence, data.subarray(14))
		}
		if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
			if (data.length < 6 || data[0] !== 8 || (data[5] !== 1 && data[5] !== 3))
				throw new TypeError("Only 8-bit RGB or grayscale JPEGs can be prepared")
			width = data.readUInt16BE(3)
			height = data.readUInt16BE(1)
			imagePixelCount(width, height)
			gray = data[5] === 1
		}
		offset += length
	}
	imagePixelCount(width, height)
	if (total !== undefined && chunks.size !== total)
		throw new TypeError("Incomplete JPEG ICC profile")
	const profile =
		total === undefined
			? undefined
			: Buffer.concat(
					Array.from({ length: total }, (_, i) => chunks.get(i + 1)!),
				)
	const decoded = jpeg.decode(bytes, {
		useTArray: true,
		formatAsRGBA: true,
		tolerantDecoding: false,
		maxResolutionInMP: 32,
		maxMemoryUsageInMB: 512,
	})
	return {
		width,
		height,
		gray,
		rgba: decoded.data,
		...(profile === undefined ? {} : { sourceProfile: profile }),
	}
}
