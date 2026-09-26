import { deflateSync } from "node:zlib"
import { expect, it } from "vitest"
import { parsePdf, PdfParseError, serializePdf } from "../../src/index.ts"
import { binaryText, SyntaxReader } from "../../src/parser/syntax.ts"

it.each([
	["(line\rbreak\r\nand\nLF)", "line\nbreak\nand\nLF"],
	["(a\\\rb\\\nc\\\r\nd)", "abcd"],
	[String.raw`(\b\t\n\f\r\q\1\12\1234\777)`, "\b\t\n\f\rq\x01\nS4\xff"],
	["()", ""],
])("decodes literal string syntax %j", (source, expected) => {
	expect(new SyntaxReader(source).value()).toEqual({
		kind: "literal-string",
		bytes: Uint8Array.from(expected, (character) => character.charCodeAt(0)),
	})
})

it.each([
	["/", { kind: "name", value: "" }],
	["/#ef#bb#bf", { kind: "name", value: "\ufeff" }],
	["/caf#c3#a9", { kind: "name", value: "café" }],
	[
		"1 % number\n 2% generation\r R",
		{ kind: "reference", objectNumber: 1, generation: 2 },
	],
	["<>", { kind: "hex-string", bytes: new Uint8Array() }],
	["[1 2 3]", { kind: "array", items: [1, 2, 3] }],
])("reads legal lexical forms %j", (source, expected) => {
	expect(new SyntaxReader(source).value()).toEqual(expected)
})

it.each([
	"(",
	"(abc\\",
	"<1",
	"<1x>",
	"/#x0",
	"/#00",
	"[",
	"<< /A 1 /#41 2 >>",
	"<< true 1 >>",
	"1e3",
	"truex",
	"0 0 R",
	"1 65535 R",
	"[".repeat(258),
])("rejects malformed object syntax %j", (source) => {
	expect(() => new SyntaxReader(source).value()).toThrow(PdfParseError)
})

it("reads large flat arrays without depending on the JavaScript argument limit", () => {
	const value = new SyntaxReader(`[${"0 ".repeat(150_000)}]`).value()
	expect(value).toMatchObject({ kind: "array" })
	if (typeof value === "object" && value?.kind === "array")
		expect(value.items).toHaveLength(150_000)
})

it("follows hybrid cross-references, preferring stream entries to table placeholders", () => {
	const document = parsePdf(structuralPdf({ hybrid: true }))
	expect(
		document.objects.find((object) => object.objectNumber === 4)?.value,
	).toMatchObject({ entries: { Answer: 42 } })
	expect(() => serializePdf(document)).not.toThrow()
})

it("decodes Flate cross-references with PNG Up prediction and compressed objects", () => {
	const document = parsePdf(structuralPdf({ predicted: true }))
	expect(
		document.objects.find((object) => object.objectNumber === 4)?.value,
	).toMatchObject({ entries: { Answer: 42 } })
	expect(parsePdf(serializePdf(document)).objects).toEqual(document.objects)
})

it("uses a newer uncompressed object over an older compressed revision", () => {
	const base = structuralPdf({ hybrid: true })
	const previous = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(base)![1])
	const update = "4 0 obj\n<< /Answer 99 >>\nendobj\n"
	const source =
		base +
		update +
		`xref\n4 1\n${row(base.length)}trailer\n<< /Size 7 /Root 1 0 R /Prev ${previous} >>\nstartxref\n${base.length + update.length}\n%%EOF\n`
	const document = parsePdf(source)
	expect(
		document.objects.find((object) => object.objectNumber === 4)?.value,
	).toMatchObject({ entries: { Answer: 99 } })
})

it("honors the catalog version and preserves sparse object numbers and generations", () => {
	const source = classic(
		[
			[1, 2, "<< /Type /Catalog /Pages 9 3 R /Version /2.0 >>"],
			[9, 3, "<< /Type /Pages /Kids [] /Count 0 >>"],
		],
		"/Root 1 2 R /ID [<00> <01>]",
	)
	const document = parsePdf(source)
	expect(document.version).toBe("2.0")
	expect(
		document.objects.map(({ objectNumber, generation }) => [
			objectNumber,
			generation,
		]),
	).toEqual([
		[1, 2],
		[9, 3],
	])
})

it.each([
	["<< /Type /Catalog >>", "/Root 1 0 R /Info 42", "Info"],
	["<< /Type /Catalog >>", "/Root 1 0 R /ID [1 2]", "two strings"],
	["<< /Type /Catalog >>", "/Root 1 0 R /ID []", "two strings"],
	["<< /Type /Catalog /Version /9.0 >>", "/Root 1 0 R", "Version"],
	["42", "/Root 1 0 R", "catalog"],
	["null", "/Root 5 0 R", "Missing indirect"],
	["null", "/Root 1 1 R", "generation"],
	["null", "/Root 42", "Root"],
	["<< /Length -1 >>\nstream\nx\nendstream", "/Root 1 0 R", "Length"],
	["<< /Length 1 >>\nstream x\nendstream", "/Root 1 0 R", "line feed"],
	["<< /Length 1 0 R >>\nstream\nx\nendstream", "/Root 1 0 R", "Cyclic"],
	["<< /Length 999999 >>\nstream\nx\nendstream", "/Root 1 0 R", "beyond"],
	["<< /Length 1 >>\nstream\nxx\nendstream", "/Root 1 0 R", "endstream"],
	["1 0 R", "/Root 1 0 R", "only a reference"],
])("diagnoses invalid document input %#", (body, trailer, message) => {
	expect(() => parsePdf(classic([[1, 0, body]], trailer))).toThrow(message)
})

