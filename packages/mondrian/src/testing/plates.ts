// SPDX-License-Identifier: MPL-2.0

import { throwForPdfErrors } from "../diagnostics.ts"
import type {
	PdfDictionary,
	PdfDocument,
	PdfIndirectObject,
	PdfIndirectValue,
	PdfReference,
	PdfValue,
} from "../objects.ts"
import {
	dictionary,
	name,
	indirectObject,
	nameBytes,
	objectNumber,
	reference,
	stream,
} from "../objects.ts"
import { formatPdfNumber } from "../syntax.ts"
import { validatePdf } from "../validate.ts"
import { nameTokenBytes } from "./plate-names.ts"
import {
	pathPaintOperator,
	projectPaint,
	textPaintMode,
} from "./plate-paint.ts"
import type { ProjectedPaint } from "./plate-paint.ts"
import { planPdfPlates, replaceEntries } from "./plate-plan.ts"
import type { PlateColorSpace, PlateForm, PlateScope } from "./plate-plan.ts"
import type { PlateImage, PlateRaster } from "./plate-image.ts"
import { zlibSync } from "fflate"

export interface PdfPlateOptions {
	/** Allowed source paint spaces. Defaults to ["cmyk", "spot"]. No color conversion is performed. */
	readonly permitColors?: readonly PlateColorSpace[]
}

export interface PdfPlatePreview {
	/** Cyan, Magenta, Yellow, Black, or the spot name decoded as UTF-8 (Latin-1 fallback). */
	readonly name: string
	readonly colorSpace: PlateColorSpace
	/** An independent document retaining this plate's ink color and coverage. */
	readonly document: PdfDocument
}

/**
 * Discover print plates, then produce one colored preview document per plate.
 * CMYK plates are included whenever permitted; spots follow first discovery order.
 * Supports vector paths, live text, Forms, prepared CMYK images with alpha,
 * knockout, overprint, and constant opacity with Normal blending.
 * Unsupported painting fails during discovery; images are never color-converted here.
 */
