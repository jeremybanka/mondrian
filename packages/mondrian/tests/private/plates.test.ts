import { describe, expect, it } from "vite-plus/test"
import { zlibSync } from "fflate"
import type {
	PdfDictionary,
	PdfDictionaryEntries,
	PdfObjectBuilder,
	PdfPagesDictionary,
	PdfStream,
	PdfVersion,
	PdfAnyName,
} from "../../src/index.ts"
import {
	array,
	ascii,
	bindColorContent,
	colorContent,
	compressColorContent,
	createPdfObjectBuilder,
	dictionary,
	fillColor,
	formColorContent,
	name,
	nameBytes,
	rgb,
	separation,
	serializePdf,
	spot,
	stream,
	textString,
} from "../../src/index.ts"
import { previewPdfPlates, readPdf, renderPdf } from "../../src/testing.ts"
import { parsePlateContent } from "../../src/testing/plate-content.ts"
import "../../src/vitest.ts"

const red = separation("Red / # ink", {
	type: "exponential",
	zero: rgb(1, 1, 1),
	full: rgb(1, 0, 0),
	exponent: 1,
})
const blue = separation("Blue", {
	type: "exponential",
	zero: rgb(1, 1, 1),
	full: rgb(0, 0, 1),
	exponent: 1,
})
const white = [255, 255, 255, 255]

it("returns UTF-8 spot names and coalesces equivalent byte names", async () => {
	const source = namedSpotDocument(
		name("Écarlate / #"),
		nameBytes(new TextEncoder().encode("Écarlate / #")),
	)
	const plates = previewPdfPlates(source, { permitColors: ["spot"] })
	expect(plates.map(({ name }) => name)).toEqual(["Écarlate / #"])
	expect(
		await samples(plates[0]!.document, [
			[20, 20],
			[60, 20],
		]),
	).toEqual([
		[255, 0, 0, 255],
		[255, 0, 0, 255],
	])
	await expect(serializePdf(plates[0]!.document)).toMatchPdfArtifact(
		"utf8-spot-name",
		{ resolution: 72 },
	)
})

it("keeps distinct ink bytes separate even when decoded display names coincide", async () => {
	const source = namedSpotDocument(name("É"), nameBytes(Uint8Array.of(0xc9)))
	const plates = previewPdfPlates(source, { permitColors: ["spot"] })
	expect(plates.map(({ name }) => name)).toEqual(["É", "É"])
	expect(
		await samples(plates[0]!.document, [
			[20, 20],
			[60, 20],
		]),
	).toEqual([[255, 0, 0, 255], white])
	expect(
		await samples(plates[1]!.document, [
			[20, 20],
			[60, 20],
		]),
	).toEqual([white, [255, 0, 0, 255]])
})

function namedSpotDocument(first: PdfAnyName, second: PdfAnyName) {
	return rawDocument(() => {
		const definition = (ink: PdfAnyName) =>
			array(
				name("Separation"),
				ink,
				name("DeviceRGB"),
				dictionary({
					FunctionType: 2,
					Domain: array(0, 1),
					C0: array(1, 1, 1),
					C1: array(1, 0, 0),
					N: 1,
				}),
			)
		return {
			resources: dictionary({
				ColorSpace: dictionary({
					"É /": definition(first),
					Other: definition(second),
				}),
				ExtGState: dictionary({ "É #": dictionary({ ca: 1 }) }),
			}),
			contents: [
				stream(
					{},
					ascii(
						"/#C3#89#20#23 gs /#C3#89#20#2f cs 1 scn 10 10 20 20 re f /Other cs 1 scn 50 10 20 20 re f",
					),
				),
			],
		}
	})
}

it("leaves inherited opacity unchanged by null byte-name graphics state entries", async () => {
	const source = rawDocument((objects) => ({
		resources: dictionary({
			ExtGState: dictionary({
				Half: dictionary({ ca: 0.5 }),
				Empty: dictionary({}, [nameBytes(ascii("ca")), objects.add(null)]),
			}),
		}),
		contents: [
			stream({}, ascii("/Half gs /Empty gs 1 0 0 0 k 10 10 60 60 re f")),
		],
	}))
	expect(
		await samples(previewPdfPlates(source)[0]!.document, [[40, 40]]),
	).toEqual([[128, 214, 247, 255]])
})

