// SPDX-License-Identifier: MPL-2.0
import { inflateSync } from "node:zlib"
import { dictionaryValue } from "../dictionary-lookup.ts"
import { imagePixelCount } from "../print-image.ts"
import type {
	PdfDictionary,
	PdfIndirectValue,
	PdfStream,
	PdfValue,
} from "../objects.ts"
import { pdfName } from "./plate-names.ts"

export interface PlateRaster {
	readonly width: number
	readonly height: number
	readonly data: Uint8Array
	readonly interpolate: boolean
}

export interface PlateImage extends PlateRaster {
	readonly alpha?: PlateRaster
}

type Resolve = (value: PdfValue | undefined) => PdfIndirectValue | undefined
const imageKeys = new Set(
	"Type Subtype Width Height ColorSpace BitsPerComponent Filter DecodeParms Decode Interpolate Intent SMask ImageMask Metadata Name StructParent"
		.split(" ")
		.map((key) => `/${key}`),
)

/** Decode samples once. The image's paint space is checked in its resource scope. */
export function readPlateImage(
	source: PdfStream,
	resolve: Resolve,
): PlateImage {
	const read = (source: PdfStream, mask: boolean): PlateImage => {
		const field = (key: string) =>
			resolve(dictionaryValue(source, key)) ?? undefined
		for (const [key, value] of [
			...Object.entries(source.entries).map(
				([key, value]) => [`/${key}`, value] as const,
			),
			...(source.byteEntries ?? []).map(
				([key, value]) => [pdfName(key)!, value] as const,
			),
		]) {
			if (resolve(value) == null) continue
			if (!imageKeys.has(key) || (mask && key === "/SMask"))
				throw new TypeError(
					`Unsupported ${mask ? "image soft mask" : "image"} setting ${key}`,
				)
		}
		if (
			pdfName(field("Subtype")) !== "/Image" ||
			(field("Type") !== undefined && pdfName(field("Type")) !== "/XObject")
		)
			throw new TypeError("Expected an Image XObject")
		if (field("ImageMask") !== undefined && field("ImageMask") !== false)
			throw new TypeError("Stencil images are unsupported in plate previews")
		const width = field("Width")
		const height = field("Height")
		if (typeof width !== "number" || typeof height !== "number")
			throw new TypeError("Expected image dimensions")
		const pixels = imagePixelCount(width, height)
		if (field("BitsPerComponent") !== 8)
			throw new TypeError("Plate images require 8-bit samples")
		if (mask) {
			const color = field("ColorSpace")
			const space =
				color !== null &&
				typeof color === "object" &&
				color.kind === "array" &&
				color.items.length === 1
					? resolve(color.items[0])
					: color
			if (pdfName(space) !== "/DeviceGray")
				throw new TypeError("Image soft masks must use DeviceGray")
		}
		const interpolation = field("Interpolate")
		if (interpolation !== undefined && typeof interpolation !== "boolean")
			throw new TypeError("Image Interpolate must be boolean")
		const intent = field("Intent")
		if (
			intent !== undefined &&
			![
				"/AbsoluteColorimetric",
				"/RelativeColorimetric",
				"/Saturation",
				"/Perceptual",
			].includes(pdfName(intent) ?? "")
		)
			throw new TypeError("Unsupported image rendering intent")
		const channels = mask ? 1 : 4
		const expected = pixels * channels
		const filter = field("Filter")
		const filters =
			filter !== null && typeof filter === "object" && filter.kind === "array"
				? filter.items.map(resolve)
				: filter === undefined
					? []
					: [filter]
		if (
			filters.length > 1 ||
			(filters.length === 1 && pdfName(filters[0]) !== "/FlateDecode") ||
			field("DecodeParms") !== undefined
		)
			throw new TypeError(
				"Plate images support only unfiltered or FlateDecode samples without DecodeParms",
			)
		if (filters.length === 0 && source.data.length !== expected)
			throw new TypeError("Image sample length does not match its dimensions")
		const data =
			filters.length === 0
				? Uint8Array.from(source.data)
				: Uint8Array.from(
						inflateSync(source.data, { maxOutputLength: expected }),
					)
		if (data.length !== expected)
			throw new TypeError("Image sample length does not match its dimensions")
		const decode = field("Decode")
		if (decode !== undefined) {
			if (
				decode === null ||
				typeof decode !== "object" ||
				decode.kind !== "array" ||
				decode.items.length !== channels * 2
			)
				throw new TypeError("Invalid image Decode array")
			for (let channel = 0; channel < channels; channel++) {
				const low = resolve(decode.items[channel * 2])
				const high = resolve(decode.items[channel * 2 + 1])
				if (!((low === 0 && high === 1) || (low === 1 && high === 0)))
					throw new TypeError(
						"Plate images support only default or inverted Decode ranges",
					)
				if (low === 1)
					for (let index = channel; index < data.length; index += channels)
						data[index] = 255 - data[index]!
			}
		}
		const alpha = field("SMask")
		let decodedAlpha: PlateRaster | undefined
		if (alpha !== undefined) {
			if (
				alpha === null ||
				typeof alpha !== "object" ||
				alpha.kind !== "stream"
			)
				throw new TypeError("Expected an image soft-mask stream")
			decodedAlpha = read(alpha, true)
			if (decodedAlpha.width !== width || decodedAlpha.height !== height)
				throw new TypeError(
					"Plate image and soft mask must have matching dimensions",
				)
		}
		return {
			width,
			height,
			data,
			interpolate: interpolation ?? false,
			...(decodedAlpha === undefined ? {} : { alpha: decodedAlpha }),
		}
	}
	return read(source, false)
}

/** A page is the outer isolated group; only explicit CMYK, non-knockout blending is supported. */
export function assertPlatePageGroup(
	group: PdfDictionary,
	resolve: Resolve,
): void {
	const field = (key: string) =>
		resolve(dictionaryValue(group, key)) ?? undefined
	if (
		pdfName(field("S")) !== "/Transparency" ||
		pdfName(field("CS")) !== "/DeviceCMYK" ||
		(field("K") !== undefined && field("K") !== false) ||
		(field("I") !== undefined && typeof field("I") !== "boolean")
	)
		throw new TypeError(
			"Page transparency group is unsupported: requires DeviceCMYK blending without knockout",
		)
}
