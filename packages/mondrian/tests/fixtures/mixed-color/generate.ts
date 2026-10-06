// SPDX-License-Identifier: MPL-2.0
// Explicit fixture regeneration; never called by tests.
import { readFileSync, writeFileSync } from "node:fs"
import { PNG } from "pngjs"
import jpeg from "jpeg-js"
import { gardenTrueType } from "../original-corpus/font-programs.ts"

const original = PNG.sync.read(
	readFileSync(
		new URL(
			"../../private/fixtures/print-images/squirrel.png",
			import.meta.url,
		),
	),
)
writeFileSync(
	new URL("../../public/fixtures/mixed-color/label.ttf", import.meta.url),
	gardenTrueType(),
)
const width = 809,
	height = 884,
	rgba = Buffer.alloc(width * height * 4),
	alpha = Buffer.alloc(width * height)
for (let y = 0; y < height; y++)
	for (let x = 0; x < width; x++) {
		const source =
				(Math.floor((y * original.height) / height) * original.width +
					Math.floor((x * original.width) / width)) *
				4,
			at = (y * width + x) * 4
		for (let channel = 0; channel < 4; channel++)
			rgba[at + channel] = original.data[source + channel]!
		alpha[y * width + x] = rgba[at + 3]!
	}
writeFileSync(
	new URL("../../public/fixtures/mixed-color/photo.jpg", import.meta.url),
	jpeg.encode({ width, height, data: rgba }, 90).data,
)
writeFileSync(
	new URL("../../public/fixtures/mixed-color/alpha.bin", import.meta.url),
	alpha,
)

// Original 8x8 constant-plane JPEG: four components, one DC coefficient each.
// Unit quantizers and DC deltas yield exact [24,80,136,200] component samples.
const segment = (marker: number, data: Uint8Array) => {
	const header = Buffer.alloc(4)
	header[0] = 255
	header[1] = marker
	header.writeUInt16BE(data.length + 2, 2)
	return Buffer.concat([header, data])
}
const q = segment(
	219,
	Uint8Array.from([0, ...Array.from({ length: 64 }, () => 1)]),
)
const counts = [0, 0, 0, 12, ...Array.from({ length: 12 }, () => 0)]
const h = segment(
	196,
	Uint8Array.from([
		0,
		...counts,
		...Array.from({ length: 12 }, (_, i) => i),
		16,
		1,
		...Array.from({ length: 15 }, () => 0),
		0,
	]),
)
const frame = segment(
	192,
	Uint8Array.from([8, 0, 8, 0, 8, 4, 1, 17, 0, 2, 17, 0, 3, 17, 0, 4, 17, 0]),
)
const scan = segment(
	218,
	Uint8Array.from([4, 1, 0, 2, 0, 3, 0, 4, 0, 0, 63, 0]),
)
let bits = ""
for (const sample of [24, 80, 136, 200]) {
	const delta = (sample - 128) * 8,
		size = Math.ceil(Math.log2(Math.abs(delta) + 1))
	bits +=
		size.toString(2).padStart(4, "0") +
		(delta < 0 ? delta + 2 ** size - 1 : delta)
			.toString(2)
			.padStart(size, "0") +
		"0"
}
bits = bits.padEnd(Math.ceil(bits.length / 8) * 8, "1")
const entropy: number[] = []
for (let at = 0; at < bits.length; at += 8) {
	const value = Number.parseInt(bits.slice(at, at + 8), 2)
	entropy.push(value)
	if (value === 255) entropy.push(0)
}
writeFileSync(
	new URL("../../public/fixtures/mixed-color/cmyk.jpg", import.meta.url),
	Buffer.concat([
		Uint8Array.of(255, 216),
		q,
		h,
		frame,
		scan,
		Uint8Array.from(entropy),
		Uint8Array.of(255, 217),
	]),
)
