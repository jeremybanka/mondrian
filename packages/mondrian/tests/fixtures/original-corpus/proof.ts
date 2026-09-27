// SPDX-License-Identifier: MPL-2.0
import { init } from "@embedpdf/pdfium"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const wasmBinary = readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm"))
const hash = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex")

/** Independent all-page evidence. No form-fill environment or actions are executed. */
export async function provePages(bytes: Uint8Array, password = "") {
	const api = await init({ wasmBinary })
	api.PDFiumExt_Init()
	const memory = api.pdfium.wasmExports
	const heap = () =>
		(api.pdfium as typeof api.pdfium & { HEAPU8: Uint8Array }).HEAPU8
	const input = memory.malloc(bytes.length)
	if (!input) throw new Error("Could not allocate fixture input")
	heap().set(bytes, input)
	const document = api.FPDF_LoadMemDocument(input, bytes.length, password)
	try {
		if (!document)
			throw new Error(`PDFium rejected fixture: ${api.FPDF_GetLastError()}`)
		const result: {
			width: number
			height: number
			rotation: number
			text: string
			pixels: string
		}[] = []
		for (let index = 0; index < api.FPDF_GetPageCount(document); index++) {
			const page = api.FPDF_LoadPage(document, index)
			if (!page) throw new Error(`Could not load fixture page ${index}`)
			try {
				const width = api.FPDF_GetPageWidthF(page),
					height = api.FPDF_GetPageHeightF(page)
				const rotation = api.FPDFPage_GetRotation(page) * 90
				const textPage = api.FPDFText_LoadPage(page)
				if (!textPage) throw new Error("Could not load fixture text")
				let text: string
				try {
					const count = api.FPDFText_CountChars(textPage),
						pointer = memory.malloc((count + 1) * 2)
					if (!pointer) throw new Error("Could not allocate fixture text")
					try {
						const written = api.FPDFText_GetText(textPage, 0, count, pointer)
						text = new TextDecoder("utf-16le").decode(
							heap().slice(pointer, pointer + Math.max(0, written - 1) * 2),
						)
					} finally {
						memory.free(pointer)
					}
				} finally {
					api.FPDFText_ClosePage(textPage)
				}
				const w = Math.ceil(width),
					h = Math.ceil(height),
					pointer = memory.malloc(w * h * 4)
				if (!pointer) throw new Error("Could not allocate fixture bitmap")
				const bitmap = api.FPDFBitmap_CreateEx(w, h, 4, pointer, w * 4)
				try {
					if (!bitmap) throw new Error("Could not create fixture bitmap")
					if (!api.FPDFBitmap_FillRect(bitmap, 0, 0, w, h, 0xffffffff))
						throw new Error("Could not initialize fixture bitmap")
					api.FPDF_RenderPageBitmap(
						bitmap,
						page,
						0,
						0,
						w,
						h,
						0,
						0x01 | 0x02 | 0x10,
					)
					const buffer = api.FPDFBitmap_GetBuffer(bitmap)
					if (!buffer) throw new Error("Could not read fixture bitmap")
					result.push({
						width,
						height,
						rotation,
						text,
						pixels: hash(heap().slice(buffer, buffer + w * h * 4)),
					})
				} finally {
					if (bitmap) api.FPDFBitmap_Destroy(bitmap)
					memory.free(pointer)
				}
			} finally {
				api.FPDF_ClosePage(page)
			}
		}
		return result
	} finally {
		if (document) api.FPDF_CloseDocument(document)
		memory.free(input)
		api.FPDF_DestroyLibrary()
	}
}
