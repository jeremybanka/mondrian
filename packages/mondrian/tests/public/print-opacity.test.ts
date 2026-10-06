import { expect, it } from "vite-plus/test"
import { PDFBool, PDFDict, PDFDocument, PDFName } from "pdf-lib"
import { parsePdf, serializePdf } from "mondrian.pdf"
import { preparePdfForPrint } from "mondrian.pdf/print"
import { previewPdfPlates, renderPdfPlateCoverage } from "mondrian.pdf/testing"
import { opacityGraphicsStateDocument } from "./fixtures/mixed-color/opacity.ts"
import { printOptions } from "./fixtures/mixed-color/document.ts"
import { readPdf } from "../../src/testing/inspection/read-pdf.ts"

async function assertOpacityState(bytes: Uint8Array) {
	const pdf = await PDFDocument.load(bytes),
		resources = pdf.getPages()[0]!.node.Resources()!
	const states = resources.lookup(PDFName.of("ExtGState"), PDFDict)
	expect(states.keys().length).toBeGreaterThan(0)
	for (const key of states.keys())
		expect(
			states
				.lookup(key, PDFDict)
				.lookup(PDFName.of("AIS"), PDFBool)
				.asBoolean(),
		).toBe(false)
}

it(
	"prepares and plate-splits explicit ordinary opacity settings while retaining AIS false",
	{ timeout: 30_000 },
	async () => {
		const original = serializePdf(opacityGraphicsStateDocument()),
			without = serializePdf(opacityGraphicsStateDocument({}))
		const prepared = await preparePdfForPrint(parsePdf(original), printOptions),
			control = await preparePdfForPrint(parsePdf(without), printOptions)
		await assertOpacityState(serializePdf(prepared.document))
		const plates = previewPdfPlates(prepared.document)
		expect(plates.map((p) => p.name)).toEqual([
			"Cyan",
			"Magenta",
			"Yellow",
			"Black",
			"Forest Green",
			"Violet",
		])
		for (const plate of plates)
			await assertOpacityState(serializePdf(plate.document))
		const actual = await renderPdfPlateCoverage(prepared.document, {
				resolution: 72,
			}),
			expected = await renderPdfPlateCoverage(control.document, {
				resolution: 72,
			})
		for (const [i, plate] of actual.plates.entries())
			expect(
				Buffer.from(plate.pages[0]!.samples).equals(
					expected.plates[i]!.pages[0]!.samples,
				),
			).toBe(true)
		const before = await readPdf(original),
			after = await readPdf(serializePdf(prepared.document))
		expect(after.pages).toEqual(before.pages)
		expect(after.pageCharacters).toEqual(before.pageCharacters)
		expect(after.pageFonts).toEqual(before.pageFonts)
	},
)

it("continues rejecting alpha-as-shape graphics state", async () => {
	await expect(
		preparePdfForPrint(
			opacityGraphicsStateDocument({ ais: true }),
			printOptions,
		),
	).rejects.toThrow(/AIS true/)
})
