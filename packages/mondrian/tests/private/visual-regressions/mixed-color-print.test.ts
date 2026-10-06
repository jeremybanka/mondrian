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
import { previewPdfPlates } from "mondrian.pdf/testing"
import { opacityGraphicsStateDocument } from "../../public/fixtures/mixed-color/opacity.ts"
import { vectorIntentDocument } from "../../public/fixtures/mixed-color/vector-intent.ts"

it("proofs ordinary opacity with AIS false on the composite and all six ink plates", async () => {
	const prepared = await preparePdfForPrint(
		parsePdf(serializePdf(opacityGraphicsStateDocument())),
		printOptions,
	)
	await expect(serializePdf(prepared.document)).toMatchPdfArtifact(
		"ordinary-opacity",
		visualArtifactOptions,
	)
	for (const plate of previewPdfPlates(prepared.document))
		await expect(serializePdf(plate.document)).toMatchPdfArtifact(
			`opacity-${plate.name.toLowerCase().replaceAll(" ", "-")}`,
			visualArtifactOptions,
		)
}, 30_000)

it("proofs intent changes between successive paintings of a reused source color", async () => {
	const source = vectorIntentDocument(
		"0 0 0 1 k BT /F 7 Tf 5 70 Td (Relative) Tj ET BT /F 7 Tf 45 70 Td (Absolute) Tj ET /RGB cs 0.8 0.15 0.05 sc 5 15 30 50 re f /Absolute gs 45 15 30 50 re f",
	)
	const prepared = await preparePdfForPrint(source, printOptions)
	await expect(serializePdf(prepared.document)).toMatchPdfArtifact(
		"paint-time-intent",
		visualArtifactOptions,
	)
})

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
