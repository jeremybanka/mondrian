import { expect, it } from "vite-plus/test"
import type { PdfDictionary, PdfAnyName } from "../../src/index.ts"
import {
	array,
	ascii,
	dictionary,
	name,
	nameBytes,
	serializePdf,
	stream,
} from "../../src/index.ts"
import { previewPdfPlates } from "../../src/testing.ts"
import { white, rawDocument, samples } from "./fixtures/plates.ts"
import "../../src/vitest.ts"

it("rejects cycles in spot-function graphs", () => {
	const source = rawDocument((objects) => {
		const cycle = objects.reserve<PdfDictionary>()
		cycle.set(
			dictionary({
				FunctionType: 3,
				Domain: array(0, 1),
				Functions: array(cycle.ref),
				Bounds: array(),
				Encode: array(0, 1),
			}),
		)
		return {
			resources: dictionary({
				ColorSpace: dictionary({
					Ink: array(
						name("Separation"),
						name("Cyclic"),
						name("DeviceRGB"),
						cycle.ref,
					),
				}),
			}),
			contents: [],
		}
	})
	expect(() => previewPdfPlates(source)).toThrow(/Cyclic spot definition/u)
})

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
