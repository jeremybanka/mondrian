import { describe, expect, it } from "vite-plus/test"
import {
	blueInk,
	objectPrintExample,
	orangeInk,
	semanticPrintExample,
} from "../../../examples/print-colors.ts"
import type { PdfColor, PdfContent } from "../../../src/index.ts"
import {
	cmyk,
	createPdfDocument,
	gray,
	pageSizes,
	rgb,
	serializePdf,
} from "../../../src/index.ts"
import { visualArtifactOptions } from "./setup.ts"

describe("print color visual regressions", () => {
	it("renders process channels, two spot tint ramps, live text and opaque overlap states", async () => {
		const pdf = createPdfDocument({
			metadata: { title: "Print color conformance" },
		})
		const font = pdf.standardFont("Helvetica")
		const bold = pdf.standardFont("Helvetica-Bold")
		const label = (
			value: string,
			x: number,
			y: number,
			size = 12,
		): PdfContent =>
			pdf.text((t) => t.font(font, size).moveText(x, y).show(value))
		const title = (value: string): PdfContent =>
			pdf.text((t) => t.font(bold, 24).moveText(44, 744).show(value))
		const content: PdfContent[] = [
			title("Process channels and named inks"),
			label("Native gray, RGB, and individual C / M / Y / K channels", 44, 713),
		]
		const samples: readonly (readonly [string, PdfColor])[] = [
			["Gray", gray(0.4)],
			["RGB", rgb(0.2, 0.5, 0.8)],
			["C", cmyk(1, 0, 0, 0)],
			["M", cmyk(0, 1, 0, 0)],
			["Y", cmyk(0, 0, 1, 0)],
			["K only", cmyk(0, 0, 0, 1)],
		]
		for (const [index, [name, color]] of samples.entries()) {
			const x = 44 + index * 88
			content.push(
				pdf.graphics((g) =>
					g.fillColor(color).rectangle(x, 628, 70, 64).fill(),
				),
				label(name, x, 608),
			)
		}
		for (const [row, ink] of [orangeInk, blueInk].entries()) {
			const y = 478 - row * 148
			content.push(
				label(`${ink.name} - native Separation tints`, 44, y + 80, 16),
			)
			for (const [index, tint] of [0, 0.25, 0.5, 0.75, 1].entries()) {
				const x = 44 + index * 107
				content.push(
					pdf.graphics((g) =>
						g
							.spotFill(ink, tint)
							.grayStroke(0.7)
							.lineWidth(0.5)
							.rectangle(x, y, 86, 64)
							.fillAndStroke(),
					),
					label(`${tint * 100}%`, x, y - 18),
				)
			}
		}
		content.push(
			pdf.text((t) =>
				t
					.font(bold, 26)
					.moveText(44, 257)
					.cmykFill(0, 0, 0, 1)
					.show("K-only black live text"),
			),
			pdf.text((t) =>
				t
					.font(bold, 26)
					.moveText(44, 211)
					.spotFill(orangeInk, 1)
					.show("Orange spot live text"),
			),
			pdf.text((t) =>
				t
					.font(bold, 26)
					.moveText(44, 165)
					.spotStroke(blueInk, 1)
					.renderingMode(1)
					.show("Blue spot stroke text"),
			),
			pdf.graphics((g) =>
				g
					.spotStroke(orangeInk, 0.5)
					.lineWidth(8)
					.moveTo(44, 118)
					.lineTo(560, 118)
					.stroke(),
			),
			label(
				"Composite proof: inspect resources separately for native ink encoding.",
				44,
				64,
				11,
			),
		)
		const overlaps: PdfContent[] = [
			title("Opaque overlap and state scoping"),
			label(
				"Process / spot painting with explicit overprint and knockout",
				44,
				713,
			),
		]
		const states = [
			{ fillOverprint: false, strokeOverprint: false, overprintMode: 0 },
			{ fillOverprint: true, strokeOverprint: false, overprintMode: 0 },
			{ fillOverprint: true, strokeOverprint: true, overprintMode: 1 },
			{ fillOverprint: false, strokeOverprint: true, overprintMode: 1 },
		] as const
		for (const [index, state] of states.entries()) {
			const x = 44 + (index % 2) * 275
			const y = 532 - Math.floor(index / 2) * 226
			overlaps.push(
				label(
					`Fill ${state.fillOverprint ? "overprint" : "knockout"} / mode ${state.overprintMode}`,
					x,
					y + 143,
				),
				label(
					`Stroke ${state.strokeOverprint ? "overprint" : "knockout"}`,
					x,
					y + 125,
				),
				pdf.graphics((g) => {
					g.cmykFill(1, 0, 0, 0).rectangle(x, y, 155, 94).fill()
					g.paintState(state)
						.spotFill(orangeInk, 0.75)
						.spotStroke(blueInk, 1)
						.lineWidth(7)
						.rectangle(x + 65, y + 30, 155, 80)
						.fillAndStroke()
					g.cmykFill(0, 1, 0, 0)
						.rectangle(x + 35, y - 27, 80, 58)
						.fill()
				}),
			)
		}
		overlaps.push(
			label(
				"New fragment: default black and no inherited overprint state",
				44,
				219,
			),
			pdf.graphics((g) => g.rectangle(44, 160, 220, 36).fill()),
			label(
				"Spot tint is coverage, never alpha. These samples use opaque paint.",
				44,
				110,
				11,
			),
			label(
				"A PDFium composite is not a separation or printer approval proof.",
				44,
				64,
				11,
			),
		)
		pdf.setPages(
			pdf.page({ mediaBox: pageSizes.letter, content }),
			pdf.page({ mediaBox: pageSizes.letter, content: overlaps }),
		)
		await expect(pdf.serialize()).toMatchPdfArtifact(
			"print-conformance",
			visualArtifactOptions,
		)
	})

	it("renders the semantic migration example", async () => {
		await expect(serializePdf(semanticPrintExample())).toMatchPdfArtifact(
			"semantic-example",
			visualArtifactOptions,
		)
	})

	it("renders cached custom paths and positioned text from object-builder examples", async () => {
		await expect(serializePdf(objectPrintExample())).toMatchPdfArtifact(
			"object-examples",
			visualArtifactOptions,
		)
	})
})
