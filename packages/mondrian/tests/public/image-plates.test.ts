import { readFileSync } from "node:fs"
import { PDFDocument, PDFName, PDFString, cmyk } from "pdf-lib"
import { expect, it } from "vite-plus/test"
import {
	createPdfDocument,
	parsePdf,
	rectangle,
	rgb,
	separation,
	serializePdf,
} from "mondrian.pdf"
import type { PdfDocument } from "mondrian.pdf"
import { prepareCmykImage } from "mondrian.pdf/print"
import { previewPdfPlates, renderPdf } from "mondrian.pdf/testing"

const fixture = (file: string) =>
	readFileSync(new URL(`./fixtures/print-images/${file}`, import.meta.url))
const profile = fixture("CGATS21_CRPC6.icc")
const outputIntent = { profile, identifier: "CRPC6" }
const background = [0.7, 0.3, 0.8, 0.2] as const

async function pixels(document: PdfDocument | Uint8Array) {
	const page = (
		await renderPdf(
			document instanceof Uint8Array ? document : serializePdf(document),
			{ resolution: 72 },
		)
	).pages[0]!
	return [10, 30, 50, 70].map((x) =>
		Array.from(
			page.pixels.slice(
				(20 * page.width + x) * 4,
				(20 * page.width + x) * 4 + 4,
			),
		),
	)
}

it.each(["rgba.png", "palette.png", "rgb.jpg"])(
	"previews the delivered %s conversion with the same per-pixel opacity",
	async (file) => {
		const prepared = await prepareCmykImage(fixture(file), {
			destinationProfile: profile,
			...(file.endsWith(".jpg") ? { sourceProfile: "srgb" as const } : {}),
		})
		const pdf = createPdfDocument({ outputIntent })
		const image = pdf.image(prepared)
		pdf.setPages(
			pdf.page({
				mediaBox: rectangle(0, 0, 80, 40),
				content: [
					pdf.graphics((g) => {
						g.cmykFill(...background)
							.rectangle(0, 0, 80, 40)
							.fill()
						g.drawImage(image, 0, 0, 80, 40)
					}),
				],
			}),
		)
		// The input is the serialized delivery, read back independently of the builder.
		const delivered = parsePdf(serializePdf(pdf.compile()))
		const before = serializePdf(delivered)
		const plates = previewPdfPlates(delivered)
		expect(plates.map((plate) => plate.name)).toEqual([
			"Cyan",
			"Magenta",
			"Yellow",
			"Black",
		])
		for (const [channel, plate] of plates.entries()) {
			// Independently encoded vector alpha is the observable compositing contract.
			const expected = await PDFDocument.create()
			const page = expected.addPage([80, 40])
			page.node.set(
				PDFName.of("Group"),
				expected.context.obj({
					S: "Transparency",
					CS: "DeviceCMYK",
					I: true,
					K: false,
				}),
			)
			expected.catalog.set(
				PDFName.of("OutputIntents"),
				expected.context.obj([
					{
						Type: "OutputIntent",
						S: "GTS_PDFX",
						OutputConditionIdentifier: PDFString.of("CRPC6"),
						DestOutputProfile: expected.context.register(
							expected.context.flateStream(profile, { N: 4 }),
						),
					},
				]),
			)
			const components: [number, number, number, number] = [0, 0, 0, 0]
			components[channel] = background[channel]!
			page.drawRectangle({
				x: 0,
				y: 0,
				width: 80,
				height: 40,
				color: cmyk(...components),
			})
			for (let pixel = 0; pixel < 4; pixel++) {
				components[channel] = prepared.data[pixel * 4 + channel]! / 255
				page.drawRectangle({
					x: pixel * 20,
					y: 0,
					width: 20,
					height: 40,
					color: cmyk(...components),
					opacity: (prepared.alpha?.[pixel] ?? 255) / 255,
				})
			}
			const actualPixels = await pixels(plate.document)
			const expectedPixels = await pixels(await expected.save())
			for (let pixel = 0; pixel < 4; pixel++)
				for (let component = 0; component < 4; component++)
					expect(
						Math.abs(
							actualPixels[pixel]![component]! -
								expectedPixels[pixel]![component]!,
						),
					).toBeLessThanOrEqual(3)
		}
		expect(
			Buffer.from(serializePdf(delivered)).equals(Buffer.from(before)),
		).toBe(true)
		expect(() =>
			previewPdfPlates(delivered, { permitColors: ["cmyk"] }),
		).not.toThrow()
		expect(() =>
			previewPdfPlates(delivered, { permitColors: ["spot"] }),
		).toThrow()
	},
	20_000,
)

it.each([false, true])(
	"preserves underlying spot coverage through a PNG cut-out with overprint %s",
	async (overprint) => {
		const ink = separation("Red", {
			type: "exponential",
			zero: rgb(1, 1, 1),
			full: rgb(1, 0, 0),
			exponent: 1,
		})
		const prepared = await prepareCmykImage(fixture("rgba.png"), {
			destinationProfile: profile,
		})
		const pdf = createPdfDocument({ outputIntent })
		const image = pdf.image(prepared)
		pdf.setPages(
			pdf.page({
				mediaBox: rectangle(0, 0, 80, 40),
				content: [
					pdf.graphics((g) => {
						g.spotFill(ink, 1).rectangle(0, 0, 80, 40).fill()
						g.paintState({
							fillOverprint: overprint,
							strokeOverprint: false,
							overprintMode: 1,
						}).drawImage(image, 0, 0, 80, 40)
					}),
				],
			}),
		)
		const plate = previewPdfPlates(pdf.compile()).find(
			(plate) => plate.name === "Red",
		)!
		const actual = await pixels(plate.document)
		const expected = createPdfDocument({ outputIntent })
		expected.setPages(
			expected.page({
				mediaBox: rectangle(0, 0, 80, 40),
				content: [
					expected.graphics((g) => {
						g.spotFill(ink, 1).rectangle(0, 0, 80, 40).fill()
					}),
				],
			}),
		)
		const red = (await pixels(expected.compile()))[0]!
		for (let index = 0; index < 4; index++) {
			const alpha = overprint ? 0 : prepared.alpha![index]! / 255
			for (let channel = 0; channel < 3; channel++)
				expect(
					Math.abs(
						actual[index]![channel]! -
							(red[channel]! * (1 - alpha) + 255 * alpha),
					),
				).toBeLessThanOrEqual(3)
		}
	},
	20_000,
)
