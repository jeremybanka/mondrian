import { init } from "@embedpdf/pdfium"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const wasmBinary = readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm"))

/** Inspect serialized output independently of Mondrian's object model. */
export async function readPdf(bytes: Uint8Array) {
	const pdfium = await init({ wasmBinary })
	pdfium.PDFiumExt_Init()
	const memory = pdfium.pdfium.wasmExports
	const heap = () =>
		(pdfium.pdfium as typeof pdfium.pdfium & { readonly HEAPU8: Uint8Array })
			.HEAPU8
	const input = memory.malloc(bytes.length)
	if (!input) throw new Error("Could not allocate PDF input")
	heap().set(bytes, input)
	const document = pdfium.FPDF_LoadMemDocument(input, bytes.length, "")
	try {
		if (!document) throw new Error("PDFium could not open the serialized PDF")
		const pages: {
			width: number
			height: number
			rotation: number
			text: string
		}[] = []
		for (let index = 0; index < pdfium.FPDF_GetPageCount(document); index++) {
			const page = pdfium.FPDF_LoadPage(document, index)
			if (!page) throw new Error(`PDFium could not open page ${index + 1}`)
			try {
				const textPage = pdfium.FPDFText_LoadPage(page)
				if (!textPage) throw new Error("PDFium could not read page text")
				try {
					const count = pdfium.FPDFText_CountChars(textPage)
					pages.push({
						width: pdfium.FPDF_GetPageWidthF(page),
						height: pdfium.FPDF_GetPageHeightF(page),
						rotation: pdfium.FPDFPage_GetRotation(page) * 90,
						text: readString(
							(count + 1) * 2,
							(pointer) =>
								pdfium.FPDFText_GetText(textPage, 0, count, pointer) * 2,
						),
					})
				} finally {
					pdfium.FPDFText_ClosePage(textPage)
				}
			} finally {
				pdfium.FPDF_ClosePage(page)
			}
		}
		return { pages, title: metadata("Title"), author: metadata("Author") }
	} finally {
		if (document) pdfium.FPDF_CloseDocument(document)
		memory.free(input)
		pdfium.FPDF_DestroyLibrary()
	}

	function metadata(key: string): string {
		const length = pdfium.FPDF_GetMetaText(document, key, 0, 0)
		if (!length) return ""
		return readString(length, (pointer) =>
			pdfium.FPDF_GetMetaText(document, key, pointer, length),
		)
	}

	function readString(
		length: number,
		read: (pointer: number) => number,
	): string {
		const pointer = memory.malloc(length)
		if (!pointer) throw new Error("Could not allocate PDF text buffer")
		try {
			const written = read(pointer)
			return new TextDecoder("utf-16le").decode(
				heap().subarray(pointer, pointer + Math.max(0, written - 2)),
			)
		} finally {
			memory.free(pointer)
		}
	}
}
