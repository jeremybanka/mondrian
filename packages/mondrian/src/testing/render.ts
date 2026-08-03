// SPDX-License-Identifier: MPL-2.0

import { createCanvas } from "@napi-rs/canvas"
import {
	AnnotationMode,
	getDocument,
	version as pdfjsVersion,
} from "pdfjs-dist/legacy/build/pdf.mjs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const pdfjsDirectory = dirname(require.resolve("pdfjs-dist/package.json"))
const standardFontDataUrl = join(pdfjsDirectory, "standard_fonts/")

export const pdfArtifactRenderer = Object.freeze({
	canvas: "@napi-rs/canvas@1.0.2",
	name: "pdfjs",
	version: pdfjsVersion,
})

export interface PdfRenderOptions {
	/** The raster resolution in dots per inch. Defaults to 144. */
	readonly resolution?: number
	/** The page background passed to PDF.js. Defaults to opaque white. */
	readonly background?: string
	/** Whether PDF annotations with appearances are rendered. Defaults to true. */
	readonly renderAnnotations?: boolean
}

export interface RenderedPdfPage {
	readonly pageNumber: number
	readonly width: number
	readonly height: number
	readonly pixels: Uint8ClampedArray
	readonly png: Uint8Array
}

export interface RenderedPdf {
	readonly renderer: typeof pdfArtifactRenderer
	readonly resolution: number
	readonly background: string
	readonly renderAnnotations: boolean
	readonly pages: readonly RenderedPdfPage[]
}

export async function renderPdf(
	bytes: Uint8Array,
	options: PdfRenderOptions = {},
): Promise<RenderedPdf> {
	if (!(bytes instanceof Uint8Array)) {
		throw new TypeError("PDF rendering requires a Uint8Array")
	}

	const resolution = options.resolution ?? 144
	if (!Number.isFinite(resolution) || resolution <= 0) {
		throw new RangeError("PDF rendering resolution must be a positive number")
	}

	const background = options.background ?? "#ffffff"
	const renderAnnotations = options.renderAnnotations ?? true
	const loadingTask = getDocument({
		data: bytes.slice(),
		standardFontDataUrl,
	})

	try {
		const document = await loadingTask.promise
		const pages: RenderedPdfPage[] = []
		const scale = resolution / 72

		for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
			const page = await document.getPage(pageNumber)
			try {
				const viewport = page.getViewport({ scale })
				const width = Math.ceil(viewport.width)
				const height = Math.ceil(viewport.height)
				const canvas = createCanvas(width, height)
				const context = canvas.getContext("2d")

				await page.render({
					annotationMode: renderAnnotations
						? AnnotationMode.ENABLE
						: AnnotationMode.DISABLE,
					background,
					canvas: canvas as never,
					canvasContext: context as never,
					intent: "display",
					viewport,
				}).promise

				const pngBuffer = canvas.toBuffer("image/png")
				pages.push(
					Object.freeze({
						pageNumber,
						width,
						height,
						pixels: context.getImageData(0, 0, width, height).data.slice(),
						png: Uint8Array.from(pngBuffer),
					}),
				)
			} finally {
				page.cleanup()
			}
		}

		return Object.freeze({
			renderer: pdfArtifactRenderer,
			resolution,
			background,
			renderAnnotations,
			pages: Object.freeze(pages),
		})
	} finally {
		await loadingTask.destroy()
	}
}
