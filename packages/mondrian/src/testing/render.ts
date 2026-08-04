// SPDX-License-Identifier: MPL-2.0

import { init } from "@embedpdf/pdfium"
import { createCanvas } from "@napi-rs/canvas"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const pdfiumWasm = readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm"))
const pdfiumWasmSha256 = createHash("sha256").update(pdfiumWasm).digest("hex")

const pdfiumBitmapBgra = 4
const pdfiumRenderAnnotations = 0x01
const pdfiumRenderLcdText = 0x02
const pdfiumRenderReverseByteOrder = 0x10

export const pdfArtifactRenderer = Object.freeze({
	name: "pdfium",
	version: "2.14.4",
	wasmSha256: pdfiumWasmSha256,
})

export interface PdfRenderOptions {
	/** The raster resolution in dots per inch. Defaults to 144. */
	readonly resolution?: number
	/** An opaque #RGB or #RRGGBB page background. Defaults to white. */
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
	const backgroundColor = parseBackground(background)
	const renderAnnotations = options.renderAnnotations ?? true
	const pdfium = await init({ wasmBinary: pdfiumWasm })
	pdfium.PDFiumExt_Init()

	const filePointer = pdfium.pdfium.wasmExports.malloc(bytes.length)
	if (filePointer === 0) {
		pdfium.FPDF_DestroyLibrary()
		throw new RangeError("PDFium could not allocate memory for the PDF")
	}
	pdfiumHeap(pdfium).set(bytes, filePointer)
	const document = pdfium.FPDF_LoadMemDocument(filePointer, bytes.length, "")
	if (document === 0) {
		const error = pdfium.FPDF_GetLastError()
		pdfium.pdfium.wasmExports.free(filePointer)
		pdfium.FPDF_DestroyLibrary()
		throw new Error(`PDFium could not load the PDF (error ${error})`)
	}

	try {
		const pages: RenderedPdfPage[] = []
		const scale = resolution / 72
		const pageCount = pdfium.FPDF_GetPageCount(document)

		for (let index = 0; index < pageCount; index += 1) {
			const page = pdfium.FPDF_LoadPage(document, index)
			if (page === 0) {
				throw new Error(`PDFium could not load PDF page ${index + 1}`)
			}
			try {
				const width = Math.ceil(pdfium.FPDF_GetPageWidthF(page) * scale)
				const height = Math.ceil(pdfium.FPDF_GetPageHeightF(page) * scale)
				const pixels = renderPage(
					pdfium,
					page,
					width,
					height,
					backgroundColor,
					renderAnnotations,
				)
				pages.push(
					Object.freeze({
						pageNumber: index + 1,
						width,
						height,
						pixels,
						png: encodePng(pixels, width, height),
					}),
				)
			} finally {
				pdfium.FPDF_ClosePage(page)
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
		pdfium.FPDF_CloseDocument(document)
		pdfium.pdfium.wasmExports.free(filePointer)
		pdfium.FPDF_DestroyLibrary()
	}
}

function renderPage(
	pdfium: Awaited<ReturnType<typeof init>>,
	page: number,
	width: number,
	height: number,
	background: number,
	renderAnnotations: boolean,
): Uint8ClampedArray {
	const byteLength = width * height * 4
	const pixelsPointer = pdfium.pdfium.wasmExports.malloc(byteLength)
	if (pixelsPointer === 0) {
		throw new RangeError("PDFium could not allocate memory for a page bitmap")
	}

	const bitmap = pdfium.FPDFBitmap_CreateEx(
		width,
		height,
		pdfiumBitmapBgra,
		pixelsPointer,
		width * 4,
	)
	if (bitmap === 0) {
		pdfium.pdfium.wasmExports.free(pixelsPointer)
		throw new Error("PDFium could not create a page bitmap")
	}

	try {
		if (!pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, background)) {
			throw new Error("PDFium could not initialize a page bitmap")
		}
		const flags =
			pdfiumRenderLcdText |
			pdfiumRenderReverseByteOrder |
			(renderAnnotations ? pdfiumRenderAnnotations : 0)
		pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, flags)
		const buffer = pdfium.FPDFBitmap_GetBuffer(bitmap)
		if (buffer === 0) {
			throw new Error("PDFium could not read a page bitmap")
		}
		return new Uint8ClampedArray(
			pdfiumHeap(pdfium).slice(buffer, buffer + byteLength),
		)
	} finally {
		pdfium.FPDFBitmap_Destroy(bitmap)
		pdfium.pdfium.wasmExports.free(pixelsPointer)
	}
}

function pdfiumHeap(
	pdfium: Awaited<ReturnType<typeof init>>,
): Uint8Array<ArrayBuffer> {
	return (
		pdfium.pdfium as typeof pdfium.pdfium & {
			readonly HEAPU8: Uint8Array<ArrayBuffer>
		}
	).HEAPU8
}

function encodePng(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
): Uint8Array {
	const canvas = createCanvas(width, height)
	const context = canvas.getContext("2d")
	const image = context.createImageData(width, height)
	image.data.set(pixels)
	context.putImageData(image, 0, 0)
	return Uint8Array.from(canvas.toBuffer("image/png"))
}

function parseBackground(value: string): number {
	const match = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(value)
	if (match === null) {
		throw new TypeError("PDF rendering background must be #RGB or #RRGGBB")
	}

	const source = match[1]!
	const hex =
		source.length === 3
			? [...source].map((digit) => `${digit}${digit}`).join("")
			: source
	const red = Number.parseInt(hex.slice(0, 2), 16)
	const green = Number.parseInt(hex.slice(2, 4), 16)
	const blue = Number.parseInt(hex.slice(4, 6), 16)
	return (0xff000000 | (blue << 16) | (green << 8) | red) >>> 0
}