it.each([false, true])(
	"treats optional null dictionary entries as absent (indirect: %s)",
	async (indirect) => {
		const source = rawDocument((objects) => {
			const nil = indirect ? objects.add(null) : null
			const child = objects.add(
				stream(
					{
						Type: name("XObject"),
						Subtype: name("Form"),
						BBox: array(0, 0, 80, 80),
						Group: nil,
						OC: nil,
						Ref: nil,
						Filter: nil,
					},
					ascii("/Ink cs 1 0 0 0 sc /State gs 10 10 60 60 re f"),
				),
			)
			return {
				page: { Group: nil, Annots: nil },
				resources: dictionary({
					ColorSpace: dictionary({
						Ink: name("DeviceCMYK"),
						Unused: nil,
						DefaultCMYK: nil,
					}),
					ExtGState: dictionary({
						State: dictionary({
							ca: nil,
							CA: nil,
							OP: nil,
							op: nil,
							OPM: nil,
							BM: nil,
							SMask: nil,
							TK: nil,
							TR: nil,
						}),
					}),
					XObject: dictionary({ Child: child }),
				}),
				contents: [
					stream(
						{ Filter: name("FlateDecode"), DecodeParms: nil },
						zlibSync(ascii("/Child Do")),
					),
				],
			}
		})
		const cyan = previewPdfPlates(source)[0]!.document
		expect(
			await samples(cyan, [
				[40, 40],
				[5, 5],
			]),
		).toEqual([[0, 174, 239, 255], white])
		if (!indirect)
			await expect(serializePdf(cyan)).toMatchPdfArtifact(
				"optional-null-entries",
				{ resolution: 72 },
			)
	},
)

it.each([false, true])(
	"accepts null resource categories (indirect: %s)",
	(indirect) => {
		const source = rawDocument((objects) => {
			const nil = indirect ? objects.add(null) : null
			return {
				contents: [],
				resources: dictionary({
					ColorSpace: nil,
					ExtGState: nil,
					XObject: nil,
				}),
			}
		})
		expect(previewPdfPlates(source)).toHaveLength(4)
	},
)

it.each([
	["Normal"],
	["FutureMode", "Normal"],
	["Normal", "Multiply"],
	["FutureMode"],
	[],
	["Compatible"],
])("resolves Normal blend-mode array fallback %j", async (...modes) => {
	const source = blendArrayDocument(modes)
	const cyan = previewPdfPlates(source)[0]!.document
	expect(
		await samples(cyan, [
			[40, 40],
			[5, 5],
		]),
	).toEqual([[128, 214, 247, 255], white])
	if (modes.length === 1 && modes[0] === "Normal")
		await expect(serializePdf(cyan)).toMatchPdfArtifact(
			"normal-blend-mode-array",
			{ resolution: 72 },
		)
})

it.each([
	["Multiply", "Normal"],
	["FutureMode", "Multiply", "Normal"],
])("rejects a recognized non-Normal blend before fallback %j", (...modes) => {
	expect(() => previewPdfPlates(blendArrayDocument(modes))).toThrow(
		/Normal blending/u,
	)
})

function blendArrayDocument(modes: readonly string[]) {
	return rawDocument((objects) => ({
		resources: dictionary({
			ExtGState: dictionary({
				Half: dictionary({
					ca: 0.5,
					BM: objects.add(
						array(...modes.map((mode) => objects.add(name(mode)))),
					),
				}),
			}),
		}),
		contents: [stream({}, ascii("/Half gs 1 0 0 0 k 10 10 60 60 re f"))],
	}))
}

