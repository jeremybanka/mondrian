import { expect, expectTypeOf, it } from "vitest"
import {
	PDFDocument as ExternalPdf,
	PDFDict,
	PDFName,
	PDFString,
	PDFHexString,
} from "pdf-lib"
import type {
	PdfArray,
	PdfDictionary,
	PdfDocument,
	PdfIndirectValue,
	PdfStream,
	PdfValue,
	PdfParseOptions,
	PdfParseWarning,
	PdfValidationOptions,
} from "mondrian.pdf"
import {
	ascii,
	createPdfDocument,
	parsePdf,
	PdfParseError,
	PdfValidationError,
	rectangle,
	serializePdf,
	validatePdf,
} from "mondrian.pdf"
import { readPdf } from "mondrian.pdf/testing"

it("parses raw PDF text into an inspectable document", () => {
	const source = classic(
		[
			"<< /Type /Catalog /Pages 2 0 R /Extra 4 0 R >>",
			"<< /Type /Pages /Resources << >> /Kids [3 0 R] /Count 1 >>",
			"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 216] >>",
			String.raw`<< /Values [null true false +17 -.25 6. /A#20B /#ff <a b c> (a(b)\n\101\(\)\\)] /#fe (bytes) /__proto__ 42 >>`,
			"<< /Title (Raw text) >>",
		],
		"/Info 5 0 R /ID [(first) <7365636f6e64>]",
	)
	const document = parsePdf(source)
	expectTypeOf(document).toMatchTypeOf<PdfDocument>()
	expect(document.version).toBe("1.7")
	expect(document.root).toMatchObject({ objectNumber: 1, generation: 0 })
	expect(document.info).toMatchObject({ objectNumber: 5, generation: 0 })
	expect(
		document.id?.map((id) => ({ kind: id.kind, bytes: [...id.bytes] })),
	).toEqual([
		{ kind: "hex-string", bytes: [...ascii("first")] },
		{ kind: "hex-string", bytes: [...ascii("second")] },
	])
	const extra = document.objects.find((object) => object.objectNumber === 4)!
		.value as PdfDictionary
	expect(extra.entries.Values).toMatchObject({ kind: "array" })
	const { items } = extra.entries.Values as PdfArray
	expect(items).toHaveLength(10)
	expect(items.slice(0, 6)).toEqual([null, true, false, 17, -0.25, 6])
	expect(pdfNameBytes(items[6])).toEqual(ascii("A B"))
	expect(pdfNameBytes(items[7])).toEqual(Uint8Array.of(255))
	expect(pdfStringBytes(items[8])).toEqual(Uint8Array.of(171, 192))
	expect(pdfStringBytes(items[9])).toEqual(ascii("a(b)\nA()\\"))
	expect(extra.entries.__proto__).toBe(42)
	const byteEntry = extra.byteEntries?.find(([key]) => {
		const bytes = pdfNameBytes(key)
		return bytes.length === 1 && bytes[0] === 254
	})
	expect(pdfStringBytes(byteEntry?.[1])).toEqual(ascii("bytes"))
	expect(
		validatePdf(document).filter(
			(diagnostic) => diagnostic.severity === "error",
		),
	).toEqual([])
})

it.each([
	[
		"indirect array",
		"4 0 R",
		"[<30313233343536373839616263646566> (fedcba9876543210)]",
	],
	["indirect strings", "[5 0 R 6 0 R]", "null"],
	["indirect array and strings", "4 0 R", "[5 0 R 6 0 R]"],
])("resolves file identifiers from an %s", async (_label, id, array) => {
	const source = classic(
		[
			"<< /Type /Catalog /Pages 2 0 R >>",
			"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
			"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>",
			array,
			"<30313233343536373839616263646566>",
			"(fedcba9876543210)",
		],
		`/ID ${id}`,
	)
	const expected = [ascii("0123456789abcdef"), ascii("fedcba9876543210")]
	expect((await readPdf(Buffer.from(source, "latin1"))).fileIds).toEqual(
		expected,
	)
	const document = parsePdf(source)
	expect(
		document.id?.map((id) => ({ kind: id.kind, bytes: [...id.bytes] })),
	).toEqual(
		expected.map((bytes) => ({ kind: "hex-string", bytes: [...bytes] })),
	)
	expect((await readPdf(serializePdf(document))).fileIds).toEqual(expected)
})

