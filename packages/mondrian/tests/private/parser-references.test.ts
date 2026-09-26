import { expect, it } from "vitest"
import { parsePdf, PdfParseError } from "../../src/index.ts"
import { readPdf } from "../../src/testing/inspection/read-pdf.ts"
import { classic, row } from "../fixtures/parser.ts"

it.each(["missing", "free", "null", "stale generation"])(
	"treats an optional reference to a %s object as null",
	async (state) => {
		let source = classic(
			[
				[1, 0, "<< /Type /Catalog /Pages 2 0 R /Version 4 0 R >>"],
				[2, 0, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
				[
					3,
					0,
					"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>",
				],
				...(state === "missing"
					? []
					: [
							[4, 0, state === "free" ? "/2.0" : "null"] as [
								number,
								number,
								string,
							],
						]),
			],
			"/Root 1 0 R /ID 4 0 R",
		)
		if (state === "free")
			source = source.replace(
				row(source.indexOf("4 0 obj")),
				"0000000000 00001 f \n",
			)
		if (state === "stale generation")
			source = source.replaceAll("4 0 R", "4 1 R")
		expect((await readPdf(Buffer.from(source, "latin1"))).pages).toHaveLength(1)
		const document = parsePdf(source)
		expect(document.version).toBe("1.7")
		expect(document.id).toBeUndefined()
	},
)

it.each([
	["<< /Type /Catalog >>", "/Root 99 0 R", "catalog dictionary"],
	[
		"<< /Length 99 0 R >>\nstream\nx\nendstream",
		"/Root 1 0 R",
		"Length must resolve",
	],
])(
	"still rejects undefined required references %#",
	(body, trailer, message) => {
		const source = classic([[1, 0, body]], trailer)
		expect(() => parsePdf(source)).toThrow(PdfParseError)
		expect(() => parsePdf(source)).toThrow(message)
	},
)
