import { expect, it } from "vite-plus/test"
import { PDFDocument } from "pdf-lib"
import { parsePdf, serializePdf } from "mondrian.pdf"
import { preparePdfForPrint } from "mondrian.pdf/print"
import { renderPdf, renderPdfPlateCoverage } from "mondrian.pdf/testing"
import {
	mixedColorDocument,
	mixedFixture,
	printOptions,
	sourceProfile,
} from "../../public/fixtures/mixed-color/document.ts"
import { taggedRgbImageExample } from "../../../examples/mixed-color-images.ts"
import { visualArtifactOptions } from "./setup.ts"

it("proofs RGB handoff, an embedded-font RGB label, destination CMYK, and six numeric ink plates", async () => {
	const authored = taggedRgbImageExample(
		mixedFixture("photo.jpg"),
		sourceProfile,
		mixedFixture("alpha.bin"),
	)
	await expect(serializePdf(authored)).toMatchPdfArtifact(
		"typed-rgb-handoff",
		visualArtifactOptions,
	)
	const original = mixedColorDocument()
	await expect(serializePdf(original)).toMatchPdfArtifact(
		"source-rgb-label",
		visualArtifactOptions,
	)
	const prepared = await preparePdfForPrint(
		parsePdf(serializePdf(original)),
		printOptions,
	)
	await expect(serializePdf(prepared.document)).toMatchPdfArtifact(
		"destination-cmyk-label",
		visualArtifactOptions,
	)
	const { plates } = await renderPdfPlateCoverage(
		prepared.document,
		visualArtifactOptions,
	)
	for (const plate of plates) {
		const proof = await PDFDocument.create()
		for (const page of plate.pages) {
			const png = await proof.embedPng(page.png)
			proof
				.addPage([page.width, page.height])
				.drawImage(png, { x: 0, y: 0, width: page.width, height: page.height })
		}
		const bytes = await proof.save(),
			rendered = await renderPdf(bytes, { resolution: 72 })
		for (const [index, page] of rendered.pages.entries())
			expect(
				page.pixels.every(
					(value, offset) =>
						value ===
						(offset % 4 === 3
							? 255
							: plate.pages[index]!.samples[Math.floor(offset / 4)]),
				),
			).toBe(true)
		await expect(bytes).toMatchPdfArtifact(
			`coverage-${plate.name.toLowerCase().replaceAll(" ", "-")}`,
			{ resolution: 72 },
		)
	}
}, 30_000)