it.each([false, true])(
	"accepts array CMYK color spaces (indirect: %s)",
	async (indirect) => {
		const source = rawDocument((objects) => ({
			resources: dictionary({
				ColorSpace: dictionary({
					Ink: indirect
						? objects.add(array(objects.add(name("DeviceCMYK"))))
						: array(name("DeviceCMYK")),
				}),
			}),
			contents: [stream({}, ascii("/Ink cs 1 0 0 0 sc 10 10 60 60 re f"))],
		}))
		const plates = previewPdfPlates(source)
		expect(
			await samples(plates[0]!.document, [
				[40, 40],
				[5, 5],
			]),
		).toEqual([[0, 174, 239, 255], white])
		for (const plate of plates.slice(1))
			expect(await samples(plate.document, [[40, 40]])).toEqual([white])
		expect(() => previewPdfPlates(source, { permitColors: ["spot"] })).toThrow(
			/DeviceCMYK.*not permitted/u,
		)
		if (!indirect)
			await expect(serializePdf(plates[0]!.document)).toMatchPdfArtifact(
				"array-cmyk-color-space",
				{ resolution: 72 },
			)
	},
)

it("still rejects malformed device color space arrays", () => {
	expect(() =>
		previewPdfPlates(
			rawDocument(() => ({
				resources: dictionary({
					ColorSpace: dictionary({ Ink: array(name("DeviceCMYK"), 1) }),
				}),
				contents: [],
			})),
		),
	).toThrow(/Color space/u)
})

it("preserves long linked bookmark chains without overflowing the call stack", () => {
	const objects = createPdfObjectBuilder()
	const pages = objects.reserve<PdfPagesDictionary>()
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 80, 80),
			Contents: objects.add(stream({}, ascii("1 0 0 0 k 0 0 80 80 re f"))),
		}),
	)
	pages.set(
		dictionary({
			Type: name("Pages"),
			Kids: array(page),
			Count: 1,
			Resources: dictionary({}),
		}),
	)
	const outlines = objects.reserve<PdfDictionary>()
	const bookmarks = Array.from({ length: 4000 }, () =>
		objects.reserve<PdfDictionary>(),
	)
	bookmarks.forEach((bookmark, index) =>
		bookmark.set(
			dictionary({
				Title: textString(`Bookmark ${index}`),
				Parent: outlines.ref,
				Prev: bookmarks[index - 1]?.ref,
				Next: bookmarks[index + 1]?.ref,
				Dest: array(page, name("Fit")),
			}),
		),
	)
	outlines.set(
		dictionary({
			Type: name("Outlines"),
			First: bookmarks[0]!.ref,
			Last: bookmarks.at(-1)!.ref,
			Count: bookmarks.length,
		}),
	)
	const root = objects.add(
		dictionary({
			Type: name("Catalog"),
			Pages: pages.ref,
			Outlines: outlines.ref,
		}),
	)
	const source = objects.build({ root })
	expect(serializePdf(source).length).toBeGreaterThan(400_000)
	const numbers = new Set(bookmarks.map(({ ref }) => ref.objectNumber))
	const expected = source.objects.filter(({ objectNumber }) =>
		numbers.has(objectNumber),
	)
	for (const { document } of previewPdfPlates(source)) {
		expect(
			document.objects.filter(({ objectNumber }) => numbers.has(objectNumber)),
		).toEqual(expected)
		expect(serializePdf(document).length).toBeGreaterThan(400_000)
	}
})

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

it("keeps shared nested Form projections linear in the source graph", async () => {
	const source = rawDocument((objects) => {
		let child = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 80, 80),
				},
				ascii("1 0 0 0 k 10 10 60 60 re f"),
			),
		)
		for (let depth = 0; depth < 12; depth++) {
			child = objects.add(
				stream(
					{
						Type: name("XObject"),
						Subtype: name("Form"),
						BBox: array(0, 0, 80, 80),
						Resources: dictionary({ XObject: dictionary({ Child: child }) }),
					},
					ascii("/Child Do /Child Do"),
				),
			)
		}
		return {
			resources: dictionary({ XObject: dictionary({ Root: child }) }),
			contents: [stream({}, ascii("/Root Do"))],
		}
	})
	const inputBytes = serializePdf(source).length
	const plates = previewPdfPlates(source)
	for (const plate of plates) {
		expect(plate.document.objects.length).toBeLessThanOrEqual(
			source.objects.length * 2,
		)
		expect(serializePdf(plate.document).length).toBeLessThan(inputBytes * 4)
	}
	expect(
		await samples(plates[0]!.document, [
			[40, 40],
			[5, 5],
		]),
	).toEqual([[0, 174, 239, 255], white])
})

