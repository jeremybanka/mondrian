// SPDX-License-Identifier: MPL-2.0

export type {
	PdfArtifactChange,
	PdfArtifactChangeKind,
	PdfArtifactMode,
	PdfArtifactOptions,
	PdfArtifactResult,
	PdfArtifactStatus,
	PdfPageDifference,
} from "./testing/artifacts.ts"
export {
	checkPdfArtifact,
	defaultPdfArtifactMode,
} from "./testing/artifacts.ts"
export type {
	PdfRenderOptions,
	RenderedPdf,
	RenderedPdfPage,
} from "./testing/render.ts"
export { pdfArtifactRenderer, renderPdf } from "./testing/render.ts"

export { readPdf } from "./testing/inspection/read-pdf.ts"
export { readPdfMetadata } from "./testing/inspection/read-metadata.ts"
export { readPdfObject } from "./testing/inspection/read-object.ts"
export type { DecodedPdfObject } from "./testing/inspection/read-object.ts"
