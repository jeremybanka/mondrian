// SPDX-License-Identifier: MPL-2.0

import type { PdfColorOperation } from "./color.ts"
import { ColorScope, fillColor, paintState, strokeColor } from "./color.ts"
import type { PdfObjectBuilder } from "./object-builder.ts"
import type {
	PdfDictionary,
	PdfDocument,
	PdfIndirectValue,
	PdfStream,
	PdfValue,
} from "./objects.ts"
import { ascii, stream } from "./objects.ts"

declare const colorContentBrand: unique symbol

/** Immutable, document-independent content. Cache this, then bind in each document. */
export interface PdfColorContent {
	readonly [colorContentBrand]: "PdfColorContent"
}

export interface PdfBoundColorContent {
	readonly stream: PdfStream
	/** Install on the page or Form containing the stream, alongside Font/XObject resources. */
	readonly resources: PdfDictionary
}

const bindings = new WeakMap<
	PdfStream,
	{ objects: PdfObjectBuilder; resources: PdfDictionary }
>()

const records = new WeakMap<
	PdfColorContent,
	readonly (string | PdfColorOperation)[]
>()

/**
 * Interleave typed paint operations with existing ASCII path/text/image commands.
 * Raw commands are the object-layer escape hatch: callers own their syntax,
 * balanced state, and non-color resources. Color resource names are reserved.
 */
export function colorContent(
	parts: readonly (string | PdfColorOperation)[],
): PdfColorContent {
	const copied = parts.map((part) => {
		if (typeof part === "string") {
			ascii(part)
			return part
		}
		switch (part?.op) {
			case "fillColor":
				return fillColor(part.color)
			case "strokeColor":
				return strokeColor(part.color)
			case "paintState":
				return paintState(part.state)
			default:
				throw new TypeError("Unknown PDF color content operation")
		}
	})
	const content = Object.freeze({}) as PdfColorContent
	records.set(content, Object.freeze(copied))
	return content
}

/** Bind all page fragments together so resource names cannot collide. */
export function bindColorContent(
	objects: PdfObjectBuilder,
	contents: readonly PdfColorContent[],
): PdfBoundColorContent {
	const scope = new ColorScope(objects)
	let commands = ""
	for (const content of contents) {
		const parts = records.get(content)
		if (parts === undefined)
			throw new TypeError("Unknown PDF color content fragment")
		commands += "q\n"
		for (const part of parts)
			commands += typeof part === "string" ? `${part}\n` : scope.encode(part)
		commands += "Q\n"
	}
	const contentStream = stream({}, ascii(commands))
	const resources = scope.resources()
	if (Object.keys(resources.entries).length > 0)
		bindings.set(contentStream, { objects, resources })
	return Object.freeze({ stream: contentStream, resources })
}

/** Check resource pairing for known bound page streams after normal graph validation. */
export function validateBoundColorContent(
	objects: PdfObjectBuilder,
	document: PdfDocument,
): void {
	const values = new Map(
		document.objects.map((object) => [object.objectNumber, object.value]),
	)
	const resolve = (
		value: PdfValue | PdfIndirectValue | undefined,
	): PdfIndirectValue | undefined => {
		return value !== null &&
			typeof value === "object" &&
			value.kind === "reference"
			? values.get(value.objectNumber)
			: value
	}
	const asDictionary = (
		value: PdfValue | undefined,
	): PdfDictionary | undefined => {
		const resolved = resolve(value)
		return resolved !== null &&
			typeof resolved === "object" &&
			resolved.kind === "dictionary"
			? resolved
			: undefined
	}
	for (const value of values.values()) {
		if (
			value === null ||
			typeof value !== "object" ||
			value.kind !== "dictionary" ||
			typeof value.entries.Type !== "object" ||
			value.entries.Type === null ||
			value.entries.Type.kind !== "name" ||
			value.entries.Type.value !== "Page"
		)
			continue
		let node: PdfDictionary | undefined = value
		let resources: PdfDictionary | undefined
		const visited = new Set<PdfDictionary>()
		while (node !== undefined && !visited.has(node)) {
			visited.add(node)
			if (node.entries.Resources !== undefined) {
				resources = asDictionary(node.entries.Resources)
				break
			}
			node = asDictionary(node.entries.Parent)
		}
		const contents = resolve(value.entries.Contents)
		const streams =
			contents !== null &&
			typeof contents === "object" &&
			contents.kind === "array"
				? contents.items.map(resolve)
				: [contents]
		for (const content of streams) {
			if (
				content === null ||
				typeof content !== "object" ||
				content.kind !== "stream"
			)
				continue
			const binding = bindings.get(content)
			if (binding === undefined) continue
			if (binding.objects !== objects)
				throw new TypeError(
					"Bound PDF color content belongs to another object builder; bind the cached fragment again",
				)
			for (const [category, expected] of Object.entries(
				binding.resources.entries,
			)) {
				if (
					expected === null ||
					typeof expected !== "object" ||
					expected.kind !== "dictionary"
				)
					continue
				const actual = asDictionary(resources?.entries[category])
				for (const [resourceName, reference] of Object.entries(
					expected.entries,
				)) {
					if (actual?.entries[resourceName] !== reference)
						throw new TypeError(
							`Missing or mismatched bound PDF color resource: ${category}.${resourceName}`,
						)
				}
			}
		}
	}
}