it("keeps cached Forms separate for different page resources", async () => {
	const objects = createPdfObjectBuilder()
	const parent = objects.reserve<PdfPagesDictionary>()
	const inner = objects.add(
		stream(
			{
				Type: name("XObject"),
				Subtype: name("Form"),
				BBox: array(0, 0, 80, 80),
			},
			ascii("/CS0 cs 1 scn 10 10 60 60 re f"),
		),
	)
	const outer = objects.add(
		stream(
			{
				Type: name("XObject"),
				Subtype: name("Form"),
				BBox: array(0, 0, 80, 80),
				Resources: dictionary({ XObject: dictionary({ Inner: inner }) }),
			},
			ascii("/Inner Do"),
		),
	)
	const contents = objects.add(stream({}, ascii("/Outer Do")))
	const pages = [red, blue].map((ink) => {
		const colors = bindColorContent(objects, [
			colorContent([fillColor(spot(ink, 1))]),
		])
		return objects.add(
			dictionary({
				Type: name("Page"),
				Parent: parent.ref,
				Resources: dictionary({
					...colors.resources.entries,
					XObject: dictionary({ Outer: outer }),
				}),
				Contents: contents,
			}),
		)
	})
	parent.set(
		dictionary({
			Type: name("Pages"),
			Kids: array(...pages),
			Count: pages.length,
			MediaBox: array(0, 0, 80, 80),
		}),
	)
	const root = objects.add(
		dictionary({ Type: name("Catalog"), Pages: parent.ref }),
	)
	const plates = previewPdfPlates(objects.build({ root }))
	for (const [index, color] of [
		[4, [255, 0, 0, 255]],
		[5, [0, 0, 255, 255]],
	] as const) {
		const rendered = await renderPdf(serializePdf(plates[index]!.document), {
			resolution: 72,
		})
		for (const [pageIndex, page] of rendered.pages.entries()) {
			const offset = ((page.height - 1 - 40) * page.width + 40) * 4
			expect(Array.from(page.pixels.slice(offset, offset + 4))).toEqual(
				pageIndex === index - 4 ? color : white,
			)
		}
	}
})

it("does not let a cached Form bypass inherited opacity validation", () => {
	const source = rawDocument((objects) => {
		const form = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 80, 80),
				},
				ascii("20 20 40 40 re B"),
			),
		)
		return {
			resources: dictionary({
				XObject: dictionary({ Fm: form }),
				ExtGState: dictionary({ Unequal: dictionary({ CA: 0.5 }) }),
			}),
			contents: [
				stream({}, ascii("1 0 0 0 k 0 1 0 0 K /Fm Do /Unequal gs /Fm Do")),
			],
		}
	})
	expect(() => previewPdfPlates(source)).toThrow(/unequal opacities/u)
})

it.each([false, true])(
	"accepts equivalent spot function streams regardless of key order (indirect arrays: %s)",
	async (indirect) => {
		const source = spotFunctionDocument(indirect)
		const plates = previewPdfPlates(source)
		expect(plates.map(({ name }) => name)).toEqual([
			"Cyan",
			"Magenta",
			"Yellow",
			"Black",
			"Red",
		])
		const [solid, tint] = await samples(plates[4]!.document, [
			[20, 20],
			[60, 20],
		])
		expect(solid).toEqual([255, 0, 0, 255])
		expect(tint![0]).toBe(255)
		expect(tint![1]).toBeCloseTo(128, -1)
		expect(tint![2]).toBe(tint![1])
	},
)

