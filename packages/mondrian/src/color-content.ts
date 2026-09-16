// SPDX-License-Identifier: MPL-2.0

import { deflateSync } from "node:zlib"
import { dictionaryValue } from "./dictionary-lookup.ts"
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
import { array, ascii, name, stream } from "./objects.ts"

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
	const resources = scope.resources()
	const contentStream = Object.freeze({
		...stream({}, ascii(commands)),
		...(Object.keys(resources.entries).length > 0
			? { requiredResources: resources }
			: {}),
	})
	return Object.freeze({ stream: contentStream, resources })
}

/** Internal metadata consumed by the shared page-tree validator. */
export function boundColorResources(
	content: PdfStream,
): PdfDictionary | undefined {
	return content.requiredResources
}

/** Compress bound content without discarding its resource requirements. */
export function compressColorContent(
	content: PdfBoundColorContent,
): PdfBoundColorContent {
	if (
		dictionaryValue(content.stream, "Filter") !== undefined ||
		dictionaryValue(content.stream, "DecodeParms") !== undefined
	) {
		throw new TypeError(
			"Color content compression requires an unfiltered stream",
		)
	}
	const compressed = Object.freeze({
		...content.stream,
		...stream(
			{ ...content.stream.entries, Filter: name("FlateDecode") },
			deflateSync(content.stream.data),
			...(content.stream.byteEntries ?? []),
		),
	})
	return Object.freeze({ stream: compressed, resources: content.resources })
}

/** Wrap bound content in a self-contained Form, retaining its resource requirements. */
export function formColorContent(
	content: PdfBoundColorContent,
	bbox: readonly [number, number, number, number],
): PdfStream {
	if (
		!Array.isArray(bbox) ||
		bbox.length !== 4 ||
		!bbox.every(Number.isFinite) ||
		bbox[2] <= bbox[0] ||
		bbox[3] <= bbox[1]
	) {
		throw new TypeError(
			"A color Form requires a finite bounding box with positive width and height",
		)
	}
	if (
		dictionaryValue(content.stream, "Type") !== undefined ||
		dictionaryValue(content.stream, "Subtype") !== undefined
	) {
		throw new TypeError("A color Form requires an ordinary content stream")
	}
	return Object.freeze({
		...content.stream,
		...stream(
			{
				...content.stream.entries,
				Type: name("XObject"),
				Subtype: name("Form"),
				BBox: array(bbox[0], bbox[1], bbox[2], bbox[3]),
				Resources: content.resources,
			},
			content.stream.data,
			...(content.stream.byteEntries ?? []),
		),
	})
}
