import { describe, expect, it } from "vite-plus/test"

import type { StandardFontName } from "../../src/index.ts"
import { createPdfDocument, literalString, pageSizes } from "../../src/index.ts"
import { visualArtifactOptions } from "./setup.ts"

const winAnsiFonts: readonly StandardFontName[] = [
	"Times-Roman",
	"Times-Bold",
	"Times-Italic",
	"Times-BoldItalic",
	"Helvetica",
	"Helvetica-Bold",
	"Helvetica-Oblique",
	"Helvetica-BoldOblique",
	"Courier",
	"Courier-Bold",
	"Courier-Oblique",
	"Courier-BoldOblique",
]

describe("typography visual regressions", () => {
	it("renders the complete Standard 14 font family", async () => {
		const pdf = createPdfDocument({ metadata: { title: "Standard 14 fonts" } })
		const content = winAnsiFonts.map((fontName, index) => {
			const font = pdf.standardFont(fontName)
			return pdf.text((text) =>
				text
					.font(font, 17)
					.moveText(54, 742 - index * 44)
					.show(`${fontName}: The quick brown fox 0123456789`),
			)
		})

		const symbol = pdf.standardFont("Symbol")
		content.push(
			pdf.text((text) =>
				text
					.font(symbol, 20)
					.moveText(54, 190)
					.show(literalString(Uint8Array.from([0x41, 0x42, 0x47, 0x44, 0x57]))),
			),
		)
		const dingbats = pdf.standardFont("ZapfDingbats")
		content.push(
			pdf.text((text) =>
				text
					.font(dingbats, 24)
					.moveText(54, 140)
					.show(literalString(Uint8Array.from([0x33, 0x34, 0x35, 0x36, 0x37]))),
			),
		)
		const helvetica = pdf.standardFont("Helvetica")
		content.push(
			pdf.text((text) =>
				text
					.font(helvetica, 15)
					.moveText(54, 90)
					.show("WinAnsi: “quotes” • € — en–dash ™ café"),
			),
		)

		pdf.setPages(pdf.page({ mediaBox: pageSizes.letter, content }))
		await expect(pdf.serialize()).toMatchPdfArtifact(
			"standard-fonts",
			visualArtifactOptions,
		)
	})

	it("renders text positioning, spacing, scaling, rise, and matrices", async () => {
		const pdf = createPdfDocument({ metadata: { title: "Text state" } })
		const regular = pdf.standardFont("Helvetica")
		const bold = pdf.standardFont("Helvetica-Bold")
		const italic = pdf.standardFont("Times-Italic")
		const content = [
			pdf.text((text) =>
				text.font(bold, 26).moveText(54, 738).show("Text state operators"),
			),
			pdf.text((text) =>
				text
					.font(regular, 16)
					.moveText(54, 680)
					.leading(24)
					.show("Leading controls each baseline")
					.nextLine()
					.show("and moves text predictably")
					.nextLine()
					.show("through multiple lines"),
			),
			pdf.text((text) =>
				text
					.font(regular, 16)
					.characterSpacing(4)
					.moveText(54, 560)
					.show("Character spacing"),
			),
			pdf.text((text) =>
				text
					.font(regular, 16)
					.wordSpacing(14)
					.moveText(54, 510)
					.show("Wide word spacing across this sentence"),
			),
			pdf.text((text) =>
				text
					.font(regular, 18)
					.horizontalScale(65)
					.moveText(54, 450)
					.show("65% horizontal scale"),
			),
			pdf.text((text) =>
				text
					.font(regular, 18)
					.horizontalScale(135)
					.moveText(300, 450)
					.show("135% scale"),
			),
			pdf.text((text) =>
				text
					.font(regular, 20)
					.moveText(54, 380)
					.show("E = mc")
					.font(regular, 12)
					.rise(9)
					.show("2")
					.rise(0)
					.font(regular, 20)
					.show(" and H")
					.font(regular, 12)
					.rise(-5)
					.show("2")
					.rise(0)
					.font(regular, 20)
					.show("O"),
			),
			pdf.text((text) =>
				text
					.font(italic, 22)
					.setTextMatrix(0.866, 0.5, -0.5, 0.866, 100, 190)
					.show("Rotated thirty degrees"),
			),
			pdf.text((text) =>
				text
					.font(bold, 22)
					.setTextMatrix(1, 0, 0.35, 1, 300, 110)
					.show("Skewed matrix"),
			),
		]

		pdf.setPages(pdf.page({ mediaBox: pageSizes.letter, content }))
		await expect(pdf.serialize()).toMatchPdfArtifact(
			"text-state",
			visualArtifactOptions,
		)
	})
})
