import type {
	PdfDictionaryEntries,
	PdfDictionaryByteEntry,
	PdfDocument,
	PdfIndirectValue,
	PdfIndirectObject,
	PdfReference,
	PdfStream,
	PdfValue,
} from "./objects.ts"
import { ascii } from "./objects.ts"
import {
	encodePdfHexString,
	encodePdfLiteralString,
	encodePdfName,
	encodePdfNameBytes,
	formatPdfNumber,
} from "./syntax.ts"
import { throwForPdfErrors } from "./diagnostics.ts"
import { validatePdf } from "./validate.ts"

const binaryMarker = Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a)

export function serializePdf(document: PdfDocument): Uint8Array {
	throwForPdfErrors(validatePdf(document))

	const writer = new ByteWriter()
	writer.writeAscii(`%PDF-${document.version}\n`)
	writer.writeBytes(binaryMarker)

	const objects = [...document.objects].sort(
		(left, right) => left.objectNumber - right.objectNumber,
	)
	const offsets = new Map<number, number>()

	for (const object of objects) {
		offsets.set(object.objectNumber, writer.length)
		writeIndirectObject(writer, object)
	}

	const xrefOffset = writer.length
	writer.writeAscii("xref\n")
	writeCrossReferenceTable(writer, objects, offsets)

	const highestObjectNumber = objects.at(-1)?.objectNumber ?? 0
	writer.writeAscii("trailer\n<<")
	writer.writeAscii(` /Size ${highestObjectNumber + 1}`)
	writer.writeAscii(" /Root ")
	writeReference(writer, document.root)
	if (document.info !== undefined) {
		writer.writeAscii(" /Info ")
		writeReference(writer, document.info)
	}

	if (document.id !== undefined) {
		writer.writeAscii(" /ID [")
		writer.writeAscii(encodePdfHexString(document.id[0].bytes))
		writer.writeAscii(" ")
		writer.writeAscii(encodePdfHexString(document.id[1].bytes))
		writer.writeAscii("]")
	}

	writer.writeAscii(` >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
	return writer.toUint8Array()
}

export function serializePdfObjectBody(
	value: PdfValue | PdfStream,
): Uint8Array {
	const writer = new ByteWriter()
	writeValue(writer, value, new Set(), true)
	return writer.toUint8Array()
}

function writeIndirectObject(
	writer: ByteWriter,
	object: PdfIndirectObject,
): void {
	writer.writeAscii(`${object.objectNumber} ${object.generation} obj\n`)
	writeIndirectValue(writer, object.value, new Set())
	writer.writeAscii("\nendobj\n")
}

function writeIndirectValue(
	writer: ByteWriter,
	value: PdfIndirectValue,
	active: Set<object>,
): void {
	writeValue(writer, value, active, true)
}

function writeValue(
	writer: ByteWriter,
	value: PdfValue | PdfStream,
	active: Set<object>,
	allowStream = false,
): void {
	if (value === null) {
		writer.writeAscii("null")
		return
	}

	if (typeof value === "boolean") {
		writer.writeAscii(value ? "true" : "false")
		return
	}

	if (typeof value === "number") {
		writer.writeAscii(formatPdfNumber(value))
		return
	}

	if (value.kind === "reference") {
		writeReference(writer, value)
		return
	}

	if (active.has(value)) {
		throw new TypeError("Direct PDF objects cannot contain cycles")
	}

	active.add(value)
	try {
		if (value.kind === "stream" && !allowStream) {
			throw new TypeError("A PDF stream must be an indirect object")
		}

		switch (value.kind) {
			case "name":
				writer.writeAscii(encodePdfName(value.value))
				break
			case "byte-name":
				writer.writeAscii(encodePdfNameBytes(value.bytes))
				break
			case "literal-string":
				writer.writeAscii(encodePdfLiteralString(value))
				break
			case "hex-string":
				writer.writeAscii(encodePdfHexString(value.bytes))
				break
			case "array":
				writer.writeAscii("[")
				for (let index = 0; index < value.items.length; index += 1) {
					if (index > 0) {
						writer.writeAscii(" ")
					}

					writeValue(writer, value.items[index] as PdfValue, active)
				}
				writer.writeAscii("]")
				break
			case "dictionary":
				writeDictionary(writer, value.entries, value.byteEntries, active)
				break
			case "stream":
				writeDictionary(
					writer,
					value.entries,
					value.byteEntries,
					active,
					value.data.length,
				)
				writer.writeAscii("\nstream\n")
				writer.writeBytes(value.data)
				writer.writeAscii("\nendstream")
				break
		}
	} finally {
		active.delete(value)
	}
}

function writeDictionary(
	writer: ByteWriter,
	entries: PdfDictionaryEntries,
	byteEntries: readonly PdfDictionaryByteEntry[] | undefined,
	active: Set<object>,
	streamLength?: number,
): void {
	writer.writeAscii("<<")
	for (const [key, value] of Object.entries(entries)) {
		if (value === undefined) {
			continue
		}

		writer.writeAscii(` ${encodePdfName(key)} `)
		writeValue(writer, value, active)
	}

	for (const [key, value] of byteEntries ?? []) {
		writer.writeAscii(
			` ${
				key.kind === "name"
					? encodePdfName(key.value)
					: encodePdfNameBytes(key.bytes)
			} `,
		)
		writeValue(writer, value, active)
	}

	if (streamLength !== undefined) {
		writer.writeAscii(` /Length ${streamLength}`)
	}

	writer.writeAscii(" >>")
}

function writeReference(writer: ByteWriter, reference: PdfReference): void {
	writer.writeAscii(`${reference.objectNumber} ${reference.generation} R`)
}

function writeCrossReferenceTable(
	writer: ByteWriter,
	objects: readonly PdfIndirectObject[],
	offsets: ReadonlyMap<number, number>,
): void {
	const highestObjectNumber = objects.at(-1)?.objectNumber ?? 0
	const missingCount = highestObjectNumber - objects.length
	if (missingCount > 1_000_000) {
		throw new RangeError(
			"A PDF object-number range cannot contain more than 1000000 gaps",
		)
	}

	const byNumber = new Map<number, PdfIndirectObject>(
		objects.map((object) => [object.objectNumber, object] as const),
	)
	const freeNumbers: number[] = []
	for (let number = 1; number <= highestObjectNumber; number += 1) {
		if (!byNumber.has(number)) {
			freeNumbers.push(number)
		}
	}

	writer.writeAscii(`0 ${highestObjectNumber + 1}\n`)
	writeXrefEntry(writer, freeNumbers[0] ?? 0, 65_535, false)

	let freeIndex = 0
	for (let number = 1; number <= highestObjectNumber; number += 1) {
		const object = byNumber.get(number)
		if (object !== undefined) {
			writeXrefEntry(writer, offsets.get(number) ?? 0, object.generation, true)
			continue
		}

		freeIndex += 1
		writeXrefEntry(writer, freeNumbers[freeIndex] ?? 0, 0, false)
	}
}

function writeXrefEntry(
	writer: ByteWriter,
	offsetOrNextFree: number,
	generation: number,
	inUse: boolean,
): void {
	if (offsetOrNextFree > 9_999_999_999) {
		throw new RangeError("A PDF cross-reference field exceeds ten digits")
	}

	writer.writeAscii(
		`${offsetOrNextFree.toString().padStart(10, "0")} ${generation
			.toString()
			.padStart(5, "0")} ${inUse ? "n" : "f"} \n`,
	)
}

class ByteWriter {
	#chunks: Uint8Array[] = []
	#length = 0

	get length(): number {
		return this.#length
	}

	writeAscii(value: string): void {
		this.writeBytes(ascii(value))
	}

	writeBytes(value: Uint8Array): void {
		this.#chunks.push(value)
		this.#length += value.length
	}

	toUint8Array(): Uint8Array {
		const result = new Uint8Array(this.#length)
		let offset = 0
		for (const chunk of this.#chunks) {
			result.set(chunk, offset)
			offset += chunk.length
		}

		return result
	}
}
