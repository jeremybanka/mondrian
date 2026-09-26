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
import { dictionary, name } from "../objects.ts"
import { encodePdfName } from "../syntax.ts"
import { pdfName, tokenName, displayName } from "./plate-names.ts"
import { parsePlateContent, textHasGlyphs } from "./plate-content.ts"
import type { ContentInstruction } from "./plate-content.ts"
import { pathPainting, textPainting } from "./plate-paint.ts"
import type { PathShape, TextMode } from "./plate-paint.ts"

export type PlateColorSpace = "cmyk" | "spot"

type CmykComponent = 0 | 1 | 2 | 3
type CmykComponents = readonly [number, number, number, number]
type SpotComponents = readonly [number]

export type PlateInk =
	| {
			readonly name: string
			readonly colorSpace: "cmyk"
			readonly component: CmykComponent
	  }
	| {
			readonly name: string
			readonly colorSpace: "spot"
			/** Canonical PDF name token; identity is byte-based, independent of display. */
			readonly ink: string
	  }

type Color =
	| { readonly space: "cmyk"; readonly components: CmykComponents }
	| {
			readonly space: "spot"
			readonly components: SpotComponents
			readonly definition: PdfValue
			readonly ink: string
	  }

export interface PlatePaint {
	readonly color: Color
	readonly overprint: boolean
	readonly mode: 0 | 1
}

interface State {
	fill: Color | undefined
	stroke: Color | undefined
	fillOverprint: boolean
	strokeOverprint: boolean
	fillOpacity: number
	strokeOpacity: number
	mode: 0 | 1
	textMode: TextMode
	textKnockout: boolean
}

type PathPaint =
	| { readonly fill: PlatePaint; readonly stroke: PlatePaint | undefined }
	| { readonly fill: undefined; readonly stroke: PlatePaint }

export type PlateInstruction =
	| (ContentInstruction & { readonly kind: "raw" })
	| ({ readonly kind: "path" } & PathShape & PathPaint)
	| (ContentInstruction & {
			readonly kind: "text"
			readonly fill: PlatePaint | undefined
			readonly stroke: PlatePaint | undefined
			readonly clip: boolean
	  })
	| { readonly kind: "form"; readonly form: PlateForm }

export interface PlateScope {
	readonly resources: PdfDictionary
	readonly states: ReadonlyMap<string, PdfDictionary>
	readonly instructions: readonly PlateInstruction[]
}

