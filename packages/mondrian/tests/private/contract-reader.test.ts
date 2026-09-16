import { expect, it } from "vite-plus/test"
import { createPdfDocument, pageSizes } from "mondrian.pdf"
import { readPdf } from "mondrian.pdf/testing"

it("rejects cross-reference repair even when a reader can recover the page", async () => {
	const pdf = createPdfDocument()
	pdf.setPages(pdf.page({ mediaBox: pageSizes.letter }))
	const bytes = pdf.serialize()
	await expect(readPdf(bytes)).resolves.toMatchObject({
		pages: [{ width: 612, height: 792 }],
	})
	const damaged = bytes.slice()
	const source = Buffer.from(bytes).toString("latin1")
	const offset = /startxref\s+(\d+)\s+%%EOF/.exec(source)
	if (!offset?.[1]) throw new Error("Missing startxref in test input")
	const position = offset.index + offset[0].indexOf(offset[1])
	damaged.fill(0x30, position, position + offset[1].length)
	await expect(readPdf(damaged)).rejects.toThrow("cross-reference repair")
})
