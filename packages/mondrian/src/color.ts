// SPDX-License-Identifier: MPL-2.0

import type { PdfObjectBuilder } from "./object-builder.ts"
import type {
	PdfDictionary,
	PdfReference,
	PdfValue,
	PdfVersion,
} from "./objects.ts"
import { array, dictionary, name } from "./objects.ts"
import { encodePdfName, formatPdfNumber } from "./syntax.ts"

export type PdfProcessColor =
	| Readonly<{ space: "DeviceGray"; components: readonly [number] }>
	| Readonly<{
			space: "DeviceRGB"
			components: readonly [number, number, number]
	  }>
	| Readonly<{
			space: "DeviceCMYK"
			components: readonly [number, number, number, number]
	  }>

/** One input (tint), with output components in the alternate space. */
export interface PdfTintTransform {
	readonly type: "exponential"
	readonly zero: PdfProcessColor
	readonly full: PdfProcessColor
	readonly exponent: number
}

export interface PdfSpotColor {
	readonly space: "Separation"
	/** Exact, case-sensitive ink identity, without PDF name escaping. */
	readonly name: string
	readonly tintTransform: PdfTintTransform
}

export type PdfColor =
	| PdfProcessColor
	| Readonly<{
			space: "Separation"
			ink: PdfSpotColor
			tint: number
	  }>

/** Complete opaque overlap state. false explicitly requests knockout. */
export interface PdfPaintState {
	readonly fillOverprint: boolean
	readonly strokeOverprint: boolean
	readonly overprintMode: 0 | 1
	readonly fillOpacity?: 1
	readonly strokeOpacity?: 1
	readonly blendMode?: "Normal"
}

export type PdfColorOperation =
	| Readonly<{ op: "fillColor" | "strokeColor"; color: PdfColor }>
	| Readonly<{ op: "paintState"; state: PdfPaintState }>

/** The common painting surface used by text and graphics builders. */
export interface PdfColorBuilder<T> {
	fillColor(color: PdfColor): T
	strokeColor(color: PdfColor): T
	rgbFill(red: number, green: number, blue: number): T
	rgbStroke(red: number, green: number, blue: number): T
	grayFill(gray: number): T
	grayStroke(gray: number): T
	cmykFill(cyan: number, magenta: number, yellow: number, black: number): T
	cmykStroke(cyan: number, magenta: number, yellow: number, black: number): T
	spotFill(ink: PdfSpotColor, tint: number): T
	spotStroke(ink: PdfSpotColor, tint: number): T
	paintState(state: PdfPaintState): T
}

export function rgb(red: number, green: number, blue: number): PdfProcessColor {
	return copyProcess({ space: "DeviceRGB", components: [red, green, blue] })
}

export function gray(value: number): PdfProcessColor {
	return copyProcess({ space: "DeviceGray", components: [value] })
}

export function cmyk(
	cyan: number,
	magenta: number,
	yellow: number,
	black: number,
): PdfProcessColor {
	return copyProcess({
		space: "DeviceCMYK",
		components: [cyan, magenta, yellow, black],
	})
}

export function separation(
	inkName: string,
	tintTransform: PdfTintTransform,
): PdfSpotColor {
	// Special plate names carry different PDF semantics and are not ordinary inks.
	if (
		typeof inkName !== "string" ||
		inkName.length === 0 ||
		/[^\x20-\x7e]/u.test(inkName) ||
		["All", "None", "Cyan", "Magenta", "Yellow", "Black"].includes(inkName)
	) {
		throw new TypeError(
			"A spot ink requires a nonempty printable ASCII name other than All, None, Cyan, Magenta, Yellow, or Black",
		)
	}
	if (tintTransform?.type !== "exponential") {
		throw new TypeError(
			"Only one-input exponential tint transforms are supported",
		)
	}
	assertKeys(
		tintTransform,
		["type", "zero", "full", "exponent"],
		"tint transform",
	)
	const zero = copyProcess(tintTransform.zero)
	const full = copyProcess(tintTransform.full)
	if (zero.space !== full.space) {
		throw new TypeError(
			"Tint transform endpoints must have the same alternate space and output arity",
		)
	}
	if (!Number.isFinite(tintTransform.exponent) || tintTransform.exponent <= 0) {
		throw new RangeError("Tint transform exponent must be finite and positive")
	}
	return Object.freeze({
		space: "Separation",
		name: inkName,
		tintTransform: Object.freeze({
			type: "exponential",
			zero,
			full,
			exponent: tintTransform.exponent,
		}),
	})
}

export function spot(ink: PdfSpotColor, tint: number): PdfColor {
	if (ink?.space !== "Separation")
		throw new TypeError("Expected a Separation ink definition")
	assertKeys(ink, ["space", "name", "tintTransform"], "spot ink")
	component(tint, "spot tint")
	return Object.freeze({
		space: "Separation",
		ink: separation(ink.name, ink.tintTransform),
		tint,
	})
}