it("round-trips serialized documents without losing page content or metadata", async () => {
	const builder = createPdfDocument({
		metadata: { title: "Parsed café", author: "Parser test" },
	})
	const font = builder.standardFont("Helvetica")
	builder.setPages(
		builder.page({
			mediaBox: rectangle(0, 0, 180, 240),
			content: [
				builder.text((text) =>
					text.font(font, 16).moveText(20, 200).show("Hello (PDF)"),
				),
			],
		}),
	)
	const original = builder.serialize()
	const document = parsePdf(original)
	const rewritten = serializePdf(document)
	expect(serializePdf(document)).toEqual(rewritten)
	const read = await readPdf(rewritten)
	expect(read.pages).toEqual([
		{ width: 180, height: 240, rotation: 0, text: "Hello (PDF)" },
	])
	expect(read.title).toBe("Parsed café")
	expect(read.author).toBe("Parser test")
})

it("preserves binary stream bytes using indirect Length, even when data resembles PDF syntax", () => {
	const data = "\x00\x80\xff\nendstream\nendobj\n7 0 obj\nnull"
	const source = classic([
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Resources << >> /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>",
		`<< /Length 5 0 R /Filter /CustomFilter >>\nstream\r\n${data}\nendstream`,
		String(data.length),
	])
	const bytes = Uint8Array.from(source, (character) => character.charCodeAt(0))
	const expected = Uint8Array.from(data, (character) => character.charCodeAt(0))
	for (const input of [source, bytes]) {
		const document = parsePdf(input)
		const object = document.objects.find((object) => object.objectNumber === 4)
		expect(object).toMatchObject({ generation: 0, value: { kind: "stream" } })
		const content = object!.value as PdfStream
		expect(content.data).toBeInstanceOf(Uint8Array)
		expect([...content.data]).toEqual([...expected])
		expect(pdfNameBytes(content.entries.Filter)).toEqual(ascii("CustomFilter"))
		expect(content.entries).not.toHaveProperty("Length")
		if (input instanceof Uint8Array) {
			input.fill(0)
			expect([...content.data]).toEqual([...expected])
		}
	}
})

it.each([false, true])(
	"reads an independent writer's PDF (object streams: %s)",
	async (useObjectStreams) => {
		const external = await ExternalPdf.create({ updateMetadata: false })
		external
			.addPage([144, 216])
			.drawText("External PDF", { x: 20, y: 100, size: 12 })
		external.setTitle("Other writer")
		const document = parsePdf(await external.save({ useObjectStreams }))
		expect(
			validatePdf(document).filter(
				(diagnostic) => diagnostic.severity === "error",
			),
		).toEqual([])
		const output = await readPdf(serializePdf(document))
		expect(output.title).toBe("Other writer")
		expect(output.pages).toEqual([
			{
				width: 144,
				height: 216,
				rotation: 0,
				text: "External PDF",
			},
		])
	},
)

