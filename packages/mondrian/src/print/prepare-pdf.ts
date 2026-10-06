// SPDX-License-Identifier: MPL-2.0
import { createHash } from "node:crypto"
import { zlibSync } from "fflate"
import { assertCmykProfile, iccColorSpace, sameBytes } from "../icc.ts"
import { dictionaryValue } from "../dictionary-lookup.ts"
import { throwForPdfErrors } from "../diagnostics.ts"
import { validatePdf } from "../validate.ts"
import {
	array,
	dictionary,
	indirectObject,
	name,
	objectNumber,
	reference,
	stream,
	textString,
} from "../objects.ts"
import type {
	PdfDictionary,
	PdfDocument,
	PdfIndirectValue,
	PdfReference,
	PdfStream,
	PdfValue,
} from "../objects.ts"
import type { PdfRenderingIntent } from "../print-image.ts"
import { imagePixelCount } from "../print-image.ts"
import type { PlateRaster } from "../testing/plate-image.ts"
import { pdfIntent } from "../rgb-image.ts"
import { parsePlateContent } from "../testing/plate-content.ts"
import { textHasGlyphs } from "../testing/plate-content.ts"
import { pathPainting, textPainting } from "../testing/plate-paint.ts"
import type { TextMode } from "../testing/plate-paint.ts"
import { nameTokenBytes, pdfName, tokenName } from "../testing/plate-names.ts"
import { nameBytes } from "../objects.ts"
import { planPdfPlates, replaceEntries } from "../testing/plate-plan.ts"
import { readPlateImage } from "../testing/plate-image.ts"
import { encodePdfName, formatPdfNumber } from "../syntax.ts"
import { convertSamples } from "./convert-image.ts"
import { decodedPdfStream, readIccSpace } from "./pdf-color.ts"
import { reachableObjects } from "../reachable-objects.ts"

export interface PreparePdfForPrintOptions {
	readonly destinationProfile: Uint8Array
	readonly outputCondition: string
	readonly renderingIntent: PdfRenderingIntent
	readonly objectIntents: "honor" | "override"
	readonly blackPointCompensation: boolean
	readonly untaggedRgb: "reject" | "srgb" | Uint8Array
	readonly gray:
		| "reject"
		| "black-only"
		| { readonly sourceProfile: Uint8Array }
	readonly spots: "preserve"
	/** Preserve native process amounts, or retarget other colors while retaining K-only paint. */
	readonly processNumbers:
		| "preserve"
		| { readonly sourceProfile: Uint8Array; readonly blackOnly: "preserve" }
	/** Destination blends converted process amounts. Source preserves existing CMYK blending, rejecting RGB groups. */
	readonly blending: "destination" | "preserve-source"
	/** Aggregate decoded image/mask bytes per preparation; defaults to 512 MiB, at most 1 GiB. */
	readonly maxDecodedImageBytes?: number
}

export interface PdfPrintConversion {
	readonly location: string
	readonly source: string
	readonly action: "convert" | "preserve-process" | "gray-to-black"
	readonly renderingIntent: PdfRenderingIntent
}

export interface PreparedPdfForPrint {
	readonly document: PdfDocument
	readonly report: {
		readonly destinationProfileSha256: string
		readonly outputCondition: string
		readonly objectIntents: "honor" | "override"
		readonly blackPointCompensation: boolean
		readonly blending: "destination" | "preserve-source"
		readonly groups: readonly {
			readonly location: string
			readonly source: string
			readonly destination: "DeviceCMYK"
		}[]
		readonly conversions: readonly PdfPrintConversion[]
	}
}

type Space =
	| {
			readonly kind: "rgb" | "gray" | "cmyk"
			readonly profile?: Uint8Array | "srgb"
	  }
	| { readonly kind: "spot"; readonly alias: string }
interface State {
	fill: Space
	stroke: Space
	intent: PdfRenderingIntent
	implicitFill: boolean
	implicitStroke: boolean
	textMode: TextMode
}
const hash = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex")
const intentNames: Record<string, PdfRenderingIntent> = {
	"/Perceptual": "perceptual",
	"/RelativeColorimetric": "relative-colorimetric",
	"/Saturation": "saturation",
	"/AbsoluteColorimetric": "absolute-colorimetric",
}

