import { describe, expect, it } from "vite-plus/test"
import { createHash } from "node:crypto"
import { renderPdf } from "../src/testing.ts"
import type { PdfTextBuilder } from "../src/index.ts"
import { createPdfDocument, rectangle } from "../src/index.ts"

describe("independent review regressions", () => {
	it.each([4, 5, 6, 7])(
		"rejects unsupported semantic text clipping mode %s",
		(mode) => {
			const pdf = createPdfDocument()
			expect(() =>
				pdf.text((text) => text.renderingMode(mode as never)),
			).toThrow("clipping")
		},
	)
	it("preserves inherited text layout independently of paint and rendering-mode operations", async () => {
		const layout = (t: PdfTextBuilder) =>
			t
				.characterSpacing(5)
				.wordSpacing(7)
				.horizontalScale(80)
				.leading(24)
				.rise(3)
		const render = async (
			paint: "none" | "black" | "mode",
			explicit: boolean,
		) => {
			const pdf = createPdfDocument()
			const font = pdf.standardFont("Helvetica")
			pdf.setPages(
				pdf.page({
					mediaBox: rectangle(0, 0, 240, 180),
					content: [
						pdf.text((t) => {
							layout(t.font(font, 16)).moveText(10, 145).show("First row")
							if (paint === "black") t.grayFill(0)
							if (paint === "mode") t.renderingMode(0)
						}),
						pdf.text((t) => {
							t.font(font, 16).moveText(10, 95)
							if (explicit) layout(t)
							t.show("Next row").nextLine().show("Last row")
						}),
					],
				}),
			)
			const rendered = await renderPdf(pdf.serialize(), { resolution: 72 })
			return createHash("sha256")
				.update(rendered.pages[0]!.pixels)
				.digest("hex")
		}
		const expected = await render("none", true)
		for (const paint of ["none", "black", "mode"] as const)
			expect(await render(paint, false), paint).toBe(expected)
	})
})
