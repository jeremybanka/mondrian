// SPDX-License-Identifier: MPL-2.0

/* eslint-disable no-control-regex -- NUL is PDF whitespace. */

import type {
	PdfDocument,
	PdfIndirectObject,
	PdfIndirectValue,
	PdfDictionary,
	PdfValue,
	PdfCatalogDictionary,
	PdfInfoDictionary,
	PdfStream,
	PdfVersion,
	PdfHexString,
} from "./objects.ts"
import { hexString, indirectObject, reference } from "./objects.ts"
import { PdfParseError } from "./parser/error.ts"
import { binaryText, isKind, SyntaxReader } from "./parser/syntax.ts"
import { decodeStructureStream } from "./parser/filters.ts"
import { DecodeBudget } from "./parser/limits.ts"
import type { PdfParseOptions } from "./parser/limits.ts"

export type { PdfParseOptions } from "./parser/limits.ts"

export { PdfParseError } from "./parser/error.ts"

/** Parse an unencrypted PDF. Strings must contain one code unit per original byte. */
export function parsePdf(
	input: string | Uint8Array,
	options: PdfParseOptions = {},
): PdfDocument {
	let source: string
	if (typeof input === "string") {
		for (let index = 0; index < input.length; index++) {
			if (input.charCodeAt(index) > 255)
				throw new PdfParseError(
					"PDF text must be a byte string; pass the original Uint8Array instead of Unicode-decoded text",
					index,
				)
		}
		source = input
	} else if (input instanceof Uint8Array) source = binaryText(input)
	else throw new TypeError("Expected PDF text or a Uint8Array")
	return new DocumentParser(source, options).parse()
}

type XrefEntry =
	| { readonly type: 0 }
	| { readonly type: 1; readonly offset: number; readonly generation: number }
	| { readonly type: 2; readonly stream: number; readonly index: number }

class DocumentParser {
	readonly source: string
	readonly budget: DecodeBudget
	readonly entries = new Map<number, XrefEntry>()
	readonly objects = new Map<number, PdfIndirectObject>()
	readonly crossReferenceOffsets = new Set<number>()
	readonly loading = new Set<number>()
	readonly objectStreams = new Map<
		number,
		{
			source: string
			first: number
			offsets: readonly (readonly [number, number])[]
		}
	>()

	constructor(source: string, options: PdfParseOptions) {
		this.source = source
		this.budget = new DecodeBudget(options)
	}

	parse(): PdfDocument {
		const header = /^%PDF-(1\.[0-7]|2\.0)(?=[\r\n])/.exec(this.source)
		if (header === null)
			throw new PdfParseError("Expected a PDF 1.0–2.0 header", 0)
		let version = header[1] as PdfVersion
		const ending =
			/startxref[\x00\t\n\f\r ]+(\d+)[\x00\t\n\f\r ]+%%EOF[\x00\t\n\f\r ]*$/.exec(
				this.source,
			)
		if (ending === null)
			throw new PdfParseError(
				"Expected startxref and %%EOF",
				this.source.length,
			)
		let offset: number | undefined = Number(ending[1])
		const visited = new Set<number>()
		let trailer: PdfDictionary | undefined
		while (offset !== undefined) {
			if (visited.has(offset))
				throw new PdfParseError("Cyclic cross-reference chain", offset)
			visited.add(offset)
			const reader: SyntaxReader = this.reader(offset)
			const section = reader.take("xref")
				? this.table(reader)
				: this.xrefStream(reader)
			trailer ??= section.trailer
			const hybridOffset = section.trailer.entries.XRefStm
			if (hybridOffset !== undefined) {
				const hybrid = this.integer(hybridOffset, reader, "XRefStm offset")
				if (visited.has(hybrid))
					reader.fail("Cyclic hybrid cross-reference chain")
				visited.add(hybrid)
				const supplement = this.xrefStream(this.reader(hybrid))
				// Hybrid stream entries supersede this revision's table, not newer revisions.
				for (const [number, entry] of supplement.entries)
					section.entries.set(number, entry)
			}
			for (const [number, entry] of section.entries) {
				if (!this.entries.has(number)) this.entries.set(number, entry)
			}
			const previous = section.trailer.entries.Prev
			offset =
				previous === undefined
					? undefined
					: this.integer(previous, reader, "Prev offset")
		}
		const reader: SyntaxReader = new SyntaxReader(this.source, ending.index)
		if (trailer === undefined) reader.fail("Missing PDF trailer")
		if (trailer.entries.Encrypt != null)
			reader.fail("Encrypted PDFs are not supported")
		const size = this.integer(trailer.entries.Size, reader, "trailer Size")
		for (const number of this.entries.keys()) {
			if (number >= size) this.entries.delete(number)
		}
		for (const [number, entry] of this.entries) {
			if (number === 0 || entry.type === 0) continue
			// Consumed cross-reference streams describe file revisions, not the
			// current object graph. Match offsets so reused object numbers survive.
			if (entry.type === 1 && this.crossReferenceOffsets.has(entry.offset))
				continue
			this.load(number)
		}
		const root = trailer.entries.Root
		if (!isKind(root, "reference"))
			reader.fail("Trailer Root must be an indirect reference")
		const catalog = this.resolve(root)
		if (!isKind(catalog, "dictionary"))
			reader.fail("Trailer Root must resolve to a catalog dictionary")
		const catalogVersion = catalog.entries.Version
		if (isKind(catalogVersion, "name")) {
			if (!/^(1\.[0-7]|2\.0)$/.test(catalogVersion.value))
				reader.fail("Unsupported catalog Version")
			if (catalogVersion.value > version)
				version = catalogVersion.value as PdfVersion
		}
		const info = trailer.entries.Info
		if (info != null && !isKind(info, "reference"))
			reader.fail("Trailer Info must be an indirect reference")
		let id: readonly [PdfHexString, PdfHexString] | undefined
		const identifiers = trailer.entries.ID
		if (identifiers != null) {
			if (!isKind(identifiers, "array") || identifiers.items.length !== 2)
				reader.fail("Trailer ID must contain two strings")
			const strings = identifiers.items.map((value) => {
				if (!isKind(value, "hex-string") && !isKind(value, "literal-string"))
					reader.fail("Trailer ID must contain two strings")
				return hexString(value.bytes)
			})
			id = Object.freeze([strings[0]!, strings[1]!])
		}
		return Object.freeze({
			version,
			root: reference<PdfCatalogDictionary>(root.objectNumber, root.generation),
			objects: Object.freeze(
				[...this.objects.values()].sort(
					(a, b) => a.objectNumber - b.objectNumber,
				),
			),
			...(info == null
				? {}
				: {
						info: reference<PdfInfoDictionary>(
							info.objectNumber,
							info.generation,
						),
					}),
			...(id === undefined ? {} : { id }),
		})
	}

