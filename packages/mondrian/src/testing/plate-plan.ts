// SPDX-License-Identifier: MPL-2.0

import { unzlibSync } from "fflate"
import { dictionaryValue } from "../dictionary-lookup.ts"
import type {
	PdfDictionary,
	PdfDocument,
	PdfIndirectValue,
	PdfReference,
	PdfStream,
	PdfValue,
} from "../objects.ts"
import { dictionary } from "../objects.ts"
import { encodePdfName, encodePdfNameBytes } from "../syntax.ts"
import { parsePlateContent } from "./plate-content.ts"
import type { ContentInstruction } from "./plate-content.ts"

export type PlateColorSpace = "cmyk" | "spot"

export interface PlateInk {
	readonly name: string
	readonly colorSpace: PlateColorSpace
	readonly component?: number
}

interface Color {
	readonly space: PlateColorSpace
	readonly components: readonly number[]
	readonly definition?: PdfValue
	readonly name?: string
}

export interface PlatePaint {
	readonly color: Color
	readonly overprint: boolean
	readonly mode: number
}

interface State {
	fill: Color | undefined
	stroke: Color | undefined
	fillOverprint: boolean
	strokeOverprint: boolean
	fillOpacity: number
	strokeOpacity: number
	mode: number
	textMode: number
}

export interface PlateInstruction extends ContentInstruction {
	readonly fill?: PlatePaint
	readonly stroke?: PlatePaint
	readonly textMode?: number
	readonly form?: PlateScope
}

export interface PlateScope {
	readonly resources: PdfDictionary
	readonly states: ReadonlyMap<string, PdfDictionary>
	readonly instructions: readonly PlateInstruction[]
	readonly source?: PdfStream
}

export interface PlatePage {
	readonly reference: PdfReference
	readonly source: PdfDictionary
	readonly scope: PlateScope
}

const processNames = ["Cyan", "Magenta", "Yellow", "Black"] as const
const passthrough = new Set(
	"cm w J j M d ri i m l c v y h re n W W* BT ET Tc Tw Tz TL Td TD Tm T* Ts BMC EMC MP".split(
		" ",
	),
)
const pathPaints = new Set("S s f F f* B B* b b*".split(" "))
const textPaints = new Set(["Tj", "TJ", "'", '"'])

export function pdfName(
	value: PdfIndirectValue | undefined,
): string | undefined {
	if (value !== null && typeof value === "object") {
		if (value.kind === "name") return encodePdfName(value.value)
		if (value.kind === "byte-name") return encodePdfNameBytes(value.bytes)
	}
	return undefined
}

function tokenName(value: string | undefined): string {
	if (!value?.startsWith("/"))
		throw new TypeError("Expected a PDF resource name")
	return encodePdfNameBytes(
		Buffer.from(
			value
				.slice(1)
				.replace(/#([\da-f]{2})/giu, (_, hex: string) =>
					String.fromCharCode(Number.parseInt(hex, 16)),
				),
			"latin1",
		),
	)
}

function dictionaryItems(
	value: Pick<PdfDictionary, "entries" | "byteEntries">,
): [string, PdfValue][] {
	return [
		...Object.entries(value.entries)
			.filter((entry): entry is [string, PdfValue] => entry[1] !== undefined)
			.map(([key, item]): [string, PdfValue] => [encodePdfName(key), item]),
		...(value.byteEntries ?? []).map(([key, item]): [string, PdfValue] => [
			pdfName(key)!,
			item,
		]),
	]
}

