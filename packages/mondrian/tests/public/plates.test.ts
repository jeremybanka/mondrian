import { expect, it } from "vite-plus/test"
import {
	cmyk,
	createPdfDocument,
	rectangle,
	rgb,
	separation,
	serializePdf,
} from "mondrian.pdf"
import type { PdfColor, PdfDocument } from "mondrian.pdf"
import { previewPdfPlates, readPdf, renderPdf } from "mondrian.pdf/testing"
import type {
	PdfPlateOptions,
	PdfPlatePreview,
	RenderedPdfPage,
} from "mondrian.pdf/testing"

const red = separation("Brand Red", {
	type: "exponential",
	zero: rgb(1, 1, 1),
	full: rgb(1, 0, 0),
	exponent: 1,
})

it("discovers four process plates and distinct named spots, retaining ink colors and tints", async () => {
	const other = separation("Other Red", red.tintTransform)
	const pdf = createPdfDocument({ metadata: { title: "Plate contract" } })
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 90, 30),
			content: [
				pdf.graphics((g) => {
					g.cmykFill(0.2, 0.4, 0.6, 0.8).rectangle(0, 0, 30, 30).fill()
					g.spotFill(red, 0.5).rectangle(30, 0, 30, 30).fill()
					g.spotFill(other, 1).rectangle(60, 0, 30, 30).fill()
				}),
			],
		}),
	)
	const source = pdf.compile()
	const before = serializePdf(source)
	const options: PdfPlateOptions = { permitColors: ["cmyk", "spot"] }
	const plates: readonly PdfPlatePreview[] = previewPdfPlates(source, options)
	expect(plates.map(({ name, colorSpace }) => [name, colorSpace])).toEqual([
		["Cyan", "cmyk"],
		["Magenta", "cmyk"],
		["Yellow", "cmyk"],
		["Black", "cmyk"],
		["Brand Red", "spot"],
		["Other Red", "spot"],
	])
	const expected: PdfColor[] = [
		cmyk(0.2, 0, 0, 0),
		cmyk(0, 0.4, 0, 0),
		cmyk(0, 0, 0.6, 0),
		cmyk(0, 0, 0, 0.8),
	]
	for (const [index, plate] of plates.entries()) {
		const page = await renderPage(plate.document)
		if (index < 4) {
			const control = createPdfDocument()
			control.setPages(
				control.page({
					mediaBox: rectangle(0, 0, 30, 30),
					content: [
						control.graphics((g) =>
							g.fillColor(expected[index]!).rectangle(0, 0, 30, 30).fill(),
						),
					],
				}),
			)
			expect(pixel(page, 15, 15)).toEqual(
				pixel(await renderPage(control.compile()), 15, 15),
			)
			expect(pixel(page, 45, 15)).toEqual(white)
			expect(pixel(page, 75, 15)).toEqual(white)
		} else {
			expect(pixel(page, 15, 15)).toEqual(white)
			const tintPixel = pixel(page, index === 4 ? 45 : 75, 15)
			expect(tintPixel[0]).toBe(255)
			expect(tintPixel[1]).toBeCloseTo(index === 4 ? 128 : 0, -1)
			expect(tintPixel[2]).toBe(tintPixel[1])
			expect(pixel(page, index === 4 ? 75 : 45, 15)).toEqual(white)
		}
	}
	expect(serializePdf(source)).toEqual(before)
	expect(
		previewPdfPlates(source).map(({ document }) => serializePdf(document)),
	).toEqual(plates.map(({ document }) => serializePdf(document)))
	// Preview bytes are independently owned, even for unchanged font/metadata data.
	const firstStream = plates[0]!.document.objects.find(
		({ value }) =>
			typeof value === "object" && value !== null && value.kind === "stream",
	)!.value
	if (
		typeof firstStream === "object" &&
		firstStream !== null &&
		firstStream.kind === "stream"
	)
		firstStream.data.fill(0)
	expect(serializePdf(source)).toEqual(before)
	expect(() => serializePdf(plates[1]!.document)).not.toThrow()
})

