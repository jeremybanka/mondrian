import { expect, it } from "vite-plus/test"
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
import { previewPdfPlates, renderPdf } from "../../src/testing.ts"
import { planPdfPlates } from "../../src/testing/plate-plan.ts"
import { red, white, rawDocument, samples } from "./fixtures/plates.ts"
import "../../src/vitest.ts"

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

it.each([
	[{ OP: false }, false, false],
	[{ OP: false, op: null }, false, false],
	[{ OP: true, op: false }, false, true],
] as const)(
	"applies partial graphics state %j and restores inherited paint",
	(flags, fill, stroke) => {
		const source = rawDocument((objects) => ({
			resources: dictionary({
				ExtGState: dictionary({
					Initial: dictionary({ OP: true, OPM: 1 }),
					Reset: dictionary(
						{},
						...Object.entries({ ...flags, OPM: 0 }).map(
							([key, value]) =>
								[nameBytes(ascii(key)), objects.add(value)] as const,
						),
					),
				}),
			}),
			contents: [
				stream(
					{},
					ascii(
						"/Initial gs 1 0 0 0 k 0 1 0 0 K q /Reset gs 10 10 20 20 re B Q 40 40 20 20 re B",
					),
				),
			],
		}))
		const plan = planPdfPlates(source, new Set(["cmyk"]))
		const paints = plan.pages[0]!.scope.instructions.filter(
			({ kind }) => kind === "path",
		)
		expect(paints).toMatchObject([
			{
				fill: { overprint: fill, mode: 0 },
				stroke: { overprint: stroke, mode: 0 },
			},
			{
				fill: { overprint: true, mode: 1 },
				stroke: { overprint: true, mode: 1 },
			},
		])
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
