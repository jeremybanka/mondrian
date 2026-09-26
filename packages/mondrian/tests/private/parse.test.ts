import { expect, it } from "vitest"
import { classic, row, structuralPdf } from "../fixtures/parser.ts"
import { parsePdf, PdfParseError, serializePdf } from "../../src/index.ts"
import { SyntaxReader } from "../../src/parser/syntax.ts"

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

it.each(["Prev", "XRefStm"])(
	"treats a null optional trailer /%s as absent",
	(key) => {
		const objects: [number, number, string][] = [[1, 0, "<< /Type /Catalog >>"]]
		expect(parsePdf(classic(objects, `/Root 1 0 R /${key} null`))).toEqual(
			parsePdf(classic(objects, "/Root 1 0 R")),
		)
	},
)

it("uses the default cross-reference range for a null /Index", () => {
	const source = structuralPdf({})
	expect(parsePdf(source.replace("/Index [0 7]", "/Index null"))).toEqual(
		parsePdf(source),
	)
})

it("resolves an indirect object-stream Type before unpacking its objects", () => {
	const document = parsePdf(structuralPdf({ indirectType: true }))
	expect(
		document.objects.find((object) => object.objectNumber === 4)?.value,
	).toMatchObject({ entries: { Answer: 42 } })
	expect(() => serializePdf(document)).not.toThrow()
})

it("preserves braces in ordinary PDF 2.0 names and dictionary keys", () => {
	const source = classic(
		[
			[1, 0, "<< /Type /Catalog /Pages 2 0 R /Extra 4 0 R >>"],
			[2, 0, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
			[
				3,
				0,
				"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>",
			],
			[4, 0, "<< /Key /A{B} /A{B} /C}D{ >>"],
		],
		"/Root 1 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]",
	).replace("%PDF-1.7", "%PDF-2.0")
	const document = parsePdf(source)
	expect(
		document.objects.find((object) => object.objectNumber === 4)?.value,
	).toMatchObject({
		entries: {
			Key: { kind: "name", value: "A{B}" },
			"A{B}": { kind: "name", value: "C}D{" },
		},
	})
	expect(parsePdf(serializePdf(document))).toEqual(document)
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

it.each([
	["1.7", "1.7"],
	["1.2", "1.4"],
])(
	"resolves indirect catalog version %s without downgrading the header",
	(catalogVersion, expected) => {
		const source = classic(
			[
				[1, 0, "<< /Type /Catalog /Pages 2 0 R /Version 4 0 R >>"],
				[2, 0, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
				[
					3,
					0,
					"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>",
				],
				[4, 0, `/${catalogVersion}`],
			],
			"/Root 1 0 R",
		).replace("%PDF-1.7", "%PDF-1.4")
		const document = parsePdf(source)
		expect(document.version).toBe(expected)
		expect(
			Buffer.from(serializePdf(document)).toString("latin1").split("\n")[0],
		).toBe(`%PDF-${expected}`)
	},
)

it("rejects an unsupported indirect catalog version", () => {
	expect(() =>
		parsePdf(
			classic(
				[
					[1, 0, "<< /Type /Catalog /Version 2 0 R >>"],
					[2, 0, "/9.0"],
				],
				"/Root 1 0 R",
			),
		),
	).toThrow(/Unsupported catalog Version/)
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
	["null", "/Root 5 0 R", "catalog dictionary"],
	["null", "/Root 1 1 R", "catalog dictionary"],
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

it.each([
	["/Type /XRef", "/Type /Other", "Expected a cross-reference stream"],
	[
		"/Length 49",
		"/Length 1 0 R",
		"Cross-reference stream Length must be direct",
	],
	["/W [1 4 2]", "/W [1 4]", "Cross-reference W must contain three integers"],
	[
		"/W [1 4 2]",
		"/W [1 -4 2]",
		"Expected a non-negative integer for cross-reference field width",
	],
	["/Index [0 7]", "/Index 7", "Cross-reference Index must be an array"],
	["/Index [0 7]", "/Index [0]", "Cross-reference Index must contain pairs"],
	[
		"/Index [0 7]",
		"/Index [0 1 0 1]",
		"Overlapping cross-reference Index ranges",
	],
	["/Index [0 7]", "/Index [0 8]", "Truncated cross-reference stream"],
	[
		"/Index [0 7]",
		"/Index [0 6]",
		"Unexpected trailing cross-reference stream data",
	],
])(
	"diagnoses damaged cross-reference metadata %s → %s",
	(original, replacement, message) => {
		const source = structuralPdf({})
		expect(source).toContain(original)
		const damaged = source.replace(original, replacement)
		expect(() => parsePdf(damaged)).toThrow(PdfParseError)
		expect(() => parsePdf(damaged)).toThrow(message)
	},
)

it.each([
	[
		"xref\n0 1",
		"xref\n0 999999",
		"Cross-reference subsection exceeds the input",
	],
	[
		"trailer\n",
		"1 1\n0000000009 00000 n \ntrailer\n",
		"Overlapping cross-reference subsections",
	],
])(
	"diagnoses damaged classic cross-references %s",
	(original, replacement, message) => {
		const source = classic([[1, 0, "<< /Type /Catalog >>"]], "/Root 1 0 R")
		expect(source).toContain(original)
		const damaged = source.replace(original, replacement)
		expect(() => parsePdf(damaged)).toThrow(PdfParseError)
		expect(() => parsePdf(damaged)).toThrow(message)
	},
)

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
