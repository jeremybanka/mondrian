// SPDX-License-Identifier: MPL-2.0
import {
	instantiate,
	TYPE_RGB_8,
	TYPE_GRAY_8,
	TYPE_CMYK_8,
	cmsFLAGS_BLACKPOINTCOMPENSATION,
} from "lcms-wasm"
import type { ColorEngine } from "lcms-wasm"
import { assertCmykProfile, iccColorSpace } from "../icc.ts"
import type { PdfCmykImageData } from "../print-image.ts"
import { decodeImage } from "./decode-image.ts"

export interface PrepareCmykImageOptions {
	readonly destinationProfile: Uint8Array
	/** Override embedded color information, or explicitly interpret untagged data. */
	readonly sourceProfile?: Uint8Array | "srgb"
	/** Defaults to relative-colorimetric. */
	readonly renderingIntent?:
		| "perceptual"
		| "relative-colorimetric"
		| "saturation"
		| "absolute-colorimetric"
	/** Defaults to true. Alpha is never color-converted. */
	readonly blackPointCompensation?: boolean
}

let engine: Promise<ColorEngine> | undefined
const intents = {
	perceptual: 0,
	"relative-colorimetric": 1,
	saturation: 2,
	"absolute-colorimetric": 3,
} as const

/** Convert a PNG/JPEG into independently owned CMYK samples and straight alpha. */
export async function prepareCmykImage(
	input: Uint8Array,
	options: PrepareCmykImageOptions,
): Promise<PdfCmykImageData> {
	assertCmykProfile(options.destinationProfile)
	const destinationProfile = Uint8Array.from(options.destinationProfile)
	const decoded = decodeImage(input)
	const source = options.sourceProfile ?? decoded.sourceProfile
	if (source === undefined)
		throw new TypeError(
			"An explicit sourceProfile is required when supported embedded color information is absent",
		)
	const sourceProfile = source === "srgb" ? source : Uint8Array.from(source)
	const sourceSpace =
		sourceProfile === "srgb" ? "RGB " : iccColorSpace(sourceProfile)
	if (sourceSpace === "CMYK" || (sourceSpace === "GRAY" && !decoded.gray))
		throw new TypeError(
			"The source ICC profile must match the image's RGB or grayscale samples",
		)
	const intent = options.renderingIntent ?? "relative-colorimetric"
	if (!Object.hasOwn(intents, intent))
		throw new TypeError("Unsupported rendering intent")
	const blackPointCompensation = options.blackPointCompensation ?? true
	if (typeof blackPointCompensation !== "boolean")
		throw new TypeError("blackPointCompensation must be boolean")
	const pixels = decoded.width * decoded.height
	const channels = sourceSpace === "GRAY" ? 1 : 3
	const samples = new Uint8Array(pixels * channels)
	const alpha = new Uint8Array(pixels)
	let transparent = false
	for (let pixel = 0; pixel < pixels; pixel++) {
		for (let channel = 0; channel < channels; channel++)
			samples[pixel * channels + channel] = decoded.rgba[pixel * 4 + channel]!
		alpha[pixel] = decoded.rgba[pixel * 4 + 3]!
		transparent ||= alpha[pixel] !== 255
	}
	const data = await convertSamples(
		samples,
		sourceProfile,
		destinationProfile,
		intent,
		blackPointCompensation,
	)
	return Object.freeze({
		width: decoded.width,
		height: decoded.height,
		data,
		destinationProfile,
		...(transparent ? { alpha } : {}),
	})
}

/** Shared explicit sample conversion; callers keep geometry and alpha separate. */
export async function convertSamples(
	samples: Uint8Array,
	sourceProfile: Uint8Array | "srgb",
	destinationProfile: Uint8Array,
	intent: NonNullable<PrepareCmykImageOptions["renderingIntent"]>,
	blackPointCompensation: boolean,
): Promise<Uint8Array> {
	const space = sourceProfile === "srgb" ? "RGB " : iccColorSpace(sourceProfile)
	const channels = space === "GRAY" ? 1 : space === "CMYK" ? 4 : 3
	const pixels = samples.length / channels
	if (!Number.isSafeInteger(pixels) || pixels > 32_000_000)
		throw new TypeError("Invalid color sample count")
	if (!Object.hasOwn(intents, intent))
		throw new TypeError("Unsupported rendering intent")
	if (typeof blackPointCompensation !== "boolean")
		throw new TypeError("blackPointCompensation must be boolean")
	assertCmykProfile(destinationProfile)
	const lcms = await (engine ??= instantiate({ printErr: () => {} }))
	const profiles: { handle: number; pointer: number }[] = []
	const open = (bytes: Uint8Array | "srgb") => {
		const pointer = bytes === "srgb" ? 0 : lcms._malloc(bytes.length)
		if (bytes !== "srgb" && pointer === 0)
			throw new RangeError("Unable to allocate ICC profile memory")
		if (bytes !== "srgb") lcms.HEAPU8.set(bytes, pointer)
		const handle =
			bytes === "srgb"
				? lcms.cmsCreate_sRGBProfile()
				: lcms._cmsOpenProfileFromMem(pointer, bytes.length)
		if (!handle) {
			if (pointer) lcms._free(pointer)
			throw new TypeError("Unable to open ICC profile")
		}
		profiles.push({ handle, pointer })
		return handle
	}
	let transform = 0
	try {
		transform = lcms.cmsCreateTransform(
			open(sourceProfile),
			channels === 1 ? TYPE_GRAY_8 : channels === 4 ? TYPE_CMYK_8 : TYPE_RGB_8,
			open(destinationProfile),
			TYPE_CMYK_8,
			intents[intent],
			blackPointCompensation ? cmsFLAGS_BLACKPOINTCOMPENSATION : 0,
		)
		if (!transform)
			throw new TypeError(
				"ICC profiles do not support the requested RGB/grayscale to CMYK conversion",
			)
		const data = new Uint8Array(pixels * 4)
		for (let offset = 0; offset < pixels; offset += 65536) {
			const count = Math.min(65536, pixels - offset)
			data.set(
				lcms.cmsDoTransform(
					transform,
					samples.subarray(offset * channels, (offset + count) * channels),
					count,
				),
				offset * 4,
			)
		}
		return data
	} finally {
		if (transform) lcms.cmsDeleteTransform(transform)
		for (const { handle, pointer } of profiles) {
			lcms.cmsCloseProfile(handle)
			if (pointer) lcms._free(pointer)
		}
	}
}
