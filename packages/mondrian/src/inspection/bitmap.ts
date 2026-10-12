// SPDX-License-Identifier: MPL-2.0
import { createCanvas } from "@napi-rs/canvas"
import { instantiate, TYPE_RGB_8, TYPE_GRAY_8, TYPE_CMYK_8 } from "lcms-wasm"
import type { ColorEngine } from "lcms-wasm"
import type { PdfDocument } from "../objects.ts"
import {
	createPdfResolver,
	pdfObjectId,
	pdfValueName,
	decodePdfInspectionStream,
} from "../inspect.ts"
import { dictionaryValue } from "../dictionary-lookup.ts"
import { isKind } from "../parser/syntax.ts"
import { readPlateImage } from "../testing/plate-image.ts"
import { readIccSpace } from "../print/pdf-color.ts"
import { iccColorSpace } from "../icc.ts"

let engine: Promise<ColorEngine> | undefined

export async function inspectBitmapPng(
	document: PdfDocument,
	id: string,
): Promise<{ png: Uint8Array; interpretation: string }> {
	const source = document.objects.find(
		(object) => pdfObjectId(object.objectNumber, object.generation) === id,
	)?.value
	if (!isKind(source, "stream"))
		throw new TypeError("The selected object is not an image stream")
	const resolve = createPdfResolver(document)
	const width = resolve(dictionaryValue(source, "Width")),
		height = resolve(dictionaryValue(source, "Height"))
	if (
		typeof width !== "number" ||
		typeof height !== "number" ||
		width * height > 4000000
	)
		throw new RangeError("Bitmap previews are limited to four million pixels")
	const spaceValue = dictionaryValue(source, "ColorSpace")
	const space = resolve(spaceValue)
	const icc =
		spaceValue !== undefined ? readIccSpace(spaceValue, resolve) : undefined
	const name = pdfValueName(space)
	const channels =
		icc?.channels ??
		(name === "DeviceRGB"
			? 3
			: name === "DeviceGray"
				? 1
				: name === "DeviceCMYK"
					? 4
					: undefined)
	if (!channels)
		throw new TypeError(
			"Preview supports DeviceRGB, DeviceGray, DeviceCMYK, and supported ICCBased image samples",
		)
	const raster = readPlateImage(source, resolve, new WeakMap(), channels)
	let rgb: Uint8Array | undefined
	if (icc) {
		const lcms = await (engine ??= instantiate({ printErr: () => {} }))
		const pointer = lcms._malloc(icc.profile.length)
		if (!pointer) throw new RangeError("Unable to allocate ICC profile")
		lcms.HEAPU8.set(icc.profile, pointer)
		const input = lcms._cmsOpenProfileFromMem(pointer, icc.profile.length),
			output = lcms.cmsCreate_sRGBProfile()
		let transform = 0
		try {
			if (!input || !output)
				throw new TypeError("Unable to open image ICC profile")
			transform = lcms.cmsCreateTransform(
				input,
				channels === 1
					? TYPE_GRAY_8
					: channels === 3
						? TYPE_RGB_8
						: TYPE_CMYK_8,
				output,
				TYPE_RGB_8,
				1,
				0,
			)
			if (!transform)
				throw new TypeError(
					"ICC profile cannot be converted to a screen preview",
				)
			rgb = Uint8Array.from(
				lcms.cmsDoTransform(transform, raster.data, width * height),
			)
		} finally {
			if (transform) lcms.cmsDeleteTransform(transform)
			if (input) lcms.cmsCloseProfile(input)
			if (output) lcms.cmsCloseProfile(output)
			lcms._free(pointer)
		}
	}
	const canvas = createCanvas(width, height),
		context = canvas.getContext("2d")
	const image = context.createImageData(width, height)
	for (let pixel = 0; pixel < width * height; pixel++) {
		for (let channel = 0; channel < 3; channel++) {
			image.data[pixel * 4 + channel] = rgb
				? rgb[pixel * 3 + channel]!
				: channels === 3
					? raster.data[pixel * 3 + channel]!
					: channels === 1
						? raster.data[pixel]!
						: 255 -
							Math.min(
								255,
								raster.data[pixel * 4 + channel]! + raster.data[pixel * 4 + 3]!,
							)
		}
		image.data[pixel * 4 + 3] = raster.alpha?.data[pixel] ?? 255
	}
	context.putImageData(image, 0, 0)
	return {
		png: await canvas.encode("png"),
		interpretation: icc
			? "ICC profile converted to sRGB for display; source samples are unchanged"
			: `${name} screen approximation; no source ICC profile was assumed`,
	}
}

export function inspectIccProfile(document: PdfDocument, id: string) {
	const source = document.objects.find(
		(object) => pdfObjectId(object.objectNumber, object.generation) === id,
	)?.value
	if (!isKind(source, "stream"))
		throw new TypeError("The profile reference is not a stream")
	const bytes = decodePdfInspectionStream(document, source, 16 * 1024 * 1024)
	const space = iccColorSpace(bytes)
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const signature = (offset: number) =>
		String.fromCharCode(...bytes.subarray(offset, offset + 4))
	let description = "No description tag"
	for (let index = 0; index < view.getUint32(128); index++) {
		if (signature(132 + index * 12) !== "desc") continue
		const start = view.getUint32(136 + index * 12),
			length = view.getUint32(140 + index * 12)
		if (signature(start) === "desc" && length >= 12)
			description = new TextDecoder("latin1")
				.decode(
					bytes.subarray(
						start + 12,
						Math.min(start + length, start + 12 + view.getUint32(start + 8)),
					),
				)
				.replace(/\0/g, "")
		else if (
			signature(start) === "mluc" &&
			length >= 28 &&
			view.getUint32(start + 8) > 0
		) {
			const size = view.getUint32(start + 20),
				offset = view.getUint32(start + 24)
			if (offset + size <= length)
				description = new TextDecoder("utf-16be").decode(
					bytes.subarray(start + offset, start + offset + size),
				)
		}
	}
	return {
		description,
		bytes: bytes.length,
		colorSpace: space.trim(),
		deviceClass: signature(12),
		connectionSpace: signature(20).trim(),
		version: `${bytes[8]}.${bytes[9]! >> 4}.${bytes[9]! & 15}`,
		renderingIntent:
			[
				"Perceptual",
				"Relative colorimetric",
				"Saturation",
				"Absolute colorimetric",
			][view.getUint32(64)] ?? "Unknown",
		declaredChannels: createPdfResolver(document)(dictionaryValue(source, "N")),
	}
}
