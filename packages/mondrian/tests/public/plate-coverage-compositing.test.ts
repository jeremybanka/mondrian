import { readFileSync } from "node:fs"
import { expect, it } from "vite-plus/test"
import {
	PDFDocument,
	cmyk,
	PDFName,
	pushGraphicsState,
	popGraphicsState,
	rectangle as pdfRectangle,
	clip,
	endPath,
} from "pdf-lib"
import {
	createPdfDocument,
	parsePdf,
	rectangle,
	rgb,
	separation,
} from "mondrian.pdf"
import { prepareCmykImage } from "mondrian.pdf/print"
import { renderPdfPlateCoverage } from "mondrian.pdf/testing"

const fixture = (file: string) =>
	readFileSync(new URL(`./fixtures/print-images/${file}`, import.meta.url))
const profile = fixture("CGATS21_CRPC6.icc")
const outputIntent = { profile, identifier: "CRPC6" }

it("measures delivered PNG samples with their independent alpha", async () => {
	const prepared = await prepareCmykImage(fixture("rgba.png"), {
		destinationProfile: profile,
	})
	const pdf = createPdfDocument({ outputIntent })
	const image = pdf.image(prepared)
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 80, 40),
			content: [pdf.graphics((g) => g.drawImage(image, 0, 0, 80, 40))],
		}),
	)
	const { plates } = await renderPdfPlateCoverage(parsePdf(pdf.serialize()), {
		resolution: 72,
	})
	for (const [channel, plate] of plates.entries()) {
		for (const [pixel, x] of [10, 30, 50, 70].entries()) {
			const coverage =
				((prepared.data[pixel * 4 + channel]! / 255) *
					prepared.alpha![pixel]!) /
				255
			const actual = plate.pages[0]!.samples[20 * 80 + x]!
			// PDFium composites quantized 8-bit samples and alpha. One simple blend
			// may round one byte away from the ideal real-valued coverage equation.
			expect(
				Math.abs(actual - Math.round(255 * (1 - coverage))),
			).toBeLessThanOrEqual(1)
		}
	}
})

it.each([0, 1] as const)(
	"retains image process zeros and spot knockout/overprint in OPM %s",
	async (mode) => {
		for (const overprint of [false, true]) {
			const pdf = createPdfDocument({ outputIntent })
			const image = pdf.image({
				width: 4,
				height: 1,
				data: Uint8Array.from(
					Array.from({ length: 4 }, () => [0, 128, 255, 0]).flat(),
				),
				alpha: Uint8Array.of(0, 64, 128, 255),
				destinationProfile: profile,
			})
			const ink = separation("Pale ink", {
				type: "exponential",
				zero: rgb(1, 1, 1),
				full: rgb(0.8, 0.8, 0.8),
				exponent: 1,
			})
			pdf.setPages(
				pdf.page({
					mediaBox: rectangle(0, 0, 80, 40),
					content: [
						pdf.graphics((g) => {
							g.cmykFill(1, 1, 1, 1).rectangle(0, 0, 80, 40).fill()
							g.paintState({
								fillOverprint: true,
								strokeOverprint: false,
								overprintMode: mode,
							})
								.spotFill(ink, 1)
								.rectangle(0, 0, 80, 40)
								.fill()
							g.paintState({
								fillOverprint: overprint,
								strokeOverprint: false,
								overprintMode: mode,
							}).drawImage(image, 0, 0, 80, 40)
						}),
					],
				}),
			)
			const { plates } = await renderPdfPlateCoverage(
				parsePdf(pdf.serialize()),
				{ resolution: 72 },
			)
			const row = (index: number) =>
				[10, 30, 50, 70].map(
					(x) => plates[index]!.pages[0]!.samples[20 * 80 + x],
				)
			expect(row(0)).toEqual([0, 64, 128, 255])
			// Allow one byte of intermediate blending quantization, while keeping
			// the fully transparent and opaque endpoints exact.
			expect([row(1)[0], row(1)[3]]).toEqual([0, 127])
			for (const [index, expected] of [0, 32, 64, 127].entries())
				expect(Math.abs(row(1)[index]! - expected)).toBeLessThanOrEqual(1)
			expect(row(2)).toEqual([0, 0, 0, 0])
			expect(row(3)).toEqual([0, 64, 128, 255])
			expect(row(4)).toEqual(overprint ? [0, 0, 0, 0] : [0, 64, 128, 255])
		}
	},
)

it("measures fill and stroke opacity and clipping within the source CMYK page group", async () => {
	const pdf = await PDFDocument.create()
	const page = pdf.addPage([80, 40])
	page.node.set(
		PDFName.of("Group"),
		pdf.context.obj({ S: "Transparency", CS: "DeviceCMYK", I: true, K: false }),
	)
	page.drawRectangle({
		x: 0,
		y: 0,
		width: 20,
		height: 40,
		color: cmyk(0.5, 0, 0, 0),
		opacity: 0.5,
	})
	page.drawRectangle({
		x: 30,
		y: 10,
		width: 20,
		height: 20,
		borderColor: cmyk(0, 1, 0, 0),
		borderWidth: 4,
		borderOpacity: 0.5,
	})
	page.pushOperators(
		pushGraphicsState(),
		pdfRectangle(60, 0, 10, 40),
		clip(),
		endPath(),
	)
	page.drawRectangle({
		x: 60,
		y: 0,
		width: 20,
		height: 40,
		color: cmyk(1, 0, 0, 0),
	})
	page.pushOperators(popGraphicsState())
	const { plates } = await renderPdfPlateCoverage(parsePdf(await pdf.save()), {
		resolution: 72,
	})
	const sample = (plate: number, x: number, y: number) =>
		plates[plate]!.pages[0]!.samples[y * 80 + x]
	expect(sample(0, 10, 20)).toBe(191)
	expect(sample(1, 30, 20)).toBe(128)
	expect(sample(1, 40, 20)).toBe(255)
	expect(sample(0, 65, 20)).toBe(0)
	expect(sample(0, 75, 20)).toBe(255)
})