it.each(["bytes", "domain", "range"] as const)(
	"still rejects spot function streams with different %s",
	(difference) => {
		expect(() =>
			previewPdfPlates(spotFunctionDocument(true, difference)),
		).toThrow(/Conflicting definitions for separation Red/u)
	},
)

function spotFunctionDocument(
	indirect: boolean,
	difference?: "bytes" | "domain" | "range",
) {
	return rawDocument((objects) => {
		const values = (...components: number[]) =>
			indirect ? objects.add(array(...components)) : array(...components)
		const code = "{ 1 exch 1 exch sub dup }"
		const first = objects.add(
			stream(
				{
					FunctionType: 4,
					Domain: values(0, 1),
					Range: values(0, 1, 0, 1, 0, 1),
				},
				ascii(code),
			),
		)
		const second = objects.add(
			stream(
				{
					Range: values(0, 1, 0, 1, 0, difference === "range" ? 0.5 : 1),
					Domain: values(0, difference === "domain" ? 2 : 1),
					FunctionType: 4,
				},
				ascii(difference === "bytes" ? "{ 0 exch dup }" : code),
			),
		)
		return {
			resources: dictionary({
				ColorSpace: dictionary({
					A: array(name("Separation"), name("Red"), name("DeviceRGB"), first),
					B: array(name("Separation"), name("Red"), name("DeviceRGB"), second),
				}),
			}),
			contents: [
				stream(
					{},
					ascii("/A cs 1 scn 0 0 40 40 re f /B cs 0.5 scn 40 0 40 40 re f"),
				),
			],
		}
	})
}

it.each([false, true])(
	"preserves PDF 1.2 with an ordinary graphics state (OP present: %s)",
	async (overprint) => {
		const source = rawDocument(
			() => ({
				resources: dictionary({
					ExtGState: dictionary({
						Width: dictionary({
							Type: name("ExtGState"),
							LW: 3,
							...(overprint ? { OP: true } : {}),
						}),
					}),
				}),
				contents: [stream({}, ascii("/Width gs 1 0 0 0 K 10 10 m 70 70 l S"))],
			}),
			"1.2",
		)
		const expected = (await renderPdf(serializePdf(source), { resolution: 72 }))
			.pages[0]!
		const plates = previewPdfPlates(source)
		for (const plate of plates) {
			expect(plate.document.version).toBe("1.2")
			expect(() => serializePdf(plate.document)).not.toThrow()
		}
		const actual = (
			await renderPdf(serializePdf(plates[0]!.document), { resolution: 72 })
		).pages[0]!
		expect(actual.pixels).toEqual(expected.pixels)
	},
)

it.each(["B", "B*", "b", "b*", "text 2", "text 6"])(
	"rejects the unsupported implicit knockout group of %s with unequal opacity",
	(operator) => {
		const source = rawDocument((objects) => {
			const font = objects.add(
				dictionary({
					Type: name("Font"),
					Subtype: name("Type1"),
					BaseFont: name("Helvetica"),
				}),
			)
			const paint = operator.startsWith("text")
				? `BT /F 30 Tf ${operator.slice(5)} Tr 20 20 Td (Ink) Tj ET`
				: `20 20 40 40 re ${operator}`
			return {
				resources: dictionary({
					Font: dictionary({ F: font }),
					ExtGState: dictionary({
						Over: dictionary({ OP: true, op: true, OPM: 1, ca: 1, CA: 0.5 }),
					}),
				}),
				contents: [
					stream({}, ascii(`/Over gs 1 0 0 0 k 0 1 0 0 K 20 w ${paint}`)),
				],
			}
		})
		expect(() => previewPdfPlates(source)).toThrow(
			/Page 1:.*combined fill.*stroke.*unequal opacit/iu,
		)
	},
)

