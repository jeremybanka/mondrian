import type { PdfDocument, PdfReference } from "./objects.ts"

const referenceOwners = new WeakMap<PdfReference, symbol>()
const documentOwners = new WeakMap<PdfDocument, symbol>()

export function registerReferenceOwner(
	reference: PdfReference,
	owner: symbol,
): void {
	referenceOwners.set(reference, owner)
}

export function referenceOwner(reference: PdfReference): symbol | undefined {
	return referenceOwners.get(reference)
}

export function registerDocumentOwner(
	document: PdfDocument,
	owner: symbol,
): void {
	documentOwners.set(document, owner)
}

export function documentOwner(document: PdfDocument): symbol | undefined {
	return documentOwners.get(document)
}
