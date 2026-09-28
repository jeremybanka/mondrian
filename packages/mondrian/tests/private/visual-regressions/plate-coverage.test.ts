import { expect, it } from "vite-plus/test"
import { PDFDocument } from "pdf-lib"
import { parsePdf, serializePdf } from "mondrian.pdf"
import { renderPdf, renderPdfPlateCoverage } from "mondrian.pdf/testing"
import { printPlateExample } from "../../../examples/print-plates.ts"
import { printImageExample } from "../../../examples/print-images.ts"
import { visualArtifactOptions } from "./setup.ts"

it.each([
	["vectors", printPlateExample],
	["images", printImageExample],
] as const)(
	"renders numeric coverage proofs for %s",
	async (fixture, document) => {
		const source = parsePdf(serializePdf(await document()))
		const { plates } = await renderPdfPlateCoverage(
			source,
			visualArtifactOptions,
		)
		for (const plate of plates) {
			// Wrap returned PNGs at one point per pixel to use the established PDF
			// artifact workflow without reinterpreting the source ink colors.
			const proof = await PDFDocument.create()
			for (const page of plate.pages) {
				const png = await proof.embedPng(page.png)
				proof.addPage([page.width, page.height]).drawImage(png, {
					x: 0,
					y: 0,
					width: page.width,
					height: page.height,
				})
			}
			const bytes = await proof.save()
			const rendered = await renderPdf(bytes, { resolution: 72 })
			for (const [index, page] of rendered.pages.entries()) {
				const expected = plate.pages[index]!
				expect([page.width, page.height]).toEqual([
					expected.width,
					expected.height,
				])
				expect(
					page.pixels.every(
						(value, offset) =>
							value ===
							(offset % 4 === 3
								? 255
								: expected.samples[Math.floor(offset / 4)]),
					),
				).toBe(true)
			}
			await expect(bytes).toMatchPdfArtifact(
				`${fixture}-${plate.name.toLowerCase().replaceAll(" ", "-")}`,
				{ resolution: 72 },
			)
		}
	},
	30_000,
)
