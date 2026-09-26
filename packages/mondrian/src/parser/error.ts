// SPDX-License-Identifier: MPL-2.0

/** A syntax error or an unsupported encoding in a PDF input. */
export class PdfParseError extends Error {
	readonly offset: number

	constructor(message: string, offset: number) {
		super(`${message} at byte ${offset}`)
		this.name = "PdfParseError"
		this.offset = offset
	}
}
