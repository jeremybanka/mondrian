// SPDX-License-Identifier: MPL-2.0

import type {
	PdfColorContent,
	PdfDocument,
	PdfPageDictionary,
	PdfPagesDictionary,
	PdfProcessColor,
	PdfSpotColor,
} from "../src/index.ts"
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
	pageSizes,
	paintState,
	rgb,
	separation,
	spot,
	strokeColor,
} from "../src/index.ts"

export const orangeInk = separation("Brand Orange", {
	type: "exponential",
	zero: cmyk(0, 0, 0, 0),
	full: cmyk(0, 0.66, 1, 0),
	exponent: 1,
})
export const blueInk = separation("Brand Blue", {
	type: "exponential",
	zero: cmyk(0, 0, 0, 0),
	full: cmyk(1, 0.3, 0, 0),
	exponent: 1,
})

export function semanticPrintExample(): PdfDocument {
	const pdf = createPdfDocument({ metadata: { title: "Native print colors" } })
	const font = pdf.standardFont("Helvetica-Bold")
	pdf.setPages(
		pdf.page({
			mediaBox: pageSizes.letter,
			content: [
				pdf.graphics((g) =>
					g
						.cmykFill(0, 0.66, 1, 0)
						.spotStroke(blueInk, 0.5)
						.lineWidth(4)
						.rectangle(54, 600, 300, 100)
						.fillAndStroke(),
				),
				pdf.text((t) =>
					t
						.font(font, 22)
						.moveText(54, 550)
						.spotFill(orangeInk, 1)
						.show("Live spot-colored text"),
				),
			],
		}),
	)
	return pdf.compile()
}

/** Application-level unit conversion matching create-design's resolved colors. */
export function createDesignColor(
	source:
		| Readonly<{ space: "rgb"; r: number; g: number; b: number }>
		| Readonly<{ space: "cmyk"; c: number; m: number; y: number; k: number }>,
): PdfProcessColor {
	return source.space === "cmyk"
		? cmyk(source.c / 100, source.m / 100, source.y / 100, source.k / 100)
		: rgb(source.r / 255, source.g / 255, source.b / 255)
}

/** Cache this instead of a stream carrying document-bound spot references. */
export function createDesignFragment(): PdfColorContent {
	return colorContent([
		fillColor(createDesignColor({ space: "cmyk", c: 0, m: 66, y: 100, k: 0 })),
		strokeColor(createDesignColor({ space: "rgb", r: 20, g: 40, b: 80 })),
		// The existing renderer continues to own custom paths and glyph placement.
		"4 w 54 550 m 90 740 270 570 330 690 c 330 550 l h B",
	])
}

/** Requirements-based Pack OS example; the private renderer was not accessible. */
export function packOsFragment(ink: PdfSpotColor = orangeInk): PdfColorContent {
	return colorContent([
		fillColor(cmyk(1, 0, 0, 0)),
		"54 360 220 120 re f",
		paintState({
			fillOverprint: true,
			strokeOverprint: false,
			overprintMode: 1,
		}),
		fillColor(spot(ink, 0.75)),
		strokeColor(spot(blueInk, 1)),
		"6 w 160 390 220 120 re B",
		fillColor(spot(ink, 1)),
		"BT /Label 20 Tf 54 310 Td (Positioned text with a named ink) Tj ET",
	])
}

/** Compose cached fragments with this graph's font resource. */
export function objectPrintExample(
	fragments: readonly PdfColorContent[] = [
		createDesignFragment(),
		packOsFragment(),
	],
): PdfDocument {
	const objects = createPdfObjectBuilder()
	const bound = bindColorContent(objects, fragments)
	const font = objects.add(
		dictionary({
			Type: name("Font"),
			Subtype: name("Type1"),
			BaseFont: name("Helvetica"),
			Encoding: name("WinAnsiEncoding"),
		}),
	)
	const pages = objects.reserve<PdfPagesDictionary>()
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 612, 792),
			Resources: dictionary({
				...bound.resources.entries,
				Font: dictionary({ Label: font }),
			}),
			Contents: objects.add(bound.stream),
		}) satisfies PdfPageDictionary,
	)
	pages.set(dictionary({ Type: name("Pages"), Count: 1, Kids: array(page) }))
	const root = objects.add(
		dictionary({ Type: name("Catalog"), Pages: pages.ref }),
	)
	return objects.build({ root })
}