it("tracks partial opacity updates into Forms and restores opacity after Q", () => {
	const make = (restore: boolean) =>
		rawDocument((objects) => {
			const form = objects.add(
				stream(
					{
						Type: name("XObject"),
						Subtype: name("Form"),
						BBox: array(0, 0, 80, 80),
					},
					ascii("1 0 0 0 k 0 1 0 0 K 20 20 40 40 re B"),
				),
			)
			return {
				resources: dictionary({
					ExtGState: dictionary({
						Fill: dictionary({ ca: 0.5 }),
						Stroke: dictionary({ CA: 0.5 }),
						Unequal: dictionary({ CA: 0.25 }),
					}),
					XObject: dictionary({ Fm: form }),
				}),
				contents: [
					stream(
						{},
						ascii(
							`/Fill gs /Stroke gs ${restore ? "q /Unequal gs Q" : "/Unequal gs"} /Fm Do`,
						),
					),
				],
			}
		})
	expect(() => previewPdfPlates(make(false))).toThrow(
		/XObject \/Fm.*unequal opacities/u,
	)
	expect(() => previewPdfPlates(make(true))).not.toThrow()
})

it("projects shared compressed Forms per invocation, with inherited colors and private resource scopes", async () => {
	const source = rawDocument((objects) => {
		const parentInk = bindColorContent(objects, [
			colorContent([fillColor(spot(blue, 1))]),
		])
		const childInk = bindColorContent(objects, [
			colorContent([fillColor(spot(red, 1))]),
		])
		const form = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 40, 20),
					Resources: childInk.resources,
					Filter: name("FlateDecode"),
					Matrix: array(1, 0, 0, 1, 5, 0),
				},
				zlibSync(ascii("0 0 20 20 re f /CS0 cs 0.5 scn 20 0 20 20 re f")),
			),
		)
		return {
			resources: dictionary({
				...parentInk.resources.entries,
				XObject: dictionary({ Fm: form }),
			}),
			contents: [
				stream(
					{},
					ascii("1 0 0 0 k /Fm Do q 1 0 0 1 0 30 cm /CS0 cs 1 scn /Fm Do Q"),
				),
			],
		}
	})
	const plates = previewPdfPlates(structuredClone(source))
	expect(plates.map(({ name }) => name)).toEqual([
		"Cyan",
		"Magenta",
		"Yellow",
		"Black",
		"Blue",
		"Red / # ink",
	])
	const cyan = await samples(plates[0]!.document, [
		[15, 10],
		[35, 10],
		[15, 40],
	])
	expect(cyan[0]).not.toEqual(white)
	expect(cyan.slice(1)).toEqual([white, white])
	expect(
		await samples(plates[4]!.document, [
			[15, 10],
			[35, 40],
			[15, 40],
		]),
	).toEqual([white, white, [0, 0, 255, 255]])
	const reds = await samples(plates[5]!.document, [
		[35, 10],
		[35, 40],
	])
	expect(reds[0]).toEqual(reds[1])
	expect(reds[0]![0]).toBe(255)
	expect(reds[0]![1]).toBeCloseTo(128, -1)
})

it("resolves resource-less nested Forms against the page resources", async () => {
	const source = rawDocument((objects) => {
		const colors = bindColorContent(objects, [
			colorContent([fillColor(spot(red, 1))]),
		])
		const inner = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 80, 80),
				},
				ascii("/CS0 cs 1 scn 10 10 60 60 re f"),
			),
		)
		const outer = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 80, 80),
					Resources: dictionary({ XObject: dictionary({ Inner: inner }) }),
				},
				ascii("/Inner Do"),
			),
		)
		return {
			resources: dictionary({
				...colors.resources.entries,
				XObject: dictionary({ Outer: outer }),
			}),
			contents: [stream({}, ascii("/Outer Do"))],
		}
	})
	expect(await samples(source, [[40, 40]])).toEqual([[255, 0, 0, 255]])
	const plates = previewPdfPlates(source)
	expect(
		await samples(plates[4]!.document, [
			[40, 40],
			[5, 5],
		]),
	).toEqual([[255, 0, 0, 255], white])
	await expect(serializePdf(plates[4]!.document)).toMatchPdfArtifact(
		"nested-form-page-resources",
		{ resolution: 96 },
	)
})

