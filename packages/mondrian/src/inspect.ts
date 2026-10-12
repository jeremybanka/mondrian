// SPDX-License-Identifier: MPL-2.0

import type {
	PdfDictionary,
	PdfDocument,
	PdfIndirectValue,
	PdfStream,
	PdfValue,
} from "./objects.ts"
import { dictionaryValue } from "./dictionary-lookup.ts"
import { decodeStructureStream } from "./parser/filters.ts"
import { DecodeBudget } from "./parser/limits.ts"
import { binaryText, isKind, SyntaxReader } from "./parser/syntax.ts"
import { serializePdfObjectBody } from "./serialize.ts"

export interface PdfObjectLink {
	readonly id: string
	readonly path: string
}
export interface PdfInspectedObject {
	readonly id: string
	readonly objectNumber: number
	readonly generation: number
	readonly role: string
	readonly keys: readonly string[]
	readonly references: readonly PdfObjectLink[]
	readonly referencedBy: readonly PdfObjectLink[]
	readonly pages: readonly number[]
	readonly streamBytes?: number
}
export interface PdfInspectedPage {
	readonly id: string
	readonly number: number
	readonly box: readonly number[]
}
export interface PdfInspectedBitmap {
	readonly id: string
	readonly width: number | null
	readonly height: number | null
	readonly bits: number | null
	readonly colorSpace: string
	readonly filters: string
	readonly profile: string | null
	readonly mask: string | null
	readonly stencil: boolean
}
export interface PdfInspectedColor {
	readonly id: string
	readonly space: string
	readonly components: readonly number[]
	readonly swatch: string | null
	readonly approximate: boolean
	readonly uses: readonly {
		readonly object: string
		readonly page: number
		readonly offset: number
	}[]
}
export interface PdfInspection {
	readonly objects: readonly PdfInspectedObject[]
	readonly pages: readonly PdfInspectedPage[]
	readonly bitmaps: readonly PdfInspectedBitmap[]
	readonly colors: readonly PdfInspectedColor[]
	readonly notices: readonly {
		readonly object: string
		readonly message: string
	}[]
}
export interface PdfContentOperation {
	/** Offset in the decoded content stream, not in the original file. */
	readonly offset: number
	readonly operator: string
	readonly operands: readonly PdfValue[]
}

export function pdfObjectId(number: number, generation = 0): string {
	return `${number}:${generation}`
}
export function pdfValueName(
	value: PdfIndirectValue | PdfValue | undefined,
): string | undefined {
	if (isKind(value, "name")) return value.value
	if (isKind(value, "byte-name")) return binaryText(value.bytes)
	return undefined
}
export function pdfDictionaryEntries(
	value: PdfDictionary | PdfStream,
): readonly (readonly [string, PdfValue])[] {
	return [
		...Object.entries(value.entries).filter(
			(pair): pair is [string, PdfValue] => pair[1] !== undefined,
		),
		...(value.byteEntries ?? []).map(
			([key, item]) => [pdfValueName(key) ?? "?", item] as const,
		),
	]
}
export function createPdfResolver(
	document: PdfDocument,
): (value: PdfValue | undefined) => PdfIndirectValue | undefined {
	const objects = new Map(
		document.objects.map((object) => [
			pdfObjectId(object.objectNumber, object.generation),
			object.value,
		]),
	)
	return (input) =>
		isKind(input, "reference")
			? objects.get(pdfObjectId(input.objectNumber, input.generation))
			: input
}

/** Decode supported filters without reading external files or altering the graph. */
export function decodePdfInspectionStream(
	document: PdfDocument,
	source: PdfStream,
	limit = 8 * 1024 * 1024,
): Uint8Array {
	return Uint8Array.from(
		decodeStructureStream(
			source,
			createPdfResolver(document),
			0,
			new DecodeBudget({
				maxDecodedStreamBytes: limit,
				maxTotalDecodedBytes: limit * 4,
			}),
		),
	)
}

