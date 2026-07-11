import type {
	LayoutDiagnostic,
	LayoutNode,
	LayoutResult,
	TextMeasurer,
} from "fitter-happier"
import type { LayoutNodePdfDiagnostic } from "./diagnostics.ts"
import { throwForLayoutNodePdfErrors } from "./diagnostics.ts"
import {
	type LayoutNodePdfLowering,
	lowerSolvedLayoutNodeToPdf,
	type SolvedLayoutNodePdfOptions,
} from "./lower-solved-layout-node.ts"
import { createLayoutPdfTextMeasurer } from "./text.ts"

export type LayoutNodeLayoutEngine = (
	root: LayoutNode,
	options: {
		readonly height?: number
		readonly textMeasurer?: TextMeasurer
		readonly width: number
	},
) => Promise<LayoutResult>

export interface LayoutNodePdfOptions extends SolvedLayoutNodePdfOptions {
	readonly computeLayout: LayoutNodeLayoutEngine
	readonly height?: number
	readonly textMeasurer?: TextMeasurer
	readonly width: number
}

/**
 * Computes fitter-happier geometry and lowers it to a mondrian.pdf document.
 * The bridge stops at PdfDocument; callers choose when and how to serialize it.
 */
export async function lowerLayoutNodeToPdf(
	root: LayoutNode,
	options: LayoutNodePdfOptions,
): Promise<LayoutNodePdfLowering> {
	if (typeof options !== "object" || options === null) {
		throw new TypeError("LayoutNode PDF lowering options are required")
	}
	if (typeof options.computeLayout !== "function") {
		throw new TypeError("A fitter-happier computeLayout function is required")
	}
	if (!Number.isFinite(options.width) || options.width <= 0) {
		throw new RangeError("Layout width must be a finite, positive number")
	}
	if (
		options.height !== undefined &&
		(!Number.isFinite(options.height) || options.height <= 0)
	) {
		throw new RangeError("Layout height must be a finite, positive number")
	}

	const layout = await options.computeLayout(root, {
		width: options.width,
		...(options.height === undefined ? {} : { height: options.height }),
		textMeasurer: options.textMeasurer ?? createLayoutPdfTextMeasurer(),
	})
	const layoutDiagnostics = layout.diagnostics.map(toPdfDiagnostic)
	throwForLayoutNodePdfErrors(layoutDiagnostics)

	const lowering = lowerSolvedLayoutNodeToPdf(layout.root, options)
	return {
		diagnostics: Object.freeze([...layoutDiagnostics, ...lowering.diagnostics]),
		document: lowering.document,
	}
}

function toPdfDiagnostic(
	diagnostic: LayoutDiagnostic,
): LayoutNodePdfDiagnostic {
	return {
		severity: diagnostic.level,
		code: diagnostic.level === "error" ? "layout-error" : "layout-warning",
		path: diagnostic.nodeId ?? "layout",
		message: diagnostic.message,
	}
}
