import type { PdfDocument, PdfIndirectValue, PdfValue } from "mondrian.pdf"
import type {
	PdfContentOperation,
	PdfInspectedObject,
	PdfInspection,
} from "mondrian.pdf/inspect"
import {
	createPdfResolver,
	decodePdfInspectionStream,
	inspectPdfContent,
	pdfDictionaryEntries,
	pdfObjectId,
	pdfValueName,
} from "mondrian.pdf/inspect"

export function inspectionHref(
	id: string,
	offset?: number,
	page?: number,
): string {
	const query = new URLSearchParams({ object: id })
	if (offset !== undefined) query.set("offset", String(offset))
	if (page !== undefined) query.set("page", String(page))
	return `/inspect?${query}`
}

/** Search the terms shown to readers, including incoming resource aliases. */
export function inspectionSearchText(
	object: PdfInspectedObject,
	value?: PdfIndirectValue,
): string {
	const names: string[] = []
	function collect(
		item: PdfIndirectValue | PdfValue | undefined,
		depth = 0,
	): void {
		if (depth > 4 || names.length >= 128) return
		const name = pdfValueName(item)
		if (name) names.push(`/${name}`)
		if (typeof item !== "object" || item === null) return
		if (item.kind === "dictionary" || item.kind === "stream")
			for (const [key, child] of pdfDictionaryEntries(item).slice(0, 64)) {
				names.push(`/${key}`)
				collect(child, depth + 1)
			}
		else if (item.kind === "array")
			for (const child of item.items.slice(0, 64)) collect(child, depth + 1)
	}
	collect(value)
	return [
		object.id,
		`${object.objectNumber} ${object.generation} R`,
		`${object.objectNumber} ${object.generation} obj`,
		object.role,
		...object.keys.map((key) => `/${key}`),
		...names,
		...object.references.map((link) => link.path),
		...object.referencedBy.map((link) => link.path),
	]
		.join(" ")
		.toLowerCase()
}

type Matrix = readonly [number, number, number, number, number, number]
export interface InspectionPlacement {
	readonly object: string
	readonly offset: number
	readonly resource: string
	/** Image unit-square corners in normalized, rotated preview coordinates. */
	readonly points: readonly (readonly [number, number])[]
}
export interface InspectionPageProgram {
	readonly placements: readonly InspectionPlacement[]
	readonly resources: ReadonlyMap<string, string>
	readonly message: string
}

function multiply(a: Matrix, b: Matrix): Matrix {
	return [
		a[0] * b[0] + a[2] * b[1],
		a[1] * b[0] + a[3] * b[1],
		a[0] * b[2] + a[2] * b[3],
		a[1] * b[2] + a[3] * b[3],
		a[0] * b[4] + a[2] * b[5] + a[4],
		a[1] * b[4] + a[3] * b[5] + a[5],
	]
}

