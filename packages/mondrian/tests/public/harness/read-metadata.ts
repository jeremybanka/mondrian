import { PDFDocument } from "pdf-lib"

export async function readMetadata(bytes: Uint8Array) {
	const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
	return {
		subject: pdf.getSubject(),
		keywords: pdf.getKeywords(),
		creator: pdf.getCreator(),
		producer: pdf.getProducer(),
		creationDate: pdf.getCreationDate()?.toISOString(),
		modificationDate: pdf.getModificationDate()?.toISOString(),
	}
}
