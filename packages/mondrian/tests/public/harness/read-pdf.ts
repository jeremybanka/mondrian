import { init } from "@embedpdf/pdfium"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const wasmBinary = readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm"))

/** Inspect output with the reader version locked alongside these contracts. */
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
		const pageFonts: { text: string; font: string }[][] = []
		const pageCharacters: { text: string; x: number; y: number }[][] = []
		for (let index = 0; index < pdfium.FPDF_GetPageCount(document); index++) {
			const page = pdfium.FPDF_LoadPage(document, index)
			if (!page) throw new Error(`PDFium could not open page ${index + 1}`)
			try {
				const textPage = pdfium.FPDFText_LoadPage(page)
				if (!textPage) throw new Error("PDFium could not read page text")
				try {
					const count = pdfium.FPDFText_CountChars(textPage)
					const characters: { text: string; x: number; y: number }[] = []
					const fonts: { text: string; font: string }[] = []
					const coordinates = memory.malloc(16)
					if (!coordinates)
						throw new Error("Could not allocate text coordinates")
					try {
						for (let character = 0; character < count; character++) {
							if (
								!pdfium.FPDFText_GetCharOrigin(
									textPage,
									character,
									coordinates,
									coordinates + 8,
								)
							) {
								throw new Error("Could not read character origin")
							}
							const length = pdfium.FPDFText_GetFontInfo(
								textPage,
								character,
								0,
								0,
								0,
							)
							if (length) {
								const pointer = memory.malloc(length)
								if (!pointer) throw new Error("Could not allocate font name")
								try {
									pdfium.FPDFText_GetFontInfo(
										textPage,
										character,
										pointer,
										length,
										0,
									)
									fonts.push({
										text: String.fromCodePoint(
											pdfium.FPDFText_GetUnicode(textPage, character),
										),
										font: new TextDecoder().decode(
											heap().subarray(pointer, pointer + length - 1),
										),
									})
								} finally {
									memory.free(pointer)
								}
							}
							const values = new DataView(heap().buffer, coordinates, 16)
							characters.push({
								text: String.fromCodePoint(
									pdfium.FPDFText_GetUnicode(textPage, character),
								),
								x: values.getFloat64(0, true),
								y: values.getFloat64(8, true),
							})
						}
					} finally {
						memory.free(coordinates)
					}
					pageCharacters.push(characters)
					pageFonts.push(fonts)
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
		// A lenient reader can reconstruct a broken startxref/xref. That is not
		// evidence of valid serialization; require PDFium to parse the original table.
		if (!pdfium.FPDF_DocumentHasValidCrossReferenceTable(document)) {
			throw new Error("The serialized PDF required cross-reference repair")
		}
		return {
			pages,
			pageCharacters,
			pageFonts,
			fileIds: [fileId(0), fileId(1)],
			title: metadata("Title"),
			author: metadata("Author"),
		}
	} finally {
		if (document) pdfium.FPDF_CloseDocument(document)
		memory.free(input)
		pdfium.FPDF_DestroyLibrary()
	}

	function fileId(type: number): Uint8Array | null {
		const length = pdfium.FPDF_GetFileIdentifier(document, type, 0, 0)
		if (!length) return null
		const pointer = memory.malloc(length)
		if (!pointer) throw new Error("Could not allocate file identifier")
		try {
			pdfium.FPDF_GetFileIdentifier(document, type, pointer, length)
			// PDFium adds one NUL terminator, even when the identifier contains NUL bytes.
			return heap().slice(pointer, pointer + length - 1)
		} finally {
			memory.free(pointer)
		}
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