it("uses the latest incremental revision and honors deleted objects", () => {
	const original = classic([
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Resources << >> /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>",
		"(deleted)",
	])
	const previous = Number(/startxref\n(\d+)/.exec(original)![1])
	const update =
		"3 1 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] >>\nendobj\n" +
		"2 0 obj\n<< /Type /Pages /Resources << >> /Kids [3 1 R] /Count 1 >>\nendobj\n"
	const pagesOffset = original.length + update.indexOf("2 0 obj")
	const xref = original.length + update.length
	const source =
		original +
		update +
		`xref\n2 3\n${row(pagesOffset)}${row(original.length, 1)}0000000000 00001 f \ntrailer\n<< /Size 5 /Root 1 0 R /Prev ${previous} >>\nstartxref\n${xref}\n%%EOF\n`
	const document = parsePdf(source)
	expect(document.objects.map((object) => object.objectNumber)).not.toContain(4)
	expect(
		document.objects.find((object) => object.objectNumber === 3),
	).toMatchObject({
		generation: 1,
		value: { entries: { MediaBox: { items: [0, 0, 200, 300] } } },
	})
	expect(
		validatePdf(document).filter(
			(diagnostic) => diagnostic.severity === "error",
		),
	).toEqual([])
})

it.each(["header", "catalog"])(
	"normalizes direct Info in PDF 2.0 selected by the %s",
	async (versionSource) => {
		const source = classic(
			[
				`<< /Type /Catalog /Pages 2 0 R /Extra 4 0 R ${versionSource === "catalog" ? "/Version /2.0" : ""} >>`,
				"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
				"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>",
				"(occupied)",
			],
			"/Info << /Title (Example) /Custom (preserved) >> /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]",
		).replace("%PDF-1.7", versionSource === "header" ? "%PDF-2.0" : "%PDF-1.7")
		const parsed = parsePdf(source)
		const bytes = serializePdf(parsed)
		expect((await readPdf(bytes)).title).toBe("Example")
		for (const document of [parsed, parsePdf(bytes)]) {
			expect(document.version).toBe("2.0")
			expect(document.info).toBeDefined()
			const info = document.objects.find(
				(object) =>
					object.objectNumber === document.info?.objectNumber &&
					object.generation === document.info.generation,
			)
			expect(info?.value).toMatchObject({ kind: "dictionary" })
			const fields = (info!.value as PdfDictionary).entries
			expect(pdfStringBytes(fields.Title)).toEqual(ascii("Example"))
			expect(pdfStringBytes(fields.Custom)).toEqual(ascii("preserved"))
			expect(
				pdfStringBytes(
					document.objects.find((object) => object.objectNumber === 4)?.value,
				),
			).toEqual(ascii("occupied"))
		}
	},
)

it("reports parse errors with byte offsets and rejects Unicode-decoded binary input", () => {
	expect(() => parsePdf("not a PDF")).toThrow(PdfParseError)
	const truncated = "%PDF-1.7\n"
	const { offset } = parseError(truncated)
	expect(Number.isSafeInteger(offset)).toBe(true)
	expect(offset).toBeGreaterThanOrEqual(0)
	expect(offset).toBeLessThanOrEqual(truncated.length)
	expect(() => parsePdf("%PDF-1.7\n€")).toThrow(PdfParseError)
})

it("keeps recovered error offsets in original-input coordinates", () => {
	const damaged = classic([
		"<< /Type /Catalog /Pages 2 0 R /Extra 4 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 216] /Resources << >> >>",
		"/#x0",
	])
	const prefix = "Document delivery note\n"
	const ordinary = parseError(damaged)
	const recovered = parseError(prefix + damaged, { recover: true })
	expect(recovered.offset).toBe(ordinary.offset + prefix.length)
})

it.each(["leading-bytes", "zero-offset-object"] as const)(
	"requires explicit recovery and reports %s through the public callback",
	async (code) => {
		const source = classic([
			"<< /Type /Catalog /Pages 2 0 R >>",
			"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
			"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 216] /Resources << >> >>",
		])
		const prefix = "Document delivery note\n"
		const damaged =
			code === "leading-bytes"
				? prefix + source
				: source
						.replace("trailer\n", "4 1\n0000000000 00000 n \ntrailer\n")
						.replace("/Size 4", "/Size 5")
		expect(() => parsePdf(damaged)).toThrow(PdfParseError)
		const warnings: PdfParseWarning[] = []
		const options: PdfParseOptions = {
			recover: true,
			onWarning: (warning) => warnings.push(warning),
		}
		const document = parsePdf(damaged, options)
		expect(warnings).toContainEqual(
			expect.objectContaining({
				code,
				...(code === "leading-bytes"
					? { offset: prefix.length }
					: { objectNumber: 4 }),
			}),
		)
		expect((await readPdf(serializePdf(document))).pages).toEqual([
			{ width: 144, height: 216, rotation: 0, text: "" },
		])
	},
)

