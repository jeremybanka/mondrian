// SPDX-License-Identifier: MPL-2.0

import type { PdfColorOperation } from "./color.ts"
import {
	ColorScope,
	fillColor,
	paintState,
	preflightColors,
	strokeColor,
} from "./color.ts"
import type { PdfObjectBuilder } from "./object-builder.ts"
import type { PdfDictionary, PdfStream } from "./objects.ts"
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

const bindings = new WeakMap<PdfStream, PdfDictionary>()

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
	const fragments = contents.map((content) => {
		const parts = records.get(content)
		if (parts === undefined)
			throw new TypeError("Unknown PDF color content fragment")
		return parts
	})
	preflightColors(
		objects,
		fragments.flatMap((parts) =>
			parts.filter(
				(part): part is PdfColorOperation => typeof part !== "string",
			),
		),
	)
	const scope = new ColorScope(objects)
	let commands = ""
	for (const parts of fragments) {
		commands += "q\n"
		for (const part of parts)
			commands += typeof part === "string" ? `${part}\n` : scope.encode(part)
		commands += "Q\n"
	}
	const contentStream = stream({}, ascii(commands))
	const resources = scope.resources()
	if (Object.keys(resources.entries).length > 0)
		bindings.set(contentStream, resources)
	return Object.freeze({ stream: contentStream, resources })
}

/** Internal metadata consumed by the shared page-tree validator. */
export function boundColorResources(
	content: PdfStream,
): PdfDictionary | undefined {
	return bindings.get(content)
}