export interface PlateForm extends PlateScope {
	readonly source: PdfStream
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
const textPaints = new Set(["Tj", "TJ", "'", '"'])
const standardBlendModes = new Set(
	"Normal Compatible Multiply Screen Overlay Darken Lighten ColorDodge ColorBurn HardLight SoftLight Difference Exclusion Hue Saturation Color Luminosity"
		.split(" ")
		.map((mode) => `/${mode}`),
)

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
): {
	plates: PlateInk[]
	pages: PlatePage[]
	pageBranches: ReadonlyMap<number, PdfDictionary>
} {
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
	// In dictionaries, PDF null (including an indirect null) means no entry.
	// Keep non-null references intact for resource reuse and output fidelity.
	const entry = (
		value: Pick<PdfDictionary, "entries" | "byteEntries">,
		key: string,
	): PdfValue | undefined => {
		const item = dictionaryValue(value, key)
		return resolve(item) === null ? undefined : item
	}
	const presentItems = (
		value: Pick<PdfDictionary, "entries" | "byteEntries">,
	) => dictionaryItems(value).filter(([, item]) => resolve(item) !== null)
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
		const entries = presentItems(dict(entry(resources, category)))
		const value = entries.find(([name]) => name === tokenName(key))?.[1]
		if (value === undefined)
			throw new TypeError(`Missing ${category} resource ${key}`)
		return value
	}
	const plates: PlateInk[] = permitted.has("cmyk")
		? ([0, 1, 2, 3] as const).map((component) => ({
				name: processNames[component],
				colorSpace: "cmyk",
				component,
			}))
		: []
	const spots = new Map<string, number>()
	// Intern shallow node descriptions containing child IDs, not expanded child
	// values. Equivalent graphs share IDs regardless of reference/layout choices,
	// and both traversal and key storage stay proportional to unique graph nodes.
	const nodeIds = new Map<string, number>()
	const cachedNodes = new WeakMap<object, number>()
	const activeNodes = new WeakSet<object>()
	const intern = (description: unknown): number => {
		const key = JSON.stringify(description)
		let id = nodeIds.get(key)
		if (id === undefined) {
			id = nodeIds.size
			nodeIds.set(key, id)
		}
		return id
	}
	const canonical = (value: PdfValue | undefined, depth = 0): number => {
		if (depth > 50)
			throw new TypeError("Cyclic or excessively nested spot definition")
		const resolved = resolve(value)
		if (resolved === null || typeof resolved !== "object")
			return intern([typeof resolved, resolved])
		const cached = cachedNodes.get(resolved)
		if (cached !== undefined) return cached
		if (activeNodes.has(resolved)) throw new TypeError("Cyclic spot definition")
		activeNodes.add(resolved)
		let id: number
		const named = pdfName(resolved)
		if (named !== undefined) id = intern(["name", named])
		else if (resolved.kind === "array")
			id = intern([
				"array",
				resolved.items.map((item) => canonical(item, depth + 1)),
			])
		else if (resolved.kind === "dictionary" || resolved.kind === "stream") {
			const entries = presentItems(resolved)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([key, item]) => [key, canonical(item, depth + 1)])
			id = intern(
				resolved.kind === "stream"
					? ["stream", entries, Buffer.from(resolved.data).toString("hex")]
					: ["dictionary", entries],
			)
		} else id = intern(resolved)
		activeNodes.delete(resolved)
		cachedNodes.set(resolved, id)
		return id
	}
	const colorSpace = (value: PdfValue): Color => {
		const resolved = resolve(value)
		// Device color spaces may be a family name or a one-element array.
		const named = pdfName(
			resolved !== null &&
				typeof resolved === "object" &&
				resolved.kind === "array" &&
				resolved.items.length === 1
				? resolve(resolved.items[0])
				: resolved,
		)
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
			const name = displayName(inkName)
			const definition = canonical(value)
			if (spots.has(inkName) && spots.get(inkName) !== definition)
				throw new TypeError(`Conflicting definitions for separation ${name}`)
			if (!spots.has(inkName)) {
				spots.set(inkName, definition)
				plates.push({ name, colorSpace: "spot", ink: inkName })
			}
			return {
				space: "spot",
				ink: inkName,
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
		const filter = resolve(entry(value, "Filter"))
		if (filter !== undefined) {
			const filters =
				filter !== null && typeof filter === "object" && filter.kind === "array"
					? filter.items
					: [filter]
			if (
				filters.length !== 1 ||
				pdfName(resolve(filters[0])) !== "/FlateDecode" ||
				entry(value, "DecodeParms") !== undefined
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
		textKnockout: true,
	})
	const activeForms = new Set<PdfStream>()
	const formPlans = new WeakMap<
		PdfStream,
		WeakMap<PdfDictionary, Map<string, PlateForm>>
	>()
	const scope = (
		source: string,
		resources: PdfDictionary,
		pageResources: PdfDictionary,
		initial: State,
		location: string,
	): PlateScope => {
		try {
			for (const [alias, value] of presentItems(
				dict(entry(resources, "ColorSpace")),
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
			let textObject: { transparent: boolean; overprint: boolean } | undefined
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
				if (op === "BT") {
					textObject = { transparent: false, overprint: false }
				} else if (op === "ET") {
					// PDF 1.6 §5.2.7: all glyphs share an implicit knockout group.
					// Suppressing an overprinting glyph loses the shape that can
					// erase earlier ink against the text object's initial backdrop.
					if (
						state.textKnockout &&
						textObject?.transparent &&
						textObject.overprint
					)
						throw new TypeError(
							"Plate previews do not support transparent overprinting text with text knockout enabled",
						)
					textObject = undefined
				} else if (op === "q") {
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
							components.some(
								(value) => !Number.isFinite(value) || value < 0 || value > 1,
							)
						)
							throw new TypeError("Invalid plate color components")
						if (color.space === "cmyk" && isCmykComponents(components))
							state[channel] = { ...color, components }
						else if (color.space === "spot" && isSpotComponents(components))
							state[channel] = { ...color, components }
						else throw new TypeError("Invalid plate color components")
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
					for (const [entry] of presentItems(value))
						if (!allowed.has(entry.slice(1)))
							throw new TypeError(
								`Unsupported plate graphics state setting ${entry}`,
							)
					const get = (key: string) => resolve(entry(value, key))
					if (get("TK") !== undefined) {
						if (typeof get("TK") !== "boolean" || textObject !== undefined)
							throw new TypeError(
								"Text knockout must be a boolean set outside a text object",
							)
						state.textKnockout = get("TK") as boolean
					}
					for (const key of ["OP", "op"])
						if (get(key) !== undefined && typeof get(key) !== "boolean")
							throw new TypeError(`Invalid ${key} overprint flag`)
					if (get("OP") !== undefined) {
						state.strokeOverprint = get("OP") as boolean
						state.fillOverprint = state.strokeOverprint
					}
					if (get("op") !== undefined)
						state.fillOverprint = get("op") as boolean
					const overprintMode = get("OPM")
					if (overprintMode !== undefined) {
						if (overprintMode !== 0 && overprintMode !== 1)
							throw new TypeError("Invalid overprint mode")
						state.mode = overprintMode
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
					const blend = get("BM")
					if (blend !== undefined) {
						let mode = pdfName(blend)
						if (
							blend !== null &&
							typeof blend === "object" &&
							blend.kind === "array"
						) {
							const modes = blend.items.map((item) => pdfName(resolve(item)))
							if (modes.some((item) => item === undefined))
								throw new TypeError("Expected blend-mode names")
							// Recognize all standard modes before checking our support;
							// [Multiply Normal] must not silently become Normal.
							mode =
								modes.find((item) => standardBlendModes.has(item!)) ?? "/Normal"
						}
						if (mode !== "/Normal" && mode !== "/Compatible")
							throw new TypeError("Plate previews support only Normal blending")
					}
					if (get("SMask") !== undefined && pdfName(get("SMask")) !== "/None")
						throw new TypeError("Soft masks are unsupported in plate previews")
					states.set(
						key,
						// Projection already applies overprint; removing all source
						// controls keeps the default knockout state without adding
						// entries requiring a newer PDF version.
						replaceEntries(
							dictionary(
								Object.fromEntries(
									Object.entries(value.entries).filter(
										([, item]) => resolve(item) !== null,
									),
								),
								...(value.byteEntries ?? []).filter(
									([, item]) => resolve(item) !== null,
								),
							),
							{
								OP: undefined,
								op: undefined,
								OPM: undefined,
								...(blend === undefined ? {} : { BM: name("Normal") }),
							},
						),
					)
				} else if (op === "Tr") {
					const mode = Number(operands[0])
					if (!isTextMode(mode))
						throw new TypeError("Invalid text rendering mode")
					state.textMode = mode
					continue
				} else if (op === "Tf") {
					const font = dict(resource(resources, "Font", tokenName(operands[0])))
					if (pdfName(resolve(entry(font, "Subtype"))) === "/Type3")
						throw new TypeError("Type3 fonts are unsupported in plate previews")
				} else if (pathPainting.has(op) || textPaints.has(op)) {
					const text = textPaints.has(op)
					if (text && !textHasGlyphs(instruction)) {
						instructions.push({ ...instruction, kind: "raw" })
						continue
					}
					const channels = pathPainting.get(op) ?? textPainting(state.textMode)
					const { fill, stroke } = channels
					if (text && textObject) {
						textObject.transparent ||=
							(fill && state.fillOpacity < 1) ||
							(stroke && state.strokeOpacity < 1)
						textObject.overprint ||=
							(fill && state.fillOverprint) || (stroke && state.strokeOverprint)
					}
					// PDF 1.6 §7.6.3: unequal alpha makes combined painting an
					// implicit knockout group. Dropping either channel loses shape
					// that can remove the earlier fill, even when it deposits no ink.
					if (fill && stroke && state.fillOpacity !== state.strokeOpacity)
						throw new TypeError(
							"Plate previews do not support combined fill and stroke with unequal opacities (implicit knockout group)",
						)
					if ("clip" in channels)
						instructions.push({
							...instruction,
							kind: "text",
							clip: channels.clip,
							fill: fill ? paint("fill") : undefined,
							stroke: stroke ? paint("stroke") : undefined,
						})
					else if (fill)
						instructions.push({
							...channels,
							kind: "path",
							fill: paint("fill"),
							stroke: stroke ? paint("stroke") : undefined,
						})
					else
						instructions.push({
							...channels,
							kind: "path",
							fill: undefined,
							stroke: paint("stroke"),
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
					if (pdfName(resolve(entry(value, "Subtype"))) !== "/Form") {
						const imageSpace = entry(value, "ColorSpace")
						if (imageSpace !== undefined) colorSpace(imageSpace)
						throw new TypeError("Images are unsupported in plate previews")
					}
					if (
						entry(value, "Group") !== undefined ||
						entry(value, "OC") !== undefined ||
						entry(value, "Ref") !== undefined
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
						const ownResources = entry(value, "Resources")
						nested = {
							...scope(
								readStream(value),
								// PDF 1.6 §3.7.2: missing Form Resources falls back to the
								// page, even when an enclosing Form has private resources.
								ownResources === undefined ? pageResources : dict(ownResources),
								pageResources,
								state,
								`${location} / XObject ${key}`,
							),
							source: value,
						}
						activeForms.delete(value)
						variants.set(stateKey, nested)
					}
					instructions.push({ kind: "form", form: nested })
					continue
				} else if (!passthrough.has(op))
					throw new TypeError(`Unsupported plate content operator ${op}`)
				instructions.push({ ...instruction, kind: "raw" })
			}
			if (stack.length !== 0)
				throw new TypeError("Unbalanced q in plate content")
			return {
				resources,
				states,
				instructions,
			}
		} catch (error) {
			throw new TypeError(
				`${location}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			)
		}
	}
	const pages: PlatePage[] = []
	const pageBranches = new Map<number, PdfDictionary>()
	const activePages = new Set<PdfIndirectValue>()
	const visit = (ref: PdfReference, inherited: PdfDictionary): void => {
		const node = dict(ref)
		if (activePages.has(node)) throw new TypeError("Cyclic page tree")
		activePages.add(node)
		const ownResources = entry(node, "Resources")
		const resources =
			ownResources === undefined ? inherited : dict(ownResources)
		if (pdfName(resolve(entry(node, "Type"))) === "/Pages") {
			pageBranches.set(ref.objectNumber, node)
			const kids = resolve(entry(node, "Kids"))
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
			if (entry(node, "Group") !== undefined)
				throw new TypeError(
					`${location}: transparency groups are unsupported in plate previews`,
				)
			const annotations = resolve(entry(node, "Annots"))
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
			const contents = resolve(entry(node, "Contents"))
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
	const pageTree = entry(root, "Pages")
	if (
		pageTree === null ||
		typeof pageTree !== "object" ||
		pageTree.kind !== "reference"
	)
		throw new TypeError("Expected a page tree reference")
	visit(pageTree, dictionary({}))
	return { plates, pages, pageBranches }
}

function isCmykComponents(values: readonly number[]): values is CmykComponents {
	return values.length === 4
}

function isSpotComponents(values: readonly number[]): values is SpotComponents {
	return values.length === 1
}

function isTextMode(value: number): value is TextMode {
	return Number.isInteger(value) && value >= 0 && value <= 7
}

/** Form resources are fixed by the source and page context; only paint is baked in.
 * Named ink consistency is validated separately, so equivalent references to an
 * ink must not prevent sharing. Geometry and layout remain inherited at render time.
 */
function inheritedPaintKey(state: State): string {
	const colorKey = (color: Color | undefined) =>
		color === undefined
			? null
			: [
					color.space,
					color.components,
					color.space === "spot" ? color.ink : undefined,
				]
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
