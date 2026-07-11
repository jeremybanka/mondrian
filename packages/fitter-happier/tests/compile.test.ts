import {
	box,
	computeLayout,
	image,
	type SolvedNode,
	svg,
	text,
} from "fitter-happier"
import type { PdfDocument } from "mondrian.pdf"
import { validatePdf } from "mondrian.pdf"
import { describe, expect, it } from "vite-plus/test"
import {
	type LayoutNodePdfOptions,
	LayoutNodePdfError,
	lowerLayoutNodeToPdf,
	lowerSolvedLayoutNodeToPdf,
} from "../src/index.ts"
import { rgbJpegDataUrl } from "./fixtures.ts"

describe("LayoutNode to mondrian.pdf lowering", () => {
	it("lowers a LayoutNode to a deterministic, valid one-page PdfDocument", async () => {
		const root = box({
			id: "page",
			style: {
				width: 240,
				height: 160,
				padding: 20,
				gap: 12,
				backgroundColor: "#fffdf8",
			},
			children: [
				text({
					id: "heading",
					text: "MONDRIAN TARGET",
					style: {
						height: 24,
						fontSize: 18,
						fontWeight: 700,
						lineHeight: 24,
						color: "#1d4ed8",
					},
				}),
				box({
					id: "panel",
					style: {
						flexGrow: 1,
						backgroundColor: "#dbeafe",
						borderColor: "#2563eb",
						borderWidth: 2,
						borderRadius: 8,
					},
				}),
			],
		})

		const first = await lowerLayoutNodeToPdf(root, {
			computeLayout,
			width: 240,
			height: 160,
			metadata: { title: "Compiler fixture" },
		})
		const second = await lowerLayoutNodeToPdf(root, {
			computeLayout,
			width: 240,
			height: 160,
			metadata: { title: "Compiler fixture" },
		})

		expect(first.document).toEqual(second.document)
		expect(Object.keys(first).sort()).toEqual(["diagnostics", "document"])
		expect(first.diagnostics).toEqual([])
		expect(validatePdf(first.document)).toEqual([])
		expect(
			first.document.objects.filter(
				(object) =>
					typeof object.value === "object" &&
					object.value !== null &&
					object.value.kind === "dictionary" &&
					isName(object.value.entries.Type, "Page"),
			).length,
		).toBe(1)
		expect(contentText(first.document)).toContain("(MONDRIAN TARGET) Tj")
	})

	it("lowers rounded boxes, nested clipping, and opacity through raw PDF content", async () => {
		const result = await lowerLayoutNodeToPdf(
			box({
				style: {
					width: 180,
					height: 120,
					padding: 12,
					backgroundColor: "white",
				},
				children: [
					box({
						id: "clip",
						style: {
							width: 100,
							height: 60,
							borderRadius: 10,
							overflow: "hidden",
							backgroundColor: "#0f172a",
						},
						children: [
							box({
								style: {
									position: "absolute",
									left: -20,
									top: 20,
									width: 140,
									height: 30,
									opacity: 0.5,
									backgroundColor: "#22d3ee",
								},
							}),
						],
					}),
				],
			}),
			{ computeLayout, width: 180, height: 120 },
		)
		const content = contentText(result.document)

		expect(content).toContain("W n")
		expect(content).toMatch(/\/GS\d+ gs/u)
		expect(content).toContain(" c\n")
		expect(result.document.objects).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					value: expect.objectContaining({
						kind: "dictionary",
						entries: expect.objectContaining({
							Type: expect.objectContaining({ value: "ExtGState" }),
						}),
					}),
				}),
			]),
		)
	})

	it("embeds one JPEG resource and reuses it for repeated image nodes", async () => {
		const src = rgbJpegDataUrl()
		const result = await lowerLayoutNodeToPdf(
			box({
				style: {
					width: 200,
					height: 100,
					padding: 10,
					gap: 10,
					flexDirection: "row",
				},
				children: [
					image({ src, intrinsicWidth: 2, intrinsicHeight: 3 }),
					image({ src, intrinsicWidth: 2, intrinsicHeight: 3 }),
				],
			}),
			{ computeLayout, width: 200, height: 100 },
		)
		const images = result.document.objects.filter(
			(object) =>
				typeof object.value === "object" &&
				object.value !== null &&
				object.value.kind === "stream" &&
				isName(object.value.entries.Subtype, "Image"),
		)

		expect(images).toHaveLength(1)
		expect(contentText(result.document).match(/\/Im0 Do/gu)).toHaveLength(2)
	})

	it("rejects unsupported media and version-gated transparency with source paths", async () => {
		const unsupported = [
			svg({
				id: "logo",
				svg: '<svg viewBox="0 0 10 10"></svg>',
				intrinsicWidth: 10,
				intrinsicHeight: 10,
				style: { width: 10, height: 10 },
			}),
			image({
				id: "photo",
				src: "data:image/png;base64,iVBORw0KGgo=",
				intrinsicWidth: 1,
				intrinsicHeight: 1,
				style: { width: 10, height: 10 },
			}),
		]

		for (const node of unsupported) {
			const error = await loweringError(
				box({
					style: { width: 40, height: 40 },
					children: [node],
				}),
				{ width: 40, height: 40 },
			)
			expect(error.diagnostics[0]?.path).toContain(node.id ?? node.type)
		}

		const transparencyError = await loweringError(
			box({
				id: "transparent-page",
				style: {
					width: 40,
					height: 40,
					opacity: 0.5,
					backgroundColor: "red",
				},
			}),
			{ width: 40, height: 40, version: "1.3" },
		)
		expect(transparencyError.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "unsupported-version-feature",
					path: expect.stringContaining("transparent-page"),
				}),
			]),
		)
	})

	it("preserves visible absolute descendants of zero-sized containers", async () => {
		const result = await lowerLayoutNodeToPdf(
			box({
				style: { width: 120, height: 80 },
				children: [
					box({
						id: "zero-parent",
						style: { width: 0, height: 0 },
						children: [
							text({
								id: "visible-absolute-child",
								text: "ABSOLUTE CHILD",
								style: {
									position: "absolute",
									left: 12,
									top: 10,
									width: 96,
									height: 18,
									fontSize: 10,
									lineHeight: 18,
								},
							}),
						],
					}),
				],
			}),
			{ computeLayout, width: 120, height: 80 },
		)

		expect(contentText(result.document)).toContain("(ABSOLUTE CHILD) Tj")
	})

	it("derives PDF 2.0 IDs and emits legacy ProcSet resources", async () => {
		const source = box({
			style: { width: 120, height: 80 },
			children: [
				text({
					text: "VERSIONED",
					style: { width: 100, height: 18, fontSize: 10, lineHeight: 18 },
				}),
			],
		})
		const pdf2 = await lowerLayoutNodeToPdf(
			box({ style: { width: 120, height: 80 } }),
			{
				computeLayout,
				width: 120,
				height: 80,
				version: "2.0",
			},
		)
		expect(pdf2.document.id?.[0].bytes).toHaveLength(16)
		expect(pdf2.document.id?.[1].bytes).toHaveLength(16)

		const pdf13 = await lowerLayoutNodeToPdf(source, {
			computeLayout,
			width: 120,
			height: 80,
			version: "1.3",
		})
		expect(pageResources(pdf13.document).entries.ProcSet).toMatchObject({
			kind: "array",
			items: [
				{ kind: "name", value: "PDF" },
				{ kind: "name", value: "Text" },
			],
		})
	})

	it("rejects structurally incomplete JPEG streams", async () => {
		const error = await loweringError(
			box({
				style: { width: 40, height: 40 },
				children: [
					image({
						id: "broken-jpeg",
						src: "data:image/jpeg;base64,/9j/wAAICAABAAED/9oAAv/Z",
						intrinsicWidth: 1,
						intrinsicHeight: 1,
						style: { width: 20, height: 20 },
					}),
				],
			}),
			{ width: 40, height: 40 },
		)
		expect(error.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "invalid-image" }),
			]),
		)
	})

	it("rejects group opacity and never emits exponent numbers", async () => {
		const opacityError = await loweringError(
			box({
				id: "group",
				style: { width: 40, height: 40, opacity: 0.5 },
				children: [box({ style: { width: 20, height: 20 } })],
			}),
			{ width: 40, height: 40 },
		)
		expect(opacityError.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "unsupported-group-opacity" }),
			]),
		)

		const precise: SolvedNode = {
			type: "box",
			path: "precise",
			source: {
				type: "box",
				style: { borderColor: "red", borderWidth: 1e-7 },
			},
			box: { x: 0, y: 0, width: 100, height: 100 },
			localBox: { x: 0, y: 0, width: 100, height: 100 },
			children: [],
		}
		const lowering = lowerSolvedLayoutNodeToPdf(precise)
		expect(contentText(lowering.document)).toContain("0.0000001 w")
		expect(contentText(lowering.document)).not.toMatch(/[eE][+-]?\d/u)
	})

	it("produces the same document from source and already-solved geometry", async () => {
		const root = box({
			style: {
				width: 120,
				height: 80,
				backgroundColor: "#f8fafc",
			},
		})
		const layout = await computeLayout(root, { width: 120, height: 80 })

		const fromSource = await lowerLayoutNodeToPdf(root, {
			computeLayout,
			width: 120,
			height: 80,
		})
		const fromSolved = lowerSolvedLayoutNodeToPdf(layout.root)

		expect(fromSource.document).toEqual(fromSolved.document)
		expect(fromSource.diagnostics).toEqual(fromSolved.diagnostics)
	})
})

