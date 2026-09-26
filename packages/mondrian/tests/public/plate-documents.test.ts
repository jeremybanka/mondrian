import { expect, it } from "vite-plus/test"
import {
	createPdfDocument,
	rectangle,
	rgb,
	separation,
	serializePdf,
} from "mondrian.pdf"
import type { PdfDocument } from "mondrian.pdf"
import { previewPdfPlates, readPdf, renderPdf } from "mondrian.pdf/testing"
import type { RenderedPdfPage } from "mondrian.pdf/testing"

it("preserves document identity, live text, page geometry, and independent fill/stroke coverage", async () => {
	const red = separation("Brand Red", {
		type: "exponential",
		zero: rgb(1, 1, 1),
		full: rgb(1, 0, 0),
		exponent: 1,
	})
	const ids = [new Uint8Array(16).fill(1), new Uint8Array(16).fill(2)] as const
	const pdf = createPdfDocument({
		version: "1.4",
		metadata: { title: "Plate contract", author: "Print team" },
		id: ids,
	})
	const font = pdf.standardFont("Helvetica")
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 100, 100),
			content: [
				pdf.graphics((g) => {
					g.cmykFill(1, 0, 0, 0).rectangle(0, 0, 100, 100).fill()
					g.paintState({
						fillOverprint: true,
						strokeOverprint: false,
						overprintMode: 0,
					})
						.spotFill(red, 1)
						.spotStroke(red, 1)
						.lineWidth(10)
						.rectangle(20, 20, 60, 40)
						.fillAndStroke()
				}),
				pdf.text((t) =>
					t
						.font(font, 12)
						.moveText(10, 80)
						.spotFill(red, 1)
						.cmykStroke(1, 0, 0, 0)
						.renderingMode(2)
						.show("Live ink"),
				),
			],
		}),
		pdf.page({ mediaBox: rectangle(0, 0, 40, 60), rotation: 90 }),
	)
	const plates = previewPdfPlates(pdf.compile())
	expect(plates).toHaveLength(5)
	const cyan = await renderPage(plates[0]!.document)
	expect(pixel(cyan, 5, 5)).not.toEqual(white)
	expect(pixel(cyan, 50, 40)).toEqual(pixel(cyan, 5, 5))
	expect(pixel(cyan, 20, 40)).toEqual(white)
	for (const plate of plates) {
		expect(plate.document.version).toBe("1.4")
		const bytes = serializePdf(plate.document)
		expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.4")
		const read = await readPdf(bytes)
		expect(read.title).toBe("Plate contract")
		expect(read.author).toBe("Print team")
		expect(read.fileIds).toEqual(ids)
		expect(read.pages).toEqual([
			{ width: 100, height: 100, rotation: 0, text: "Live ink" },
			{ width: 60, height: 40, rotation: 90, text: "" },
		])
		expect(read.pageCharacters[0]![0]).toEqual({ text: "L", x: 10, y: 80 })
		expect(read.pageFonts[0]).toEqual(
			expect.arrayContaining([{ text: "L", font: "Helvetica" }]),
		)
		const rendered = await renderPdf(bytes, { resolution: 72 })
		expect(rendered.pages.map(({ width, height }) => [width, height])).toEqual([
			[100, 100],
			[60, 40],
		])
	}
})

it("owns preview byte buffers independently of the input and other plates", () => {
	const pdf = createPdfDocument({
		id: [new Uint8Array(16).fill(1), new Uint8Array(16).fill(2)],
	})
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 20, 20),
			content: [
				pdf.graphics((g) =>
					g.cmykFill(0.2, 0.4, 0.6, 0.8).rectangle(0, 0, 20, 20).fill(),
				),
			],
		}),
	)
	const source = pdf.compile()
	const inputBytes = serializePdf(source)
	const plates = previewPdfPlates(source)
	expect(plates).toHaveLength(4)
	const previewBytes = plates.map(({ document }) => serializePdf(document))
	const streams = plates[0]!.document.objects.flatMap(({ value }) =>
		value !== null && typeof value === "object" && value.kind === "stream"
			? [value.data]
			: [],
	)
	// Mutate every stream, without depending on object numbers, ordering, or names.
	expect(streams.length).toBeGreaterThan(0)
	for (const bytes of streams) bytes.fill(0)
	for (const { bytes } of plates[0]!.document.id!) bytes.fill(0)
	expect(serializePdf(source)).toEqual(inputBytes)
	expect(plates.slice(1).map(({ document }) => serializePdf(document))).toEqual(
		previewBytes.slice(1),
	)
})

const white = [255, 255, 255, 255]
function pixel(page: RenderedPdfPage, x: number, y: number): number[] {
	const offset = ((page.height - 1 - y) * page.width + x) * 4
	return Array.from(page.pixels.slice(offset, offset + 4))
}
async function renderPage(document: PdfDocument): Promise<RenderedPdfPage> {
	return (await renderPdf(serializePdf(document), { resolution: 72 })).pages[0]!
}