	private reader(offset: number): SyntaxReader {
		if (
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			offset >= this.source.length
		)
			throw new PdfParseError("Offset is outside the PDF input", offset)
		return new SyntaxReader(this.source, offset)
	}

	private integer(
		value: PdfIndirectValue | PdfValue | undefined,
		reader: SyntaxReader,
		description: string,
	): number {
		if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
			reader.fail(`Expected a non-negative integer for ${description}`)
		return value
	}

	private table(reader: SyntaxReader) {
		const entries = new Map<number, XrefEntry>()
		while (!reader.take("trailer")) {
			const first = reader.integer("cross-reference subsection start")
			const count = reader.integer("cross-reference subsection count")
			if (count > this.source.length)
				reader.fail("Cross-reference subsection exceeds the input")
			for (let index = 0; index < count; index++) {
				const offset = reader.integer("object offset")
				const generation = reader.integer("object generation")
				let entry: XrefEntry
				if (reader.take("n")) entry = { type: 1, offset, generation }
				else if (reader.take("f")) entry = { type: 0 }
				else reader.fail("Expected a cross-reference entry status")
				if (entries.has(first + index))
					reader.fail("Overlapping cross-reference subsections")
				entries.set(first + index, entry)
			}
		}
		const trailer = reader.value()
		if (!isKind(trailer, "dictionary"))
			reader.fail("Expected a trailer dictionary")
		return { entries, trailer }
	}

	private xrefStream(reader: SyntaxReader) {
		const offset = reader.position
		const object = reader.indirect((value) => {
			if (isKind(value, "reference"))
				reader.fail("Cross-reference stream Length must be direct")
			return value
		})
		const stream = object.value
		if (
			!isKind(stream, "stream") ||
			!isKind(stream.entries.Type, "name") ||
			stream.entries.Type.value !== "XRef"
		)
			reader.fail("Expected a cross-reference stream")
		this.crossReferenceOffsets.add(offset)
		const data = this.decode(stream, offset)
		const widths = stream.entries.W
		if (!isKind(widths, "array") || widths.items.length !== 3)
			reader.fail("Cross-reference W must contain three integers")
		const w = widths.items.map((width) =>
			this.integer(width, reader, "cross-reference field width"),
		)
		if (w.some((width) => width > 8) || w.every((width) => width === 0))
			reader.fail("Unsupported cross-reference field widths")
		const size = this.integer(
			stream.entries.Size,
			reader,
			"cross-reference Size",
		)
		const index = stream.entries.Index
		if (index !== undefined && !isKind(index, "array"))
			reader.fail("Cross-reference Index must be an array")
		const ranges =
			index === undefined
				? [0, size]
				: index.items.map((value) =>
						this.integer(value, reader, "cross-reference Index"),
					)
		if (ranges.length % 2)
			reader.fail("Cross-reference Index must contain pairs")
		const entries = new Map<number, XrefEntry>()
		let position = 0
		const field = (width: number, fallback = 0) => {
			if (width === 0) return fallback
			let value = 0
			for (let byte = 0; byte < width; byte++) {
				if (position >= data.length)
					reader.fail("Truncated cross-reference stream")
				value = value * 256 + data[position++]!
			}
			if (!Number.isSafeInteger(value))
				reader.fail("Cross-reference field exceeds safe integer precision")
			return value
		}
		for (let range = 0; range < ranges.length; range += 2) {
			const first = ranges[range]!
			const count = ranges[range + 1]!
			for (let entry = 0; entry < count; entry++) {
				const type = field(w[0]!, 1)
				const second = field(w[1]!)
				const third = field(w[2]!)
				if (entries.has(first + entry))
					reader.fail("Overlapping cross-reference Index ranges")
				entries.set(
					first + entry,
					type === 1
						? { type, offset: second, generation: third }
						: type === 2
							? { type, stream: second, index: third }
							: { type: 0 },
				)
			}
		}
		if (position !== data.length)
			reader.fail("Unexpected trailing cross-reference stream data")
		return {
			entries,
			trailer: { kind: "dictionary", entries: stream.entries } as PdfDictionary,
		}
	}

