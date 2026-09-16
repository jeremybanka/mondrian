// SPDX-License-Identifier: MPL-2.0

import { PDFDocument } from "pdf-lib"

/** Read Info metadata without adding defaults; dates are normalized to UTC ISO strings. */
export async function readPdfMetadata(bytes: Uint8Array) {
	const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
	return {
		title: pdf.getTitle(),
		author: pdf.getAuthor(),
		subject: pdf.getSubject(),
		keywords: pdf.getKeywords(),
		creator: pdf.getCreator(),
		producer: pdf.getProducer(),
		creationDate: pdf.getCreationDate()?.toISOString(),
		modificationDate: pdf.getModificationDate()?.toISOString(),
	}
}