it("handles bound compressed content and nested Forms without losing resource declarations", async () => {
	const source = rawDocument((objects) => {
		const bound = compressColorContent(
			bindColorContent(objects, [
				colorContent([fillColor(spot(red, 0.75)), "0 0 30 30 re f"]),
			]),
		)
		const inner = objects.add(formColorContent(bound, [0, 0, 30, 30]))
		const outer = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 30, 30),
					Resources: dictionary({ XObject: dictionary({ Inner: inner }) }),
				},
				ascii("/Inner Do"),
			),
		)
		return {
			resources: dictionary({ XObject: dictionary({ Outer: outer }) }),
			contents: [stream({}, ascii("/Outer Do"))],
		}
	})
	const plates = previewPdfPlates(source)
	expect(await samples(plates[0]!.document, [[10, 10]])).toEqual([white])
	const result = await samples(plates[4]!.document, [[10, 10]])
	expect(result[0]![0]).toBe(255)
	expect(result[0]![1]).toBeCloseTo(64, -1)
})

it("retains constant opacity, clipping, and graphics state across split page streams", async () => {
	const source = rawDocument((objects) => {
		const colors = bindColorContent(objects, [
			colorContent([fillColor(spot(red, 1))]),
		])
		return {
			resources: dictionary({
				...colors.resources.entries,
				ExtGState: dictionary({}, [
					nameBytes(ascii("Half")),
					dictionary({
						ca: 0.5,
						CA: 0.25,
						OP: true,
						op: false,
						OPM: 1,
						BM: name("Normal"),
					}),
				]),
			}),
			contents: [
				stream({}, ascii("1 0 0 0 k 0 0 80 80 re f q 0 0 40 80 re W n")),
				stream(
					{},
					ascii(
						"/H#61lf gs /CS0 cs 1 scn 0 0 80 80 re f Q 0 1 0 0 k 0 60 20 20 re f",
					),
				),
			],
		}
	})
	const plates = previewPdfPlates(source)
	const [light, solid, knockedOut] = await samples(plates[0]!.document, [
		[10, 10],
		[60, 10],
		[10, 70],
	])
	expect(knockedOut).toEqual(white)
	expect(light).not.toEqual(solid)
	for (let channel = 0; channel < 3; channel++)
		expect(light![channel]).toBeCloseTo((solid![channel]! + 255) / 2, -1)
	const [tint, clipped, covered] = await samples(plates[4]!.document, [
		[10, 10],
		[60, 10],
		[10, 70],
	])
	expect(tint![0]).toBe(255)
	expect(tint![1]).toBeCloseTo(128, -1)
	expect(clipped).toEqual(white)
	expect(covered).toEqual(white)
})

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