async function loweringError(
	root: Parameters<typeof lowerLayoutNodeToPdf>[0],
	options: Omit<LayoutNodePdfOptions, "computeLayout">,
): Promise<LayoutNodePdfError> {
	try {
		await lowerLayoutNodeToPdf(root, { ...options, computeLayout })
		throw new Error("Expected LayoutNode lowering to fail")
	} catch (error) {
		expect(error).toBeInstanceOf(LayoutNodePdfError)
		return error as LayoutNodePdfError
	}
}

function contentText(document: PdfDocument): string {
	for (const object of document.objects) {
		if (
			typeof object.value === "object" &&
			object.value !== null &&
			object.value.kind === "stream" &&
			object.value.entries.Type === undefined
		) {
			return String.fromCharCode(...object.value.data)
		}
	}
	throw new Error("PDF content stream not found")
}

function pageResources(document: PdfDocument) {
	for (const object of document.objects) {
		if (
			typeof object.value === "object" &&
			object.value !== null &&
			object.value.kind === "dictionary" &&
			isName(object.value.entries.Type, "Page")
		) {
			const resources = object.value.entries.Resources
			if (
				typeof resources === "object" &&
				resources !== null &&
				resources.kind === "dictionary"
			) {
				return resources
			}
		}
	}
	throw new Error("PDF page resources not found")
}

function isName(value: unknown, expected: string): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { readonly kind?: unknown }).kind === "name" &&
		(value as { readonly value?: unknown }).value === expected
	)
}
