import { expect, it } from "vite-plus/test"
import { zlibSync } from "fflate"
import { array, name, nameBytes, reference, stream } from "../../src/index.ts"
import type {
	PdfDictionaryEntries,
	PdfIndirectValue,
	PdfValue,
} from "../../src/index.ts"
import { readPlateImage } from "../../src/testing/plate-image.ts"

const resolve = (value: PdfValue | undefined): PdfIndirectValue | undefined =>
	value !== null && typeof value === "object" && value.kind === "reference"
		? undefined
		: value
const entries: PdfDictionaryEntries = {
	Type: name("XObject"),
	Subtype: name("Image"),
	Width: 2,
	Height: 1,
	ColorSpace: name("DeviceCMYK"),
	BitsPerComponent: 8,
}
const samples = Uint8Array.of(0, 16, 32, 255, 255, 64, 128, 0)

it("normalizes channel Decode ranges and independent mask interpolation without mutating input", () => {
	const mask = stream(
		{
			...entries,
			ColorSpace: array(name("DeviceGray")),
			Decode: array(1, 0),
			Interpolate: false,
			Filter: array(name("FlateDecode")),
		},
		zlibSync(Uint8Array.of(0, 64)),
	)
	const input = stream(
		{
			...entries,
			Decode: array(1, 0, 0, 1, 0, 1, 1, 0),
			Interpolate: true,
			Intent: name("RelativeColorimetric"),
			SMask: reference(1),
		},
		samples,
	)
	const result = readPlateImage(input, (value) =>
		value !== null && typeof value === "object" && value.kind === "reference"
			? mask
			: resolve(value),
	)
	expect(result.data).toEqual(Uint8Array.of(255, 16, 32, 0, 0, 64, 128, 255))
	expect(result.alpha?.data).toEqual(Uint8Array.of(255, 191))
	expect(result.interpolate).toBe(true)
	expect(result.alpha?.interpolate).toBe(false)
	expect(input.data).toEqual(samples)
})

it("reads byte-keyed metadata and treats explicit null like an absent optional field", () => {
	const { Width: _, ...rest } = entries
	const input = stream(
		{ ...rest, SMask: null, Filter: null, Decode: null, Matte: null },
		samples,
		[nameBytes(new TextEncoder().encode("Width")), 2],
	)
	expect(readPlateImage(input, resolve).data).toEqual(samples)
})

it.each([
	{ Type: name("Other") },
	{ ImageMask: true },
	{ Width: name("Two") },
	{ Interpolate: 1 },
	{ Intent: name("Invented") },
	{ Filter: name("DCTDecode") },
	{ Filter: array(name("FlateDecode"), name("FlateDecode")) },
	{ Decode: array(0, 1) },
	{ Decode: array(0, 2, 0, 1, 0, 1, 0, 1) },
	{ SMask: 2 },
	{ Matte: array(0, 0, 0, 0) },
])("rejects unsupported raster semantics: %j", (change) => {
	expect(() =>
		readPlateImage(stream({ ...entries, ...change }, samples), resolve),
	).toThrow()
})

it("bounds decompression and rejects both short and oversized rasters", () => {
	for (const size of [4, 12])
		for (const compressed of [false, true])
			expect(() =>
				readPlateImage(
					stream(
						{
							...entries,
							...(compressed ? { Filter: name("FlateDecode") } : {}),
						},
						compressed ? zlibSync(new Uint8Array(size)) : new Uint8Array(size),
					),
					resolve,
				),
			).toThrow()
})
