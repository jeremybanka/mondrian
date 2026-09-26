// SPDX-License-Identifier: MPL-2.0

import { PdfParseError } from "./error.ts"

export interface PdfParseWarning {
	readonly code: "leading-bytes" | "zero-offset-object"
	readonly message: string
	/** Byte offset in the original input. */
	readonly offset: number
	readonly objectNumber?: number
}

export interface PdfParseOptions {
	/** Recover a header in the first 1,024 bytes and zero-offset in-use xref entries. Default: false. */
	readonly recover?: boolean
	/** Receives each recovery performed when recover is true. */
	readonly onWarning?: (warning: PdfParseWarning) => void
	/** Maximum bytes in any structural stream's intermediate or final decoded output. Default: 8 MiB. */
	readonly maxDecodedStreamBytes?: number
	/** Maximum cumulative bytes from structural decoding, including filter and predictor intermediates. Default: 32 MiB. */
	readonly maxTotalDecodedBytes?: number
}

/** One budget shared by every structural stream in a parse operation. */
export class DecodeBudget {
	readonly perStream: number
	readonly total: number
	private used = 0

	constructor(options: PdfParseOptions = {}) {
		this.perStream = options.maxDecodedStreamBytes ?? 8 * 1024 * 1024
		this.total = options.maxTotalDecodedBytes ?? 32 * 1024 * 1024
		for (const [key, value] of [
			["maxDecodedStreamBytes", this.perStream],
			["maxTotalDecodedBytes", this.total],
		] as const) {
			if (!Number.isSafeInteger(value) || value < 0)
				throw new RangeError(`${key} must be a non-negative safe integer`)
		}
	}

	check(bytes: number, offset: number): void {
		if (bytes > this.perStream || bytes > this.total - this.used) {
			throw new PdfParseError(
				"Structural stream decoded-byte limit exceeded",
				offset,
			)
		}
	}

	charge(bytes: number, offset: number): void {
		this.check(bytes, offset)
		this.used += bytes
	}
}
