import { expect, it } from "vite-plus/test"
import { createPdfDocument, rectangle } from "../../../src/index.ts"
import { visualArtifactOptions } from "./setup.ts"

it("proofs the red and blue pages used for visual regression detection", async () => {
	const pdf = createPdfDocument()
	const red = pdf.page({
		mediaBox: rectangle(0, 0, 20, 20),
		content: [
			pdf.graphics((g) => g.rgbFill(1, 0, 0).rectangle(0, 0, 20, 20).fill()),
		],
	})
	const blue = pdf.page({
		mediaBox: rectangle(0, 0, 20, 20),
		content: [
			pdf.graphics((g) => g.rgbFill(0, 0, 1).rectangle(0, 0, 20, 20).fill()),
		],
	})
	pdf.setPages(red, blue)
	await expect(pdf.serialize()).toMatchPdfArtifact(
		"red-and-blue-pages",
		visualArtifactOptions,
	)
})