export function previewPdfPlates(
	document: PdfDocument,
	options: PdfPlateOptions = {},
): readonly PdfPlatePreview[] {
	const permitted = options.permitColors ?? ["cmyk", "spot"]
	if (
		!Array.isArray(permitted) ||
		permitted.some((space) => space !== "cmyk" && space !== "spot")
	)
		throw new TypeError('permitColors must contain only "cmyk" and "spot"')
	throwForPdfErrors(validatePdf(document))
	const plan = planPdfPlates(document, new Set(permitted))
	const objectIndices = new Map<number, number>()
	let highestNumber = 0
	for (const [index, object] of document.objects.entries()) {
		const number = object.objectNumber
		objectIndices.set(number, index)
		highestNumber = Math.max(highestNumber, number)
	}
	return plan.plates.map((plate) => {
		const objects: PdfIndirectObject[] = [...document.objects]
		let nextNumber = highestNumber + 1
		const add = (value: PdfIndirectValue): PdfReference => {
			const number = objectNumber(nextNumber++)
			objects.push(indirectObject(number, value))
			return reference(number)
		}
		// A scope identifies the Form, page resource context, and inherited paint.
		// The cache is local to this plate; other plates need their own projection.
		const projectedForms = new Map<PlateForm, PdfReference>()
		const projectedImages = new Map<PlateImage, PdfReference>()
		const projectedMasks = new Map<PlateRaster, PdfReference>()
		const rasterEntries = (
			raster: PlateRaster,
			colorSpace: "DeviceGray" | "DeviceCMYK",
		) => ({
			Type: name("XObject"),
			Subtype: name("Image"),
			Width: raster.width,
			Height: raster.height,
			ColorSpace: name(colorSpace),
			BitsPerComponent: 8,
			Filter: name("FlateDecode"),
			Interpolate: raster.interpolate,
		})
		const projectImage = (source: PlateImage): PdfReference => {
			const cached = projectedImages.get(source)
			if (cached !== undefined) return cached
			let mask: PdfReference | undefined
			if (source.alpha !== undefined) {
				mask = projectedMasks.get(source.alpha)
				if (mask === undefined) {
					mask = add(
						stream(
							rasterEntries(source.alpha, "DeviceGray"),
							zlibSync(source.alpha.data),
						),
					)
					projectedMasks.set(source.alpha, mask)
				}
			}
			// Image OPM never skips zero-valued process components. Preserve the
			// alpha separately so even zero ink can occlude the existing plate.
			const data = new Uint8Array(source.data.length)
			if (plate.colorSpace === "cmyk")
				for (let offset = plate.component; offset < data.length; offset += 4)
					data[offset] = source.data[offset]!
			const result = add(
				stream(
					{
						...rasterEntries(source, "DeviceCMYK"),
						...(mask === undefined ? {} : { SMask: mask }),
					},
					zlibSync(data),
				),
			)
			projectedImages.set(source, result)
			return result
		}
		const emit = (
			scope: PlateScope,
		): { data: Uint8Array; resources: PdfDictionary } => {
			const commands: string[] = []
			const xObjects = new Map<string, PdfValue>()
			const xObjectNames = new Map<PdfReference, string>()
			let spotDefinition: PdfValue | undefined
			const color = (paint: ProjectedPaint, stroke: boolean): void => {
				if (paint.kind === "skip") return
				const { color } = paint
				if (color.space === "spot") {
					spotDefinition = color.definition
					commands.push(
						`/PlateInk ${stroke ? "CS" : "cs"}`,
						`${formatPdfNumber(color.components[0])} ${stroke ? "SCN" : "scn"}`,
					)
				} else {
					commands.push(
						`${color.components.map(formatPdfNumber).join(" ")} ${stroke ? "K" : "k"}`,
					)
				}
			}
			for (const instruction of scope.instructions) {
				if (instruction.kind === "image") {
					if (plate.colorSpace === "spot" && instruction.overprint) continue
					const projected = projectImage(instruction.image)
					let key = xObjectNames.get(projected)
					if (key === undefined) {
						key = `/PlateImage${xObjects.size}`
						xObjectNames.set(projected, key)
						xObjects.set(key, projected)
					}
					commands.push(`${key} Do`)
					continue
				}
				if (instruction.kind === "form") {
					let projected = projectedForms.get(instruction.form)
					if (projected === undefined) {
						const nested = emit(instruction.form)
						const source = instruction.form.source
						const entries = replaceEntries(source, {
							Resources: nested.resources,
							Filter: undefined,
							DecodeParms: undefined,
						})
						projected = add(
							stream(
								entries.entries,
								nested.data,
								...(entries.byteEntries ?? []),
							),
						)
						projectedForms.set(instruction.form, projected)
					}
					let key = xObjectNames.get(projected)
					if (key === undefined) {
						key = `/PlateForm${xObjects.size}`
						xObjectNames.set(projected, key)
						xObjects.set(key, projected)
					}
					commands.push(`${key} Do`)
					continue
				}
				if (instruction.kind === "raw") {
					const { op, operands } = instruction
					commands.push(`${operands.join(" ")} ${op}`)
					continue
				}
				const fill = projectPaint(instruction.fill, plate)
				const stroke = projectPaint(instruction.stroke, plate)
				color(fill, false)
				color(stroke, true)
				const channels = {
					fill: fill.kind !== "skip",
					stroke: stroke.kind !== "skip",
				}
				if (instruction.kind === "text") {
					const { op, operands } = instruction
					commands.push(
						`${textPaintMode(channels, instruction.clip)} Tr`,
						`${operands.join(" ")} ${op}`,
					)
				} else {
					if (instruction.close) commands.push("h")
					commands.push(pathPaintOperator(channels, instruction.evenOdd))
				}
			}
			const resources = replaceEntries(scope.resources, {
				ColorSpace:
					spotDefinition === undefined
						? undefined
						: dictionary({ PlateInk: spotDefinition }),
				ExtGState:
					scope.states.size === 0
						? undefined
						: resourceDictionary(scope.states),
				XObject: xObjects.size === 0 ? undefined : resourceDictionary(xObjects),
				Pattern: undefined,
				Shading: undefined,
			})
			return {
				data: Buffer.from(commands.join("\n") + "\n", "latin1"),
				resources,
			}
		}
		for (const page of plan.pages) {
			const content = emit(page.scope)
			const value = replaceEntries(page.source, {
				Contents: add(stream({}, content.data)),
				Resources: content.resources,
			})
			// Existing slots stay fixed; each plate only appends new objects.
			const index = objectIndices.get(page.reference.objectNumber)!
			objects[index] = { ...objects[index]!, value }
		}
		// Every leaf and projected Form now has explicit resources. Inherited
		// tables are shadowed, and would otherwise retain the original Form graph.
		for (const [index, object] of objects.entries()) {
			const branch = plan.pageBranches.get(object.objectNumber)
			if (branch !== undefined)
				objects[index] = {
					...object,
					value: replaceEntries(branch, { Resources: undefined }),
				}
		}
		// Copy all retained bytes and dictionaries, including fonts and metadata.
		// Pruning also removes the original, now unreferenced content streams.
		const preview = structuredClone({
			...document,
			objects: reachableObjects(document, objects),
		})
		throwForPdfErrors(validatePdf(preview))
		return { name: plate.name, colorSpace: plate.colorSpace, document: preview }
	})
}

function resourceDictionary(
	entries: ReadonlyMap<string, PdfValue>,
): PdfDictionary {
	return dictionary(
		{},
		...[...entries].map(
			([key, value]) => [nameBytes(nameTokenBytes(key)), value] as const,
		),
	)
}

function reachableObjects(
	document: PdfDocument,
	objects: readonly PdfIndirectObject[],
): PdfIndirectObject[] {
	const byNumber = new Map(
		objects.map((object) => [object.objectNumber, object]),
	)
	const reachable = new Set<number>()
	const pending: (PdfIndirectValue | PdfReference | undefined)[] = [
		document.root,
		document.info,
	]
	while (pending.length > 0) {
		const value = pending.pop()
		if (value === null || typeof value !== "object") continue
		if (value.kind === "reference") {
			if (reachable.has(value.objectNumber)) continue
			reachable.add(value.objectNumber)
			pending.push(byNumber.get(value.objectNumber)?.value)
		} else if (value.kind === "array") {
			for (const item of value.items) pending.push(item)
		} else if (value.kind === "dictionary" || value.kind === "stream") {
			for (const item of Object.values(value.entries)) pending.push(item)
			for (const [, item] of value.byteEntries ?? []) pending.push(item)
		}
	}
	return objects.filter((object) => reachable.has(object.objectNumber))
}