describe("discovery failures", () => {
	it.each([
		["1 0 0 rg", /DeviceRGB/u],
		["0 g", /DeviceGray/u],
		["0 0 20 20 re S", /Implicit DeviceGray stroke/u],
		["/Shade sh", /operator sh/u],
		["BI", /operator BI/u],
		["/OC /Layer BDC", /operator BDC/u],
		["Q", /Unbalanced Q/u],
		["q", /Unbalanced q/u],
		["1 0 0 k", /Invalid plate color components/u],
		["2 0 0 0 k", /Invalid plate color components/u],
		["8 Tr", /Invalid text rendering mode/u],
		["/Missing gs", /Missing ExtGState/u],
	])("rejects unsupported or malformed content %s", (commands, message) => {
		expect(() =>
			previewPdfPlates(
				rawDocument(() => ({ contents: [stream({}, ascii(commands))] })),
			),
		).toThrow(message)
	})
	it.each([
		[{ BM: name("Multiply") }, /Normal blending/u],
		[{ SMask: dictionary({ S: name("Alpha") }) }, /Soft masks/u],
		[{ ca: 2 }, /opacity/u],
		[{ OPM: 2 }, /overprint mode/u],
		[{ OP: 1 }, /overprint flag/u],
		[{ TR: name("Identity") }, /graphics state setting/u],
	] as const)("rejects unsupported graphics states %j", (state, message) => {
		expect(() =>
			previewPdfPlates(
				rawDocument(() => ({
					contents: [stream({}, ascii("/State gs"))],
					resources: dictionary({
						ExtGState: dictionary({ State: dictionary(state) }),
					}),
				})),
			),
		).toThrow(message)
	})
	it("rejects forbidden process paint in spot-only mode and invalid options", () => {
		const source = rawDocument(() => ({
			contents: [stream({}, ascii("0 0 0 1 k"))],
		}))
		expect(() => previewPdfPlates(source, { permitColors: ["spot"] })).toThrow(
			/DeviceCMYK.*not permitted/u,
		)
		expect(() =>
			previewPdfPlates(source, { permitColors: ["rgb" as "cmyk"] }),
		).toThrow(/permitColors/u)
	})
	it("rejects image color spaces, transparency groups, Type3 fonts, and annotations", () => {
		const image = rawDocument((objects) => ({
			resources: dictionary({
				XObject: dictionary({
					Image: objects.add(
						stream(
							{
								Type: name("XObject"),
								Subtype: name("Image"),
								Width: 1,
								Height: 1,
								BitsPerComponent: 8,
								ColorSpace: name("DeviceRGB"),
							},
							Uint8Array.of(255, 0, 0),
						),
					),
				}),
			}),
			contents: [stream({}, ascii("/Image Do"))],
		}))
		expect(() => previewPdfPlates(image)).toThrow(/DeviceRGB/u)
		for (const page of [
			{ Group: dictionary({ S: name("Transparency") }) },
			{ Annots: array(dictionary({ Subtype: name("Text") })) },
		])
			expect(() =>
				previewPdfPlates(rawDocument(() => ({ contents: [], page }))),
			).toThrow(/unsupported/u)
		const font = rawDocument(() => ({
			resources: dictionary({
				Font: dictionary({ F: dictionary({ Subtype: name("Type3") }) }),
			}),
			contents: [stream({}, ascii("/F 12 Tf"))],
		}))
		expect(() => previewPdfPlates(font)).toThrow(/Type3/u)
	})
})

it("tokenizes nested strings, escapes, arrays, hex strings, and comments without finding false paint operators", () => {
	expect(
		parsePlateContent(
			"% 1 0 0 rg\n[(outer(inner) \\( rg) -10 <7267>] TJ /A#2fb BMC << /Key (gs) >> DP EMC",
		),
	).toEqual([
		{ operands: ["[(outer(inner) \\( rg) -10 <7267>]"], op: "TJ" },
		{ operands: ["/A#2fb"], op: "BMC" },
		{ operands: ["<< /Key (gs) >>"], op: "DP" },
		{ operands: [], op: "EMC" },
	])
	for (const invalid of ["(unclosed", "[1", "<zz>", "<ab", "1 0", "]", "<<"])
		expect(() => parsePlateContent(invalid)).toThrow(/Malformed/u)
})

function rawDocument(
	make: (objects: PdfObjectBuilder) => {
		contents: readonly PdfStream[]
		resources?: PdfDictionary
		page?: PdfDictionaryEntries
	},
	version: PdfVersion = "1.7",
) {
	const objects = createPdfObjectBuilder()
	const data = make(objects)
	const pages = objects.reserve<PdfPagesDictionary>()
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			Contents: array(...data.contents.map((content) => objects.add(content))),
			...data.page,
		}),
	)
	pages.set(
		dictionary({
			Type: name("Pages"),
			Kids: array(page),
			Count: 1,
			MediaBox: array(0, 0, 80, 80),
			Resources: data.resources ?? dictionary({}),
		}),
	)
	const root = objects.add(
		dictionary({ Type: name("Catalog"), Pages: pages.ref }),
	)
	return objects.build({ root, version })
}

async function samples(
	document: Parameters<typeof serializePdf>[0],
	points: readonly (readonly [number, number])[],
) {
	const page = (await renderPdf(serializePdf(document), { resolution: 72 }))
		.pages[0]!
	return points.map(([x, y]) => {
		const offset = ((page.height - y - 1) * page.width + x) * 4
		return Array.from(page.pixels.slice(offset, offset + 4))
	})
}
