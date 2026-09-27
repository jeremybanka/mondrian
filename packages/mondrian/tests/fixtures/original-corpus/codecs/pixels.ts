// SPDX-License-Identifier: MPL-2.0
export const imageWidth = 64
export const imageHeight = 64

/** Original arithmetic color study; no photographs, fonts, or external assets. */
export function colorPixels(): Uint8Array {
	return Uint8Array.from(
		{ length: imageWidth * imageHeight * 3 },
		(_, index) => {
			const component = index % 3
			const x = Math.floor(index / 3) % imageWidth
			const y = Math.floor(index / (imageWidth * 3))
			const disk = (x - 32) ** 2 + (y - 32) ** 2 < 20 ** 2
			return component === 0
				? disk
					? 240
					: x * 4
				: component === 1
					? disk
						? 170
						: y * 4
					: (x ^ y) * 4
		},
	)
}

/** An invented paper lantern, packed MSB first with 1 = white. */
export function lanternPixels(): Uint8Array {
	const pixels = new Uint8Array((imageWidth * imageHeight) / 8)
	for (let y = 0; y < imageHeight; y++)
		for (let x = 0; x < imageWidth; x++) {
			const frame = x >= 12 && x <= 51 && y >= 12 && y <= 47
			const edge = x <= 15 || x >= 48 || y <= 15 || y >= 44
			const ribs = x % 12 < 3 || y % 12 < 2
			const handle =
				y >= 5 &&
				y < 12 &&
				(x === 24 || x === 39 || y === 5) &&
				x >= 24 &&
				x <= 39
			const feet = y > 47 && y < 57 && (x === 20 || x === 43)
			if (!((frame && (edge || ribs)) || handle || feet))
				pixels[y * 8 + (x >> 3)]! |= 128 >> (x % 8)
		}
	return pixels
}
