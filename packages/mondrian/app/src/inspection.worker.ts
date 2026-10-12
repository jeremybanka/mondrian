import type { PdfDiagnostic } from "mondrian.pdf"
import { parsePdf, validatePdf } from "mondrian.pdf"
import { inspectPdf } from "mondrian.pdf/inspect"

self.onmessage = (
	event: MessageEvent<{
		bytes: Uint8Array
		password: string
		recover: boolean
	}>,
) => {
	try {
		const warnings: { message: string; offset: number }[] = []
		const document = parsePdf(event.data.bytes, {
			password: event.data.password,
			recover: event.data.recover,
			onWarning: (warning) => warnings.push(warning),
		})
		let diagnostics: readonly PdfDiagnostic[]
		try {
			diagnostics = validatePdf(document)
		} catch (error) {
			diagnostics = [
				{
					severity: "error",
					code: "invalid-object",
					path: "document",
					message: `Validation could not complete: ${error instanceof Error ? error.message : String(error)}`,
				},
			]
		}
		self.postMessage({
			document,
			index: inspectPdf(document),
			diagnostics,
			warnings,
		})
	} catch (error) {
		self.postMessage({
			error: error instanceof Error ? error.message : String(error),
		})
	}
}