export function fillColor(color: PdfColor): PdfColorOperation {
	return Object.freeze({ op: "fillColor", color: copyColor(color) })
}

export function strokeColor(color: PdfColor): PdfColorOperation {
	return Object.freeze({ op: "strokeColor", color: copyColor(color) })
}

export function paintState(
	state: PdfPaintState,
): Extract<PdfColorOperation, { op: "paintState" }> {
	if (state === null || typeof state !== "object")
		throw new TypeError("A PDF paint state is required")
	for (const key of Object.keys(state)) {
		if (
			![
				"fillOverprint",
				"strokeOverprint",
				"overprintMode",
				"fillOpacity",
				"strokeOpacity",
				"blendMode",
			].includes(key)
		) {
			throw new TypeError(`Unsupported PDF paint state setting: ${key}`)
		}
	}
	if (
		typeof state.fillOverprint !== "boolean" ||
		typeof state.strokeOverprint !== "boolean" ||
		![0, 1].includes(state.overprintMode)
	) {
		throw new TypeError(
			"Paint state requires fill/stroke overprint booleans and overprint mode 0 or 1",
		)
	}
	if (
		(state.fillOpacity !== undefined && state.fillOpacity !== 1) ||
		(state.strokeOpacity !== undefined && state.strokeOpacity !== 1) ||
		(state.blendMode !== undefined && state.blendMode !== "Normal")
	) {
		throw new TypeError(
			"Only opaque paint with Normal blending is supported; tint is not opacity",
		)
	}
	return Object.freeze({
		op: "paintState",
		state: Object.freeze({
			fillOverprint: state.fillOverprint,
			strokeOverprint: state.strokeOverprint,
			overprintMode: state.overprintMode,
			fillOpacity: 1,
			strokeOpacity: 1,
			blendMode: "Normal",
		}),
	})
}

function component(value: number, label: string): void {
	if (!Number.isFinite(value))
		throw new TypeError(`PDF ${label} must be finite`)
	if (value < 0 || value > 1)
		throw new RangeError(`PDF ${label} must be from 0 through 1`)
}

function copyProcess(color: PdfProcessColor): PdfProcessColor {
	assertKeys(color, ["space", "components"], "process color")
	const count = { DeviceGray: 1, DeviceRGB: 3, DeviceCMYK: 4 }[color?.space]
	if (
		count === undefined ||
		!Array.isArray(color.components) ||
		color.components.length !== count
	) {
		throw new TypeError(
			"A process color requires DeviceGray/RGB/CMYK with exactly 1/3/4 normalized components",
		)
	}
	for (const value of color.components)
		component(value, `${color.space.slice(6)} components`)
	return Object.freeze({
		space: color.space,
		components: Object.freeze([...color.components]),
	}) as PdfProcessColor
}

function copyColor(color: PdfColor): PdfColor {
	if (color?.space === "Separation")
		assertKeys(color, ["space", "ink", "tint"], "spot paint")
	return color?.space === "Separation"
		? spot(color.ink, color.tint)
		: copyProcess(color)
}

export function colorBuilder<T>(
	use: () => void,
	push: (operation: PdfColorOperation) => void,
	result: () => T,
): PdfColorBuilder<T> {
	const emit = (operation: PdfColorOperation): T => {
		use()
		push(operation)
		return result()
	}
	return {
		fillColor: (color) => emit(fillColor(color)),
		strokeColor: (color) => emit(strokeColor(color)),
		rgbFill: (r, g, b) => emit(fillColor(rgb(r, g, b))),
		rgbStroke: (r, g, b) => emit(strokeColor(rgb(r, g, b))),
		grayFill: (g) => emit(fillColor(gray(g))),
		grayStroke: (g) => emit(strokeColor(gray(g))),
		cmykFill: (c, m, y, k) => emit(fillColor(cmyk(c, m, y, k))),
		cmykStroke: (c, m, y, k) => emit(strokeColor(cmyk(c, m, y, k))),
		spotFill: (ink, tint) => emit(fillColor(spot(ink, tint))),
		spotStroke: (ink, tint) => emit(strokeColor(spot(ink, tint))),
		paintState: (state) => emit(paintState(state)),
	}
}

interface Registry {
	readonly inks: Map<string, { key: string; ref: PdfReference }>
	readonly states: Map<string, PdfReference>
	minimumVersion: number
}
const registries = new WeakMap<PdfObjectBuilder, Registry>()

function registry(objects: PdfObjectBuilder): Registry {
	let value = registries.get(objects)
	if (value === undefined) {
		value = { inks: new Map(), states: new Map(), minimumVersion: 1 }
		registries.set(objects, value)
	}
	return value
}

