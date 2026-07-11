import { box, computeLayout, type LayoutNode } from "fitter-happier"
import type { PdfDocument } from "mondrian.pdf"
import { describe, expect, it } from "vite-plus/test"
import * as bridge from "../src/index.ts"

describe("public bridge contract", () => {
	it("exports only the lowering endpoints and diagnostic error", () => {
		expect(Object.keys(bridge).sort()).toEqual([
			"LayoutNodePdfError",
			"lowerLayoutNodeToPdf",
			"lowerSolvedLayoutNodeToPdf",
		])
	})

	it("accepts an upstream LayoutNode and returns a mondrian PdfDocument", async () => {
		const input: LayoutNode = box({
			style: { width: 32, height: 24, backgroundColor: "white" },
		})
		const lowering = await bridge.lowerLayoutNodeToPdf(input, {
			computeLayout,
			width: 32,
			height: 24,
		})
		const document: PdfDocument = lowering.document

		expect(document.version).toBe("1.7")
	})
})
