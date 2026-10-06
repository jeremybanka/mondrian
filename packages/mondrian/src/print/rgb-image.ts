// SPDX-License-Identifier: MPL-2.0
import { decodeImage } from "./decode-image.ts"
import { iccColorSpace } from "../icc.ts"
import type { PdfRenderingIntent, PdfRgbImageData } from "../print-image.ts"

export interface PrepareRgbImageOptions {
	/** Override an embedded profile, or interpret untagged/sRGB-declared samples. */
	readonly sourceProfile?: Uint8Array
	readonly renderingIntent?: PdfRenderingIntent
}

/** Decode PNG/JPEG without converting color or premultiplying its alpha. */
export function prepareRgbImage(
	input: Uint8Array,
	options: PrepareRgbImageOptions = {},
): PdfRgbImageData {
	const decoded = decodeImage(input)
	const source = options.sourceProfile ?? decoded.sourceProfile
	if (source === undefined || source === "srgb")
		throw new TypeError(
			"RGB handoff requires sourceProfile bytes when the image has no embedded RGB ICC profile",
		)
	if (iccColorSpace(source) !== "RGB ")
		throw new TypeError("RGB handoff requires an RGB source ICC profile")
	const pixels = decoded.width * decoded.height
	const data = new Uint8Array(pixels * 3)
	const alpha = new Uint8Array(pixels)
	for (let pixel = 0; pixel < pixels; pixel++) {
		data.set(decoded.rgba.subarray(pixel * 4, pixel * 4 + 3), pixel * 3)
		alpha[pixel] = decoded.rgba[pixel * 4 + 3]!
	}
	return {
		width: decoded.width,
		height: decoded.height,
		data,
		sourceProfile: Uint8Array.from(source),
		...(alpha.every((value) => value === 255) ? {} : { alpha }),
		...(options.renderingIntent === undefined
			? {}
			: { renderingIntent: options.renderingIntent }),
	}
}
