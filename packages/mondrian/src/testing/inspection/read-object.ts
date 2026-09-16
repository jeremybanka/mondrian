// SPDX-License-Identifier: MPL-2.0

import { createRequire } from "node:module"
import {
	PDFArray,
	PDFBool,
	PDFContext,
	PDFDict,
	PDFHexString,
	PDFName,
	PDFNull,
	PDFNumber,
	PDFObjectParser,
	PDFRef,
	PDFString,
} from "pdf-lib"
import type { PDFObject } from "pdf-lib"

export type DecodedPdfObject =
	| null
	| boolean
	| number
	| { name: number[] }
	| { bytes: number[] }
	| { reference: [number, number] }
	| DecodedPdfObject[]
	| Map<string, DecodedPdfObject>

/** Decode primitive bodies with an independent parser.
 * Names and strings retain bytes; dictionary order and lexical choices do not.
 * The name adapter accepts lowercase as well as uppercase name escapes.
 */
export function readPdfObject(bytes: Uint8Array): DecodedPdfObject {
	return decode(
		new NameCompatibleParser(
			ByteStream.of(bytes),
			PDFContext.create(),
		).parseObject(),
	)
}

function decode(value: PDFObject): DecodedPdfObject {
	if (value === PDFNull) return null
	if (value instanceof PDFBool) return value.asBoolean()
	if (value instanceof PDFNumber) return value.asNumber()
	if (value instanceof PDFName) return { name: Array.from(value.asBytes()) }
	if (value instanceof PDFString || value instanceof PDFHexString)
		return { bytes: Array.from(value.asBytes()) }
	if (value instanceof PDFRef)
		return { reference: [value.objectNumber, value.generationNumber] }
	if (value instanceof PDFArray) return value.asArray().map(decode)
	if (value instanceof PDFDict)
		return new Map(
			value
				.entries()
				.map(([key, item]) => [
					Buffer.from(key.asBytes()).toString("hex"),
					decode(item),
				]),
		)
	throw new Error(
		`Unsupported primitive in PDF object reader: ${value.constructor.name}`,
	)
}

// pdf-lib 1.17.1 decodes only uppercase #XX name escapes. Accept the full PDF
// lexical grammar here so the independent reader does not freeze capitalization.
// ByteStream is an internal dependency of this explicitly pinned parser version.
const { default: ByteStream } = createRequire(import.meta.url)(
	"pdf-lib/cjs/core/parser/ByteStream.js",
) as typeof import("pdf-lib/cjs/core/parser/ByteStream.js")

class NameCompatibleParser extends PDFObjectParser {
	protected override parseName(): PDFName {
		this.bytes.assertNext(0x2f)
		let encoded = ""
		while (!this.bytes.done()) {
			const byte = this.bytes.peek()
			if (
				[
					0, 9, 10, 12, 13, 32, 40, 41, 60, 62, 91, 93, 123, 125, 47, 37,
				].includes(byte)
			)
				break
			encoded += String.fromCharCode(this.bytes.next())
		}
		return PDFName.of(
			encoded.replace(/#[\da-f]{2}/giu, (escape) => escape.toUpperCase()),
		)
	}
}
