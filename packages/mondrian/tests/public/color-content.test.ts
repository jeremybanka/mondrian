import { inflateSync } from "node:zlib"
import { expect, it } from "vite-plus/test"
import {
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
} from "mondrian.pdf"

it.each([
	["empty", new Uint8Array()],
	["short", ascii("q\n1 0 0 rg\n0 0 100 100 re f\nQ\n")],
	["all byte values", Uint8Array.from({ length: 256 }, (_, i) => i)],
	["multiple blocks", ascii("0 0 100 100 re f\n".repeat(10_000))],
] as const)(
	"round-trips %s content through zlib-compatible Flate compression",
	(_label, data) => {
		const original = data.slice()
		const bound = { stream: stream({}, data), resources: dictionary({}) }
		const compressed = compressColorContent(bound)
		expect(compressed.stream.entries.Filter).toEqual(name("FlateDecode"))
		expect(new Uint8Array(inflateSync(compressed.stream.data))).toEqual(
			original,
		)
		expect(data).toEqual(original)
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
	const bound = bindColorContent(createPdfObjectBuilder(), [
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
	expect(compressed.resources).toBe(bound.resources)
	expect(compressed.stream.requiredResources).toBe(
		bound.stream.requiredResources,
	)
	expect(compressed.stream.entries.Custom).toEqual(name("Preserved"))
	expect(compressed.stream.byteEntries).toEqual(content.stream.byteEntries)
	expect(compressed.stream.data).not.toBe(content.stream.data)
	expect(Object.isFrozen(compressed)).toBe(true)
	expect(Object.isFrozen(compressed.stream)).toBe(true)
})