/** Preserve unknown operators; inline image data requires a separate decoder. */
export function inspectPdfContent(
	bytes: Uint8Array,
	maxOperations = 100000,
): readonly PdfContentOperation[] {
	const source = binaryText(bytes)
	const reader = new SyntaxReader(source)
	const operations: PdfContentOperation[] = []
	let operands: PdfValue[] = []
	let start = 0
	while (true) {
		reader.skip()
		if (reader.position === source.length) break
		if (operands.length === 0) start = reader.position
		if (
			/^[/(<[+\-.\d]/u.test(source.slice(reader.position)) ||
			/^(true|false|null)\b/u.test(source.slice(reader.position))
		) {
			operands.push(reader.value())
			if (operands.length > 4096)
				throw new RangeError("Content instruction has too many operands")
		} else {
			const match = /^[A-Za-z*'"]+/u.exec(source.slice(reader.position))
			if (!match) reader.fail("Expected a content operator")
			const operator = match?.[0] ?? reader.fail("Expected a content operator")
			if (operator === "BI")
				throw new TypeError(
					"Inline image instructions are not yet decoded; inspect the stream bytes instead",
				)
			reader.position += operator.length
			operations.push({ offset: start, operator, operands })
			operands = []
			if (operations.length > maxOperations)
				throw new RangeError("Content operation limit exceeded")
		}
	}
	if (operands.length)
		reader.fail("Content ends with operands without an operator")
	return operations
}

export function pdfInspectionSyntax(
	value: PdfValue | PdfStream,
	limit = 8192,
): string {
	if (isKind(value, "stream")) {
		return `${pdfInspectionSyntax({ kind: "dictionary", entries: value.entries, ...(value.byteEntries ? { byteEntries: value.byteEntries } : {}) }, limit)}\nstream\n[${value.data.length} encoded bytes; open the stream detail]\nendstream`
	}
	// Bound the generated display before serialization of very large arrays/strings.
	const trim = (item: PdfValue, depth: number): PdfValue => {
		if (depth > 12) return null
		if (isKind(item, "array"))
			return {
				kind: "array",
				items: item.items.slice(0, 64).map((child) => trim(child, depth + 1)),
			}
		if (isKind(item, "dictionary"))
			return {
				kind: "dictionary",
				entries: Object.fromEntries(
					Object.entries(item.entries)
						.slice(0, 64)
						.map(([key, child]) => [
							key,
							child === undefined ? undefined : trim(child, depth + 1),
						]),
				),
				...(item.byteEntries
					? {
							byteEntries: item.byteEntries
								.slice(0, 64)
								.map(([key, child]) => [key, trim(child, depth + 1)] as const),
						}
					: {}),
			}
		if (isKind(item, "literal-string") || isKind(item, "hex-string"))
			return { ...item, bytes: item.bytes.slice(0, 256) }
		return item
	}
	return binaryText(serializePdfObjectBody(trim(value, 0))).slice(0, limit)
}

/** A bounded, semantic index of the current object graph; no source-byte spans are invented. */
export function inspectPdf(document: PdfDocument): PdfInspection {
	if (document.objects.length > 100000)
		throw new RangeError("Inspection is limited to 100,000 objects")
	const resolve = createPdfResolver(document)
	const values = new Map(
		document.objects.map((object) => [
			pdfObjectId(object.objectNumber, object.generation),
			object.value,
		]),
	)
	const refs = new Map<string, PdfObjectLink[]>()
	const incoming = new Map<string, PdfObjectLink[]>()
	const roles = new Map<string, string>()
	const usage = new Map<string, Set<number>>()
	const notices: { object: string; message: string }[] = []
	const dict = (
		value: PdfIndirectValue | undefined,
	): PdfDictionary | PdfStream | undefined =>
		isKind(value, "dictionary") || isKind(value, "stream") ? value : undefined
	const field = (value: PdfIndirectValue | undefined, key: string) =>
		resolve(dictionaryValue(dict(value), key))
	const refId = (value: PdfValue | undefined) =>
		isKind(value, "reference")
			? pdfObjectId(value.objectNumber, value.generation)
			: null
	const nameOf = (value: PdfIndirectValue | undefined) =>
		pdfValueName(value) ??
		(isKind(value, "array")
			? pdfValueName(resolve(value.items[0]))
			: undefined) ??
		"Unspecified"
	function walk(
		value: PdfValue | PdfStream,
		visit: (target: string, path: string) => void,
		path = "",
		depth = 0,
	): void {
		if (depth > 256) return
		if (isKind(value, "reference"))
			visit(pdfObjectId(value.objectNumber, value.generation), path)
		else if (isKind(value, "array")) {
			if (pdfValueName(resolve(value.items[0])) === "ICCBased") {
				const profile = refId(value.items[1])
				if (profile) roles.set(profile, "ICC profile")
			}
			value.items.forEach((item, i) =>
				walk(item, visit, `${path}[${i}]`, depth + 1),
			)
		} else if (isKind(value, "dictionary") || isKind(value, "stream"))
			pdfDictionaryEntries(value).forEach(([key, item]) =>
				walk(item, visit, `${path}/${key}`, depth + 1),
			)
	}
	for (const [id, value] of values) {
		const links: PdfObjectLink[] = []
		walk(value, (target, path) => {
			links.push({ id: target, path })
			const back = incoming.get(target) ?? []
			back.push({ id, path })
			incoming.set(target, back)
			if (/\/Contents(?:\[\d+\])?$/u.test(path))
				roles.set(target, "Content stream")
			if (path.endsWith("/SMask")) roles.set(target, "Soft mask")
			if (/\/FontFile[23]?$/u.test(path)) roles.set(target, "Font program")
			if (
				path.endsWith("/ColorSpace[1]") &&
				nameOf(field(value, "ColorSpace")) === "ICCBased"
			)
				roles.set(target, "ICC profile")
			if (path.endsWith("/DestOutputProfile")) roles.set(target, "ICC profile")
		})
		refs.set(id, links)
	}
	const pages: PdfInspectedPage[] = []
	const pageSeen = new Set<string>()
	function pageTree(value: PdfValue | undefined): void {
		const pending = [value]
		while (pending.length) {
			const next = pending.pop()
			const id = refId(next)
			if (!id || pageSeen.has(id)) continue
			pageSeen.add(id)
			const node = resolve(next)
			if (pdfValueName(field(node, "Type")) === "Page") {
				let parent = node,
					box = field(node, "MediaBox")
				const parents = new Set<PdfIndirectValue>()
				while (
					box === undefined &&
					parent !== undefined &&
					!parents.has(parent)
				) {
					parents.add(parent)
					parent = field(parent, "Parent")
					box = field(parent, "MediaBox")
				}
				pages.push({
					id,
					number: pages.length + 1,
					box: isKind(box, "array")
						? box.items.filter((v): v is number => typeof v === "number")
						: [],
				})
			} else {
				const kids = field(node, "Kids")
				if (isKind(kids, "array"))
					for (let index = kids.items.length - 1; index >= 0; index--)
						pending.push(kids.items[index])
			}
		}
	}
	pageTree(dictionaryValue(dict(resolve(document.root)), "Pages"))
	if (pages.length > 1000)
		notices.push({
			object: pdfObjectId(document.root.objectNumber, document.root.generation),
			message:
				"Page resource and color associations are limited to the first 1,000 pages. All object modules are retained.",
		})
	for (const page of pages.slice(0, 1000)) {
		const visited = new Set<string>(),
			stack = [page.id]
		let ancestor = dictionaryValue(dict(values.get(page.id)), "Parent")
		const parents = new Set<string>()
		while (ancestor) {
			const parentId = refId(ancestor)
			if (!parentId || parents.has(parentId)) break
			parents.add(parentId)
			const uses = usage.get(parentId) ?? new Set<number>()
			uses.add(page.number)
			usage.set(parentId, uses)
			const parent = resolve(ancestor)
			const resources = dictionaryValue(dict(parent), "Resources")
			if (resources) walk(resources, (target) => stack.push(target))
			ancestor = dictionaryValue(dict(parent), "Parent")
		}
		while (stack.length) {
			const id = stack.pop()!
			if (visited.has(id)) continue
			visited.add(id)
			const uses = usage.get(id) ?? new Set<number>()
			uses.add(page.number)
			usage.set(id, uses)
			for (const link of refs.get(id) ?? [])
				if (!link.path.startsWith("/Parent")) stack.push(link.id)
		}
	}
	const bitmaps: PdfInspectedBitmap[] = []
	for (const [id, value] of values) {
		if (pdfValueName(field(value, "Subtype")) !== "Image") continue
		const space = field(value, "ColorSpace")
		const number = (key: string) => {
			const v = field(value, key)
			return typeof v === "number" ? v : null
		}
		const filter = field(value, "Filter")
		bitmaps.push({
			id,
			width: number("Width"),
			height: number("Height"),
			bits: number("BitsPerComponent"),
			colorSpace: nameOf(space),
			filters: isKind(filter, "array")
				? filter.items.map((v) => nameOf(resolve(v))).join(" → ")
				: filter
					? nameOf(filter)
					: "Uncompressed",
			profile:
				isKind(space, "array") && nameOf(space) === "ICCBased"
					? refId(space.items[1])
					: null,
			mask: refId(dictionaryValue(dict(value), "SMask")),
			stencil: field(value, "ImageMask") === true,
		})
		if (isKind(space, "array") && nameOf(space) === "ICCBased") {
			const profile = refId(space.items[1])
			if (profile) roles.set(profile, "ICC profile")
		}
	}
	const colorMap = new Map<
		string,
		{
			id: string
			space: string
			components: number[]
			swatch: string | null
			approximate: boolean
			uses: { object: string; page: number; offset: number }[]
		}
	>()
	const budget = new DecodeBudget({
		maxDecodedStreamBytes: 8 * 1024 * 1024,
		maxTotalDecodedBytes: 32 * 1024 * 1024,
	})
	type Paint = { space: PdfValue; values: number[] }
	type State = { fill: Paint; stroke: Paint; textMode: number }
	let operationsLeft = 200000
	function record(
		paint: Paint,
		object: string,
		page: number,
		offset: number,
	): void {
		const space = resolve(paint.space),
			label = nameOf(space)
		const id = `${pdfInspectionSyntax(paint.space, 512)}:${paint.values.join(",")}`
		let color = colorMap.get(id)
		if (!color) {
			const [a = 0, b = 0, c = 0, k = 0] = paint.values
			const rgb =
				label === "DeviceRGB"
					? [a, b, c]
					: label === "DeviceGray"
						? [a, a, a]
						: label === "DeviceCMYK"
							? [
									1 - Math.min(1, a + k),
									1 - Math.min(1, b + k),
									1 - Math.min(1, c + k),
								]
							: null
			const ink =
				isKind(space, "array") && label === "Separation"
					? pdfValueName(resolve(space.items[1]))
					: undefined
			color = {
				id,
				space: ink
					? `Separation /${ink}`
					: `${label}${label === "ICCBased" && isKind(space, "array") && refId(space.items[1]) ? ` (${refId(space.items[1])})` : ""}`,
				components: [...paint.values],
				swatch: rgb
					? `rgb(${rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(" ")})`
					: null,
				approximate: true,
				uses: [],
			}
			colorMap.set(id, color)
		}
		if (color.uses.length < 10000) color.uses.push({ object, page, offset })
	}
	function program(
		value: PdfValue | undefined,
		resources: PdfIndirectValue | undefined,
		state: State,
		page: number,
		active: Set<string>,
		stack: State[] = [],
	): State {
		if (active.size > 128) {
			notices.push({
				object: refId(value) ?? "",
				message: "Nested Form inspection exceeds 128 levels",
			})
			return state
		}
		const id = refId(value)
		const source = resolve(value)
		if (isKind(source, "array")) {
			if (id && active.has(id)) {
				notices.push({
					object: id,
					message: "Cyclic content array; color traversal stopped",
				})
				return state
			}
			if (id) active.add(id)
			for (const item of source.items)
				state = program(item, resources, state, page, active, stack)
			if (id) active.delete(id)
			return state
		}
		if (!id || !isKind(source, "stream")) return state
		if (active.has(id)) {
			notices.push({
				object: id,
				message: "Cyclic Form invocation; color traversal stopped",
			})
			return state
		}
		active.add(id)
		try {
			const bytes = decodeStructureStream(source, resolve, 0, budget)
			const ops = inspectPdfContent(bytes, Math.max(1, operationsLeft))
			operationsLeft -= ops.length
			if (operationsLeft < 0)
				throw new RangeError("Color inspection operation budget exceeded")
			for (const op of ops) {
				const nums = op.operands.filter(
					(v): v is number => typeof v === "number",
				)
				const name = pdfValueName(op.operands[0])
				if (op.operator === "q")
					stack.push({
						fill: { ...state.fill, values: [...state.fill.values] },
						stroke: { ...state.stroke, values: [...state.stroke.values] },
						textMode: state.textMode,
					})
				else if (op.operator === "Q") {
					const saved = stack.pop()
					if (!saved) throw new TypeError("Unbalanced graphics-state restore")
					state = saved
				} else if (op.operator === "Tr")
					state = { ...state, textMode: nums[0] ?? 0 }
				else if (["rg", "RG", "g", "G", "k", "K"].includes(op.operator)) {
					const key =
						op.operator === op.operator.toLowerCase() ? "fill" : "stroke"
					state = {
						...state,
						[key]: {
							space: {
								kind: "name",
								value:
									op.operator.toLowerCase() === "rg"
										? "DeviceRGB"
										: op.operator.toLowerCase() === "k"
											? "DeviceCMYK"
											: "DeviceGray",
							},
							values: nums,
						},
					}
				} else if (op.operator === "cs" || op.operator === "CS") {
					const spaces = field(resources, "ColorSpace")
					const selected =
						dictionaryValue(dict(spaces), name ?? "") ?? op.operands[0] ?? null
					state = {
						...state,
						[op.operator === "cs" ? "fill" : "stroke"]: {
							space: selected,
							values: [],
						},
					}
				} else if (["sc", "SC", "scn", "SCN"].includes(op.operator)) {
					const key =
						op.operator === op.operator.toLowerCase() ? "fill" : "stroke"
					state = { ...state, [key]: { ...state[key], values: nums } }
				} else if (op.operator === "Do") {
					const target = dictionaryValue(
						dict(field(resources, "XObject")),
						name ?? "",
					)
					const form = resolve(target)
					if (pdfValueName(field(form, "Subtype")) === "Form")
						program(
							target,
							field(form, "Resources") ?? resources,
							{ ...state },
							page,
							active,
						)
				} else {
					if (op.operator === "sh")
						notices.push({
							object: id,
							message:
								"Shading colors are retained in the object graph but not enumerated in the palette.",
						})
					const hasGlyphs = (operand: PdfValue | undefined): boolean =>
						isKind(operand, "literal-string") || isKind(operand, "hex-string")
							? operand.bytes.length > 0
							: isKind(operand, "array") && operand.items.some(hasGlyphs)
					const text =
						["Tj", "TJ", "'", '"'].includes(op.operator) &&
						hasGlyphs(op.operands.at(-1))
					if (
						["f", "F", "f*", "B", "B*", "b", "b*"].includes(op.operator) ||
						(text && [0, 2, 4, 6].includes(state.textMode))
					)
						record(state.fill, id, page, op.offset)
					if (
						["S", "s", "B", "B*", "b", "b*"].includes(op.operator) ||
						(text && [1, 2, 5, 6].includes(state.textMode))
					)
						record(state.stroke, id, page, op.offset)
				}
			}
		} catch (error) {
			notices.push({
				object: id,
				message: error instanceof Error ? error.message : String(error),
			})
		}
		active.delete(id)
		return state
	}
	for (const page of pages.slice(0, 1000)) {
		const node = values.get(page.id)
		let parent = node,
			resources = field(node, "Resources")
		const seen = new Set<PdfIndirectValue>()
		while (
			resources === undefined &&
			parent !== undefined &&
			!seen.has(parent)
		) {
			seen.add(parent)
			parent = field(parent, "Parent")
			resources = field(parent, "Resources")
		}
		program(
			dictionaryValue(dict(node), "Contents"),
			resources,
			{
				fill: { space: { kind: "name", value: "DeviceGray" }, values: [0] },
				stroke: { space: { kind: "name", value: "DeviceGray" }, values: [0] },
				textMode: 0,
			},
			page.number,
			new Set(),
		)
	}
	return {
		objects: document.objects
			.toSorted(
				(left, right) =>
					left.objectNumber - right.objectNumber ||
					left.generation - right.generation,
			)
			.map((object) => {
				const id = pdfObjectId(object.objectNumber, object.generation),
					value = object.value
				const type = pdfValueName(field(value, "Type")),
					subtype = pdfValueName(field(value, "Subtype"))
				return {
					id,
					objectNumber: object.objectNumber,
					generation: object.generation,
					role:
						roles.get(id) ??
						(subtype === "Image"
							? "Bitmap"
							: subtype === "Form"
								? "Form XObject"
								: (type ??
									(isKind(value, "stream")
										? "Stream"
										: isKind(value, "dictionary")
											? "Dictionary"
											: "Value"))),
					keys: dict(value)
						? pdfDictionaryEntries(dict(value)!).map(([key]) => key)
						: [],
					references: refs.get(id) ?? [],
					referencedBy: incoming.get(id) ?? [],
					pages: [...(usage.get(id) ?? [])],
					...(isKind(value, "stream")
						? { streamBytes: value.data.length }
						: {}),
				}
			}),
		pages,
		bitmaps,
		colors: [...colorMap.values()],
		notices,
	}
}
