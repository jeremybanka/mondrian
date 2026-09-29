// SPDX-License-Identifier: MPL-2.0

/** Validate the envelope before handing profile bytes to a color engine or PDF. */
export function iccColorSpace(bytes: Uint8Array): "RGB " | "GRAY" | "CMYK" {
	if (
		!(bytes instanceof Uint8Array) ||
		bytes.length < 132 ||
		bytes.length > 16 * 1024 * 1024
	)
		throw new TypeError("Expected an ICC profile of at most 16 MiB")
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const signature = (offset: number) =>
		String.fromCharCode(...bytes.subarray(offset, offset + 4))
	if (
		view.getUint32(0) !== bytes.length ||
		signature(36) !== "acsp" ||
		![2, 4].includes(bytes[8]!)
	)
		throw new TypeError("Invalid ICC profile header")
	if (
		!["mntr", "scnr", "prtr", "spac"].includes(signature(12)) ||
		!["XYZ ", "Lab "].includes(signature(20))
	)
		throw new TypeError("Expected a colorimetric ICC input or output profile")
	const count = view.getUint32(128)
	const tableEnd = 132 + count * 12
	if (count === 0 || tableEnd > bytes.length)
		throw new TypeError("Invalid ICC tag table")
	for (let index = 0; index < count; index++) {
		const offset = view.getUint32(136 + index * 12)
		const size = view.getUint32(140 + index * 12)
		if (offset < tableEnd || size < 8 || offset + size > bytes.length)
			throw new TypeError("Invalid ICC tag bounds")
	}
	const space = signature(16)
	if (space !== "RGB " && space !== "GRAY" && space !== "CMYK")
		throw new TypeError(
			"Only RGB, grayscale, and CMYK ICC profiles are supported",
		)
	return space
}

export function assertCmykProfile(bytes: Uint8Array): void {
	if (
		iccColorSpace(bytes) !== "CMYK" ||
		String.fromCharCode(...bytes.subarray(12, 16)) !== "prtr"
	)
		throw new TypeError("The destination must be a CMYK output ICC profile")
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	)
}
