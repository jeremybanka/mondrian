import { expect, it } from "vite-plus/test"
import { PNG } from "pngjs"
import { parsePdf, serializePdf } from "mondrian.pdf"
import { prepareCmykImage, preparePdfForPrint } from "mondrian.pdf/print"
import { renderPdfPlateCoverage } from "mondrian.pdf/testing"
import {
	printOptions,
	sourceProfile,
	destinationProfile,
} from "./fixtures/mixed-color/document.ts"
import { vectorIntentDocument } from "./fixtures/mixed-color/vector-intent.ts"
import { paintedFills } from "./helpers/painted-fills.ts"

const color = "0.8 0.15 0.05"
const sourceColor = `/RGB cs ${color} sc /RGB CS ${color} SC`
const relative = "/RelativeColorimetric ri",
	absolute = "/AbsoluteColorimetric ri"
const rectangle = "10 10 60 60 re f"

async function ink(intent: "relative-colorimetric" | "absolute-colorimetric") {
	const image = new PNG({ width: 1, height: 1 })
	image.data.set([204, 38, 13, 255])
	const png = PNG.sync.write(image)
	const converted = await prepareCmykImage(png, {
		destinationProfile,
		sourceProfile,
		renderingIntent: intent,
		blackPointCompensation: true,
	})
	return [...converted.data].map((v) => v / 255)
}
async function prepare(
	program: string,
	form?: string,
	objectIntents: "honor" | "override" = "honor",
) {
	return preparePdfForPrint(
		parsePdf(serializePdf(vectorIntentDocument(program, form))),
		{ ...printOptions, objectIntents },
	)
}
async function fills(
	program: string,
	form?: string,
	objectIntents: "honor" | "override" = "honor",
) {
	return paintedFills(
		serializePdf((await prepare(program, form, objectIntents)).document),
	)
}

it.each([absolute, "/Absolute gs"])(
	"converts RGB fill using %s at painting, independent of color-assignment order",
	async (intent) => {
		const expected = await ink("absolute-colorimetric"),
			other = await ink("relative-colorimetric")
		expect(expected).not.toEqual(other)
		const before = await fills(`/RGB cs ${intent} ${color} sc ${rectangle}`)
		const after = await fills(`/RGB cs ${color} sc ${intent} ${rectangle}`)
		expect(after).toEqual(before)
		expect(after[0]!.components).toEqual(expected)
	},
)

it.each([
	["stroke path", "4 w 10 10 60 60 re S"],
	["fill and stroke path", "4 w 10 10 60 60 re B"],
	["filled text", "BT /F 24 Tf 0 Tr 10 30 Td (Ink) Tj ET"],
	["stroked text", "BT /F 24 Tf 1 Tr 10 30 Td (Ink) Tj ET"],
	["fill and stroke text", "BT /F 24 Tf 2 Tr 10 30 Td (Ink) Tj ET"],
] as const)(
	"resolves active intent for %s against independently authored CMYK paint",
	{ timeout: 30_000 },
	async (_label, painting) => {
		const components = await ink("absolute-colorimetric"),
			native = `${components.join(" ")} k ${components.join(" ")} K`
		const before = await prepare(`${absolute} ${sourceColor} ${painting}`),
			after = await prepare(`${sourceColor} ${absolute} ${painting}`)
		const reference = vectorIntentDocument(`${native} ${painting}`)
		const a = await renderPdfPlateCoverage(before.document, { resolution: 72 }),
			b = await renderPdfPlateCoverage(after.document, { resolution: 72 }),
			expected = await renderPdfPlateCoverage(reference, { resolution: 72 })
		for (let i = 0; i < 4; i++) {
			expect(
				Buffer.from(a.plates[i]!.pages[0]!.samples).equals(
					b.plates[i]!.pages[0]!.samples,
				),
			).toBe(true)
			expect(
				Buffer.from(b.plates[i]!.pages[0]!.samples).equals(
					expected.plates[i]!.pages[0]!.samples,
				),
			).toBe(true)
		}
	},
)

it.each([
	[relative, absolute],
	["/Relative gs", "/Absolute gs"],
])(
	"honors changing intent on a reused color and restores q/Q state: %s, %s",
	async (rel, abs) => {
		const relativeInk = await ink("relative-colorimetric"),
			absoluteInk = await ink("absolute-colorimetric")
		const paints = await fills(
			`${sourceColor} ${rectangle} q ${abs} ${rectangle} Q ${rectangle} ${abs} ${rectangle} ${rel} ${rectangle}`,
		)
		expect(paints.map((p) => p.components)).toEqual([
			relativeInk,
			absoluteInk,
			relativeInk,
			absoluteInk,
			relativeInk,
		])
		const colors = await fills(
			`${sourceColor} q /RGB cs 0.1 0.6 0.2 sc ${abs} ${rectangle} Q ${rectangle}`,
		)
		expect(colors[0]!.components).not.toEqual(relativeInk)
		expect(colors[1]!.components).toEqual(relativeInk)
	},
)

it.each([absolute, "/Absolute gs"])(
	"inherits source color and current %s into Form painting",
	{ timeout: 30_000 },
	async (intent) => {
		const direct = await prepare(`${sourceColor} ${intent} ${rectangle}`)
		const inherited = await prepare(
			`${sourceColor} ${intent} /Mark Do`,
			rectangle,
		)
		const internal = await prepare(
			`${sourceColor} /Mark Do`,
			`${intent} ${rectangle}`,
		)
		const expected = await renderPdfPlateCoverage(direct.document, {
			resolution: 72,
		})
		for (const prepared of [inherited, internal]) {
			const actual = await renderPdfPlateCoverage(prepared.document, {
				resolution: 72,
			})
			for (let i = 0; i < 4; i++)
				expect(
					Buffer.from(actual.plates[i]!.pages[0]!.samples).equals(
						expected.plates[i]!.pages[0]!.samples,
					),
				).toBe(true)
		}
		const restored = await fills(
			`${sourceColor} /Mark Do ${rectangle}`,
			`${intent} ${rectangle}`,
		)
		expect(restored[0]!.components).toEqual(await ink("relative-colorimetric"))
	},
)

it("keeps deliberate override independent of ri/RI ordering and reused colors", async () => {
	const paints = await fills(
		`${sourceColor} ${absolute} ${rectangle} /Absolute gs ${rectangle} ${relative} ${rectangle}`,
		undefined,
		"override",
	)
	expect(paints.map((p) => p.components)).toEqual(
		Array.from({ length: 3 }, () => [...paints[0]!.components]),
	)
	expect(paints[0]!.components).toEqual(await ink("relative-colorimetric"))
})