/** Validate an entire binding before resource allocation or registry mutation. */
export function preflightColors(
	objects: PdfObjectBuilder,
	operations: readonly PdfColorOperation[],
): void {
	const definitions = new Map(
		[...registry(objects).inks].map(([inkName, value]) => [inkName, value.key]),
	)
	for (const operation of operations) {
		if (operation.op === "paintState" || operation.color.space !== "Separation")
			continue
		const ink = operation.color.ink
		const key = JSON.stringify(ink)
		const existing = definitions.get(ink.name)
		if (existing !== undefined && existing !== key)
			throw new TypeError(`Conflicting definitions for separation ${ink.name}`)
		definitions.set(ink.name, key)
	}
}

export function validateColorVersion(
	objects: PdfObjectBuilder,
	version: PdfVersion,
): void {
	const minimum = registries.get(objects)?.minimumVersion ?? 1
	if (Number(version) < minimum)
		throw new TypeError(
			`Authored PDF color resources require PDF ${minimum} or later`,
		)
}

/** One page/stream resource scope; ink consistency and references are document-wide. */
export class ColorScope {
	readonly #objects: PdfObjectBuilder
	readonly #inks = new Map<string, string>()
	readonly #states = new Map<string, string>()
	readonly #colorSpaces: Record<string, PdfValue> = Object.create(null)
	readonly #graphicsStates: Record<string, PdfValue> = Object.create(null)

	constructor(objects: PdfObjectBuilder) {
		this.#objects = objects
	}

	encode(operation: PdfColorOperation): string {
		if (operation.op === "paintState") {
			const validated = paintState(operation.state)
			const state = validated.state
			const key = JSON.stringify(state)
			const resources = registry(this.#objects)
			resources.minimumVersion = Math.max(resources.minimumVersion, 1.4)
			let ref = resources.states.get(key)
			if (ref === undefined) {
				ref = this.#objects.add(
					dictionary({
						Type: name("ExtGState"),
						op: state.fillOverprint,
						OP: state.strokeOverprint,
						OPM: state.overprintMode,
						ca: 1,
						CA: 1,
						BM: name("Normal"),
						SMask: name("None"),
					}),
				)
				resources.states.set(key, ref)
			}
			let resourceName = this.#states.get(key)
			if (resourceName === undefined) {
				resourceName = `GS${this.#states.size}`
				this.#states.set(key, resourceName)
				this.#graphicsStates[resourceName] = ref
			}
			return `${encodePdfName(resourceName)} gs\n`
		}
		const color = copyColor(operation.color)
		const stroke = operation.op === "strokeColor"
		if (color.space !== "Separation") {
			const operator = { DeviceGray: "g", DeviceRGB: "rg", DeviceCMYK: "k" }[
				color.space
			]
			return `${color.components.map(formatPdfNumber).join(" ")} ${stroke ? operator.toUpperCase() : operator}\n`
		}
		const ink = color.ink
		const key = JSON.stringify(ink)
		const resources = registry(this.#objects)
		const existing = resources.inks.get(ink.name)
		if (existing !== undefined && existing.key !== key)
			throw new TypeError(`Conflicting definitions for separation ${ink.name}`)
		resources.minimumVersion = Math.max(resources.minimumVersion, 1.3)
		let ref = existing?.ref
		if (ref === undefined) {
			const { zero, full, exponent } = ink.tintTransform
			const fn = dictionary({
				FunctionType: 2,
				Domain: array(0, 1),
				Range: array(...zero.components.flatMap(() => [0, 1])),
				C0: array(...zero.components),
				C1: array(...full.components),
				N: exponent,
			})
			ref = this.#objects.add(
				array(name("Separation"), name(ink.name), name(zero.space), fn),
			)
			resources.inks.set(ink.name, { key, ref })
		}
		let resourceName = this.#inks.get(ink.name)
		if (resourceName === undefined) {
			resourceName = `CS${this.#inks.size}`
			this.#inks.set(ink.name, resourceName)
			this.#colorSpaces[resourceName] = ref
		}
		return `${encodePdfName(resourceName)} ${stroke ? "CS" : "cs"}\n${formatPdfNumber(color.tint)} ${stroke ? "SCN" : "scn"}\n`
	}

	resources(): PdfDictionary {
		return dictionary({
			...(this.#inks.size === 0
				? {}
				: { ColorSpace: dictionary(this.#colorSpaces) }),
			...(this.#states.size === 0
				? {}
				: { ExtGState: dictionary(this.#graphicsStates) }),
		})
	}
}

function assertKeys(
	value: object,
	keys: readonly string[],
	label: string,
): void {
	if (value === null || typeof value !== "object")
		throw new TypeError(`A PDF ${label} is required`)
	for (const key of Object.keys(value)) {
		if (!keys.includes(key))
			throw new TypeError(`Unsupported PDF ${label} setting: ${key}`)
	}
}
