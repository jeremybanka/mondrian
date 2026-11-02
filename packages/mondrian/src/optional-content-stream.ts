// SPDX-License-Identifier: MPL-2.0
import { dictionaryValue as entry } from "./dictionary-lookup.ts"
import type {
	PdfDictionary,
	PdfIndirectValue,
	PdfReference,
	PdfStream,
	PdfValue,
} from "./objects.ts"
import { dictionary, name, nameBytes, stream } from "./objects.ts"
import type { PdfProcessingStep } from "./optional-content.ts"
import { parsePlateContent } from "./content-syntax.ts"
import type { ContentInstruction } from "./content-syntax.ts"
import { pdfName, tokenName, nameTokenBytes } from "./pdf-names.ts"
import { replaceEntries } from "./dictionary-replace.ts"

type Matrix = readonly [number, number, number, number, number, number]
interface PaintState {
	fillSpot: boolean
	strokeSpot: boolean
	fillOverprint: boolean
	strokeOverprint: boolean
	fillOpacity: number
	strokeOpacity: number
	normal: boolean
	masked: boolean
	clipped: boolean
	unsupportedState: boolean
	matrix: Matrix
}
const identity: Matrix = [1, 0, 0, 1, 0, 0]
export const initialPaint = (): PaintState => ({
	fillSpot: false,
	strokeSpot: false,
	fillOverprint: false,
	strokeOverprint: false,
	fillOpacity: 1,
	strokeOpacity: 1,
	normal: true,
	masked: false,
	clipped: false,
	unsupportedState: false,
	matrix: identity,
})
export interface OptionalContentMembership {
	readonly ref: PdfReference
	readonly step: PdfProcessingStep | undefined
	readonly visible: boolean
}

interface SelectionContext {
	readonly resolve: (
		value: PdfValue | undefined,
	) => PdfIndirectValue | undefined
	readonly dict: (value: PdfValue | undefined) => PdfDictionary
	readonly items: (value: PdfValue | undefined) => readonly PdfValue[]
	readonly read: (value: PdfStream) => string
	readonly add: (value: PdfIndirectValue) => PdfReference
	readonly membership: (
		value: PdfValue | undefined,
	) => OptionalContentMembership
}