/** Discover and validate the complete painting program before producing any copies. */
export function planPdfPlates(
	document: PdfDocument,
	permitted: ReadonlySet<PlateColorSpace>,
): { plates: PlateInk[]; pages: PlatePage[] } {
	const objects = new Map(
		document.objects.map((object) => [
			`${object.objectNumber}:${object.generation}`,
			object.value,
		]),
	)
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
			const next = objects.get(key)
			if (next !== null && typeof next === "object" && next.kind === "stream")
				return next
			value = next
		}
		return value
	}
	const dict = (value: PdfValue | undefined): PdfDictionary => {
		const resolved = resolve(value)
		if (resolved === undefined) return dictionary({})
		if (
			resolved === null ||
			typeof resolved !== "object" ||
			resolved.kind !== "dictionary"
		)
			throw new TypeError("Expected a PDF resource dictionary")
		return resolved
	}
	const resource = (
		resources: PdfDictionary,
		category: string,
		key: string,
	): PdfValue => {
		const entries = dictionaryItems(dict(dictionaryValue(resources, category)))
		const value = entries.find(([name]) => name === tokenName(key))?.[1]
		if (value === undefined)
			throw new TypeError(`Missing ${category} resource ${key}`)
		return value
	}
	const plates: PlateInk[] = permitted.has("cmyk")
		? processNames.map((name, component) => ({
				name,
				colorSpace: "cmyk",
				component,
			}))
		: []
	const spots = new Map<string, string>()
	const canonical = (value: PdfValue | undefined, depth = 0): unknown => {
		if (depth > 50)
			throw new TypeError("Cyclic or excessively nested spot definition")
		const resolved = resolve(value)
		if (resolved === null || typeof resolved !== "object") return resolved
		if (pdfName(resolved) !== undefined) return pdfName(resolved)
		if (resolved.kind === "array")
			return resolved.items.map((item) => canonical(item, depth + 1))
		if (resolved.kind === "dictionary" || resolved.kind === "stream") {
			const entries = dictionaryItems(resolved)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([key, item]) => [key, canonical(item, depth + 1)])
			return resolved.kind === "stream"
				? { entries, data: Array.from(resolved.data) }
				: entries
		}
		return resolved
	}
	const colorSpace = (value: PdfValue): Color => {
		const resolved = resolve(value)
		const named = pdfName(resolved)
		if (named === "/DeviceCMYK") {
			if (!permitted.has("cmyk"))
				throw new TypeError("Color space DeviceCMYK is not permitted")
			return { space: "cmyk", components: [0, 0, 0, 1] }
		}
		if (
			resolved !== null &&
			typeof resolved === "object" &&
			resolved.kind === "array" &&
			pdfName(resolve(resolved.items[0])) === "/Separation"
		) {
			if (!permitted.has("spot"))
				throw new TypeError("Color space Separation (spot) is not permitted")
			const inkName = pdfName(resolve(resolved.items[1]))
			if (
				resolved.items.length !== 4 ||
				!inkName ||
				["/All", "/None", ...processNames.map((name) => `/${name}`)].includes(
					inkName,
				)
			)
				throw new TypeError(
					"Plate previews require an ordinary named Separation ink",
				)
			const name = inkName
				.slice(1)
				.replace(/#([\da-f]{2})/giu, (_, hex: string) =>
					String.fromCharCode(Number.parseInt(hex, 16)),
				)
			const definition = JSON.stringify(canonical(value))
			if (spots.has(name) && spots.get(name) !== definition)
				throw new TypeError(`Conflicting definitions for separation ${name}`)
			if (!spots.has(name)) {
				spots.set(name, definition)
				plates.push({ name, colorSpace: "spot" })
			}
			return {
				space: "spot",
				name,
				definition: value,
				components: [1],
			}
		}
		throw new TypeError(
			`Color space ${named?.slice(1) ?? "other than DeviceCMYK or Separation"} is not permitted for plate previews`,
		)
	}
	const readStream = (value: PdfStream): string => {
		let bytes = value.data
		const filter = resolve(dictionaryValue(value, "Filter"))
		if (filter !== undefined) {
			const filters =
				filter !== null && typeof filter === "object" && filter.kind === "array"
					? filter.items
					: [filter]
			if (
				filters.length !== 1 ||
				pdfName(resolve(filters[0])) !== "/FlateDecode" ||
				dictionaryValue(value, "DecodeParms") !== undefined
			)
				throw new TypeError(
					"Plate content supports only unfiltered or FlateDecode streams without DecodeParms",
				)
			bytes = unzlibSync(bytes)
		}
		return Buffer.from(bytes).toString("latin1")
	}
	const initialState = (): State => ({
		fill: undefined,
		stroke: undefined,
		fillOverprint: false,
		strokeOverprint: false,
		fillOpacity: 1,
		strokeOpacity: 1,
		mode: 0,
		textMode: 0,
	})
	const activeForms = new Set<PdfStream>()
	const formPlans = new WeakMap<
		PdfStream,
		WeakMap<PdfDictionary, Map<string, PlateScope>>
	>()
	const scope = (
		source: string,
		resources: PdfDictionary,
		pageResources: PdfDictionary,
		initial: State,
		location: string,
		form?: PdfStream,
	): PlateScope => {
		try {
			for (const [alias, value] of dictionaryItems(
				dict(dictionaryValue(resources, "ColorSpace")),
			)) {
				if (["/DefaultCMYK", "/DefaultRGB", "/DefaultGray"].includes(alias))
					throw new TypeError(
						"Default color space replacements are unsupported",
					)
				colorSpace(value)
			}
			let state = { ...initial }
			const stack: State[] = []
			const states = new Map<string, PdfDictionary>()
			const instructions: PlateInstruction[] = []
			const paint = (channel: "fill" | "stroke"): PlatePaint => {
				const color = state[channel]
				if (color === undefined)
					throw new TypeError(
						`Implicit DeviceGray ${channel} is not permitted; set an explicit CMYK or spot color before painting`,
					)
				return {
					color,
					overprint:
						state[channel === "fill" ? "fillOverprint" : "strokeOverprint"],
					mode: state.mode,
				}
			}
			for (const instruction of parsePlateContent(source)) {
				const { op, operands } = instruction
				if (op === "q") {
					stack.push({ ...state })
				} else if (op === "Q") {
					const previous = stack.pop()
					if (!previous) throw new TypeError("Unbalanced Q in plate content")
					state = previous
				} else if (
					[
						"k",
						"K",
						"rg",
						"RG",
						"g",
						"G",
						"cs",
						"CS",
						"sc",
						"SC",
						"scn",
						"SCN",
					].includes(op)
				) {
					const channel = op === op.toLowerCase() ? "fill" : "stroke"
					if (["g", "G", "rg", "RG"].includes(op))
						throw new TypeError(
							`Color space ${op.toLowerCase() === "g" ? "DeviceGray" : "DeviceRGB"} is not permitted for plate previews`,
						)
					if (op.toLowerCase() === "cs") {
						const alias = tokenName(operands[0])
						state[channel] = colorSpace(
							["/DeviceCMYK", "/DeviceRGB", "/DeviceGray", "/Pattern"].includes(
								alias,
							)
								? { kind: "name", value: alias.slice(1) }
								: resource(resources, "ColorSpace", alias),
						)
					} else {
						const color =
							op.toLowerCase() === "k"
								? colorSpace({ kind: "name", value: "DeviceCMYK" })
								: state[channel]
						if (!color)
							throw new TypeError("Implicit DeviceGray color is not permitted")
						const components = operands.map(Number)
						if (
							components.length !== (color.space === "cmyk" ? 4 : 1) ||
							components.some(
								(value) => !Number.isFinite(value) || value < 0 || value > 1,
							)
						)
							throw new TypeError("Invalid plate color components")
						state[channel] = { ...color, components }
					}
					continue
				} else if (op === "gs") {
					const key = tokenName(operands[0])
					const value = dict(resource(resources, "ExtGState", key))
					const allowed = new Set(
						"Type OP op OPM ca CA BM SMask LW LC LJ ML D RI FL SA TK".split(
							" ",
						),
					)
					for (const [entry] of dictionaryItems(value))
						if (!allowed.has(entry.slice(1)))
							throw new TypeError(
								`Unsupported plate graphics state setting ${entry}`,
							)
					const get = (key: string) => resolve(dictionaryValue(value, key))
					for (const key of ["OP", "op"])
						if (get(key) !== undefined && typeof get(key) !== "boolean")
							throw new TypeError(`Invalid ${key} overprint flag`)
					if (get("OP") !== undefined) {
						state.strokeOverprint = get("OP") as boolean
						state.fillOverprint = state.strokeOverprint
					}
					if (get("op") !== undefined)
						state.fillOverprint = get("op") as boolean
					if (get("OPM") !== undefined) {
						if (get("OPM") !== 0 && get("OPM") !== 1)
							throw new TypeError("Invalid overprint mode")
						state.mode = get("OPM") as number
					}
					for (const key of ["ca", "CA"]) {
						const alpha = get(key)
						if (
							alpha !== undefined &&
							(typeof alpha !== "number" ||
								!Number.isFinite(alpha) ||
								alpha < 0 ||
								alpha > 1)
						)
							throw new TypeError(`Invalid ${key} opacity`)
						if (typeof alpha === "number")
							state[key === "ca" ? "fillOpacity" : "strokeOpacity"] = alpha
					}
					if (get("BM") !== undefined && pdfName(get("BM")) !== "/Normal")
						throw new TypeError("Plate previews support only Normal blending")
					if (get("SMask") !== undefined && pdfName(get("SMask")) !== "/None")
						throw new TypeError("Soft masks are unsupported in plate previews")
					states.set(
						key,
						// Projection already applies overprint; removing all source
						// controls keeps the default knockout state without adding
						// entries requiring a newer PDF version.
						replaceEntries(value, {
							OP: undefined,
							op: undefined,
							OPM: undefined,
						}),
					)
				} else if (op === "Tr") {
					const mode = Number(operands[0])
					if (!Number.isInteger(mode) || mode < 0 || mode > 7)
						throw new TypeError("Invalid text rendering mode")
					state.textMode = mode
					continue
				} else if (op === "Tf") {
					const font = dict(resource(resources, "Font", tokenName(operands[0])))
					if (pdfName(resolve(dictionaryValue(font, "Subtype"))) === "/Type3")
						throw new TypeError("Type3 fonts are unsupported in plate previews")
				} else if (pathPaints.has(op) || textPaints.has(op)) {
					const text = textPaints.has(op)
					const mode = state.textMode % 4
					const fill = text
						? mode === 0 || mode === 2
						: !["S", "s"].includes(op)
					const stroke = text
						? mode === 1 || mode === 2
						: !["f", "F", "f*"].includes(op)
					// PDF 1.6 §7.6.3: unequal alpha makes combined painting an
					// implicit knockout group. Dropping either channel loses shape
					// that can remove the earlier fill, even when it deposits no ink.
					if (fill && stroke && state.fillOpacity !== state.strokeOpacity)
						throw new TypeError(
							"Plate previews do not support combined fill and stroke with unequal opacities (implicit knockout group)",
						)
					instructions.push({
						...instruction,
						...(fill ? { fill: paint("fill") } : {}),
						...(stroke ? { stroke: paint("stroke") } : {}),
						...(text ? { textMode: state.textMode } : {}),
					})
					continue
				} else if (op === "Do") {
					const key = tokenName(operands[0])
					const value = resolve(resource(resources, "XObject", key))
					if (
						value === null ||
						typeof value !== "object" ||
						value.kind !== "stream"
					)
						throw new TypeError("Expected an XObject stream")
					if (pdfName(resolve(dictionaryValue(value, "Subtype"))) !== "/Form") {
						const imageSpace = dictionaryValue(value, "ColorSpace")
						if (imageSpace !== undefined) colorSpace(imageSpace)
						throw new TypeError("Images are unsupported in plate previews")
					}
					if (
						dictionaryValue(value, "Group") !== undefined ||
						dictionaryValue(value, "OC") !== undefined ||
						dictionaryValue(value, "Ref") !== undefined
					)
						throw new TypeError(
							"Transparency groups, optional content, and reference XObjects are unsupported in plate previews",
						)
					if (activeForms.has(value))
						throw new TypeError("Recursive Form XObject in plate content")
					let contexts = formPlans.get(value)
					if (contexts === undefined) {
						contexts = new WeakMap()
						formPlans.set(value, contexts)
					}
					let variants = contexts.get(pageResources)
					if (variants === undefined) {
						variants = new Map()
						contexts.set(pageResources, variants)
					}
					const stateKey = inheritedPaintKey(state)
					let nested = variants.get(stateKey)
					if (nested === undefined) {
						activeForms.add(value)
						const ownResources = dictionaryValue(value, "Resources")
						nested = scope(
							readStream(value),
							// PDF 1.6 §3.7.2: missing Form Resources falls back to the
							// page, even when an enclosing Form has private resources.
							ownResources === undefined ? pageResources : dict(ownResources),
							pageResources,
							state,
							`${location} / XObject ${key}`,
							value,
						)
						activeForms.delete(value)
						variants.set(stateKey, nested)
					}
					instructions.push({ ...instruction, form: nested })
					continue
				} else if (!passthrough.has(op))
					throw new TypeError(`Unsupported plate content operator ${op}`)
				instructions.push(instruction)
			}
			if (stack.length !== 0)
				throw new TypeError("Unbalanced q in plate content")
			return {
				resources,
				states,
				instructions,
				...(form ? { source: form } : {}),
			}
		} catch (error) {
			throw new TypeError(
				`${location}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			)
		}
	}
	const pages: PlatePage[] = []
	const activePages = new Set<PdfIndirectValue>()
	const visit = (ref: PdfReference, inherited: PdfDictionary): void => {
		const node = dict(ref)
		if (activePages.has(node)) throw new TypeError("Cyclic page tree")
		activePages.add(node)
		const ownResources = dictionaryValue(node, "Resources")
		const resources =
			ownResources === undefined ? inherited : dict(ownResources)
		if (pdfName(resolve(dictionaryValue(node, "Type"))) === "/Pages") {
			const kids = resolve(dictionaryValue(node, "Kids"))
			if (kids === null || typeof kids !== "object" || kids.kind !== "array")
				throw new TypeError("Expected page tree Kids")
			for (const child of kids.items) {
				if (
					child === null ||
					typeof child !== "object" ||
					child.kind !== "reference"
				)
					throw new TypeError("Expected a page reference")
				visit(child, resources)
			}
		} else {
			const location = `Page ${pages.length + 1}`
			if (dictionaryValue(node, "Group") !== undefined)
				throw new TypeError(
					`${location}: transparency groups are unsupported in plate previews`,
				)
			const annotations = resolve(dictionaryValue(node, "Annots"))
			if (
				annotations !== undefined &&
				!(
					annotations !== null &&
					typeof annotations === "object" &&
					annotations.kind === "array" &&
					annotations.items.length === 0
				)
			)
				throw new TypeError(
					`${location}: annotations are unsupported in plate previews`,
				)
			const contents = resolve(dictionaryValue(node, "Contents"))
			const streams =
				contents !== null &&
				typeof contents === "object" &&
				contents.kind === "array"
					? contents.items.map(resolve)
					: contents === undefined
						? []
						: [contents]
			const source = streams
				.map((value) => {
					if (
						value === null ||
						typeof value !== "object" ||
						value.kind !== "stream"
					)
						throw new TypeError(`${location}: expected a content stream`)
					return readStream(value)
				})
				.join("\n")
			pages.push({
				reference: ref,
				source: node,
				scope: scope(source, resources, resources, initialState(), location),
			})
		}
		activePages.delete(node)
	}
	const root = dict(document.root)
	const pageTree = dictionaryValue(root, "Pages")
	if (
		pageTree === null ||
		typeof pageTree !== "object" ||
		pageTree.kind !== "reference"
	)
		throw new TypeError("Expected a page tree reference")
	visit(pageTree, dictionary({}))
	return { plates, pages }
}

/** Form resources are fixed by the source and page context; only paint is baked in.
 * Named ink consistency is validated separately, so equivalent references to an
 * ink must not prevent sharing. Geometry and layout remain inherited at render time.
 */
function inheritedPaintKey(state: State): string {
	const colorKey = (color: Color | undefined) =>
		color === undefined ? null : [color.space, color.components, color.name]
	return JSON.stringify({
		...state,
		fill: colorKey(state.fill),
		stroke: colorKey(state.stroke),
	})
}

/** Replace logical keys, including byte-name entries, without duplicate PDF keys. */
export function replaceEntries(
	value: Pick<PdfDictionary, "entries" | "byteEntries">,
	changes: Record<string, PdfValue | undefined>,
): PdfDictionary {
	const entries = { ...value.entries, ...changes }
	const replaced = new Set(Object.keys(changes).map(encodePdfName))
	return dictionary(
		entries,
		...(value.byteEntries ?? []).filter(
			([key]) => !replaced.has(pdfName(key)!),
		),
	)
}
