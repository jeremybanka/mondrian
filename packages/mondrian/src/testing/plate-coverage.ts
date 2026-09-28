// SPDX-License-Identifier: MPL-2.0

import type { PdfDocument } from "../objects.ts"
import { serializePdf } from "../serialize.ts"
import type { PdfPlateOptions } from "./plates.ts"
import { projectPdfPlates } from "./plates.ts"
import type { PlateColorSpace } from "./plate-plan.ts"
import { pdfArtifactRenderer, renderCoveragePdf } from "./render.ts"

export interface PdfPlateCoverageOptions extends PdfPlateOptions {
	/** Dots per inch. Defaults to 144. */
	readonly resolution?: number
}

export interface PdfPlateCoveragePage {
	readonly pageNumber: number
	readonly width: number
	readonly height: number
	/** One inverse-coverage byte per pixel, rows from top left: paper 255, full ink 0. */
	readonly samples: Uint8Array
	/** Opaque grayscale appearance of exactly the same samples. */
	readonly png: Uint8Array
}

export interface PdfPlateCoverage {
	readonly name: string
	readonly colorSpace: PlateColorSpace
	readonly pages: readonly PdfPlateCoveragePage[]
}

export interface RenderedPdfPlateCoverage {
	readonly renderer: typeof pdfArtifactRenderer
	readonly resolution: number
	readonly plates: readonly PdfPlateCoverage[]
}

/**
 * Rasterize described ink coverage before alternate-space or screen color conversion.
 * Uniform opaque tint t maps to round(255 * (1 - t)); alpha, clipping, and edges
 * retain the pinned renderer's 8-bit compositing and grayscale antialiasing.
 * Paper is opaque white. No press profiles, trapping, or screening are applied.
 */
export async function renderPdfPlateCoverage(
	document: PdfDocument,
	options: PdfPlateCoverageOptions = {},
): Promise<RenderedPdfPlateCoverage> {
	const resolution = options.resolution ?? 144
	if (!Number.isFinite(resolution) || resolution <= 0)
		throw new RangeError("Plate coverage resolution must be a positive number")
	const projected = projectPdfPlates(document, options, "coverage")
	const plates: PdfPlateCoverage[] = []
	// Avoid simultaneous PDFium instances; returned sample buffers remain independent.
	for (const { name, colorSpace, document: plate } of projected) {
		const rendered = await renderCoveragePdf(serializePdf(plate), resolution)
		const pages = rendered.pages.map(
			({ pageNumber, width, height, pixels, png }) => {
				const samples = new Uint8Array(width * height)
				for (let pixel = 0; pixel < samples.length; pixel++)
					samples[pixel] = pixels[pixel * 4]!
				return Object.freeze({ pageNumber, width, height, samples, png })
			},
		)
		plates.push(
			Object.freeze({ name, colorSpace, pages: Object.freeze(pages) }),
		)
	}
	return Object.freeze({
		renderer: pdfArtifactRenderer,
		resolution,
		plates: Object.freeze(plates),
	})
}
