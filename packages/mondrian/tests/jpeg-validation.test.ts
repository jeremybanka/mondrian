import { describe, expect, it } from "vite-plus/test"

import { createPdfDocument } from "../src/document-builder.ts"
import { grayscaleJpeg, rgbJpeg } from "./fixtures.ts"

describe("JPEG validation", () => {
	it("rejects invalid inputs and malformed marker framing", () => {
		const pdf = createPdfDocument()
		expect(() => pdf.jpeg("jpeg" as never)).toThrow("must be a Uint8Array")
		expect(() => pdf.jpeg(new Uint8Array())).toThrow("cannot be empty")
		expect(() => pdf.jpeg(Uint8Array.of(0xff, 0xd9))).toThrow("SOI marker")
		expect(() => pdf.jpeg(Uint8Array.of(0xff, 0xd8, 0x01, 0x02))).toThrow(
			"bytes outside a marker segment",
		)
		expect(() => pdf.jpeg(Uint8Array.of(0xff, 0xd8, 0xff, 0xdb, 0x00))).toThrow(
			"missing its segment length",
		)
		expect(() =>
			pdf.jpeg(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01)),
		).toThrow("invalid segment length")
	})

	it("rejects unsupported or invalid frame headers", () => {
		const pdf = createPdfDocument()
		expect(() => pdf.jpeg(Uint8Array.of(0xff, 0xd8, 0xff, 0xff))).toThrow(
			"does not contain a supported frame header",
		)
		const progressive = mutateMarker(rgbJpeg(), 0xc0, 1, 0xc2)
		expect(() => pdf.jpeg(progressive)).toThrow("Only baseline JPEG")

		const truncatedFrame = mutateMarker(rgbJpeg(), 0xc0, 3, 7)
		expect(() => pdf.jpeg(truncatedFrame)).toThrow("frame header is truncated")

		const wrongBitDepth = mutateMarker(rgbJpeg(), 0xc0, 4, 12)
		expect(() => pdf.jpeg(wrongBitDepth)).toThrow("Only 8-bit JPEG")

		const invalidComponents = mutateMarker(rgbJpeg(), 0xc0, 9, 4)
		expect(() => pdf.jpeg(invalidComponents)).toThrow("frame header is invalid")
		expect(() => pdf.jpeg(expandGrayscaleFrameToTwoComponents())).toThrow(
			"Only grayscale and three-component JPEG",
		)

		const invalidSampling = mutateMarker(rgbJpeg(), 0xc0, 11, 0)
		expect(() => pdf.jpeg(invalidSampling)).toThrow(
			"sampling factors are invalid",
		)
		const invalidTableReference = mutateMarker(rgbJpeg(), 0xc0, 12, 4)
		expect(() => pdf.jpeg(invalidTableReference)).toThrow(
			"frame components are invalid",
		)
	})

	it("rejects malformed quantization and Huffman tables", () => {
		const pdf = createPdfDocument()
		const zeroCoefficient = mutateMarker(rgbJpeg(), 0xdb, 5, 0)
		expect(() => pdf.jpeg(zeroCoefficient)).toThrow(
			"quantization coefficients must be greater than zero",
		)

		const invalidQuantizationTable = mutateMarker(rgbJpeg(), 0xdb, 4, 0x24)
		expect(() => pdf.jpeg(invalidQuantizationTable)).toThrow(
			"quantization table is invalid",
		)

		const oversubscribedHuffmanTable = mutateMarker(rgbJpeg(), 0xc4, 5, 3)
		expect(() => pdf.jpeg(oversubscribedHuffmanTable)).toThrow(
			"Huffman table is oversubscribed",
		)

		const invalidHuffmanTable = mutateMarker(rgbJpeg(), 0xc4, 4, 0x24)
		expect(() => pdf.jpeg(invalidHuffmanTable)).toThrow(
			"Huffman table is invalid",
		)

		const truncatedHuffmanTable = mutateMarker(rgbJpeg(), 0xc4, 3, 3)
		expect(() => pdf.jpeg(truncatedHuffmanTable)).toThrow(
			"Huffman table is truncated",
		)

		const emptyHuffmanTable = zeroHuffmanCounts(rgbJpeg())
		expect(() => pdf.jpeg(emptyHuffmanTable)).toThrow("invalid symbol count")

		const invalidDcSymbol = mutateMarker(rgbJpeg(), 0xc4, 21, 12)
		expect(() => pdf.jpeg(invalidDcSymbol)).toThrow("invalid symbol")
		const invalidAcSymbol = mutateMarker(rgbJpeg(), 0xc4, 21, 0x0b, 1)
		expect(() => pdf.jpeg(invalidAcSymbol)).toThrow("invalid symbol")
	})

	it("requires a complete baseline scan and end marker", () => {
		const pdf = createPdfDocument()
		const nonSequentialScan = mutateMarker(rgbJpeg(), 0xda, 11, 1)
		expect(() => pdf.jpeg(nonSequentialScan)).toThrow(
			"scan is not baseline sequential data",
		)

		const withoutEnd = rgbJpeg().slice(0, -2)
		expect(() => pdf.jpeg(withoutEnd)).toThrow(
			"must contain quantization, Huffman, scan-data, and EOI segments",
		)

		const invalidScanHeader = mutateMarker(rgbJpeg(), 0xda, 4, 0)
		expect(() => pdf.jpeg(invalidScanHeader)).toThrow("scan header is invalid")
	})

	it("accepts standalone restart markers outside entropy data", () => {
		const bytes = insertBytes(rgbJpeg(), 2, Uint8Array.of(0xff, 0xd0))
		expect(() => createPdfDocument().jpeg(bytes)).not.toThrow()
	})
})

function mutateMarker(
	bytes: Uint8Array,
	marker: number,
	offset: number,
	value: number,
	occurrence = 0,
): Uint8Array {
	const result = bytes.slice()
	let found = 0
	for (let index = 0; index + 1 < result.length; index += 1) {
		if (result[index] === 0xff && result[index + 1] === marker) {
			if (found === occurrence) {
				result[index + offset] = value
				return result
			}
			found += 1
		}
	}
	throw new Error(`Marker ${marker.toString(16)} not found`)
}

function expandGrayscaleFrameToTwoComponents(): Uint8Array {
	const bytes = grayscaleJpeg()
	const marker = markerOffset(bytes, 0xc0)
	const result = insertBytes(
		bytes,
		marker + 13,
		Uint8Array.of(0x02, 0x11, 0x00),
	)
	result[marker + 3] = 14
	result[marker + 9] = 2
	return result
}

function zeroHuffmanCounts(bytes: Uint8Array): Uint8Array {
	const result = bytes.slice()
	const marker = markerOffset(result, 0xc4)
	result.fill(0, marker + 5, marker + 21)
	return result
}

function markerOffset(bytes: Uint8Array, marker: number): number {
	for (let index = 0; index + 1 < bytes.length; index += 1) {
		if (bytes[index] === 0xff && bytes[index + 1] === marker) {
			return index
		}
	}
	throw new Error(`Marker ${marker.toString(16)} not found`)
}

function insertBytes(
	bytes: Uint8Array,
	offset: number,
	inserted: Uint8Array,
): Uint8Array {
	const result = new Uint8Array(bytes.length + inserted.length)
	result.set(bytes.slice(0, offset))
	result.set(inserted, offset)
	result.set(bytes.slice(offset), offset + inserted.length)
	return result
}