/** Resolve complete optional graphics scopes, preserving ordinary paint and resource byte identities. */
export function createOptionalContentTransformer({
	resolve,
	dict,
	items,
	read,
	add,
	membership,
}: SelectionContext) {
	const activeForms = new Set<PdfStream>()
	const mergeStep = (
		parent: PdfProcessingStep | undefined,
		child: PdfProcessingStep | undefined,
	): PdfProcessingStep | undefined => {
		if (
			parent &&
			child &&
			(parent.group !== child.group || parent.type !== child.type)
		)
			throw new TypeError(
				"A path cannot belong to different processing-step classifications",
			)
		return child ?? parent
	}
	const transform = (
		source: string,
		resources: PdfDictionary,
		pageResources: PdfDictionary,
		inherited: PaintState,
		inheritedStep?: PdfProcessingStep,
		bounds?: readonly number[],
		nestedInForm = false,
	): { data: Uint8Array; resources: PdfDictionary } => {
		const instructions = parsePlateContent(source)
		const output: string[] = []
		let state = { ...inherited, matrix: identity }
		const stack: PaintState[] = []
		const marked: {
			visible: boolean
			step: PdfProcessingStep | undefined
			depth: number
			optional: boolean
		}[] = []
		const used = new Map<string, Set<string>>()
		const xobjects = new Map<string, PdfValue>()
		let path = false
		const resource = (
			category: string,
			token: string,
		): PdfValue | undefined => {
			const table = entry(resources, category)
			if (table === undefined) return undefined
			const dictionary = dict(table)
			const key = tokenName(token)
			for (const [alias, value] of Object.entries(dictionary.entries))
				if (pdfName(name(alias)) === key) return value
			for (const [alias, value] of dictionary.byteEntries ?? [])
				if (pdfName(alias) === key) return value
			return undefined
		}
		const use = (category: string, token: string): void => {
			let keys = used.get(category)
			if (!keys) {
				keys = new Set()
				used.set(category, keys)
			}
			keys.add(tokenName(token))
		}
		const point = (x: number, y: number): void => {
			if (!bounds) return
			const [a, b, c, d, e, f] = state.matrix
			const px = a * x + c * y + e
			const py = b * x + d * y + f
			if (
				px < bounds[0]! ||
				px > bounds[2]! ||
				py < bounds[1]! ||
				py > bounds[3]!
			)
				throw new TypeError(
					"Structural path may be clipped by its Form BBox; keep the entire path inside the box",
				)
		}
		for (const instruction of instructions) {
			const { op, operands } = instruction
			const top = marked.at(-1)
			const step = top?.step ?? inheritedStep
			const visible = marked.every((scope) => scope.visible)
			if (op === "BDC" || op === "BMC") {
				if (operands.length !== (op === "BDC" ? 2 : 1))
					throw new TypeError(`Invalid ${op} operands`)
				const optional = tokenName(operands[0]) === "/OC"
				if (optional) {
					if (op !== "BDC" || !operands[1]?.startsWith("/"))
						throw new TypeError("Optional content requires /OC /resource BDC")
					if (path)
						throw new TypeError(
							"Optional-content boundaries cannot split a path",
						)
					const group = membership(resource("Properties", operands[1]))
					marked.push({
						visible: group.visible,
						step: mergeStep(step, group.step),
						depth: stack.length,
						optional: true,
					})
				} else {
					marked.push({
						visible: true,
						step,
						depth: stack.length,
						optional: false,
					})
					if (visible) output.push(emit(instruction))
					if (op === "BDC" && operands[1]?.startsWith("/"))
						use("Properties", operands[1])
				}
				continue
			}
			if (op === "EMC") {
				const scope = marked.pop()
				if (!scope || operands.length)
					throw new TypeError("Unbalanced optional/marked content EMC")
				if (scope.optional && (stack.length !== scope.depth || path))
					throw new TypeError(
						"Optional content must contain balanced, complete graphics fragments",
					)
				if (!scope.optional && visible) output.push(emit(instruction))
				continue
			}
			// This subset requires optional fragments to isolate state and paths with q/Q.
			const optional = marked.findLast((scope) => scope.optional)
			if (optional && stack.length === optional.depth && op !== "q")
				throw new TypeError(
					"Optional content must isolate graphics state in q/Q fragments",
				)
			if (op === "q") stack.push({ ...state })
			else if (op === "Q") {
				if (path)
					throw new TypeError(
						"A graphics fragment cannot leave an unfinished path",
					)
				const previous = stack.pop()
				if (!previous)
					throw new TypeError("Unbalanced Q in optional-content selection")
				state = previous
			} else if (op === "cm") {
				const m = numbers(operands, 6)
				const [a, b, c, d, e, f] = state.matrix
				state.matrix = [
					a * m[0]! + c * m[1]!,
					b * m[0]! + d * m[1]!,
					a * m[2]! + c * m[3]!,
					b * m[2]! + d * m[3]!,
					a * m[4]! + c * m[5]! + e,
					b * m[4]! + d * m[5]! + f,
				]
			} else if (["cs", "CS"].includes(op)) {
				const color = resolve(resource("ColorSpace", operands[0]!))
				const spot =
					color &&
					typeof color === "object" &&
					color.kind === "array" &&
					pdfName(resolve(color.items[0])) === "/Separation" &&
					!["/All", "/None", "/Cyan", "/Magenta", "/Yellow", "/Black"].includes(
						pdfName(resolve(color.items[1])) ?? "",
					)
				state[op === "cs" ? "fillSpot" : "strokeSpot"] = !!spot
			} else if (["k", "rg", "g", "K", "RG", "G"].includes(op))
				state[op === op.toLowerCase() ? "fillSpot" : "strokeSpot"] = false
			else if (op === "W" || op === "W*") state.clipped = true
			else if (op === "gs") {
				const ext = dict(resource("ExtGState", operands[0]!))
				const allowed = new Set([
					"Type",
					"OP",
					"op",
					"OPM",
					"ca",
					"CA",
					"BM",
					"SMask",
					"LW",
					"LC",
					"LJ",
					"ML",
					"D",
				])
				if (
					Object.keys(ext.entries).some((key) => !allowed.has(key)) ||
					(ext.byteEntries ?? []).some(
						([key]) => !allowed.has((pdfName(key) ?? "").slice(1)),
					)
				)
					state.unsupportedState = true
				for (const [key, target] of [
					["op", "fillOverprint"],
					["OP", "strokeOverprint"],
					["ca", "fillOpacity"],
					["CA", "strokeOpacity"],
				] as const) {
					const value = resolve(entry(ext, key))
					if (value !== undefined) Object.assign(state, { [target]: value })
				}
				if (entry(ext, "op") === undefined && entry(ext, "OP") !== undefined)
					state.fillOverprint = state.strokeOverprint
				if (entry(ext, "BM") !== undefined)
					state.normal = pdfName(resolve(entry(ext, "BM"))) === "/Normal"
				if (entry(ext, "SMask") !== undefined)
					state.masked = pdfName(resolve(entry(ext, "SMask"))) !== "/None"
			}
			if (step) {
				if (nestedInForm)
					throw new TypeError(
						"Nested technical Forms are unsupported; use a single Form with unclipped vector fragments",
					)
				if (state.unsupportedState)
					throw new TypeError(
						"Structural paths inherit unsupported ExtGState settings",
					)
				if (
					![
						"q",
						"Q",
						"cm",
						"w",
						"J",
						"j",
						"M",
						"d",
						"m",
						"l",
						"c",
						"v",
						"y",
						"h",
						"re",
						"S",
						"s",
						"f",
						"F",
						"f*",
						"B",
						"B*",
						"b",
						"b*",
						"n",
						"cs",
						"CS",
						"scn",
						"SCN",
						"sc",
						"SC",
						"k",
						"K",
						"rg",
						"RG",
						"g",
						"G",
						"gs",
						"Do",
					].includes(op)
				)
					throw new TypeError(
						`Unsupported structural processing-step operator ${op}; only unclipped vector paths and Forms are supported`,
					)
				if (["m", "l", "c", "v", "y"].includes(op)) {
					const values = numbers(
						operands,
						op === "c" ? 6 : ["v", "y"].includes(op) ? 4 : 2,
					)
					for (let i = 0; i < values.length; i += 2)
						point(values[i]!, values[i + 1]!)
				}
				if (op === "re") {
					const [x, y, w, h] = numbers(operands, 4) as [
						number,
						number,
						number,
						number,
					]
					point(x, y)
					point(x + w, y)
					point(x, y + h)
					point(x + w, y + h)
				}
				const fill = ["f", "F", "f*", "B", "B*", "b", "b*"].includes(op)
				const stroke = ["S", "s", "B", "B*", "b", "b*"].includes(op)
				if (fill && !stroke)
					throw new TypeError("Cutting and creasing paths must have a stroke")
				if (
					(fill &&
						(!state.fillSpot ||
							state.fillOverprint !== true ||
							state.fillOpacity !== 1)) ||
					(stroke &&
						(!state.strokeSpot ||
							state.strokeOverprint !== true ||
							state.strokeOpacity !== 1)) ||
					((fill || stroke) && (!state.normal || state.masked || state.clipped))
				)
					throw new TypeError(
						"Structural paths require opaque overprinting spot paint with Normal blending and no soft mask or clipping",
					)
			}
			if (["m", "l", "c", "v", "y", "re"].includes(op)) path = true
			if (["S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n"].includes(op))
				path = false
			if (op === "Do") {
				const value = resolve(resource("XObject", operands[0]!))
				if (!value || typeof value !== "object" || value.kind !== "stream")
					throw new TypeError("Expected an XObject stream")
				const subtype = pdfName(resolve(entry(value, "Subtype")))
				const group =
					entry(value, "OC") === undefined
						? undefined
						: membership(entry(value, "OC"))
				const nestedStep = mergeStep(step, group?.step)
				if (subtype === "/Form") {
					if (activeForms.has(value))
						throw new TypeError(
							"Recursive Form XObject in optional-content selection",
						)
					if (
						entry(value, "Group") !== undefined ||
						entry(value, "Ref") !== undefined
					)
						throw new TypeError(
							"Transparency groups and reference Forms are unsupported in optional-content selection",
						)
					// A technical Form nested in another technical Form could introduce clipping at either boundary.
					if (nestedStep && bounds)
						throw new TypeError(
							"Nested technical Forms are unsupported; use a single Form with unclipped vector fragments",
						)
					const own = entry(value, "Resources")
					const bbox = items(entry(value, "BBox")).map((item) => resolve(item))
					if (
						bbox.length !== 4 ||
						bbox.some((n) => typeof n !== "number" || !Number.isFinite(n))
					)
						throw new TypeError("Invalid Form BBox")
					activeForms.add(value)
					const nested = transform(
						read(value),
						own === undefined ? pageResources : dict(own),
						pageResources,
						state,
						nestedStep,
						bbox as number[],
						bounds !== undefined,
					)
					activeForms.delete(value)
					if (visible && (group?.visible ?? true)) {
						const entries = replaceEntries(value, {
							Resources: nested.resources,
							Filter: undefined,
							DecodeParms: undefined,
							OC: undefined,
						})
						xobjects.set(
							tokenName(operands[0]),
							add(
								stream(
									entries.entries,
									nested.data,
									...(entries.byteEntries ?? []),
								),
							),
						)
					}
				} else {
					if (nestedStep)
						throw new TypeError(
							"Structural processing steps cannot contain images or other non-vector XObjects",
						)
					if (group)
						throw new TypeError(
							"Optional content on non-Form XObjects is unsupported",
						)
					if (visible)
						xobjects.set(
							tokenName(operands[0]),
							resource("XObject", operands[0]!)!,
						)
				}
				if (!visible || group?.visible === false) continue
			}
			if (op === "DP" && tokenName(operands[0]) === "/OC")
				throw new TypeError("Optional-content point markers are unsupported")
			if (!visible) continue
			if (
				["cs", "CS"].includes(op) &&
				!["/DeviceCMYK", "/DeviceRGB", "/DeviceGray", "/Pattern"].includes(
					tokenName(operands[0]),
				)
			)
				use("ColorSpace", operands[0]!)
			if (op === "gs") use("ExtGState", operands[0]!)
			if (op === "Tf") use("Font", operands[0]!)
			if (op === "DP" && operands[1]?.startsWith("/"))
				use("Properties", operands[1])
			output.push(emit(instruction))
		}
		if (stack.length || marked.length || path)
			throw new TypeError(
				"Unbalanced graphics, path, or optional-content scope",
			)
		const changes: Record<string, PdfValue | undefined> = {}
		for (const category of [
			"Properties",
			"ColorSpace",
			"ExtGState",
			"Font",
			"XObject",
		]) {
			const table = new Map<string, PdfValue>()
			if (category === "XObject")
				for (const [key, value] of xobjects) table.set(key, value)
			else
				for (const key of used.get(category) ?? []) {
					const value = resource(category, key)
					if (value !== undefined) table.set(key, value)
				}
			// Preserve default color replacements so downstream validation still diagnoses them.
			if (category === "ColorSpace")
				for (const key of ["/DefaultCMYK", "/DefaultRGB", "/DefaultGray"]) {
					const value = resource(category, key)
					if (value !== undefined) table.set(key, value)
				}
			changes[category] = table.size
				? dictionary(
						{},
						...[...table].map(
							([key, value]) =>
								[nameBytes(nameTokenBytes(key)), value] as const,
						),
					)
				: undefined
		}
		return {
			data: Uint8Array.from(output.join("\n") + "\n", (character) =>
				character.charCodeAt(0),
			),
			resources: replaceEntries(resources, changes),
		}
	}
	return transform
}

function emit({ operands, op }: ContentInstruction): string {
	return `${operands.join(" ")} ${op}`
}
function numbers(operands: readonly string[], length?: number): number[] {
	if (
		(length !== undefined && operands.length !== length) ||
		operands.some((token) => !/^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(token))
	)
		throw new TypeError("Invalid numeric operands in processing-step geometry")
	const values = operands.map(Number)
	if (values.some((value) => !Number.isFinite(value)))
		throw new TypeError("Processing-step geometry must be finite")
	return values
}
