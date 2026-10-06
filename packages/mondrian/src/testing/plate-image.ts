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
import { decodeJpegSamples } from "../print/jpeg-samples.ts"
import { readIccSpace } from "../print/pdf-color.ts"

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
	// Share masks across parent images only within this document's plan.
	masks = new WeakMap<PdfStream, PlateRaster>(),
	components: 1 | 3 | 4 = 4,
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
		const channels = mask ? 1 : components
		const expected = pixels * channels
		const filter = field("Filter")
		const filters =
			filter !== null && typeof filter === "object" && filter.kind === "array"
				? filter.items.map(resolve)
				: filter === undefined
					? []
					: [filter]
		const codec = filters.length === 0 ? undefined : pdfName(filters[0])
		if (
			filters.length > 1 ||
			(filters.length === 1 &&
				codec !== "/FlateDecode" &&
				codec !== "/DCTDecode")
		)
			throw new TypeError(
				"Plate images support only unfiltered, FlateDecode, or baseline DCTDecode samples",
			)
		let parameters = field("DecodeParms")
		if (
			parameters !== null &&
			typeof parameters === "object" &&
			parameters.kind === "array"
		) {
			if (parameters.items.length !== filters.length)
				throw new TypeError("DecodeParms must match the filter array")
			parameters = resolve(parameters.items[0]) ?? undefined
		}
		if (
			parameters !== undefined &&
			(parameters === null ||
				typeof parameters !== "object" ||
				parameters.kind !== "dictionary")
		)
			throw new TypeError("Expected image DecodeParms dictionary")
		const setting = (key: string, fallback: number) => {
			const value =
				parameters === undefined
					? fallback
					: (resolve(dictionaryValue(parameters as PdfDictionary, key)) ??
						fallback)
			if (typeof value !== "number" || !Number.isSafeInteger(value))
				throw new TypeError(`Invalid image DecodeParms ${key}`)
			return value
		}
		const allowed =
			codec === "/DCTDecode"
				? ["ColorTransform"]
				: ["Predictor", "Colors", "Columns", "BitsPerComponent"]
		if (parameters !== undefined) {
			for (const key of [
				...Object.keys((parameters as PdfDictionary).entries).map(
					(key) => `/${key}`,
				),
				...((parameters as PdfDictionary).byteEntries ?? []).map(([key]) =>
					pdfName(key)!,
				),
			])
				if (!allowed.includes(key.slice(1)))
					throw new TypeError(`Unsupported image DecodeParms ${key}`)
		}
		const predictor = codec === "/DCTDecode" ? 1 : setting("Predictor", 1)
		if (
			predictor !== 1 &&
			predictor !== 2 &&
			(predictor < 10 || predictor > 15)
		)
			throw new TypeError(`Unsupported image predictor ${predictor}`)
		if (
			predictor !== 1 &&
			(setting("Colors", 1) !== channels ||
				setting("Columns", 1) !== width ||
				setting("BitsPerComponent", 8) !== 8)
		)
			throw new TypeError(
				"Image predictor geometry must match its 8-bit samples",
			)
		if (filters.length === 0 && source.data.length !== expected)
			throw new TypeError("Image sample length does not match its dimensions")
		const colorTransform =
			codec === "/DCTDecode" ? setting("ColorTransform", -1) : -1
		if (![-1, 0, 1].includes(colorTransform))
			throw new TypeError("Unsupported DCT ColorTransform")
		let data =
			filters.length === 0
				? Uint8Array.from(source.data)
				: codec === "/DCTDecode"
					? decodeJpegSamples(
							source.data,
							width,
							height,
							channels,
							colorTransform === -1 ? undefined : (colorTransform as 0 | 1),
						)
					: Uint8Array.from(
							inflateSync(source.data, {
								maxOutputLength: expected + (predictor >= 10 ? height : 0),
							}),
						)
		if (predictor !== 1)
			data = undoPredictor(data, width, height, channels, predictor)
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
				if (
					typeof low !== "number" ||
					typeof high !== "number" ||
					!Number.isFinite(low) ||
					!Number.isFinite(high) ||
					low < 0 ||
					low > 1 ||
					high < 0 ||
					high > 1
				)
					throw new TypeError(
						"Plate image Decode endpoints must be finite values from 0 through 1",
					)
				for (let index = channel; index < data.length; index += channels)
					data[index] = Math.round(low * 255 + data[index]! * (high - low))
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
			decodedAlpha = masks.get(alpha)
			if (decodedAlpha === undefined) {
				decodedAlpha = read(alpha, true)
				masks.set(alpha, decodedAlpha)
			}
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

function undoPredictor(
	input: Uint8Array,
	width: number,
	height: number,
	channels: number,
	predictor: number,
): Uint8Array {
	const row = width * channels,
		stride = row + (predictor >= 10 ? 1 : 0)
	if (input.length !== stride * height)
		throw new TypeError(
			"Image predictor row length does not match its dimensions",
		)
	const output = new Uint8Array(row * height)
	for (let y = 0; y < height; y++) {
		const filter = predictor === 2 ? 1 : input[y * stride]!
		if (filter > 4) throw new TypeError("Invalid image PNG predictor filter")
		for (let x = 0; x < row; x++) {
			const at = y * row + x,
				left = x >= channels ? output[at - channels]! : 0,
				above = y ? output[at - row]! : 0,
				upperLeft = y && x >= channels ? output[at - row - channels]! : 0
			let prediction = 0
			if (filter === 1) prediction = left
			else if (filter === 2) prediction = above
			else if (filter === 3) prediction = Math.floor((left + above) / 2)
			else if (filter === 4) {
				const estimate = left + above - upperLeft,
					a = Math.abs(estimate - left),
					b = Math.abs(estimate - above),
					c = Math.abs(estimate - upperLeft)
				prediction = a <= b && a <= c ? left : b <= c ? above : upperLeft
			}
			output[at] =
				input[y * stride + x + (predictor >= 10 ? 1 : 0)]! + prediction
		}
	}
	return output
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
		(pdfName(field("CS")) !== "/DeviceCMYK" &&
			readIccSpace(dictionaryValue(group, "CS")!, resolve)?.channels !== 4) ||
		(field("K") !== undefined && field("K") !== false) ||
		(field("I") !== undefined && typeof field("I") !== "boolean")
	)
		throw new TypeError(
			"Page transparency group is unsupported: requires DeviceCMYK blending without knockout",
		)
}
