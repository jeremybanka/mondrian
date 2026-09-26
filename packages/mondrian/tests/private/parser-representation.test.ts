import { expect, it } from "vitest"
import {
	createPdfDocument,
	parsePdf,
	PdfParseError,
	rectangle,
	serializePdf,
} from "../../src/index.ts"
import { classic } from "../fixtures/parser.ts"
import { SyntaxReader } from "../../src/parser/syntax.ts"

it("retains current name and string variants for each token spelling", () => {
	expect(
		new SyntaxReader(
			String.raw`[/A#20B /#ff <a b c> (a(b)\n\101\(\)\\)]`,
		).value(),
	).toEqual({
		kind: "array",
		items: [
			{ kind: "name", value: "A B" },
			{ kind: "byte-name", bytes: Uint8Array.of(255) },
			{ kind: "hex-string", bytes: Uint8Array.of(171, 192) },
			{
				kind: "literal-string",
				bytes: new TextEncoder().encode("a(b)\nA()\\"),
			},
		],
	})
})

it("produces deeply equal models from byte strings and byte arrays", () => {
	const source = classic(
		[
			[1, 0, "<< /Type /Catalog /Extra 2 0 R >>"],
			[
				2,
				0,
				"<< /Length 3 /Filter /CustomFilter >>\nstream\n\x00\x80\xff\nendstream",
			],
		],
		"/Root 1 0 R",
	)
	expect(parsePdf(source)).toEqual(parsePdf(Buffer.from(source, "latin1")))
})

it("reproduces the current writer's bytes after parsing its output", () => {
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
	expect(serializePdf(parsePdf(original))).toEqual(original)
})

it.each(["header", "catalog"])(
	"currently appends direct Info after existing object numbers (%s)",
	(versionSource) => {
		const source = classic(
			[
				[
					1,
					0,
					`<< /Type /Catalog /Pages 2 0 R /Extra 4 0 R ${versionSource === "catalog" ? "/Version /2.0" : ""} >>`,
				],
				[2, 0, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
				[
					3,
					0,
					"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>",
				],
				[4, 0, "(occupied)"],
			],
			"/Root 1 0 R /Info << /Title (Example) /Custom (preserved) >> /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]",
		).replace("%PDF-1.7", versionSource === "header" ? "%PDF-2.0" : "%PDF-1.7")
		const document = parsePdf(source)
		expect(document.info).toMatchObject({ objectNumber: 5, generation: 0 })
		expect(document.objects.map((object) => object.objectNumber)).toEqual([
			1, 2, 3, 4, 5,
		])
		expect(document.objects[3]?.value).toMatchObject({ kind: "literal-string" })
		expect(document.objects[4]?.value).toMatchObject({ kind: "dictionary" })
		expect(parsePdf(serializePdf(document))).toEqual(document)
	},
)

it("retains current diagnostic wording and the end-of-input error location", () => {
	expect(() => parsePdf("%PDF-1.7\n")).toThrow(PdfParseError)
	try {
		parsePdf("%PDF-1.7\n")
	} catch (error) {
		expect(error).toMatchObject({ name: "PdfParseError", offset: 9 })
	}
	expect(() => parsePdf("%PDF-1.7\n€")).toThrow(/byte string/)
	expect(() =>
		parsePdf(
			classic([[1, 0, "<< /Type /Catalog >>"]], "/Root 1 0 R /Encrypt 2 0 R"),
		),
	).toThrow(/Encrypted PDFs/)
})
