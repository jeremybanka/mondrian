// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs"
import { createPdfDocument, rectangle, rgb } from "../../../src/index.ts"

/** Original shared-resource booklet used as the input to qpdf's linearizer. */
export function linearizationSource(): Uint8Array {
	const pdf = createPdfDocument({
		version: "1.7",
		metadata: {
			title: "The four seasons of a paper garden",
			author: "Imaginary Garden Office",
			creationDate: new Date("2026-09-01T12:00:00Z"),
		},
		id: [
			Uint8Array.from({ length: 16 }, (_, i) => i),
			Uint8Array.from({ length: 16 }, (_, i) => i),
		],
	})
	const font = pdf.standardFont("Helvetica")
	const heading = pdf.standardFont("Helvetica-Bold")
	const image = pdf.jpeg(
		Uint8Array.from(
			readFileSync(
				new URL("../original-corpus/garden-raster.jpg", import.meta.url),
			),
		),
	)
	const pages = ["Seed", "Leaf", "Bloom", "Rest"].map((season, index) =>
		pdf.page({
			mediaBox: rectangle(0, 0, 300, 180),
			content: [
				pdf.text((t) =>
					t.font(heading, 20).moveText(18, 150).show(`Paper garden: ${season}`),
				),
				pdf.text((t) =>
					t
						.font(font, 11)
						.moveText(18, 130)
						.show(`Season ${index + 1} of 4 / invented field notes`),
				),
				pdf.graphics((g) => g.drawImage(image, 18, 30, 144, 96)),
				pdf.graphics((g) =>
					g
						.fillColor(rgb(0.1 + index * 0.15, 0.6, 0.4))
						.rectangle(185, 30, 90, 20 + index * 22)
						.fill(),
				),
			],
		}),
	)
	return pdf.setPages(pages[0]!, ...pages.slice(1)).serialize()
}

export function linearizedBooklet(): Uint8Array {
	return Uint8Array.from(
		readFileSync(new URL("linearized-garden.pdf", import.meta.url)),
	)
}
