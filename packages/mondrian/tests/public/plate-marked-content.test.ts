import { expect, it } from "vite-plus/test"
import { parsePdf, serializePdf } from "mondrian.pdf"
import { previewPdfPlates, readPdf, renderPdf } from "mondrian.pdf/testing"
import { markedTextDocument } from "./helpers/marked-text.ts"

it.each([
	{ named: false, form: false },
	{ named: true, form: false },
	{ named: false, form: true },
	{ named: true, form: true },
])(
	"preserves ActualText and plate appearance from delivered bytes: %j",
	async ({ named, form }) => {
		const bytes = serializePdf(markedTextDocument(named, form))
		expect((await readPdf(bytes)).pages[0]!.text).toBe("ffi")
		const source = parsePdf(bytes)
		const before = serializePdf(source)
		const plates = previewPdfPlates(source)
		expect(plates.map(({ name }) => name)).toEqual([
			"Cyan",
			"Magenta",
			"Yellow",
			"Black",
		])
		const unmarked = previewPdfPlates(markedTextDocument(named, form, false))
		for (const [index, plate] of plates.entries()) {
			const output = serializePdf(plate.document)
			expect((await readPdf(output)).pages[0]!.text).toBe("ffi")
			const actual = await renderPdf(output, { resolution: 72 })
			const expected = await renderPdf(
				serializePdf(unmarked[index]!.document),
				{ resolution: 72 },
			)
			expect(actual.pages[0]!.pixels).toEqual(expected.pages[0]!.pixels)
		}
		expect(serializePdf(source)).toEqual(before)
	},
)