it.each(["maxDecodedStreamBytes", "maxTotalDecodedBytes"] as const)(
	"lets callers bound structural decoding with %s",
	async (option) => {
		const external = await ExternalPdf.create({ updateMetadata: false })
		external.addPage([144, 216])
		external.setTitle("Bounded structural decoding")
		const source = await external.save({ useObjectStreams: true })
		const limited: PdfParseOptions = { [option]: 0 }
		expect(() => parsePdf(source, limited)).toThrow(PdfParseError)
		const document = parsePdf(source, { [option]: 16 * 1024 * 1024 })
		const read = await readPdf(serializePdf(document))
		expect(read.title).toBe("Bounded structural decoding")
		expect(read.pages).toEqual([
			{ width: 144, height: 216, rotation: 0, text: "" },
		])
	},
)

it("retains indirect page contents and Info while producing readable output", async () => {
	const content = "BT /F1 12 Tf 20 100 Td (Indirect content) Tj ET"
	const source = classic(
		[
			"<< /Type /Catalog /Pages 2 0 R >>",
			"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
			"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 216] /Resources << /Font << /F1 8 0 R >> >> /Contents 4 0 R >>",
			"[5 0 R]",
			`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
			"<< /Title 7 0 R >>",
			"(Indirect title)",
			"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		],
		"/Info 6 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]",
	)
	const document = parsePdf(source)
	expect(
		validatePdf(document).filter(
			(diagnostic) => diagnostic.severity === "error",
		),
	).toEqual([])
	expect(
		document.objects.find((object) => object.objectNumber === 3)?.value,
	).toMatchObject({
		entries: {
			Contents: { kind: "reference", objectNumber: 4, generation: 0 },
		},
	})
	expect(
		document.objects.find((object) => object.objectNumber === 6)?.value,
	).toMatchObject({
		entries: { Title: { kind: "reference", objectNumber: 7, generation: 0 } },
	})
	const read = await readPdf(serializePdf(document))
	expect(read.title).toBe("Indirect title")
	expect(read.pages).toEqual([
		{ width: 144, height: 216, rotation: 0, text: "Indirect content" },
	])
})

it.each([
	{
		version: "1.7",
		hex: "feff0044003a00320030003200340030003200320039003000310030003200300033005a",
	},
	{ version: "2.0", hex: "efbbbf443a32303234303232393031303230335a" },
])(
	"preserves valid Unicode date bytes in PDF $version",
	async ({ version, hex }) => {
		const source = documentWithImportedInfo(`/CreationDate <${hex}>`).replace(
			"%PDF-1.7",
			`%PDF-${version}`,
		)
		const document = parsePdf(source)
		expect(
			validatePdf(document).filter(
				(diagnostic) => diagnostic.severity === "error",
			),
		).toEqual([])
		const output = serializePdf(document)
		const independent = await ExternalPdf.load(output, {
			updateMetadata: false,
		})
		const independentInfo = independent.context.lookup(
			independent.context.trailerInfo.Info,
			PDFDict,
		)
		const independentDate = independent.context.lookup(
			independentInfo.get(PDFName.of("CreationDate")),
		)
		// pdf-lib does not decode PDF 2.0 UTF-8 dates, but can read their original bytes.
		if (
			!(
				independentDate instanceof PDFString ||
				independentDate instanceof PDFHexString
			)
		)
			throw new Error("Expected an independently readable date string")
		expect([...independentDate.asBytes()]).toEqual([...Buffer.from(hex, "hex")])
		const info = parsePdf(output).objects.find(
			(object) => object.objectNumber === 4,
		)!.value as PdfDictionary
		expect(pdfStringBytes(info.entries.CreationDate)).toEqual(
			Uint8Array.from(Buffer.from(hex, "hex")),
		)
	},
)

it("preserves nonstandard date bytes only when requested and keeps other errors fatal", () => {
	const date = "Wed Nov 01 13:20:25 2000"
	const document = parsePdf(documentWithImportedInfo(`/CreationDate (${date})`))
	expect(validatePdf(document)).toContainEqual(
		expect.objectContaining({ severity: "error", code: "invalid-info" }),
	)
	expect(() => serializePdf(document)).toThrow(PdfValidationError)
	const options: PdfValidationOptions = { preserveInvalidDates: true }
	expect(validatePdf(document, options)).toContainEqual(
		expect.objectContaining({ severity: "warning", code: "invalid-info" }),
	)
	expect(
		validatePdf(document, options).filter(
			(diagnostic) => diagnostic.severity === "error",
		),
	).toEqual([])
	const rewritten = parsePdf(serializePdf(document, options))
	const info = rewritten.objects.find((object) => object.objectNumber === 4)!
		.value as PdfDictionary
	expect(pdfStringBytes(info.entries.CreationDate)).toEqual(ascii(date))
	for (const invalid of ["42", "<feffd800>"]) {
		const malformed = parsePdf(
			documentWithImportedInfo(`/CreationDate ${invalid}`),
		)
		expect(validatePdf(malformed, options)).toContainEqual(
			expect.objectContaining({ severity: "error" }),
		)
		expect(() => serializePdf(malformed, options)).toThrow(PdfValidationError)
	}
})

function documentWithImportedInfo(fields: string): string {
	return classic(
		[
			"<< /Type /Catalog /Pages 2 0 R >>",
			"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
			"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 216] /Resources << >> >>",
			`<< ${fields} >>`,
		],
		"/Info 4 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]",
	)
}

function parseError(source: string, options?: PdfParseOptions): PdfParseError {
	try {
		parsePdf(source, options)
	} catch (error) {
		expect(error).toBeInstanceOf(PdfParseError)
		return error as PdfParseError
	}
	return expect.fail("Expected parsing to throw PdfParseError")
}

function row(offset: number, generation = 0): string {
	return `${String(offset).padStart(10, "0")} ${String(generation).padStart(5, "0")} n \n`
}

// Assert the exposed PDF values without choosing a serialization spelling.
function pdfStringBytes(
	value: PdfValue | PdfIndirectValue | undefined,
): Uint8Array {
	if (
		typeof value !== "object" ||
		value === null ||
		(value.kind !== "literal-string" && value.kind !== "hex-string")
	)
		throw new Error("Expected a PDF string")
	expect(value.bytes).toBeInstanceOf(Uint8Array)
	return Uint8Array.from(value.bytes)
}

function pdfNameBytes(value: PdfValue | undefined): Uint8Array {
	if (typeof value !== "object" || value === null)
		throw new Error("Expected a PDF name")
	if (value.kind === "name") return new TextEncoder().encode(value.value)
	if (value.kind === "byte-name") {
		expect(value.bytes).toBeInstanceOf(Uint8Array)
		return Uint8Array.from(value.bytes)
	}
	throw new Error("Expected a PDF name")
}
function classic(bodies: string[], trailer = ""): string {
	let source = "%PDF-1.7\n"
	const offsets: number[] = []
	for (const [index, body] of bodies.entries()) {
		offsets.push(source.length)
		source += `${index + 1} 0 obj\n${body}\nendobj\n`
	}
	const xref = source.length
	return (
		source +
		`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => row(offset)).join("")}trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`
	)
}
