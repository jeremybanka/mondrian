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
) {
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width)
	header.writeUInt32BE(1, 4)
	header[8] = 8
	header[9] = colorType
	writeFileSync(
		new URL(file, directory),
		Buffer.concat([
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
			chunk("IHDR", header),
			...metadata,
			chunk("IDAT", deflateSync(Buffer.from([0, ...samples]))),
			chunk("IEND", new Uint8Array()),
		]),
	)
}
const rgba = [0, 64, 128, 255].flatMap((alpha) => [210, 85, 35, alpha])
png("rgba.png", 6, 4, rgba, [chunk("sRGB", Uint8Array.of(0))])
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
writeFileSync(
	new URL("rgb.jpg", directory),
	jpeg.encode({ width: 4, height: 1, data: Buffer.from(rgba) }, 95).data,
)
