import type { PdfDocument } from "mondrian.pdf"
import { createPdfDocument, rectangle, rgb, separation } from "mondrian.pdf"

const orange = separation("Orange", {
	type: "exponential",
	zero: rgb(1, 1, 1),
	full: rgb(1, 0.4, 0),
	exponent: 1,
})
const blue = separation("Blue", {
	type: "exponential",
	zero: rgb(1, 1, 1),
	full: rgb(0.2, 0.25, 1),
	exponent: 1,
})

/** A fixed six-ink job for composite and individual plate proofing. */
export function printPlateExample(): PdfDocument {
	const pdf = createPdfDocument({
		metadata: { title: "Six-ink plate previews" },
	})
	const font = pdf.standardFont("Helvetica-Bold")
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 480, 320),
			content: [
				pdf.graphics((g) => {
					// Process coverage ramps: every component survives on its own plate.
					for (let index = 0; index < 5; index++) {
						const tint = (index + 1) / 5
						g.cmykFill(tint, tint, tint, tint)
							.rectangle(20 + index * 90, 240, 80, 45)
							.fill()
						g.spotFill(orange, tint)
							.rectangle(20 + index * 90, 190, 80, 30)
							.fill()
						g.spotFill(blue, tint)
							.rectangle(20 + index * 90, 150, 80, 30)
							.fill()
					}
					// Identical geometry, knockout on the left and overprint on the right.
					for (const [index, overprint] of [false, true].entries()) {
						const x = 20 + index * 230
						g.cmykFill(1, 0.6, 0.3, 0.2).rectangle(x, 40, 140, 85).fill()
						g.paintState({
							fillOverprint: overprint,
							strokeOverprint: overprint,
							overprintMode: 1,
						})
							.spotFill(orange, 0.75)
							.spotStroke(blue, 1)
							.lineWidth(8)
							.rectangle(x + 70, 70, 130, 40)
							.fillAndStroke()
						g.cmykFill(0, 0.8, 0, 0)
							.rectangle(x + 25, 25, 55, 45)
							.fill()
						g.paintState({
							fillOverprint: false,
							strokeOverprint: false,
							overprintMode: 0,
						})
					}
				}),
				pdf.text((t) =>
					t
						.font(font, 14)
						.moveText(20, 300)
						.cmykFill(0, 0, 0, 1)
						.show("Six inks: process, Orange, Blue"),
				),
				pdf.text((t) =>
					t.font(font, 12).moveText(20, 7).spotFill(orange, 1).show("Knockout"),
				),
				pdf.text((t) =>
					t
						.font(font, 12)
						.moveText(250, 7)
						.spotStroke(blue, 1)
						.renderingMode(1)
						.show("Overprint"),
				),
			],
		}),
	)
	return pdf.compile()
}
