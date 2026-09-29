// SPDX-License-Identifier: MPL-2.0
// Explicit fixture regeneration only; tests consume the committed bytes.
import { readFileSync, writeFileSync } from "node:fs"
import { crc32, deflateSync } from "node:zlib"
import jpeg from "jpeg-js"

const directory = new URL(
	"../../public/fixtures/print-images/",
	import.meta.url,
)
function chunk(type: string, data: Uint8Array) {
	const buffer = Buffer.alloc(12 + data.length)
	buffer.writeUInt32BE(data.length)
	buffer.write(type, 4)
	buffer.set(data, 8)
	buffer.writeUInt32BE(crc32(buffer.subarray(4, -4)), buffer.length - 4)
	return buffer
}
function png(
	file: string,
	colorType: number,
	width: number,
	samples: number[],
	metadata: Buffer[] = [],
	interlace = 0,
) {
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width)
	header.writeUInt32BE(1, 4)
	header[8] = 8
	header[9] = colorType
	header[12] = interlace
	writeFileSync(
		new URL(file, directory),
		Buffer.concat([
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
			chunk("IHDR", header),
			...metadata,
			chunk(
				"IDAT",
				deflateSync(Buffer.from(interlace ? samples : [0, ...samples])),
			),
			chunk("IEND", new Uint8Array()),
		]),
	)
}
const rgba = [0, 64, 128, 255].flatMap((alpha) => [210, 85, 35, alpha])
png("rgba.png", 6, 4, rgba, [chunk("sRGB", Uint8Array.of(0))])
// A 4x1 Adam7 image has rows only in passes 1, 4, and 6.
png(
	"rgba-interlaced.png",
	6,
	4,
	[
		0,
		...rgba.slice(0, 4),
		0,
		...rgba.slice(8, 12),
		0,
		...rgba.slice(4, 8),
		...rgba.slice(12),
	],
	[chunk("sRGB", Uint8Array.of(0))],
	1,
)
png("untagged.png", 6, 4, rgba)
png("p3.png", 6, 4, rgba, [
	chunk(
		"iCCP",
		Buffer.concat([
			Buffer.from("P3\0\0"),
			deflateSync(readFileSync(new URL("DisplayP3-v4.icc", directory))),
		]),
	),
])
png(
	"palette.png",
	3,
	4,
	[0, 1, 2, 3],
	[
		chunk("sRGB", Uint8Array.of(0)),
		chunk(
			"PLTE",
			Buffer.from([210, 85, 35, 210, 85, 35, 210, 85, 35, 210, 85, 35]),
		),
		chunk("tRNS", Buffer.from([0, 64, 128, 255])),
	],
)
png("gray.png", 4, 4, [40, 0, 40, 64, 40, 128, 40, 255])
const transparentRgb = [210, 85, 35, 211, 85, 35, 210, 85, 35, 210, 86, 35]
png("rgb-trns.png", 2, 4, transparentRgb, [
	chunk("sRGB", Uint8Array.of(0)),
	chunk("tRNS", Uint8Array.of(0, 210, 0, 85, 0, 35)),
])
png(
	"rgb-trns-reference.png",
	6,
	4,
	[0, 255, 0, 255].flatMap((alpha, pixel) => [
		...transparentRgb.slice(pixel * 3, pixel * 3 + 3),
		alpha,
	]),
	[chunk("sRGB", Uint8Array.of(0))],
)
png(
	"gray-trns.png",
	0,
	4,
	[40, 41, 40, 41],
	[chunk("sRGB", Uint8Array.of(0)), chunk("tRNS", Uint8Array.of(0, 40))],
)
png(
	"gray-trns-reference.png",
	4,
	4,
	[40, 0, 41, 255, 40, 0, 41, 255],
	[chunk("sRGB", Uint8Array.of(0))],
)
writeFileSync(
	new URL("rgb.jpg", directory),
	jpeg.encode({ width: 4, height: 1, data: Buffer.from(rgba) }, 95).data,
)

// Relabel the three stored component planes as RGB. The compressed coefficients
// are unchanged; independent decoding yields [117, 82, 195] at every pixel.
const originalJpeg = readFileSync(new URL("rgb.jpg", directory))
const app0End = 4 + originalJpeg.readUInt16BE(4)
const withoutJfif = Buffer.concat([
	originalJpeg.subarray(0, 2),
	originalJpeg.subarray(app0End),
])
writeFileSync(
	new URL("adobe-rgb.jpg", directory),
	Buffer.concat([
		withoutJfif.subarray(0, 2),
		Buffer.from([
			255, 238, 0, 14, 65, 100, 111, 98, 101, 0, 100, 0, 0, 0, 0, 0,
		]),
		withoutJfif.subarray(2),
	]),
)
const componentRgb = Buffer.from(withoutJfif)
for (let offset = 2; offset < componentRgb.length;) {
	const marker = componentRgb[offset + 1]
	const length = componentRgb.readUInt16BE(offset + 2)
	if (marker === 0xc0)
		for (const [index, id] of [82, 71, 66].entries())
			componentRgb[offset + 10 + index * 3] = id
	if (marker === 0xda) {
		for (const [index, id] of [82, 71, 66].entries())
			componentRgb[offset + 5 + index * 2] = id
		break
	}
	offset += 2 + length
}
writeFileSync(new URL("component-rgb.jpg", directory), componentRgb)
png(
	"rgb-encoded-reference.png",
	6,
	4,
	Array.from({ length: 4 }, () => [117, 82, 195, 255]).flat(),
	[chunk("sRGB", Uint8Array.of(0))],
)
