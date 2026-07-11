import { createPdfDocument } from "mondrian.pdf"

export interface LayoutPdfJpeg {
	readonly bitsPerComponent: 8
	readonly bytes: Uint8Array
	readonly colorSpace: "DeviceGray" | "DeviceRGB"
	readonly height: number
	readonly width: number
}

const base64Alphabet =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

export function parseLayoutJpegDataUrl(
	src: string,
	expectedWidth: number,
	expectedHeight: number,
	path: string,
): LayoutPdfJpeg {
	const match = /^data:image\/(?:jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/u.exec(
		src,
	)
	if (match === null) {
		if (/^data:image\/png(?:;|,)/u.test(src)) {
			throw new TypeError(
				`${path}: PNG images are not supported; use a baseline JPEG data URL`,
			)
		}
		throw new TypeError(`${path}: image src must be a baseline JPEG data URL`)
	}

	const bytes = decodeBase64(match[1] ?? "", path)
	try {
		createPdfDocument().jpeg(bytes)
	} catch (error) {
		throw new TypeError(
			`${path}: ${error instanceof Error ? error.message : "invalid baseline JPEG data"}`,
		)
	}
	const metadata = parseBaselineJpeg(bytes, path)
	if (
		Math.round(expectedWidth) !== metadata.width ||
		Math.round(expectedHeight) !== metadata.height
	) {
		throw new TypeError(
			`${path}: intrinsic dimensions ${expectedWidth}x${expectedHeight} do not match JPEG dimensions ${metadata.width}x${metadata.height}`,
		)
	}
	return { bytes, ...metadata }
}

function decodeBase64(value: string, path: string): Uint8Array {
	const normalized = value.replaceAll(/\s/gu, "")
	if (
		normalized.length === 0 ||
		normalized.length % 4 !== 0 ||
		!/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)
	) {
		throw new TypeError(`${path}: image data contains invalid base64`)
	}

	const padding = normalized.endsWith("==")
		? 2
		: normalized.endsWith("=")
			? 1
			: 0
	const result = new Uint8Array((normalized.length / 4) * 3 - padding)
	let output = 0
	for (let index = 0; index < normalized.length; index += 4) {
		const first = base64Value(normalized[index], path)
		const second = base64Value(normalized[index + 1], path)
		const third =
			normalized[index + 2] === "="
				? 0
				: base64Value(normalized[index + 2], path)
		const fourth =
			normalized[index + 3] === "="
				? 0
				: base64Value(normalized[index + 3], path)
		const bits = (first << 18) | (second << 12) | (third << 6) | fourth
		if (output < result.length) result[output++] = bits >>> 16
		if (output < result.length) result[output++] = (bits >>> 8) & 0xff
		if (output < result.length) result[output++] = bits & 0xff
	}
	return result
}

function base64Value(value: string | undefined, path: string): number {
	const index = value === undefined ? -1 : base64Alphabet.indexOf(value)
	if (index < 0) {
		throw new TypeError(`${path}: image data contains invalid base64`)
	}
	return index
}

function parseBaselineJpeg(
	bytes: Uint8Array,
	path: string,
): Omit<LayoutPdfJpeg, "bytes"> {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
		throw new TypeError(`${path}: JPEG data is missing its SOI marker`)
	}

	let offset = 2
	let metadata: Omit<LayoutPdfJpeg, "bytes"> | undefined
	let foundScan = false
	let foundEnd = false
	while (offset < bytes.length) {
		if (bytes[offset] !== 0xff) {
			if (!foundScan) {
				throw new TypeError(`${path}: invalid JPEG marker structure`)
			}
			offset += 1
			continue
		}

		while (bytes[offset] === 0xff) offset += 1
		const marker = bytes[offset]
		offset += 1
		if (marker === undefined) break
		if (marker === 0x00 && foundScan) continue
		if (marker >= 0xd0 && marker <= 0xd7) continue
		if (marker === 0xd9) {
			foundEnd = true
			break
		}
		if (marker === 0x01) continue

		const length = readUint16(bytes, offset, path)
		if (length < 2 || offset + length > bytes.length) {
			throw new TypeError(`${path}: invalid JPEG segment length`)
		}
		const dataOffset = offset + 2

		if (marker === 0xc0) {
			const precision = bytes[dataOffset]
			const height = readUint16(bytes, dataOffset + 1, path)
			const width = readUint16(bytes, dataOffset + 3, path)
			const components = bytes[dataOffset + 5]
			if (precision !== 8 || (components !== 1 && components !== 3)) {
				throw new TypeError(
					`${path}: only baseline 8-bit grayscale or RGB JPEG images are supported`,
				)
			}
			if (width === 0 || height === 0) {
				throw new TypeError(`${path}: JPEG dimensions must be positive`)
			}
			metadata = {
				bitsPerComponent: 8,
				colorSpace: components === 1 ? "DeviceGray" : "DeviceRGB",
				height,
				width,
			}
		} else if (
			(marker >= 0xc1 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf)
		) {
			throw new TypeError(`${path}: only baseline JPEG images are supported`)
		}

		if (marker === 0xda) {
			foundScan = true
		}
		offset += length
	}

	if (metadata === undefined || !foundScan || !foundEnd) {
		throw new TypeError(`${path}: JPEG data is incomplete`)
	}
	return metadata
}

function readUint16(bytes: Uint8Array, offset: number, path: string): number {
	const first = bytes[offset]
	const second = bytes[offset + 1]
	if (first === undefined || second === undefined) {
		throw new TypeError(`${path}: JPEG data ended unexpectedly`)
	}
	return (first << 8) | second
}