it("rejects invalid cross-reference offsets, cycles, and mismatched headers", () => {
	const source = classic([[1, 0, "<< /Type /Catalog >>"]], "/Root 1 0 R")
	const xref = Number(/startxref\n(\d+)/.exec(source)![1])
	expect(() =>
		parsePdf(source.replace(`startxref\n${xref}`, "startxref\n999999")),
	).toThrow(/outside/)
	expect(() =>
		parsePdf(source.replace("/Root", `/Prev ${xref} /Root`)),
	).toThrow(/Cyclic/)
	expect(() => parsePdf(source.replace("1 0 obj", "2 0 obj"))).toThrow(/header/)
	expect(() => parsePdf(source.replace(" n \n", " x \n"))).toThrow(/status/)
	expect(() =>
		parsePdf(source.replace("trailer\n<<", "trailer\n42 %")),
	).toThrow(/dictionary/)
})

it("rejects damaged compressed structures without scanning for replacement objects", () => {
	const source = structuralPdf({})
	expect(() => parsePdf(source.replace("/W [1 4 2]", "/W [1 4 9]"))).toThrow(
		/widths/,
	)
	expect(() => parsePdf(source.replace("/W [1 4 2]", "/W [0 0 0]"))).toThrow(
		/widths/,
	)
	expect(() => parsePdf(source.replace("/N 1", "/N 9"))).toThrow(PdfParseError)
	expect(() => parsePdf(source.replace("/First 4", "/First 9"))).toThrow(
		/First/,
	)
})

function row(offset: number, generation = 0): string {
	return `${String(offset).padStart(10, "0")} ${String(generation).padStart(5, "0")} n \n`
}

function classic(objects: [number, number, string][], trailer: string): string {
	let source = "%PDF-1.7\n"
	let rows = "0 1\n0000000000 65535 f \n"
	for (const [number, generation, body] of objects) {
		rows += `${number} 1\n${row(source.length, generation)}`
		source += `${number} ${generation} obj\n${body}\nendobj\n`
	}
	return (
		source +
		`xref\n${rows}trailer\n<< /Size ${Math.max(...objects.map(([number]) => number)) + 1} ${trailer} >>\nstartxref\n${source.length}\n%%EOF\n`
	)
}

function structuralPdf(options: {
	hybrid?: boolean
	predicted?: boolean
}): string {
	let source = "%PDF-1.7\n"
	const offsets = new Map<number, number>()
	const add = (number: number, body: string) => {
		offsets.set(number, source.length)
		source += `${number} 0 obj\n${body}\nendobj\n`
	}
	add(1, "<< /Type /Catalog /Pages 2 0 R /Extra 4 0 R >>")
	add(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	add(
		3,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>",
	)
	const objects = "4 0 << /Answer 42 >>"
	const compressed = binaryText(deflateSync(objects))
	add(
		5,
		`<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n${compressed}\nendstream`,
	)
	offsets.set(6, source.length)
	const records = new Uint8Array(7 * 7)
	const view = new DataView(records.buffer)
	for (let number = 0; number < 7; number++) {
		const position = number * 7
		records[position] = number === 0 ? 0 : number === 4 ? 2 : 1
		view.setUint32(position + 1, number === 4 ? 5 : (offsets.get(number) ?? 0))
		view.setUint16(position + 5, number === 0 ? 65535 : 0)
	}
	let data = records
	let filters = ""
	if (options.predicted) {
		const predicted = new Uint8Array(7 * 8)
		for (let row = 0; row < 7; row++) {
			predicted[row * 8] = 2
			for (let byte = 0; byte < 7; byte++)
				predicted[row * 8 + byte + 1] =
					records[row * 7 + byte]! -
					(row === 0 ? 0 : records[(row - 1) * 7 + byte]!)
		}
		data = Uint8Array.from(deflateSync(predicted))
		filters = "/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >>"
	}
	add(
		6,
		`<< /Type /XRef /Size 7 /Root 1 0 R /W [1 4 2] /Index [0 7] ${filters} /Length ${data.length} >>\nstream\n${binaryText(data)}\nendstream`,
	)
	let xref = offsets.get(6)!
	if (options.hybrid) {
		xref = source.length
		source += "xref\n0 7\n0000000000 65535 f \n"
		for (let number = 1; number < 7; number++)
			source +=
				number === 4 ? "0000000000 00000 f \n" : row(offsets.get(number)!)
		source += `trailer\n<< /Size 7 /Root 1 0 R /XRefStm ${offsets.get(6)} >>\n`
	}
	return source + `startxref\n${xref}\n%%EOF\n`
}
