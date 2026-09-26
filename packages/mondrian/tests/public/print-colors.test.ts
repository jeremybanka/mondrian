import { expect, it } from "vite-plus/test"
import {
	array,
	bindColorContent,
	cmyk,
	colorContent,
	createPdfDocument,
	createPdfObjectBuilder,
	dictionary,
	fillColor,
	name,
	rectangle,
	rgb,
	separation,
	serializePdf,
	spot,
} from "mondrian.pdf"
import type { PdfPagesDictionary } from "mondrian.pdf"
import { readPdf, renderPdf } from "mondrian.pdf/testing"
import { paintedFills } from "./helpers/painted-fills.ts"

// Identical preview colors must not collapse two independently named inks.
const alternate = {
	type: "exponential",
	zero: rgb(1, 1, 1),
	full: rgb(1, 0, 0),
	exponent: 1,
} as const
const firstInk = separation("Brand Red", alternate)
const secondInk = separation("Other Red", alternate)

it.each([
	["semantic builder", semanticPage],
	["object builder", objectPage],
] as const)(
	"preserves process channels, named inks, and live text through the %s",
	async (_workflow, makePage) => {
		const bytes = makePage()
		const fills = await paintedFills(bytes)
		// These are PDF paint semantics, not generated resource names or object IDs.
		expect(fills).toEqual(
			expect.arrayContaining([
				{ paint: "path", space: "DeviceCMYK", components: [0, 0, 0, 1] },
				{ paint: "path", space: "Brand Red", components: [1] },
				{ paint: "path", space: "Other Red", components: [0.5] },
				{ paint: "text", space: "Brand Red", components: [0.75] },
			]),
		)

		const read = await readPdf(bytes)
		expect(read.pages[0]!.text).toBe("Ink")
		const firstCharacter = read.pageCharacters[0]!.find(
			({ text }) => text === "I",
		)!
		expect(firstCharacter.x).toBeCloseTo(10, 3)
		expect(firstCharacter.y).toBeCloseTo(70, 3)

		const page = (await renderPdf(bytes, { resolution: 72 })).pages[0]!
		// Interior samples prove usable alternate-color rendering. A small channel
		// tolerance avoids making a renderer's exact rounding a public contract.
		for (const [x, expected] of [
			[75, [255, 0, 0]],
			[125, [255, 128, 128]],
		] as const) {
			const offset = ((page.height - 1 - 25) * page.width + x) * 4
			for (const [channel, value] of expected.entries()) {
				expect(
					Math.abs(page.pixels[offset + channel]! - value),
				).toBeLessThanOrEqual(2)
			}
			expect(page.pixels[offset + 3]).toBe(255)
		}
	},
)

function semanticPage(): Uint8Array {
	const pdf = createPdfDocument()
	const font = pdf.standardFont("Helvetica")
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 150, 100),
			content: [
				pdf.graphics((g) =>
					g
						.cmykFill(0, 0, 0, 1)
						.rectangle(10, 10, 30, 30)
						.fill()
						.spotFill(firstInk, 1)
						.rectangle(60, 10, 30, 30)
						.fill()
						.spotFill(secondInk, 0.5)
						.rectangle(110, 10, 30, 30)
						.fill(),
				),
				pdf.text((t) =>
					t
						.font(font, 12)
						.moveText(10, 70)
						.spotFill(firstInk, 0.75)
						.show("Ink"),
				),
			],
		}),
	)
	return pdf.serialize()
}

function objectPage(): Uint8Array {
	const objects = createPdfObjectBuilder()
	const bound = bindColorContent(objects, [
		colorContent([
			fillColor(cmyk(0, 0, 0, 1)),
			"10 10 30 30 re f",
			fillColor(spot(firstInk, 1)),
			"60 10 30 30 re f",
			fillColor(spot(secondInk, 0.5)),
			"110 10 30 30 re f",
			fillColor(spot(firstInk, 0.75)),
			"BT /Label 12 Tf 10 70 Td (Ink) Tj ET",
		]),
	])
	const font = objects.add(
		dictionary({
			Type: name("Font"),
			Subtype: name("Type1"),
			BaseFont: name("Helvetica"),
		}),
	)
	const pages = objects.reserve<PdfPagesDictionary>()
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 150, 100),
			Resources: dictionary({
				...bound.resources.entries,
				Font: dictionary({ Label: font }),
			}),
			Contents: objects.add(bound.stream),
		}),
	)
	pages.set(dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }))
	const root = objects.add(
		dictionary({ Type: name("Catalog"), Pages: pages.ref }),
	)
	return serializePdf(objects.build({ root }))
}
