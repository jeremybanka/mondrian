import { inflateSync } from "node:zlib"
import { expect, it } from "vite-plus/test"
import type {
	PdfBoundColorContent,
	PdfDictionary,
	PdfObjectBuilder,
	PdfPagesDictionary,
} from "mondrian.pdf"
import {
	array,
	ascii,
	bindColorContent,
	colorContent,
	compressColorContent,
	createPdfObjectBuilder,
	dictionary,
	dictionaryEntry,
	fillColor,
	name,
	nameBytes,
	rgb,
	separation,
	spot,
	stream,
	validatePdf,
} from "mondrian.pdf"

it.each([
	["empty", new Uint8Array()],
	["short", ascii("q\n1 0 0 rg\n0 0 100 100 re f\nQ\n")],
	["all byte values", Uint8Array.from({ length: 256 }, (_, i) => i)],
	["large repetitive", ascii("0 0 100 100 re f\n".repeat(10_000))],
] as const)(
	"round-trips %s content through zlib-compatible Flate compression",
	(_label, data) => {
		const bound = { stream: stream({}, data), resources: dictionary({}) }
		const original = bound.stream.data.slice()
		const compressed = compressColorContent(bound)
		expect(bound.stream.data).toEqual(original)
		expect(compressed.stream.entries.Filter).toEqual(name("FlateDecode"))
		expect(new Uint8Array(inflateSync(compressed.stream.data))).toEqual(
			original,
		)
		expect(bound.stream.entries).not.toHaveProperty("Filter")
		expect(compressColorContent(bound).stream.data).toEqual(
			compressed.stream.data,
		)
	},
)

it("preserves bound resources and stream entries while copying compressed data", () => {
	const ink = separation("Compression Red", {
		type: "exponential",
		zero: rgb(1, 1, 1),
		full: rgb(1, 0, 0),
		exponent: 1,
	})
	const objects = createPdfObjectBuilder()
	const bound = bindColorContent(objects, [
		colorContent([fillColor(spot(ink, 1)), "0 0 100 100 re f"]),
	])
	const content = {
		...bound,
		stream: {
			...bound.stream,
			...stream(
				{ Custom: name("Preserved") },
				bound.stream.data,
				dictionaryEntry(nameBytes(ascii("ByteKey")), 42),
			),
		},
	}
	const compressed = compressColorContent(content)
	expect(compressed.resources).toEqual(bound.resources)
	expect(compressed.stream.requiredResources).toEqual(
		bound.stream.requiredResources,
	)
	expect(compressed.stream.entries.Custom).toEqual(name("Preserved"))
	expect(compressed.stream.byteEntries).toEqual(content.stream.byteEntries)
	expect(compressed.stream.data).not.toBe(content.stream.data)
	expect(Object.isFrozen(compressed)).toBe(true)
	expect(Object.isFrozen(compressed.stream)).toBe(true)
	expect(
		validatePdf(colorPage(objects, compressed, compressed.resources)),
	).toEqual([])
	expect(() => colorPage(objects, compressed, dictionary({}))).toThrow(
		expect.objectContaining({
			diagnostics: expect.arrayContaining([
				expect.objectContaining({ code: "invalid-color-resource" }),
			]),
		}),
	)
})

function colorPage(
	objects: PdfObjectBuilder,
	content: PdfBoundColorContent,
	resources: PdfDictionary,
) {
	const pages = objects.reserve<PdfPagesDictionary>()
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 100, 100),
			Resources: resources,
			Contents: objects.add(content.stream),
		}),
	)
	pages.set(dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }))
	const root = objects.add(
		dictionary({ Type: name("Catalog"), Pages: pages.ref }),
	)
	return objects.build({ root })
}