	private resolve(value: PdfValue | undefined): PdfIndirectValue | undefined {
		if (!isKind(value, "reference")) return value
		const object = this.load(value.objectNumber)
		if (object.generation !== value.generation)
			throw new PdfParseError(
				"Reference generation does not match its object",
				this.objectOffset(value.objectNumber),
			)
		return object.value
	}

	private objectOffset(number: number): number {
		const entry = this.entries.get(number)
		return entry?.type === 1 ? entry.offset : 0
	}

	private load(number: number): PdfIndirectObject {
		const cached = this.objects.get(number)
		if (cached !== undefined) return cached
		const entry = this.entries.get(number)
		if (entry === undefined || entry.type === 0)
			throw new PdfParseError(`Missing indirect object ${number}`, 0)
		if (this.loading.has(number) || this.loading.size > 256)
			throw new PdfParseError(
				"Cyclic or excessively nested object dependency",
				this.objectOffset(number),
			)
		this.loading.add(number)
		try {
			let object: PdfIndirectObject
			if (entry.type === 1) {
				const reader: SyntaxReader = this.reader(entry.offset)
				object = reader.indirect((value) => this.resolve(value))
				if (
					object.objectNumber !== number ||
					object.generation !== entry.generation
				)
					reader.fail("Cross-reference entry does not match the object header")
			} else object = this.compressed(number, entry)
			this.objects.set(number, object)
			return object
		} finally {
			this.loading.delete(number)
		}
	}

	private compressed(
		number: number,
		entry: Extract<XrefEntry, { type: 2 }>,
	): PdfIndirectObject {
		const offset = this.objectOffset(entry.stream)
		let container = this.objectStreams.get(entry.stream)
		if (container === undefined) {
			if (this.entries.get(entry.stream)?.type !== 1)
				throw new PdfParseError(
					"Object stream must be an uncompressed indirect object",
					offset,
				)
			const stream = this.load(entry.stream).value
			if (
				!isKind(stream, "stream") ||
				!isKind(stream.entries.Type, "name") ||
				stream.entries.Type.value !== "ObjStm"
			)
				throw new PdfParseError("Expected an object stream", offset)
			const source = binaryText(this.decode(stream, offset))
			const reader: SyntaxReader = new SyntaxReader(source, 0, offset)
			const count = this.integer(
				this.resolve(stream.entries.N),
				reader,
				"object stream N",
			)
			const first = this.integer(
				this.resolve(stream.entries.First),
				reader,
				"object stream First",
			)
			if (count > source.length || first > source.length)
				reader.fail("Invalid object stream header")
			const offsets: [number, number][] = []
			for (let index = 0; index < count; index++)
				offsets.push([
					reader.integer("compressed object number"),
					reader.integer("compressed object offset"),
				])
			reader.skip()
			if (reader.position !== first)
				reader.fail("Object stream First does not match its header")
			container = { source, first, offsets }
			this.objectStreams.set(entry.stream, container)
		}
		const location = container.offsets[entry.index]
		if (location === undefined || location[0] !== number)
			throw new PdfParseError(
				"Object stream index does not match its object number",
				offset,
			)
		const start = container.first + location[1]
		const end =
			container.first +
			(container.offsets[entry.index + 1]?.[1] ??
				container.source.length - container.first)
		if (
			start < container.first ||
			end > container.source.length ||
			end <= start
		)
			throw new PdfParseError("Invalid compressed object bounds", offset)
		const reader: SyntaxReader = new SyntaxReader(
			container.source.slice(start, end),
			0,
			offset,
		)
		const value = reader.value()
		reader.skip()
		if (isKind(value, "reference") || reader.position !== reader.source.length)
			reader.fail("Invalid compressed object body")
		return indirectObject(number, value)
	}

	private decode(stream: PdfStream, offset: number): Uint8Array {
		return decodeStructureStream(
			stream,
			(value) => this.resolve(value),
			offset,
			this.budget,
		)
	}
}
