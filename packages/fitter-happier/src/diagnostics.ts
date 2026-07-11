export type LayoutNodePdfDiagnosticSeverity = "error" | "warning"

export type LayoutNodePdfDiagnosticCode =
	| "font-fallback"
	| "invalid-color"
	| "invalid-geometry"
	| "invalid-image"
	| "invalid-opacity"
	| "layout-error"
	| "layout-warning"
	| "unsupported-image"
	| "unsupported-group-opacity"
	| "unsupported-svg"
	| "unsupported-text-character"
	| "unsupported-version-feature"

export interface LayoutNodePdfDiagnostic {
	readonly severity: LayoutNodePdfDiagnosticSeverity
	readonly code: LayoutNodePdfDiagnosticCode
	readonly path: string
	readonly message: string
}

export class LayoutNodePdfError extends Error {
	readonly diagnostics: readonly LayoutNodePdfDiagnostic[]

	constructor(diagnostics: readonly LayoutNodePdfDiagnostic[]) {
		const errors = diagnostics.filter(
			(diagnostic) => diagnostic.severity === "error",
		)
		super(
			errors.length === 1
				? errors[0]?.message
				: `Could not lower LayoutNode to PDF (${errors.length} errors)`,
		)
		this.name = "LayoutNodePdfError"
		this.diagnostics = Object.freeze([...diagnostics])
	}
}

export function throwForLayoutNodePdfErrors(
	diagnostics: readonly LayoutNodePdfDiagnostic[],
): void {
	if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
		throw new LayoutNodePdfError(diagnostics)
	}
}
