export type PdfDiagnosticSeverity = "error" | "warning"

export type PdfDiagnosticCode =
	| "direct-object-cycle"
	| "duplicate-object-number"
	| "duplicate-dictionary-key"
	| "excessive-xref-gaps"
	| "foreign-reference"
	| "foreign-source"
	| "incorrect-page-count"
	| "incorrect-page-parent"
	| "incorrect-reference-target"
	| "invalid-byte-string"
	| "invalid-dictionary"
	| "invalid-dictionary-key"
	| "invalid-document-id"
	| "invalid-generation-number"
	| "invalid-info"
	| "invalid-name"
	| "invalid-number"
	| "invalid-object"
	| "invalid-object-number"
	| "invalid-page-tree"
	| "invalid-reference"
	| "invalid-root"
	| "invalid-stream"
	| "invalid-version"
	| "missing-page-tree"
	| "missing-page-attribute"
	| "page-tree-cycle"
	| "page-tree-node-reused"
	| "page-node-reused"
	| "reference-generation-mismatch"
	| "stream-length-is-derived"
	| "stream-must-be-indirect"
	| "unreachable-object"
	| "unsupported-version-feature"

export interface PdfDiagnostic {
	readonly severity: PdfDiagnosticSeverity
	readonly code: PdfDiagnosticCode
	readonly path: string
	readonly message: string
	readonly related?: readonly {
		readonly path: string
		readonly message: string
	}[]
}

export class PdfValidationError extends Error {
	readonly diagnostics: readonly PdfDiagnostic[]

	constructor(diagnostics: readonly PdfDiagnostic[]) {
		const errors = diagnostics.filter(({ severity }) => severity === "error")
		super(
			errors.length === 1
				? errors[0]?.message
				: `PDF validation failed with ${errors.length} errors`,
		)
		this.name = "PdfValidationError"
		this.diagnostics = diagnostics
	}
}

export function throwForPdfErrors(diagnostics: readonly PdfDiagnostic[]): void {
	if (diagnostics.some(({ severity }) => severity === "error")) {
		throw new PdfValidationError(diagnostics)
	}
}
