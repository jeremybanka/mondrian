import { computeLayout } from "fitter-happier"
import { validatePdf } from "mondrian.pdf"
import { describe, expect, it } from "vite-plus/test"
import { layoutFixtures } from "../examples/layouts.ts"
import { lowerLayoutNodeToPdf } from "../src/index.ts"

describe("visual LayoutNode fixtures", () => {
	for (const fixture of layoutFixtures) {
		it(`lowers ${fixture.slug} without diagnostics`, async () => {
			const lowering = await lowerLayoutNodeToPdf(fixture.node, {
				computeLayout,
				width: fixture.width,
				height: fixture.height,
			})

			expect(lowering.diagnostics).toEqual([])
			expect(validatePdf(lowering.document)).toEqual([])
			expect(
				lowering.document.objects.every((object) =>
					finitePdfValue(object.value),
				),
			).toBe(true)
			expect(contentText(lowering.document)).not.toContain("DO NOT RENDER")
		})
	}
})

function finitePdfValue(value: unknown, visited = new Set<object>()): boolean {
	if (typeof value === "number") return Number.isFinite(value)
	if (value === null || typeof value !== "object") return true
	if (visited.has(value)) return true
	visited.add(value)

	if ((value as { readonly kind?: unknown }).kind === "array") {
		const items = (value as { readonly items?: unknown }).items
		return (
			Array.isArray(items) &&
			items.every((item) => finitePdfValue(item, visited))
		)
	}
	if (
		(value as { readonly kind?: unknown }).kind === "dictionary" ||
		(value as { readonly kind?: unknown }).kind === "stream"
	) {
		const entries = (value as { readonly entries?: unknown }).entries
		return (
			typeof entries === "object" &&
			entries !== null &&
			Object.values(entries).every((item) => finitePdfValue(item, visited))
		)
	}
	return true
}

function contentText(document: {
	readonly objects: readonly { readonly value: unknown }[]
}): string {
	for (const object of document.objects) {
		if (
			typeof object.value === "object" &&
			object.value !== null &&
			(object.value as { readonly kind?: unknown }).kind === "stream" &&
			(object.value as { readonly entries?: { readonly Type?: unknown } })
				.entries?.Type === undefined
		) {
			const data = (object.value as { readonly data: Uint8Array }).data
			return String.fromCharCode(...data)
		}
	}
	throw new Error("PDF content stream not found")
}
