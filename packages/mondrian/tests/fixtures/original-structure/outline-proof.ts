// SPDX-License-Identifier: MPL-2.0
import { init } from "@embedpdf/pdfium"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const wasmBinary = readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm"))

/** Read actual bookmark navigation with a reader independent of Mondrian. */
export async function proveOutlines(bytes: Uint8Array) {
	const api = await init({ wasmBinary })
	api.PDFiumExt_Init()
	const memory = api.pdfium.wasmExports
	const heap = () =>
		(api.pdfium as typeof api.pdfium & { HEAPU8: Uint8Array }).HEAPU8
	const input = memory.malloc(bytes.length)
	if (!input) throw new Error("Could not allocate outline input")
	heap().set(bytes, input)
	const document = api.FPDF_LoadMemDocument(input, bytes.length, "")
	try {
		if (!document || !api.FPDF_DocumentHasValidCrossReferenceTable(document))
			throw new Error("Invalid independent outline input")
		const result: { title: string; depth: number; page: number }[] = [],
			visited = new Set<number>()
		const visit = (parent: number, depth: number) => {
			let bookmark = api.FPDFBookmark_GetFirstChild(document, parent)
			while (bookmark) {
				if (visited.has(bookmark)) throw new Error("Cyclic independent outline")
				visited.add(bookmark)
				const length = api.FPDFBookmark_GetTitle(bookmark, 0, 0),
					pointer = memory.malloc(length)
				if (!pointer) throw new Error("Could not allocate outline title")
				try {
					api.FPDFBookmark_GetTitle(bookmark, pointer, length)
					const title = new TextDecoder("utf-16le").decode(
						heap().slice(pointer, pointer + length - 2),
					)
					const destination = api.FPDFBookmark_GetDest(document, bookmark)
					result.push({
						title,
						depth,
						page: api.FPDFDest_GetDestPageIndex(document, destination),
					})
				} finally {
					memory.free(pointer)
				}
				visit(bookmark, depth + 1)
				bookmark = api.FPDFBookmark_GetNextSibling(document, bookmark)
			}
		}
		visit(0, 1)
		return result
	} finally {
		if (document) api.FPDF_CloseDocument(document)
		memory.free(input)
		api.FPDF_DestroyLibrary()
	}
}