it("preserves knockout, spot overprint, and both CMYK overprint modes", async () => {
	const pdf = createPdfDocument()
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 150, 60),
			content: [
				pdf.graphics((g) => {
					g.cmykFill(1, 1, 0, 0).rectangle(0, 0, 150, 60).fill()
					g.spotFill(red, 1).rectangle(0, 0, 30, 30).fill()
					g.paintState({
						fillOverprint: true,
						strokeOverprint: false,
						overprintMode: 0,
					})
					g.spotFill(red, 0.5).rectangle(30, 0, 30, 30).fill()
					g.cmykFill(0, 1, 0, 0).rectangle(60, 0, 30, 30).fill()
					g.paintState({
						fillOverprint: true,
						strokeOverprint: false,
						overprintMode: 1,
					})
					g.cmykFill(0, 1, 0, 0).rectangle(90, 0, 30, 30).fill()
					g.spotFill(red, 1).rectangle(120, 0, 30, 30).fill()
					g.spotFill(red, 0).rectangle(120, 0, 30, 30).fill()
				}),
			],
		}),
	)
	const plates = previewPdfPlates(pdf.compile())
	const cyan = await renderPage(plates[0]!.document)
	const ink = pixel(cyan, 15, 45)
	expect(ink).not.toEqual(white)
	expect([15, 45, 75, 105, 135].map((x) => pixel(cyan, x, 15))).toEqual([
		white,
		ink,
		white,
		ink,
		ink,
	])
	const spot = await renderPage(plates[4]!.document)
	expect(pixel(spot, 135, 15)).toEqual(white) // Zero spot tint still paints in OPM 1.
})

it("projects fill and stroke independently and keeps live text, geometry, and page order", async () => {
	const pdf = createPdfDocument()
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
	const cyan = await renderPage(plates[0]!.document)
	expect(pixel(cyan, 50, 40)).toEqual(pixel(cyan, 5, 5))
	expect(pixel(cyan, 20, 40)).toEqual(white)
	for (const plate of plates) {
		const read = await readPdf(serializePdf(plate.document))
		expect(read.pages).toHaveLength(2)
		expect(read.pages[0]!.text).toBe("Live ink")
		const rendered = await renderPdf(serializePdf(plate.document), {
			resolution: 72,
		})
		expect(rendered.pages.map(({ width, height }) => [width, height])).toEqual([
			[100, 100],
			[60, 40],
		])
	}
})

it("supports spot-only and empty jobs while checking the entire document before returning previews", () => {
	const pdf = createPdfDocument()
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 10, 10),
			content: [
				pdf.graphics((g) => g.spotFill(red, 1).rectangle(0, 0, 10, 10).fill()),
			],
		}),
	)
	expect(
		previewPdfPlates(pdf.compile(), { permitColors: ["spot"] }).map(
			({ name }) => name,
		),
	).toEqual(["Brand Red"])
	expect(() =>
		previewPdfPlates(pdf.compile(), { permitColors: ["cmyk"] }),
	).toThrow(/Separation.*not permitted/u)
	const blank = createPdfDocument()
	blank.setPages(blank.page({ mediaBox: rectangle(0, 0, 10, 10) }))
	expect(previewPdfPlates(blank.compile())).toHaveLength(4)
	expect(previewPdfPlates(blank.compile(), { permitColors: [] })).toEqual([])
	pdf.setPages(
		pdf.page({ mediaBox: rectangle(0, 0, 10, 10) }),
		pdf.page({
			mediaBox: rectangle(0, 0, 10, 10),
			content: [
				pdf.graphics((g) => g.rgbFill(1, 0, 0).rectangle(0, 0, 10, 10).fill()),
			],
		}),
	)
	expect(() => previewPdfPlates(pdf.compile())).toThrow(/Page 2:.*DeviceRGB/u)
})

it("rejects explicit gray and implicit default black instead of silently converting them", () => {
	for (const explicit of [false, true]) {
		const pdf = createPdfDocument()
		pdf.setPages(
			pdf.page({
				mediaBox: rectangle(0, 0, 10, 10),
				content: [
					pdf.graphics((g) => {
						if (explicit) g.grayFill(0)
						g.rectangle(0, 0, 10, 10).fill()
					}),
				],
			}),
		)
		expect(() => previewPdfPlates(pdf.compile())).toThrow(/DeviceGray/u)
	}
})

const white = [255, 255, 255, 255]
function pixel(page: RenderedPdfPage, x: number, y: number): number[] {
	const offset = ((page.height - 1 - y) * page.width + x) * 4
	return Array.from(page.pixels.slice(offset, offset + 4))
}
async function renderPage(document: PdfDocument): Promise<RenderedPdfPage> {
	return (await renderPdf(serializePdf(document), { resolution: 72 })).pages[0]!
}
