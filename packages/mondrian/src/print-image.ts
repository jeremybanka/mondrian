// SPDX-License-Identifier: MPL-2.0

/** Eight-bit, interleaved CMYK samples in row-major order, with straight alpha. */
export interface PdfCmykImageData {
	readonly width: number
	readonly height: number
	/** Four samples per pixel; 0 means no ink and 255 means full ink. */
	readonly data: Uint8Array
	/** One opacity sample per pixel; 0 is transparent and 255 is opaque. */
	readonly alpha?: Uint8Array
	/** The exact CMYK output profile used to prepare these samples. */
	readonly destinationProfile: Uint8Array
}

export interface PdfOutputIntent {
	readonly profile: Uint8Array
	/** Human-readable identification of the intended printing condition. */
	readonly identifier: string
}

export function imagePixelCount(width: number, height: number): number {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		width * height > 32_000_000
	)
		throw new RangeError(
			"Image dimensions must be positive integers totaling at most 32 million pixels",
		)
	return width * height
}
