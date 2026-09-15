import { describe, expect, it } from "vite-plus/test"
import { createPdfDocument } from "../src/index.ts"

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
})
