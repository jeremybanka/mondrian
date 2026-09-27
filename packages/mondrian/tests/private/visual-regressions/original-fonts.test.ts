import { expect, it } from "vite-plus/test"
import { parsePdf, serializePdf } from "../../../src/index.ts"
import { embeddedFontNotebook } from "../../fixtures/original-corpus/fonts.ts"
import { provePages } from "../../fixtures/original-corpus/proof.ts"
import "./setup.ts"

it("preserves all embedded-font notebook pages, text, geometry, and pixels", async () => {
	const source = embeddedFontNotebook()
	const output = serializePdf(parsePdf(source))
	const before = await provePages(source),
		after = await provePages(output)
	expect(after).toEqual(before)
	expect(before).toHaveLength(2)
	for (const page of before)
		expect(page).toMatchObject({ width: 540, height: 540, rotation: 0 })
	expect(before[0]!.text).toContain("MOSS LANGUAGE NOTEBOOK")
	expect(before[0]!.text).toContain("山川日月")
	expect(before[0]!.text).toContain("山の川と月")
	expect(before[0]!.text).toContain("سلام")
	expect(before[0]!.text).toContain("باب")
	expect(before[1]!.text).toContain("PAPER MOON MATHEMATICS")
	expect(before[1]!.text).toContain("Σ")
	expect(before[1]!.text).toContain("∫")
	expect(before[1]!.text).toContain("α + π")
	await expect(output).toMatchPdfArtifact("embedded-font-notebook", {
		resolution: 96,
	})
})

it.each(["truetype", "cff"] as const)(
	"really renders the embedded %s outlines rather than a fallback",
	async (font) => {
		const ordinary = await provePages(embeddedFontNotebook())
		const blank = await provePages(embeddedFontNotebook(font))
		const affected = font === "truetype" ? 0 : 1
		const unaffected = 1 - affected
		expect(blank[affected]!.pixels).not.toBe(ordinary[affected]!.pixels)
		expect(blank[affected]!.text.replace(/\s/g, "")).toBe(
			ordinary[affected]!.text.replace(/\s/g, ""),
		)
		expect(blank[unaffected]).toEqual(ordinary[unaffected])
	},
)