/** Trace direct page image bounds; this is an overlay, not another PDF renderer. */
export function inspectionPageProgram(
	document: PdfDocument,
	index: PdfInspection,
	number: number,
): InspectionPageProgram {
	const page = index.pages.find((entry) => entry.number === number)
	const resolve = createPdfResolver(document)
	const field = (
		value: PdfIndirectValue | undefined,
		key: string,
	): PdfValue | undefined => {
		if (
			typeof value !== "object" ||
			value === null ||
			(value.kind !== "dictionary" && value.kind !== "stream")
		)
			return undefined
		return pdfDictionaryEntries(value).find(([name]) => name === key)?.[1]
	}
	const pageValue = document.objects.find(
		(object) =>
			pdfObjectId(object.objectNumber, object.generation) === page?.id,
	)?.value
	function inherited(key: string): PdfIndirectValue | undefined {
		let node = pageValue
		const seen = new Set<PdfIndirectValue>()
		while (node !== undefined && !seen.has(node)) {
			seen.add(node)
			const value = field(node, key)
			if (value !== undefined) return resolve(value)
			node = resolve(field(node, "Parent"))
		}
		return undefined
	}
	const resources = new Map<string, string>()
	const resourceDictionary = inherited("Resources")
	for (const category of [
		"XObject",
		"Font",
		"ExtGState",
		"ColorSpace",
		"Shading",
		"Pattern",
	]) {
		const dictionary = resolve(field(resourceDictionary, category))
		if (
			typeof dictionary === "object" &&
			dictionary !== null &&
			dictionary.kind === "dictionary"
		)
			for (const [name, target] of pdfDictionaryEntries(dictionary))
				if (
					typeof target === "object" &&
					target !== null &&
					target.kind === "reference"
				)
					resources.set(
						`${category}/${name}`,
						pdfObjectId(target.objectNumber, target.generation),
					)
	}
	const box = inherited("CropBox") ?? inherited("MediaBox")
	const media = inherited("MediaBox")
	const raw =
		typeof box === "object" && box !== null && box.kind === "array"
			? box.items
			: []
	const mediaBox =
		typeof media === "object" && media !== null && media.kind === "array"
			? media.items
			: raw
	const rotation = inherited("Rotate") ?? 0
	const placements: InspectionPlacement[] = []
	if (
		raw.length !== 4 ||
		mediaBox.length !== 4 ||
		!raw.every((v) => typeof v === "number" && Number.isFinite(v)) ||
		!mediaBox.every((v) => typeof v === "number" && Number.isFinite(v)) ||
		typeof rotation !== "number" ||
		!Number.isInteger(rotation / 90)
	)
		return {
			placements,
			resources,
			message: "Image bounds are unavailable for this page geometry.",
		}
	const [left, bottom, right, top] = raw as number[]
	const [ml, mb, mr, mt] = mediaBox as number[]
	const x0 = Math.max(left!, ml!),
		y0 = Math.max(bottom!, mb!),
		x1 = Math.min(right!, mr!),
		y1 = Math.min(top!, mt!)
	if (
		x1 <= x0 ||
		y1 <= y0 ||
		!Number.isFinite(x1 - x0) ||
		!Number.isFinite(y1 - y0)
	)
		return {
			placements,
			resources,
			message:
				"Image bounds are unavailable for an empty or out-of-range page box.",
		}
	const rotate = ((rotation % 360) + 360) % 360
	const point = (x: number, y: number): readonly [number, number] => {
		const u = (x - x0) / (x1 - x0),
			v = (y - y0) / (y1 - y0)
		return rotate === 90
			? [v, u]
			: rotate === 180
				? [1 - u, v]
				: rotate === 270
					? [1 - v, 1 - u]
					: [u, 1 - v]
	}
	let matrix: Matrix = [1, 0, 0, 1, 0, 0]
	const stack: Matrix[] = []
	const active = new Set<PdfIndirectValue>()
	let remaining = 100000
	let decodedLeft = 32 * 1024 * 1024
	const bitmapIds = new Set(index.bitmaps.map((image) => image.id))
	function program(input: PdfValue | undefined): void {
		const source = resolve(input)
		if (typeof source !== "object" || source === null) return
		if (active.has(source) || active.size >= 128)
			throw new Error("Cyclic or deeply nested content array")
		active.add(source)
		try {
			if (source.kind === "array") {
				for (const child of source.items) program(child)
			} else if (source.kind === "stream") {
				const id =
					typeof input === "object" &&
					input !== null &&
					input.kind === "reference"
						? pdfObjectId(input.objectNumber, input.generation)
						: null
				const bytes = decodePdfInspectionStream(document, source)
				decodedLeft -= bytes.length
				if (decodedLeft < 0) throw new Error("Page decoded-byte limit exceeded")
				const operations = inspectPdfContent(bytes, remaining)
				remaining -= operations.length
				if (remaining < 0) throw new Error("Page instruction limit exceeded")
				for (const op of operations) {
					if (op.operator === "q") stack.push(matrix)
					else if (op.operator === "Q") {
						const saved = stack.pop()
						if (!saved) throw new Error("Unbalanced graphics-state restore")
						matrix = saved
					} else if (op.operator === "cm") {
						if (
							op.operands.length !== 6 ||
							!op.operands.every(
								(v) => typeof v === "number" && Number.isFinite(v),
							)
						)
							throw new Error("Invalid transformation matrix")
						matrix = multiply(matrix, op.operands as Matrix)
						if (!matrix.every(Number.isFinite))
							throw new Error("Transformation exceeds display range")
					} else if (op.operator === "Do" && id) {
						const name = pdfValueName(op.operands[0])
						const resource = resources.get(`XObject/${name}`)
						if (!resource || !bitmapIds.has(resource)) continue
						const corners = [
							[0, 0],
							[1, 0],
							[1, 1],
							[0, 1],
						] as const
						placements.push({
							object: id,
							offset: op.offset,
							resource,
							points: corners.map(([x, y]) =>
								point(
									matrix[0] * x + matrix[2] * y + matrix[4],
									matrix[1] * x + matrix[3] * y + matrix[5],
								),
							),
						})
					}
				}
			}
		} finally {
			active.delete(source)
		}
	}
	try {
		program(field(pageValue, "Contents"))
		return {
			placements,
			resources,
			message:
				"Outlines show direct page image bounds before clipping. Images inside Forms are not outlined.",
		}
	} catch (error: unknown) {
		return {
			placements: [],
			resources,
			message: `Image bounds unavailable: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

export function operationResource(
	operation: PdfContentOperation,
	resources: ReadonlyMap<string, string>,
): string | undefined {
	const category = (
		{
			Do: "XObject",
			Tf: "Font",
			gs: "ExtGState",
			cs: "ColorSpace",
			CS: "ColorSpace",
			sh: "Shading",
			scn: "Pattern",
			SCN: "Pattern",
		} as Record<string, string>
	)[operation.operator]
	const operand = ["scn", "SCN"].includes(operation.operator)
		? operation.operands.at(-1)
		: operation.operands[0]
	return category
		? resources.get(`${category}/${pdfValueName(operand)}`)
		: undefined
}
