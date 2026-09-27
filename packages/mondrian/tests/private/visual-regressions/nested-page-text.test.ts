import { expect, it } from "vite-plus/test"
import {
	createPdfDocument,
	parsePdf,
	serializePdf,
	rectangle,
} from "../../../src/index.ts"
import { visualArtifactOptions } from "./setup.ts"

it("renders escaped text and rotated pages in a nested page tree", async () => {
	const pdf = createPdfDocument({
		metadata: { title: "Résumé — 2026", author: "M. Example" },
	})
	const font = pdf.standardFont("Helvetica")
	const cover = pdf.page({
		mediaBox: rectangle(0, 0, 240, 180),
		content: [
			pdf.text((text) =>
				text.font(font, 12).moveText(20, 140).show("Invoice (paid) \\ café €"),
			),
		],
	})
	const appendix = pdf.page({
		mediaBox: rectangle(0, 0, 180, 240),
		rotation: 90,
		content: [
			pdf.text((text) =>
				text.font(font, 12).moveText(20, 200).show("Appendix"),
			),
		],
	})
	const end = pdf.page({
		mediaBox: rectangle(0, 0, 120, 120),
		content: [
			pdf.text((text) => text.font(font, 12).moveText(20, 80).show("End")),
		],
	})
	pdf.setPages(cover, pdf.pages(appendix, end))

	await expect(serializePdf(parsePdf(pdf.serialize()))).toMatchPdfArtifact(
		"nested-pages-and-escaped-text",
		visualArtifactOptions,
	)
})