/** Convert object samples and paint explicitly, then validate the complete plate program. */
export async function preparePdfForPrint(
	input: PdfDocument,
	requested: PreparePdfForPrintOptions,
): Promise<PreparedPdfForPrint> {
	// Snapshot all inputs before the first asynchronous color-engine initialization.
	const document = structuredClone(input),
		options = structuredClone(requested)
	assertCmykProfile(options.destinationProfile)
	pdfIntent(options.renderingIntent)
	if (
		typeof options.outputCondition !== "string" ||
		!options.outputCondition.trim()
	)
		throw new TypeError("An outputCondition identifier is required")
	if (
		typeof options.blackPointCompensation !== "boolean" ||
		!["honor", "override"].includes(options.objectIntents) ||
		options.spots !== "preserve" ||
		!["destination", "preserve-source"].includes(options.blending)
	)
		throw new TypeError(
			"Explicit supported conversion, spot preservation, and blending policies are required",
		)
	if (options.untaggedRgb instanceof Uint8Array) {
		if (iccColorSpace(options.untaggedRgb) !== "RGB ")
			throw new TypeError("untaggedRgb requires an RGB ICC profile")
	} else if (!["reject", "srgb"].includes(options.untaggedRgb))
		throw new TypeError("An explicit untaggedRgb policy is required")
	if (
		options.gray !== "reject" &&
		options.gray !== "black-only" &&
		(!options.gray || iccColorSpace(options.gray.sourceProfile) !== "GRAY")
	)
		throw new TypeError(
			"An explicit gray policy or grayscale ICC source profile is required",
		)
	if (
		options.processNumbers !== "preserve" &&
		(!options.processNumbers ||
			options.processNumbers.blackOnly !== "preserve" ||
			iccColorSpace(options.processNumbers.sourceProfile) !== "CMYK")
	)
		throw new TypeError(
			"Process retargeting requires a CMYK source profile and blackOnly preservation",
		)
	throwForPdfErrors(validatePdf(document))
	const maxDecoded = options.maxDecodedImageBytes ?? 512 * 1024 * 1024
	if (
		!Number.isSafeInteger(maxDecoded) ||
		maxDecoded < 1 ||
		maxDecoded > 1024 * 1024 * 1024
	)
		throw new RangeError(
			"maxDecodedImageBytes must be a positive integer of at most 1 GiB",
		)
	let decodedBytes = 0
	const countedMasks = new WeakSet<object>()
	const decodedMasks = new WeakMap<PdfStream, PlateRaster>()
	const objects = [...document.objects],
		indices = new Map(
			objects.map((o, i) => [`${o.objectNumber}:${o.generation}`, i]),
		)
	let next = objects.reduce((n, o) => Math.max(n, o.objectNumber), 0) + 1
	const add = (value: PdfIndirectValue): PdfReference => {
		const n = objectNumber(next++)
		indices.set(`${n}:0`, objects.length)
		objects.push(indirectObject(n, value))
		return reference(n)
	}
	const resolve = (
		value: PdfIndirectValue | PdfReference | undefined,
	): PdfIndirectValue | undefined => {
		const seen = new Set<string>()
		while (
			value !== null &&
			typeof value === "object" &&
			value.kind === "reference"
		) {
			const key = `${value.objectNumber}:${value.generation}`
			if (seen.has(key)) throw new TypeError("Cyclic PDF resource reference")
			seen.add(key)
			const index = indices.get(key)
			if (index === undefined) throw new TypeError(`Missing PDF object ${key}`)
			value = objects[index]!.value
		}
		return value
	}
	const field = (value: PdfDictionary | PdfStream, key: string) =>
		resolve(dictionaryValue(value, key)) ?? undefined
	const dict = (
		value: PdfIndirectValue | PdfReference | undefined,
	): PdfDictionary => {
		const result = resolve(value)
		if (result == null) return dictionary({})
		if (typeof result !== "object" || result.kind !== "dictionary")
			throw new TypeError("Expected a PDF resource dictionary")
		return result
	}
	const declaredIntents = field(dict(document.root), "OutputIntents")
	let declaredProcessProfile: Uint8Array | undefined
	if (declaredIntents !== undefined) {
		if (
			declaredIntents === null ||
			typeof declaredIntents !== "object" ||
			declaredIntents.kind !== "array" ||
			declaredIntents.items.length > 1
		)
			throw new TypeError(
				"Multiple or malformed output intents require an explicit prior choice",
			)
		if (declaredIntents.items[0] !== undefined) {
			const declared = field(
				dict(declaredIntents.items[0]),
				"DestOutputProfile",
			)
			if (declared !== undefined) {
				if (
					declared === null ||
					typeof declared !== "object" ||
					declared.kind !== "stream"
				)
					throw new TypeError("Expected destination ICC profile stream")
				const bytes = decodedPdfStream(declared, resolve, 16 * 1024 * 1024)
				if (iccColorSpace(bytes) === "CMYK") declaredProcessProfile = bytes
			}
		}
	}
	const entries = (value: PdfDictionary): [string, PdfValue][] => [
		...Object.entries(value.entries)
			.filter((v): v is [string, PdfValue] => v[1] !== undefined)
			.map(([key, value]): [string, PdfValue] => [encodePdfName(key), value]),
		...(value.byteEntries ?? []).map(([key, value]): [string, PdfValue] => [
			pdfName(key)!,
			value,
		]),
	]
	const conversions: PdfPrintConversion[] = [],
		groups: { location: string; source: string; destination: "DeviceCMYK" }[] =
			[]
	const sourceKey = (space: Space) =>
		space.kind === "spot"
			? space.alias
			: space.profile instanceof Uint8Array
				? `sha256:${hash(space.profile)}`
				: (space.profile ?? `Device${space.kind.toUpperCase()}`)
	const readSpace = (
		value: PdfValue,
		resources: PdfDictionary,
		depth = 0,
	): Space => {
		if (depth > 50)
			throw new TypeError("Cyclic or excessively nested color space aliases")
		const named = pdfName(resolve(value))
		if (named === "/DeviceRGB") return { kind: "rgb" }
		if (named === "/DeviceGray") return { kind: "gray" }
		if (named === "/DeviceCMYK") return { kind: "cmyk" }
		if (named !== undefined) {
			const target = entries(
				dict(dictionaryValue(resources, "ColorSpace")),
			).find(([key]) => tokenName(key) === tokenName(named))?.[1]
			if (target === undefined)
				throw new TypeError(`Missing color space resource ${named}`)
			return readSpace(target, resources, depth + 1)
		}
		const icc = readIccSpace(value, resolve)
		if (icc)
			return {
				kind: icc.channels === 3 ? "rgb" : icc.channels === 4 ? "cmyk" : "gray",
				profile: icc.profile,
			}
		const resolved = resolve(value)
		if (
			resolved !== null &&
			typeof resolved === "object" &&
			resolved.kind === "array"
		) {
			if (resolved.items.length === 1 && resolved.items[0] !== undefined)
				return readSpace(resolved.items[0], resources, depth + 1)
			if (pdfName(resolve(resolved.items[0])) === "/Separation")
				return { kind: "spot", alias: "" }
		}
		throw new TypeError(
			"Unsupported print color space; use RGB/gray/CMYK or an ordinary Separation",
		)
	}
	const selectedIntent = (
		value: PdfValue | undefined,
		current: PdfRenderingIntent,
	) => {
		if (value == null) return current
		const intent = intentNames[pdfName(resolve(value)) ?? ""]
		if (!intent) throw new TypeError("Unsupported object rendering intent")
		return options.objectIntents === "honor" ? intent : options.renderingIntent
	}
	const convert = async (
		data: Uint8Array,
		space: Exclude<Space, { kind: "spot" }>,
		intent: PdfRenderingIntent,
		location: string,
	): Promise<Uint8Array> => {
		let profile = space.profile
		if (
			space.kind === "cmyk" &&
			profile === undefined &&
			options.processNumbers === "preserve"
		)
			profile = declaredProcessProfile
		if (space.kind === "rgb" && profile === undefined) {
			if (options.untaggedRgb === "reject")
				throw new TypeError(
					`${location}: untagged RGB requires caller-supplied source interpretation`,
				)
			profile = options.untaggedRgb
		}
		if (space.kind === "gray" && options.gray === "reject")
			throw new TypeError(
				`${location}: gray paint requires an explicit gray policy`,
			)
		if (space.kind === "gray" && options.gray === "black-only") {
			const result = new Uint8Array(data.length * 4)
			for (let i = 0; i < data.length; i++) result[i * 4 + 3] = 255 - data[i]!
			conversions.push({
				location,
				source: sourceKey(space),
				action: "gray-to-black",
				renderingIntent: intent,
			})
			return result
		}
		if (
			space.kind === "gray" &&
			profile === undefined &&
			typeof options.gray === "object"
		)
			profile = options.gray.sourceProfile
		if (space.kind === "cmyk" && options.processNumbers === "preserve") {
			if (
				profile instanceof Uint8Array &&
				!sameBytes(profile, options.destinationProfile)
			)
				throw new TypeError(
					`${location}: ICCBased CMYK profile differs from the destination; choose explicit process retargeting`,
				)
			conversions.push({
				location,
				source: sourceKey(space),
				action: "preserve-process",
				renderingIntent: intent,
			})
			return Uint8Array.from(data)
		}
		if (
			space.kind === "cmyk" &&
			profile === undefined &&
			typeof options.processNumbers === "object"
		)
			profile = options.processNumbers.sourceProfile
		// Validated policies establish a profile for every branch that reaches conversion.
		const sourceProfile = profile!
		const result = await convertSamples(
			data,
			sourceProfile,
			options.destinationProfile,
			intent,
			options.blackPointCompensation,
		)
		if (space.kind === "cmyk")
			for (let at = 0; at < data.length; at += 4)
				if (data[at] === 0 && data[at + 1] === 0 && data[at + 2] === 0)
					result.set(data.subarray(at, at + 4), at)
		conversions.push({
			location,
			source:
				sourceProfile === "srgb" ? "srgb" : `sha256:${hash(sourceProfile)}`,
			action: "convert",
			renderingIntent: intent,
		})
		return result
	}
	const activeForms = new Set<PdfStream>(),
		activePages = new Set<PdfDictionary>()
	const imageCache = new WeakMap<PdfStream, Map<string, PdfReference>>()
	const normalizeImage = async (
		image: PdfStream,
		resources: PdfDictionary,
		state: State,
		location: string,
	): Promise<PdfReference> => {
		const color = dictionaryValue(image, "ColorSpace")
		if (color === undefined) throw new TypeError("Image ColorSpace is required")
		const space = readSpace(color, resources),
			intent = selectedIntent(dictionaryValue(image, "Intent"), state.intent)
		if (space.kind === "spot")
			throw new TypeError("Separation images are unsupported")
		const key = `${space.kind}:${sourceKey(space)}:${intent}`
		const cache = imageCache.get(image) ?? new Map<string, PdfReference>()
		imageCache.set(image, cache)
		const existing = cache.get(key)
		if (existing) return existing
		const width = field(image, "Width"),
			height = field(image, "Height")
		if (typeof width !== "number" || typeof height !== "number")
			throw new TypeError("Expected image dimensions")
		const count = imagePixelCount(width, height),
			channels = space.kind === "rgb" ? 3 : space.kind === "gray" ? 1 : 4
		const mask = field(image, "SMask"),
			cachedMask =
				mask !== null && typeof mask === "object" && mask.kind === "stream"
					? decodedMasks.get(mask)
					: undefined
		const expected =
			count * channels +
			(mask !== undefined &&
			(cachedMask === undefined || !countedMasks.has(cachedMask))
				? count
				: 0)
		if (decodedBytes + expected > maxDecoded)
			throw new RangeError(
				`${location}: aggregate decoded image/mask bytes exceed maxDecodedImageBytes`,
			)
		const raster = readPlateImage(image, resolve, decodedMasks, channels)
		decodedBytes += raster.data.length
		if (raster.alpha !== undefined && !countedMasks.has(raster.alpha)) {
			decodedBytes += raster.alpha.data.length
			countedMasks.add(raster.alpha)
		}
		const samples = await convert(raster.data, space, intent, location)
		const replacement = replaceEntries(image, {
			ColorSpace: name("DeviceCMYK"),
			Filter: name("FlateDecode"),
			DecodeParms: undefined,
			Decode: undefined,
			Intent: name(pdfIntent(intent)),
		})
		const result = add(
			stream(
				replacement.entries,
				zlibSync(samples),
				...(replacement.byteEntries ?? []),
			),
		)
		cache.set(key, result)
		return result
	}
	const normalizeScope = async (
		source: string,
		resources: PdfDictionary,
		initial: State,
		location: string,
		pageResources: PdfDictionary = resources,
	): Promise<{ data: Uint8Array; resources: PdfDictionary }> => {
		const colors = dict(dictionaryValue(resources, "ColorSpace"))
		for (const [alias] of entries(colors))
			if (
				["/DefaultRGB", "/DefaultCMYK", "/DefaultGray"].includes(
					tokenName(alias),
				)
			)
				throw new TypeError(
					"Default color space replacements require explicit normalization and are unsupported",
				)
		const retainedColors = entries(colors).filter(
			([, value]) => readSpace(value, resources).kind === "spot",
		)
		const retainedXObjects = new Map<string, PdfValue>()
		const retainedStates = entries(
			dict(dictionaryValue(resources, "ExtGState")),
		).map(([alias, value]): [string, PdfValue] => {
			const original = dict(value)
			return [
				alias,
				options.objectIntents === "override" &&
				field(original, "RI") !== undefined
					? replaceEntries(original, {
							RI: name(pdfIntent(options.renderingIntent)),
						})
					: value,
			]
		})
		let state = { ...initial }
		const stack: State[] = [],
			commands: string[] = []
		const resource = (category: string, key: string) => {
			const value = entries(dict(dictionaryValue(resources, category))).find(
				([alias]) => tokenName(alias) === tokenName(key),
			)?.[1]
			if (value === undefined)
				throw new TypeError(`Missing ${category} resource ${key}`)
			return value
		}
		for (const instruction of parsePlateContent(source)) {
			let { op, operands } = instruction
			if (
				["cs", "CS", "gs", "Do", "ri", "Tr"].includes(op) &&
				operands.length !== 1
			)
				throw new TypeError(`Operator ${op} requires exactly one operand`)
			if (op === "q") stack.push({ ...state })
			else if (op === "Q") {
				const prior = stack.pop()
				if (!prior) throw new TypeError("Unbalanced Q")
				state = prior
			} else if (op === "ri") {
				state.intent = selectedIntent(
					nameBytes(nameTokenBytes(operands[0]!)),
					state.intent,
				)
				operands = [`/${pdfIntent(state.intent)}`]
			} else if (op === "gs") {
				const gs = dict(resource("ExtGState", operands[0]!))
				state.intent = selectedIntent(dictionaryValue(gs, "RI"), state.intent)
			} else if (["cs", "CS"].includes(op)) {
				const alias = tokenName(operands[0]),
					channel = op === "cs" ? "fill" : "stroke"
				const color = ["/DeviceRGB", "/DeviceGray", "/DeviceCMYK"].includes(
					alias,
				)
					? name(alias.slice(1))
					: resource("ColorSpace", alias)
				const space = readSpace(color, resources)
				state[channel] = space.kind === "spot" ? { kind: "spot", alias } : space
				state[channel === "fill" ? "implicitFill" : "implicitStroke"] = false
				if (space.kind !== "spot") {
					const count = space.kind === "rgb" ? 3 : space.kind === "gray" ? 1 : 4
					const defaults = new Uint8Array(count)
					if (space.kind === "cmyk") defaults[3] = 255
					const data = await convert(defaults, space, state.intent, location)
					op = channel === "stroke" ? "K" : "k"
					operands = [...data].map((v) => formatPdfNumber(v / 255))
				}
			} else if (
				["rg", "RG", "g", "G", "k", "K", "sc", "SC", "scn", "SCN"].includes(op)
			) {
				const stroke = op === op.toUpperCase(),
					channel = stroke ? "stroke" : "fill",
					lower = op.toLowerCase()
				if (lower === "rg") state[channel] = { kind: "rgb" }
				if (lower === "g") state[channel] = { kind: "gray" }
				if (lower === "k") state[channel] = { kind: "cmyk" }
				state[channel === "fill" ? "implicitFill" : "implicitStroke"] = false
				const space = state[channel]
				if (space.kind !== "spot") {
					const count =
							space.kind === "rgb" ? 3 : space.kind === "gray" ? 1 : 4,
						values = operands.map(Number)
					if (
						values.length !== count ||
						values.some((v) => !Number.isFinite(v) || v < 0 || v > 1)
					)
						throw new TypeError("Invalid normalized print color components")
					if (
						space.kind === "cmyk" &&
						options.processNumbers === "preserve" &&
						(space.profile === undefined ||
							(space.profile instanceof Uint8Array &&
								sameBytes(space.profile, options.destinationProfile)))
					) {
						if (
							space.profile === undefined &&
							declaredProcessProfile !== undefined &&
							!sameBytes(declaredProcessProfile, options.destinationProfile)
						)
							throw new TypeError(
								"Declared CMYK output profile differs from the destination; select explicit process retargeting",
							)
						conversions.push({
							location,
							source: sourceKey({
								...space,
								...(space.profile === undefined &&
								declaredProcessProfile !== undefined
									? { profile: declaredProcessProfile }
									: {}),
							}),
							action: "preserve-process",
							renderingIntent: state.intent,
						})
						op = stroke ? "K" : "k"
					} else if (space.kind === "gray" && options.gray === "black-only") {
						op = stroke ? "K" : "k"
						operands = ["0", "0", "0", formatPdfNumber(1 - values[0]!)]
						conversions.push({
							location,
							source: sourceKey(space),
							action: "gray-to-black",
							renderingIntent: state.intent,
						})
					} else if (
						space.kind === "cmyk" &&
						values[0] === 0 &&
						values[1] === 0 &&
						values[2] === 0 &&
						typeof options.processNumbers === "object"
					) {
						op = stroke ? "K" : "k"
					} else {
						const data = await convert(
							Uint8Array.from(values, (v) => Math.round(v * 255)),
							space,
							state.intent,
							location,
						)
						op = stroke ? "K" : "k"
						operands = [...data].map((v) => formatPdfNumber(v / 255))
					}
				}
			} else if (op === "Do") {
				const alias = tokenName(operands[0]),
					value = resolve(resource("XObject", alias))
				if (
					value === null ||
					typeof value !== "object" ||
					value.kind !== "stream"
				)
					throw new TypeError(`XObject ${alias} must be a stream`)
				const subtype = pdfName(field(value, "Subtype"))
				let result: PdfReference
				if (subtype === "/Image") {
					try {
						result = await normalizeImage(
							value,
							resources,
							state,
							`${location}, image ${alias}`,
						)
					} catch (error) {
						throw new TypeError(
							`Image ${alias}: ${error instanceof Error ? error.message : String(error)}`,
							{ cause: error },
						)
					}
				} else if (subtype === "/Form") {
					if (activeForms.has(value) || activeForms.size > 50)
						throw new TypeError("Cyclic or excessively nested Form")
					if (
						field(value, "Group") !== undefined ||
						field(value, "OC") !== undefined ||
						field(value, "Ref") !== undefined
					)
						throw new TypeError(
							"Form transparency groups, optional content, and reference XObjects are unsupported",
						)
					activeForms.add(value)
					const nested = await normalizeScope(
						Buffer.from(
							decodedPdfStream(value, resolve, 16 * 1024 * 1024),
						).toString("latin1"),
						field(value, "Resources") === undefined
							? pageResources
							: dict(dictionaryValue(value, "Resources")),
						state,
						`${location}, Form ${alias}`,
						pageResources,
					).catch((error: unknown) => {
						throw new TypeError(
							`${location}, Form ${alias}: ${error instanceof Error ? error.message : String(error)}`,
							{ cause: error },
						)
					})
					activeForms.delete(value)
					const replacement = replaceEntries(value, {
						Resources: nested.resources,
						Filter: undefined,
						DecodeParms: undefined,
					})
					result = add(
						stream(
							replacement.entries,
							nested.data,
							...(replacement.byteEntries ?? []),
						),
					)
				} else throw new TypeError(`Unsupported XObject ${alias} subtype`)
				const newAlias = `/PrintX${retainedXObjects.size}`
				retainedXObjects.set(newAlias, result)
				operands = [newAlias]
			}
			if (op === "Tr") {
				const mode = Number(operands[0])
				if (!Number.isInteger(mode) || mode < 0 || mode > 7)
					throw new TypeError("Invalid text rendering mode")
				state.textMode = mode as TextMode
			}
			const painting =
				pathPainting.get(op) ??
				(["Tj", "TJ", "'", '"'].includes(op) && textHasGlyphs(instruction)
					? textPainting(state.textMode)
					: undefined)
			if (painting)
				for (const channel of ["fill", "stroke"] as const)
					if (
						painting[channel] &&
						state[channel === "fill" ? "implicitFill" : "implicitStroke"]
					) {
						const data = await convert(
							Uint8Array.of(0),
							{ kind: "gray" },
							state.intent,
							`${location}, implicit ${channel}`,
						)
						commands.push(
							`${[...data].map((v) => formatPdfNumber(v / 255)).join(" ")} ${channel === "fill" ? "k" : "K"}`,
						)
						state[channel === "fill" ? "implicitFill" : "implicitStroke"] =
							false
					}
			commands.push(`${operands.join(" ")} ${op}`)
		}
		if (stack.length) throw new TypeError("Unbalanced q")
		const table = (items: Iterable<readonly [string, PdfValue]>) =>
			dictionary(
				{},
				...[...items].map(
					([key, value]) =>
						[nameBytes(nameTokenBytes(tokenName(key))), value] as const,
				),
			)
		return {
			data: Buffer.from(commands.join("\n") + "\n", "latin1"),
			resources: replaceEntries(resources, {
				ColorSpace: retainedColors.length ? table(retainedColors) : undefined,
				XObject: retainedXObjects.size ? table(retainedXObjects) : undefined,
				ExtGState: retainedStates.length ? table(retainedStates) : undefined,
			}),
		}
	}
	let pageNumber = 0
	const visit = async (
		ref: PdfReference,
		inherited: PdfDictionary,
	): Promise<void> => {
		const node = dict(ref),
			location = `Page ${pageNumber + 1}, object ${ref.objectNumber} ${ref.generation}`
		if (activePages.has(node) || activePages.size > 100)
			throw new TypeError("Cyclic or excessively nested page tree")
		activePages.add(node)
		const resources =
			field(node, "Resources") === undefined
				? inherited
				: dict(dictionaryValue(node, "Resources"))
		if (pdfName(field(node, "Type")) === "/Pages") {
			const kids = field(node, "Kids")
			if (kids === null || typeof kids !== "object" || kids.kind !== "array")
				throw new TypeError("Expected page tree Kids")
			for (const child of kids.items) {
				if (
					child === null ||
					typeof child !== "object" ||
					child.kind !== "reference"
				)
					throw new TypeError("Expected page reference")
				await visit(child, resources)
			}
			const index = indices.get(`${ref.objectNumber}:${ref.generation}`)!
			objects[index] = {
				...objects[index]!,
				value: replaceEntries(node, { Resources: undefined }),
			}
		} else {
			pageNumber++
			try {
				const group = field(node, "Group")
				if (group !== undefined) {
					const g = dict(group)
					if (
						pdfName(field(g, "S")) !== "/Transparency" ||
						(field(g, "K") !== undefined && field(g, "K") !== false) ||
						(field(g, "I") !== undefined && typeof field(g, "I") !== "boolean")
					)
						throw new TypeError("Unsupported page transparency group flags")
					const cs = dictionaryValue(g, "CS")
					if (cs === undefined)
						throw new TypeError(
							"Page group requires an explicit blending color space",
						)
					const space = readSpace(cs, resources)
					if (space.kind !== "rgb" && space.kind !== "cmyk")
						throw new TypeError("Unsupported page blending color space")
					if (
						space.kind === "cmyk" &&
						space.profile instanceof Uint8Array &&
						!sameBytes(space.profile, options.destinationProfile) &&
						(options.blending === "preserve-source" ||
							options.processNumbers === "preserve")
					)
						throw new TypeError(
							"CMYK blending profile differs from the destination; select process retargeting and destination blending",
						)
					if (space.kind === "rgb" && options.blending === "preserve-source")
						throw new TypeError(
							"RGB source blending cannot be preserved by per-object CMYK conversion; select destination blending deliberately, or prepare this compositing externally",
						)
					if (
						space.kind === "rgb" &&
						space.profile === undefined &&
						options.untaggedRgb === "reject"
					)
						throw new TypeError(
							"Untagged RGB blending requires caller source interpretation",
						)
					groups.push({
						location,
						source: sourceKey(space),
						destination: "DeviceCMYK",
					})
				}
				const contents = field(node, "Contents"),
					parts =
						contents !== null &&
						typeof contents === "object" &&
						contents.kind === "array"
							? contents.items
							: contents === undefined
								? []
								: [contents]
				const source = parts
					.map((part) => {
						const value = resolve(part)
						if (
							value === null ||
							typeof value !== "object" ||
							value.kind !== "stream"
						)
							throw new TypeError("Expected page content stream")
						return Buffer.from(
							decodedPdfStream(value, resolve, 16 * 1024 * 1024),
						).toString("latin1")
					})
					.join("\n")
				const normalized = await normalizeScope(
					source,
					resources,
					{
						fill: { kind: "gray" },
						stroke: { kind: "gray" },
						intent: options.renderingIntent,
						implicitFill: true,
						implicitStroke: true,
						textMode: 0,
					},
					location,
				)
				objects[indices.get(`${ref.objectNumber}:${ref.generation}`)!] = {
					...objects[indices.get(`${ref.objectNumber}:${ref.generation}`)!]!,
					value: replaceEntries(node, {
						Resources: normalized.resources,
						OutputIntents: undefined,
						Contents: add(stream({}, normalized.data)),
						Group: dictionary({
							S: name("Transparency"),
							CS: name("DeviceCMYK"),
							I: true,
							K: false,
						}),
					}),
				}
			} catch (error) {
				throw new TypeError(
					`${location}: ${error instanceof Error ? error.message : String(error)}`,
					{ cause: error },
				)
			}
		}
		activePages.delete(node)
	}
	const catalog = dict(document.root),
		rootPages = dictionaryValue(catalog, "Pages")
	if (
		rootPages === null ||
		typeof rootPages !== "object" ||
		rootPages.kind !== "reference"
	)
		throw new TypeError("Expected page tree reference")
	await visit(rootPages, dictionary({}))
	const output = add(
		dictionary({
			Type: name("OutputIntent"),
			S: name("GTS_PDFX"),
			OutputConditionIdentifier: textString(options.outputCondition),
			DestOutputProfile: add(
				stream(
					{ N: 4, Filter: name("FlateDecode") },
					zlibSync(options.destinationProfile),
				),
			),
		}),
	)
	const rootIndex = indices.get(
		`${document.root.objectNumber}:${document.root.generation}`,
	)!
	objects[rootIndex] = {
		...objects[rootIndex]!,
		value: replaceEntries(catalog, { OutputIntents: array(output) }),
	}
	const result: PdfDocument = {
		...document,
		version: Number(document.version) < 1.4 ? "1.4" : document.version,
		objects: reachableObjects(document, objects),
	}
	throwForPdfErrors(validatePdf(result))
	planPdfPlates(result, new Set(["cmyk", "spot"]))
	return {
		document: result,
		report: {
			destinationProfileSha256: hash(options.destinationProfile),
			outputCondition: options.outputCondition,
			objectIntents: options.objectIntents,
			blackPointCompensation: options.blackPointCompensation,
			blending: options.blending,
			groups,
			conversions,
		},
	}
}
