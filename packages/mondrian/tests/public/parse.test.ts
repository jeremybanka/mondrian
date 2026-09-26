import { expect, expectTypeOf, it } from "vitest"
import { PDFDocument as ExternalPdf } from "pdf-lib"
import type { PdfDictionary, PdfDocument, PdfStream } from "mondrian.pdf"
import {
	ascii,
	createPdfDocument,
	hexString,
	parsePdf,
	PdfParseError,
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
	expectTypeOf(document).toEqualTypeOf<PdfDocument>()
	expect(document.version).toBe("1.7")
	expect(document.root).toMatchObject({ objectNumber: 1, generation: 0 })
	expect(document.info).toMatchObject({ objectNumber: 5 })
	expect(document.id).toEqual([
		hexString(ascii("first")),
		hexString(ascii("second")),
	])
	const extra = document.objects.find((object) => object.objectNumber === 4)!
		.value as PdfDictionary
	expect(extra.entries.Values).toEqual({
		kind: "array",
		items: [
			null,
			true,
			false,
			17,
			-0.25,
			6,
			{ kind: "name", value: "A B" },
			{ kind: "byte-name", bytes: Uint8Array.of(255) },
			{ kind: "hex-string", bytes: Uint8Array.of(171, 192) },
			{ kind: "literal-string", bytes: ascii("a(b)\nA()\\") },
		],
	})
	expect(extra.entries.__proto__).toBe(42)
	expect(extra.byteEntries).toEqual([
		[
			{ kind: "byte-name", bytes: Uint8Array.of(254) },
			{ kind: "literal-string", bytes: ascii("bytes") },
		],
	])
	expect(
		validatePdf(document).filter(
			(diagnostic) => diagnostic.severity === "error",
		),
	).toEqual([])
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
	expect(serializePdf(document)).toEqual(original)
	const read = await readPdf(serializePdf(document))
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
	const document = parsePdf(bytes)
	const content = document.objects[3]!.value as PdfStream
	expect(content.data).toEqual(
		Uint8Array.from(data, (character) => character.charCodeAt(0)),
	)
	expect(content.entries).toEqual({
		Filter: { kind: "name", value: "CustomFilter" },
	})
	expect(parsePdf(source)).toEqual(document)
	bytes.fill(0)
	expect(content.data[2]).toBe(255)
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
		expect(output.pages[0]).toEqual({
			width: 144,
			height: 216,
			rotation: 0,
			text: "External PDF",
		})
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
	expect(document.objects.map((object) => object.objectNumber)).toEqual([
		1, 2, 3,
	])
	expect(document.objects[2]).toMatchObject({
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
		const document = parsePdf(source)
		expect(document.version).toBe("2.0")
		expect(document.info).toMatchObject({ objectNumber: 5, generation: 0 })
		expect(document.objects.map((object) => object.objectNumber)).toEqual([
			1, 2, 3, 4, 5,
		])
		expect(document.objects[3]?.value).toEqual({
			kind: "literal-string",
			bytes: ascii("occupied"),
		})
		expect(document.objects[4]?.value).toMatchObject({
			entries: {
				Title: { kind: "literal-string", bytes: ascii("Example") },
				Custom: { kind: "literal-string", bytes: ascii("preserved") },
			},
		})
		const bytes = serializePdf(document)
		expect((await readPdf(bytes)).title).toBe("Example")
		expect(parsePdf(bytes)).toEqual(document)
	},
)

it("reports parse errors with byte offsets and rejects Unicode-decoded binary input", () => {
	expect(() => parsePdf("not a PDF")).toThrow(PdfParseError)
	try {
		parsePdf("%PDF-1.7\n")
	} catch (error) {
		expect(error).toMatchObject({ name: "PdfParseError", offset: 9 })
	}
	expect(() => parsePdf("%PDF-1.7\n€")).toThrow(/byte string/)
	expect(() =>
		parsePdf(classic(["<< /Type /Catalog >>"], "/Encrypt 2 0 R")),
	).toThrow(/Encrypted PDFs/)
})

function row(offset: number, generation = 0): string {
	return `${String(offset).padStart(10, "0")} ${String(generation).padStart(5, "0")} n \n`
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
