import { describe, expect, it } from "vite-plus/test"

import type { PdfDocumentBuilder, PdfRectangle } from "../../src/index.ts"
import { createPdfDocument, pageSizes, rectangle } from "../../src/index.ts"
import { colorBarsJpeg } from "../fixtures.ts"
import { visualArtifactOptions } from "./setup.ts"

describe("images and pages visual regressions", () => {
	it("renders repeated JPEG images at different scales and transforms", async () => {
		const pdf = createPdfDocument({ metadata: { title: "JPEG placement" } })
		const font = pdf.standardFont("Helvetica-Bold")
		const image = pdf.jpeg(colorBarsJpeg())
		const content = [
			pdf.text((text) =>
				text.font(font, 26).moveText(54, 738).show("JPEG image placement"),
			),
			pdf.graphics((graphics) => graphics.drawImage(image, 54, 500, 240, 160)),
			pdf.graphics((graphics) => graphics.drawImage(image, 340, 540, 180, 120)),
			pdf.graphics((graphics) => graphics.drawImage(image, 54, 350, 360, 80)),
			pdf.graphics((graphics) =>
				graphics
					.concatMatrix(0.866, 0.5, -0.5, 0.866, 380, 150)
					.drawImage(image, 0, 0, 180, 120),
			),
		]

		pdf.setPages(pdf.page({ mediaBox: pageSizes.letter, content }))
		await expect(pdf.serialize()).toMatchPdfArtifact(
			"jpeg-placement",
			visualArtifactOptions,
		)
	})

	it("renders page boxes and rotations across a multi-page document", async () => {
		const pdf = createPdfDocument({ metadata: { title: "Page geometry" } })
		const pages = [
			geometryPage(pdf, "Letter portrait", pageSizes.letter, 0),
			geometryPage(pdf, "Letter rotated 90°", pageSizes.letter, 90),
			geometryPage(pdf, "A4 rotated 180°", pageSizes.a4, 180),
			geometryPage(pdf, "Custom 400 × 240", rectangle(0, 0, 400, 240), 0),
		]
		pdf.setPages(pages[0]!, ...pages.slice(1))

		await expect(pdf.serialize()).toMatchPdfArtifact(
			"page-geometry",
			visualArtifactOptions,
		)
	})
})

function geometryPage(
	pdf: PdfDocumentBuilder,
	label: string,
	mediaBox: PdfRectangle,
	rotation: 0 | 90 | 180 | 270,
) {
	const width = mediaBox[2] - mediaBox[0]
	const height = mediaBox[3] - mediaBox[1]
	const font = pdf.standardFont("Helvetica-Bold")
	return pdf.page({
		mediaBox,
		rotation,
		content: [
			pdf.graphics((graphics) =>
				graphics
					.rgbFill(0.96, 0.97, 0.98)
					.rectangle(0, 0, width, height)
					.fill()
					.rgbStroke(0.08, 0.18, 0.32)
					.lineWidth(8)
					.rectangle(24, 24, width - 48, height - 48)
					.stroke()
					.rgbFill(0.94, 0.27, 0.27)
					.rectangle(24, height - 64, 40, 40)
					.fill()
					.rgbFill(0.13, 0.77, 0.37)
					.rectangle(width - 64, 24, 40, 40)
					.fill(),
			),
			pdf.text((text) =>
				text
					.font(font, Math.min(26, width / 14))
					.moveText(80, height - 58)
					.show(label),
			),
		],
	})
}
