import { describe, expect, it } from "vite-plus/test"

import { createPdfDocument, pageSizes } from "../../src/index.ts"
import { visualArtifactOptions } from "./setup.ts"

describe("graphics visual regressions", () => {
	it("renders fills, strokes, widths, rectangles, and closed paths", async () => {
		const pdf = createPdfDocument({ metadata: { title: "Vector primitives" } })
		const heading = pdf.standardFont("Helvetica-Bold")
		const labels = pdf.standardFont("Helvetica")
		const content = [
			pdf.text((text) =>
				text.font(heading, 26).moveText(54, 738).show("Vector primitives"),
			),
			pdf.graphics((graphics) => {
				const colors = [
					[0.94, 0.27, 0.27],
					[0.96, 0.62, 0.04],
					[0.13, 0.77, 0.37],
					[0.02, 0.71, 0.83],
					[0.23, 0.51, 0.96],
					[0.55, 0.36, 0.96],
				] as const
				for (const [index, color] of colors.entries()) {
					const [red, green, blue] = color
					graphics
						.rgbFill(red, green, blue)
						.rectangle(54 + index * 82, 630, 66, 66)
						.fill()
				}
			}),
			pdf.graphics((graphics) =>
				graphics
					.rgbFill(0.86, 0.94, 1)
					.rgbStroke(0.02, 0.4, 0.7)
					.lineWidth(5)
					.rectangle(54, 500, 220, 80)
					.fillAndStroke(),
			),
			pdf.graphics((graphics) =>
				graphics
					.rgbFill(0.98, 0.8, 0.08)
					.rgbStroke(0.45, 0.23, 0.02)
					.lineWidth(8)
					.moveTo(340, 500)
					.lineTo(500, 500)
					.lineTo(420, 590)
					.closePath()
					.fillAndStroke(),
			),
			pdf.text((text) =>
				text.font(labels, 14).moveText(54, 450).show("Line widths"),
			),
		]
		for (let index = 0; index < 6; index += 1) {
			content.push(
				pdf.graphics((graphics) =>
					graphics
						.rgbStroke(0.12, 0.16, 0.23)
						.lineWidth(index + 1)
						.moveTo(54, 410 - index * 42)
						.lineTo(540, 410 - index * 42)
						.stroke(),
				),
			)
		}

		pdf.setPages(pdf.page({ mediaBox: pageSizes.letter, content }))
		await expect(pdf.serialize()).toMatchPdfArtifact(
			"vector-primitives",
			visualArtifactOptions,
		)
	})

	it("renders independent coordinate transformations", async () => {
		const pdf = createPdfDocument({ metadata: { title: "Transformations" } })
		const font = pdf.standardFont("Helvetica-Bold")
		const content = [
			pdf.text((text) =>
				text
					.font(font, 26)
					.moveText(54, 738)
					.show("Coordinate transformations"),
			),
			pdf.graphics((graphics) =>
				graphics.rgbFill(0.86, 0.15, 0.15).rectangle(70, 520, 130, 90).fill(),
			),
			pdf.graphics((graphics) =>
				graphics
					.concatMatrix(0.866, 0.5, -0.5, 0.866, 330, 500)
					.rgbFill(0.03, 0.65, 0.55)
					.rectangle(0, 0, 130, 90)
					.fill(),
			),
			pdf.graphics((graphics) =>
				graphics
					.concatMatrix(1.4, 0, 0.35, 0.8, 90, 320)
					.rgbFill(0.25, 0.46, 0.95)
					.rectangle(0, 0, 130, 90)
					.fill(),
			),
			pdf.graphics((graphics) =>
				graphics
					.concatMatrix(-1, 0, 0, 1, 530, 300)
					.rgbFill(0.58, 0.25, 0.9)
					.moveTo(0, 0)
					.lineTo(150, 0)
					.lineTo(30, 110)
					.closePath()
					.fill(),
			),
		]

		pdf.setPages(pdf.page({ mediaBox: pageSizes.letter, content }))
		await expect(pdf.serialize()).toMatchPdfArtifact(
			"transformations",
			visualArtifactOptions,
		)
	})
})
