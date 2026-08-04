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
