// SPDX-License-Identifier: MPL-2.0
// Run explicitly to regenerate the committed original raster; not part of test execution.
import { createCanvas } from "@napi-rs/canvas"
import { writeFileSync } from "node:fs"
const canvas = createCanvas(48, 32)
const context = canvas.getContext("2d")
const image = context.createImageData(48, 32)
for (let y = 0; y < 32; y++) {
	for (let x = 0; x < 48; x++) {
		const i = (y * 48 + x) * 4
		image.data[i] = 30 + x * 4
		image.data[i + 1] = 210 - y * 5
		image.data[i + 2] = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 170 : 70
		image.data[i + 3] = 255
	}
}
context.putImageData(image, 0, 0)
writeFileSync(
	new URL("garden-raster.jpg", import.meta.url),
	canvas.toBuffer("image/jpeg", 90),
)
