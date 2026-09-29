import { readFileSync } from "node:fs"
import { createPdfDocument, rectangle, rgb, separation } from "mondrian.pdf"
import type { PdfDocument } from "mondrian.pdf"
import { prepareCmykImage } from "mondrian.pdf/print"

const fixture = (file: string) =>
	readFileSync(
		new URL(`../tests/public/fixtures/print-images/${file}`, import.meta.url),
	)
const inks = [
	separation("Leaf Green", {
		type: "exponential",
		zero: rgb(1, 1, 1),
		full: rgb(0.2, 0.55, 0.32),
		exponent: 1,
	}),
	separation("Violet", {
		type: "exponential",
		zero: rgb(1, 1, 1),
		full: rgb(0.46, 0.25, 0.75),
		exponent: 1,
	}),
] as const

/** One conversion shared by the delivered composite and every plate preview. */
export async function printImageExample(): Promise<PdfDocument> {
	const profile = fixture("CGATS21_CRPC6.icc")
	const prepared = await prepareCmykImage(
		readFileSync(
			new URL(
				"../tests/private/fixtures/print-images/squirrel.png",
				import.meta.url,
			),
		),
		{
			sourceProfile: "srgb",
			destinationProfile: profile,
		},
	)
	const pdf = createPdfDocument({
		metadata: { title: "Transparent PNG / six-ink print proof" },
		outputIntent: { profile, identifier: "CGATS21 CRPC6" },
	})
	const image = pdf.image(prepared)
	const font = pdf.standardFont("Helvetica")
	const bold = pdf.standardFont("Helvetica-Bold")
	const text = (
		value: string,
		x: number,
		y: number,
		size: number,
		heading = false,
	) =>
		pdf.text((t) =>
			t
				.font(heading ? bold : font, size)
				.moveText(x, y)
				.cmykFill(0, 0, 0, 1)
				.show(value),
		)
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 720, 450),
			content: [
				text("Transparent PNG / six-ink print proof", 24, 418, 22, true),
				text(
					"One ICC conversion. Four process plates. Two spot inks. Original alpha.",
					24,
					395,
					11,
				),
				pdf.graphics((g) => {
					for (const [index, overprint] of [false, true].entries()) {
						const x = 24 + index * 348
						g.paintState({
							fillOverprint: false,
							strokeOverprint: false,
							overprintMode: 0,
						})
						g.cmykFill(0.25, 0.08, 0.04, 0.02).rectangle(x, 68, 324, 312).fill()
						g.spotFill(inks[0], 0.6).rectangle(x, 68, 108, 312).fill()
						g.spotFill(inks[1], 0.5)
							.rectangle(x + 216, 68, 108, 312)
							.fill()
						g.paintState({
							fillOverprint: overprint,
							strokeOverprint: false,
							overprintMode: 1,
						}).drawImage(image, x + 6, 68, 312, 312)
					}
				}),
				text("KNOCKOUT", 24, 46, 12, true),
				text("Spot ink is removed in proportion to image opacity.", 24, 29, 10),
				text("OVERPRINT", 372, 46, 12, true),
				text("Spot ink remains beneath the image.", 372, 29, 10),
			],
		}),
	)
	return pdf.compile()
}
