import { deflateSync } from "node:zlib"
import { expect, it } from "vitest"
import { parsePdf, PdfParseError } from "../../src/index.ts"
import { binaryText } from "../../src/parser/syntax.ts"

it.each([
	"FlateDecode",
	"LZWDecode",
	"RunLengthDecode",
	"ASCII85Decode",
	"ASCIIHexDecode",
	"none",
])("bounds %s structural output before object parsing", (filter) => {
	const text = "4 0 (" + "A".repeat(64) + ")"
	const source = limitedPdf([{ filter, bytes: encode(filter, text) }])
	expect(() => parsePdf(source, { maxDecodedStreamBytes: 32 })).toThrow(
		/decoded-byte limit/,
	)
	expect(() =>
		parsePdf(source, { maxDecodedStreamBytes: text.length }),
	).not.toThrow()
})

it("stops Flate expansion before processing a damaged later block", () => {
	const compressed = deflateSync("4 0 (" + "A".repeat(1024 * 1024) + ")")
	const damaged = compressed.subarray(0, compressed.length - 100)
	expect(() =>
		parsePdf(limitedPdf([{ filter: "FlateDecode", bytes: damaged }]), {
			maxDecodedStreamBytes: 128,
		}),
	).toThrow(/decoded-byte limit/)
})

it("counts intermediate filter outputs even when the final output is smaller", () => {
	const text = "4 0 (" + "A".repeat(64) + ")"
	const hex = Buffer.from(text).toString("hex") + ">"
	const source = limitedPdf([
		{ filter: "[/FlateDecode /ASCIIHexDecode]", bytes: deflateSync(hex) },
	])
	expect(() => parsePdf(source, { maxDecodedStreamBytes: 100 })).toThrow(
		/decoded-byte limit/,
	)
	expect(() =>
		parsePdf(source, {
			maxTotalDecodedBytes: 7 + hex.length + text.length - 1,
		}),
	).toThrow(/decoded-byte limit/)
	expect(() =>
		parsePdf(source, { maxTotalDecodedBytes: 7 + hex.length + text.length }),
	).not.toThrow()
})

it("shares the decoded-byte budget across structural streams", () => {
	const source = limitedPdf(
		[4, 5].map((number) => ({
			filter: "FlateDecode",
			bytes: deflateSync(`${number} 0 (abcdefghij)`),
		})),
	)
	// Two seven-byte xref records and two sixteen-byte object streams.
	expect(() => parsePdf(source, { maxTotalDecodedBytes: 45 })).toThrow(
		/decoded-byte limit/,
	)
	expect(() => parsePdf(source, { maxTotalDecodedBytes: 46 })).not.toThrow()
})

it("counts decoded predictor output as well as the filter output", () => {
	const text = "4 0 (abcdefghij)"
	const source = limitedPdf([
		{
			filter: "FlateDecode",
			bytes: deflateSync(Uint8Array.from([0, ...Buffer.from(text)])),
			parameters: `/DecodeParms << /Predictor 15 /Columns ${text.length} >>`,
		},
	])
	expect(() =>
		parsePdf(source, { maxTotalDecodedBytes: 7 + 17 + 16 - 1 }),
	).toThrow(/decoded-byte limit/)
	expect(() =>
		parsePdf(source, { maxTotalDecodedBytes: 7 + 17 + 16 }),
	).not.toThrow()
})

it.each([-1, Infinity, NaN, 1.5])(
	"rejects invalid decoded-byte limits %s",
	(limit) => {
		const source = limitedPdf([
			{ filter: "none", bytes: Buffer.from("4 0 (ok)") },
		])
		expect(() => parsePdf(source, { maxDecodedStreamBytes: limit })).toThrow(
			RangeError,
		)
		expect(() => parsePdf(source, { maxTotalDecodedBytes: limit })).toThrow(
			RangeError,
		)
	},
)

it("reports the structural container's offset when a budget is exceeded", () => {
	const source = limitedPdf([
		{
			filter: "FlateDecode",
			bytes: deflateSync("4 0 (" + "A".repeat(64) + ")"),
		},
	])
	try {
		parsePdf(source, { maxDecodedStreamBytes: 32 })
		expect.fail("Expected a decoded-byte limit error")
	} catch (error) {
		expect(error).toBeInstanceOf(PdfParseError)
		expect(error).toHaveProperty("offset", source.indexOf("5 0 obj"))
	}
})

function encode(filter: string, text: string): Uint8Array {
	if (filter === "FlateDecode") return deflateSync(text)
	if (filter === "ASCIIHexDecode")
		return Buffer.from(Buffer.from(text).toString("hex") + ">")
	if (filter === "RunLengthDecode")
		return Uint8Array.from([text.length - 1, ...Buffer.from(text), 128])
	if (filter === "LZWDecode") {
		const bits = [256, ...Buffer.from(text), 257]
			.map((code) => code.toString(2).padStart(9, "0"))
			.join("")
		return Uint8Array.from({ length: Math.ceil(bits.length / 8) }, (_, index) =>
			Number.parseInt(bits.slice(index * 8, index * 8 + 8).padEnd(8, "0"), 2),
		)
	}
	if (filter === "ASCII85Decode") {
		let encoded = ""
		for (let index = 0; index < text.length; index += 4) {
			const count = Math.min(4, text.length - index)
			let number = 0
			for (let byte = 0; byte < 4; byte++)
				number =
					number * 256 + (byte < count ? text.charCodeAt(index + byte) : 0)
			let group = ""
			for (let digit = 0; digit < 5; digit++) {
				group = String.fromCharCode(33 + (number % 85)) + group
				number = Math.floor(number / 85)
			}
			encoded += group.slice(0, count + 1)
		}
		return Buffer.from(encoded + "~>")
	}
	return Buffer.from(text)
}

function limitedPdf(
	streams: { filter: string; bytes: Uint8Array; parameters?: string }[],
): string {
	let source = "%PDF-1.7\n"
	const offsets = new Map<number, number>()
	const add = (number: number, body: string) => {
		offsets.set(number, source.length)
		source += `${number} 0 obj\n${body}\nendobj\n`
	}
	add(1, "<< /Type /Catalog /Pages 2 0 R >>")
	add(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	add(
		3,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>",
	)
	const firstStream = 4 + streams.length
	const xrefNumber = firstStream + streams.length
	const records = new Uint8Array(streams.length * 7)
	for (const [index, stream] of streams.entries()) {
		const filter =
			stream.filter === "none"
				? ""
				: `/Filter ${stream.filter.startsWith("[") ? stream.filter : "/" + stream.filter}`
		add(
			firstStream + index,
			`<< /Type /ObjStm /N 1 /First 4 ${filter} ${stream.parameters ?? ""} /Length ${stream.bytes.length} >>\nstream\n${binaryText(stream.bytes)}\nendstream`,
		)
		records[index * 7] = 2
		new DataView(records.buffer).setUint32(index * 7 + 1, firstStream + index)
	}
	const supplemental = source.length
	add(
		xrefNumber,
		`<< /Type /XRef /Size ${xrefNumber + 1} /W [1 4 2] /Index [4 ${streams.length}] /Length ${records.length} >>\nstream\n${binaryText(records)}\nendstream`,
	)
	const start = source.length
	source += "xref\n0 1\n0000000000 65535 f \n"
	for (const [number, offset] of offsets)
		source += `${number} 1\n${String(offset).padStart(10, "0")} 00000 n \n`
	return (
		source +
		`trailer\n<< /Size ${xrefNumber + 1} /Root 1 0 R /XRefStm ${supplemental} >>\nstartxref\n${start}\n%%EOF\n`
	)
}
