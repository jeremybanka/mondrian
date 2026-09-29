import { expect, it } from "vite-plus/test"
import { PNG } from "pngjs"
import {
	createPdfDocument,
	parsePdf,
	rectangle,
	rgb,
	separation,
	serializePdf,
} from "mondrian.pdf"
import { previewPdfPlates, renderPdfPlateCoverage } from "mondrian.pdf/testing"
import type {
	PdfPlateCoverageOptions,
	RenderedPdfPlateCoverage,
} from "mondrian.pdf/testing"
import { markedTextDocument } from "./helpers/marked-text.ts"

function ramp(alternate = rgb(210 / 255, 214 / 255, 221 / 255), exponent = 1) {
	const ink = separation("Pale ink", {
		type: "exponential",
		zero: rgb(1, 1, 1),
		full: alternate,
		exponent,
	})
	const pdf = createPdfDocument()
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 100, 40),
			content: [
				pdf.graphics((g) => {
					for (const [index, tint] of [0, 0.25, 0.5, 0.75, 1].entries()) {
						g.cmykFill(tint, tint, tint, tint)
							.rectangle(index * 20, 20, 20, 20)
							.fill()
						g.spotFill(ink, tint)
							.rectangle(index * 20, 0, 20, 20)
							.fill()
					}
				}),
			],
		}),
	)
	return parsePdf(pdf.serialize())
}

it("returns inverse ink samples independently of process preview colors and spot alternates", async () => {
	const source = ramp()
	const before = serializePdf(source)
	const previews = previewPdfPlates(source).map(({ document }) =>
		serializePdf(document),
	)
	const options: PdfPlateCoverageOptions = { resolution: 72 }
	const result: RenderedPdfPlateCoverage = await renderPdfPlateCoverage(
		source,
		options,
	)
	expect(result.resolution).toBe(72)
	expect(result.renderer.name).toBe("pdfium")
	expect(result.renderer.version.length).toBeGreaterThan(0)
	expect(result.renderer.wasmSha256).toMatch(/^[\da-f]{64}$/)
	expect(
		result.plates.map(({ name, colorSpace }) => [name, colorSpace]),
	).toEqual([
		["Cyan", "cmyk"],
		["Magenta", "cmyk"],
		["Yellow", "cmyk"],
		["Black", "cmyk"],
		["Pale ink", "spot"],
	])
	for (const [index, plate] of result.plates.entries()) {
		expect(plate.pages).toHaveLength(1)
		const page = plate.pages[0]!
		expect([page.pageNumber, page.width, page.height]).toEqual([1, 100, 40])
		expect(page.samples).toBeInstanceOf(Uint8Array)
		expect(page.samples).toHaveLength(4000)
		const inkRow = index < 4 ? 10 : 30
		expect(
			[10, 30, 50, 70, 90].map((x) => page.samples[inkRow * page.width + x]),
		).toEqual([255, 191, 128, 64, 0])
		expect(
			[10, 30, 50, 70, 90].map(
				(x) => page.samples[(40 - inkRow) * page.width + x],
			),
		).toEqual([255, 255, 255, 255, 255])
		const png = PNG.sync.read(Buffer.from(page.png))
		expect([png.width, png.height]).toEqual([page.width, page.height])
		for (let pixel = 0; pixel < page.samples.length; pixel++)
			expect(Array.from(png.data.subarray(pixel * 4, pixel * 4 + 4))).toEqual([
				page.samples[pixel],
				page.samples[pixel],
				page.samples[pixel],
				255,
			])
	}
	const other = await renderPdfPlateCoverage(
		ramp(rgb(0.05, 0.2, 0.8), 2),
		options,
	)
	expect(other.plates.map(({ pages }) => pages[0]!.samples)).toEqual(
		result.plates.map(({ pages }) => pages[0]!.samples),
	)
	expect(serializePdf(source)).toEqual(before)
	expect(
		previewPdfPlates(source).map(({ document }) => serializePdf(document)),
	).toEqual(previews)
})

it("preserves process knockout, overprint modes, and zero spot tint", async () => {
	const ink = separation("Spot", {
		type: "exponential",
		zero: rgb(1, 1, 1),
		full: rgb(0.8, 0.8, 0.8),
		exponent: 1,
	})
	const pdf = createPdfDocument()
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 100, 20),
			content: [
				pdf.graphics((g) => {
					g.cmykFill(1, 1, 0, 0).rectangle(0, 0, 100, 20).fill()
					g.spotFill(ink, 1).rectangle(0, 0, 20, 20).fill()
					g.paintState({
						fillOverprint: true,
						strokeOverprint: false,
						overprintMode: 0,
					})
					g.spotFill(ink, 0.5).rectangle(20, 0, 20, 20).fill()
					g.cmykFill(0, 1, 0, 0).rectangle(40, 0, 20, 20).fill()
					g.paintState({
						fillOverprint: true,
						strokeOverprint: false,
						overprintMode: 1,
					})
					g.cmykFill(0, 1, 0, 0).rectangle(60, 0, 20, 20).fill()
					g.spotFill(ink, 1).rectangle(80, 0, 20, 20).fill()
					g.spotFill(ink, 0).rectangle(80, 0, 20, 20).fill()
				}),
			],
		}),
	)
	const { plates } = await renderPdfPlateCoverage(pdf.compile(), {
		resolution: 72,
	})
	const row = (index: number) =>
		[10, 30, 50, 70, 90].map(
			(x) => plates[index]!.pages[0]!.samples[10 * 100 + x],
		)
	expect(row(0)).toEqual([255, 0, 255, 0, 0])
	expect(row(4)).toEqual([0, 128, 255, 255, 255])
})

it("supports parsed ActualText in Forms and isolates returned buffers", async () => {
	const source = parsePdf(serializePdf(markedTextDocument(true, true)))
	const result = await renderPdfPlateCoverage(source, { resolution: 72 })
	expect(result.plates[0]!.pages[0]!.samples.some((value) => value < 255)).toBe(
		true,
	)
	for (const plate of result.plates.slice(1))
		expect(plate.pages[0]!.samples.every((value) => value === 255)).toBe(true)
	const baseline = result.plates[0]!.pages[0]!.samples.slice()
	result.plates[0]!.pages[0]!.samples.fill(23)
	expect(
		(await renderPdfPlateCoverage(source, { resolution: 72 })).plates[0]!
			.pages[0]!.samples,
	).toEqual(baseline)
})

it("defines resolution, rotation, empty plates, and permitted-color validation", async () => {
	const pdf = createPdfDocument()
	pdf.setPages(
		pdf.page({ mediaBox: rectangle(0, 0, 10, 20), rotation: 90 }),
		pdf.page({ mediaBox: rectangle(0, 0, 30, 10) }),
	)
	const result = await renderPdfPlateCoverage(pdf.compile())
	expect(result.resolution).toBe(144)
	expect(
		result.plates[0]!.pages.map(({ width, height }) => [width, height]),
	).toEqual([
		[40, 20],
		[60, 20],
	])
	for (const plate of result.plates)
		for (const page of plate.pages)
			expect(page.samples.every((value) => value === 255)).toBe(true)
	expect(
		(await renderPdfPlateCoverage(pdf.compile(), { permitColors: [] })).plates,
	).toEqual([])
	await expect(
		renderPdfPlateCoverage(ramp(), { permitColors: ["cmyk"] }),
	).rejects.toThrow()
	await expect(
		renderPdfPlateCoverage(ramp(), { resolution: 0 }),
	).rejects.toThrow()
})
