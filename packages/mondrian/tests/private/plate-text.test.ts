import { expect, it } from "vite-plus/test"
import type { PdfDictionaryEntries } from "../../src/index.ts"
import {
	array,
	ascii,
	bindColorContent,
	colorContent,
	dictionary,
	fillColor,
	name,
	nameBytes,
	serializePdf,
	spot,
	stream,
} from "../../src/index.ts"
import { previewPdfPlates, readPdf, renderPdf } from "../../src/testing.ts"
import { red, rawDocument } from "./fixtures/plates.ts"
import "../../src/vitest.ts"

it.each([
	"[100] TJ",
	"[] TJ",
	"() Tj",
	"<> Tj",
	"< \n > Tj",
	"[() 100 <> % (ignored glyphs)\n -20] TJ",
	"(\\\n\\\r\\\r\n) Tj",
	"() '",
	'2 3 () "',
])("retains positioning without requiring paint for %j", async (empty) => {
	const source = textPositionDocument(`${empty} 1 0 0 0 k (Cyan) Tj`)
	const plates = previewPdfPlates(source)
	const original = await readPdf(serializePdf(source))
	for (const plate of plates) {
		const actual = await readPdf(serializePdf(plate.document))
		expect(actual.pageCharacters).toEqual(original.pageCharacters)
	}
	const cyan = serializePdf(plates[0]!.document)
	expect((await renderPdf(cyan, { resolution: 72 })).pages[0]!.pixels).toEqual(
		(await renderPdf(serializePdf(source), { resolution: 72 })).pages[0]!
			.pixels,
	)
	if (empty === "[100] TJ")
		await expect(cyan).toMatchPdfArtifact("positioning-only-text", {
			resolution: 144,
		})
})

it("does not count empty text toward transparency and overprint usage", () => {
	expect(() =>
		previewPdfPlates(
			textPositionDocument(
				"/Half gs [100 ()] TJ /OpaqueOver gs 1 0 0 0 k (Cyan) Tj",
			),
		),
	).not.toThrow()
	expect(() =>
		previewPdfPlates(
			textPositionDocument(
				"2 Tr /Unequal gs [100 ()] TJ 0 Tr /OpaqueOver gs 1 0 0 0 k (Cyan) Tj",
			),
		),
	).not.toThrow()
})

it.each([
	"[(A)] TJ",
	"(\\101) Tj",
	"<41> Tj",
	"(()) Tj",
	"(\\\\) Tj",
	"( ) Tj",
])("still checks actual glyph bytes in %j", (paint) => {
	expect(() => previewPdfPlates(textPositionDocument(paint))).toThrow(
		/Implicit DeviceGray/u,
	)
})

function textPositionDocument(commands: string) {
	return rawDocument(() => ({
		resources: dictionary({
			Font: dictionary({
				F: dictionary({
					Type: name("Font"),
					Subtype: name("Type1"),
					BaseFont: name("Helvetica"),
				}),
			}),
			ExtGState: dictionary({
				Half: dictionary({ ca: 0.5 }),
				Unequal: dictionary({ ca: 0.5, CA: 1 }),
				OpaqueOver: dictionary({ ca: 1, op: true, OPM: 1 }),
			}),
		}),
		contents: [stream({}, ascii(`BT /F 12 Tf 20 50 Td 14 TL ${commands} ET`))],
	}))
}

it.each([true, false, null])(
	"checks text-knockout context on each use of TK=%s",
	(TK) => {
		const source = rawDocument((objects) => ({
			resources: dictionary({
				ExtGState: dictionary({
					State: dictionary({}, [nameBytes(ascii("TK")), objects.add(TK)]),
				}),
			}),
			contents: [stream({}, ascii("/State gs BT /State gs ET"))],
		}))
		if (TK === null) expect(() => previewPdfPlates(source)).not.toThrow()
		else
			expect(() => previewPdfPlates(source)).toThrow(
				/Text knockout.*outside a text object/u,
			)
	},
)

// PDF 1.6 §5.2.7 requires glyph shapes to survive implicit text knockout.
// PDFium does not distinguish TK in this fixture; this tests the support boundary.
it.each([undefined, true])(
	"rejects transparent overprinting text with TK=%s",
	(TK) => {
		const source = knockoutTextDocument({ ca: 0.5, op: true, OPM: 1, TK })
		expect(() => previewPdfPlates(source)).toThrow(
			/transparent overprinting text.*knockout/u,
		)
	},
)

