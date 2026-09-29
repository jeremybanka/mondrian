import { expect, it } from "vite-plus/test"
import { createPdfDocument, rectangle } from "../../src/index.ts"
import { renderPdfPlateCoverage } from "../../src/testing.ts"
import { projectPdfPlates } from "../../src/testing/plates.ts"

it.each([NaN, Infinity, -1, "72"])(
	"rejects invalid coverage resolution even for an empty plate set: %s",
	async (resolution) => {
		const pdf = createPdfDocument()
		pdf.setPages(pdf.page({ mediaBox: rectangle(0, 0, 10, 10) }))
		await expect(
			renderPdfPlateCoverage(pdf.compile(), {
				resolution: resolution as number,
				permitColors: [],
			}),
		).rejects.toThrow(/resolution/)
	},
)

it("uses scalar blending in a supported temporary PDF version for legacy source documents", async () => {
	const pdf = createPdfDocument({ version: "1.1" })
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 10, 10),
			content: [
				pdf.graphics((g) =>
					g.cmykFill(0.5, 0, 0, 0).rectangle(0, 0, 10, 10).fill(),
				),
			],
		}),
	)
	const source = pdf.compile()
	const [plate] = projectPdfPlates(source, {}, "coverage")
	expect(plate!.document.version).toBe("1.4")
	expect(source.version).toBe("1.1")
	const { plates } = await renderPdfPlateCoverage(source, { resolution: 72 })
	expect(plates[0]!.pages[0]!.samples[55]).toBe(128)
})