it("checks transparency and overprint across the whole text object", () => {
	const source = knockoutTextDocument(
		{ ca: 0.5 },
		"BT /F 30 Tf 1 0 0 0 k (M) Tj /Over gs 1 0 0 1 0 0 Tm 0 1 0 0 k (M) Tj ET",
	)
	expect(() => previewPdfPlates(source)).toThrow(
		/transparent overprinting text/u,
	)
})

it("tracks text knockout through partial states, save/restore, and cached Forms", () => {
	const source = knockoutTextDocument(
		{ ca: 0.5, op: true, OPM: 1 },
		"q /NoKnockout gs /Text Do Q /Text Do",
		true,
	)
	expect(() => previewPdfPlates(source)).toThrow(
		/XObject.*transparent overprinting text/u,
	)
})

it.each([
	[{ ca: 0.5, op: true, OPM: 1, TK: false }, undefined],
	[{ ca: 0.5 }, undefined],
	[{ op: true, OPM: 1 }, undefined],
	[
		{ ca: 0.5 },
		"BT /F 30 Tf 1 0 0 0 k (M) Tj ET /Over gs BT /F 30 Tf 0 1 0 0 k (M) Tj ET",
	],
] as const)("retains supported text compositing %j", (state, commands) => {
	expect(previewPdfPlates(knockoutTextDocument(state, commands))).toHaveLength(
		4,
	)
})

function knockoutTextDocument(
	state: PdfDictionaryEntries,
	commands = "BT /F 30 Tf 1 0 0 0 k (M) Tj 1 0 0 1 0 0 Tm 0 1 0 0 k (M) Tj ET",
	form = false,
) {
	return rawDocument((objects) => {
		const resources = dictionary({
			Font: dictionary({
				F: dictionary({
					Type: name("Font"),
					Subtype: name("Type1"),
					BaseFont: name("Helvetica"),
				}),
			}),
			ExtGState: dictionary({
				State: dictionary(state),
				Over: dictionary({ ca: 1, op: true, OPM: 1 }),
				NoKnockout: dictionary({ TK: false }),
			}),
		})
		return {
			resources: dictionary({
				...resources.entries,
				...(form
					? {
							XObject: dictionary({
								Text: objects.add(
									stream(
										{
											Type: name("XObject"),
											Subtype: name("Form"),
											BBox: array(0, 0, 80, 80),
										},
										ascii(
											"BT /F 30 Tf 1 0 0 0 k (M) Tj 1 0 0 1 0 0 Tm 0 1 0 0 k (M) Tj ET",
										),
									),
								),
							}),
						}
					: {}),
			}),
			contents: [stream({}, ascii(`/State gs ${commands}`))],
		}
	})
}

it("keeps invisible text advancement and separates text stroke overprint", async () => {
	const source = rawDocument((objects) => {
		const colors = bindColorContent(objects, [
			colorContent([fillColor(spot(red, 1))]),
		])
		const font = objects.add(
			dictionary({
				Type: name("Font"),
				Subtype: name("Type1"),
				BaseFont: name("Helvetica"),
			}),
		)
		return {
			resources: dictionary({
				...colors.resources.entries,
				Font: dictionary({ F: font }),
				ExtGState: dictionary({
					Over: dictionary({ OP: true, op: true, OPM: 1 }),
				}),
			}),
			contents: [
				stream(
					{},
					ascii(
						"/Over gs BT /F 12 Tf 5 40 Td /CS0 cs 1 scn (Red ) Tj 0 0 0 1 k (Black) Tj ET",
					),
				),
			],
		}
	})
	const plates = previewPdfPlates(source)
	for (const plate of plates)
		expect((await readPdf(serializePdf(plate.document))).pages[0]!.text).toBe(
			"Red Black",
		)
	const black = await readPdf(serializePdf(plates[3]!.document))
	const redPage = await readPdf(serializePdf(plates[4]!.document))
	expect(black.pageCharacters[0]!.map(({ x }) => x)).toEqual(
		redPage.pageCharacters[0]!.map(({ x }) => x),
	)
})
