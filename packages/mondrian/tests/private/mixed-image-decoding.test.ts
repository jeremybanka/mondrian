import { readFileSync } from "node:fs"
import { expect, it } from "vite-plus/test"
import { zlibSync } from "fflate"
import {
	array,
	ascii,
	dictionary,
	name,
	nameBytes,
	stream,
} from "../../src/index.ts"
import { readPlateImage } from "../../src/testing/plate-image.ts"
import { decodeJpegSamples } from "../../src/print/jpeg-samples.ts"
import { previewPdfPlates, renderPdfPlateCoverage } from "../../src/testing.ts"
import { rawDocument, samples } from "./fixtures/plates.ts"
import type { PdfIndirectValue, PdfValue } from "../../src/index.ts"

const fixture = (file: string) =>
	readFileSync(
		new URL(`../public/fixtures/mixed-color/${file}`, import.meta.url),
	)
const resolve = (v: PdfValue | undefined): PdfIndirectValue | undefined =>
	v !== null && typeof v === "object" && v.kind === "reference" ? undefined : v
const imageEntries = {
	Type: name("XObject"),
	Subtype: name("Image"),
	Width: 2,
	Height: 2,
	BitsPerComponent: 8,
	ColorSpace: name("DeviceCMYK"),
	Filter: name("FlateDecode"),
}

it("accepts single-filter DecodeParms arrays and byte-keyed predictor dictionaries", () => {
	const parameters = dictionary(
		{ Colors: 4, Columns: 2, BitsPerComponent: 8 },
		[nameBytes(new TextEncoder().encode("Predictor")), 1],
	)
	const data = Uint8Array.from({ length: 16 }, (_, i) => i * 15)
	const image = stream(
		{
			...imageEntries,
			Filter: array(name("FlateDecode")),
			DecodeParms: array(parameters),
		},
		zlibSync(data),
	)
	expect(readPlateImage(image, resolve).data).toEqual(data)
})

it("rejects malformed parameter arrays, unsupported DCT transforms, and damaged predictor rows", () => {
	for (const DecodeParms of [
		array(dictionary({}), dictionary({})),
		2,
		dictionary({ Predictor: 1.5 }),
	])
		expect(() =>
			readPlateImage(
				stream({ ...imageEntries, DecodeParms }, zlibSync(new Uint8Array(16))),
				resolve,
			),
		).toThrow()
	expect(() =>
		readPlateImage(
			stream(
				{
					...imageEntries,
					Width: 8,
					Height: 8,
					Filter: name("DCTDecode"),
					DecodeParms: dictionary({ ColorTransform: 2 }),
				},
				fixture("cmyk.jpg"),
			),
			resolve,
		),
	).toThrow(/ColorTransform/)
	for (const data of [
		Uint8Array.of(0),
		Uint8Array.from({ length: 18 }, (_, i) => (i === 0 ? 5 : 0)),
	])
		expect(() =>
			readPlateImage(
				stream(
					{
						...imageEntries,
						DecodeParms: dictionary({ Predictor: 15, Colors: 4, Columns: 2 }),
					},
					zlibSync(data),
				),
				resolve,
			),
		).toThrow(/predictor/)
})

it("honors APP14 transforms before ColorTransform and keeps CMYK inversion in Decode", () => {
	const original = fixture("cmyk.jpg")
	const adobe = (transform: number) =>
		Buffer.concat([
			original.subarray(0, 2),
			Uint8Array.from([
				255,
				238,
				0,
				14,
				65,
				100,
				111,
				98,
				101,
				0,
				100,
				0,
				0,
				0,
				0,
				transform,
			]),
			original.subarray(2),
		])
	expect(decodeJpegSamples(adobe(0), 8, 8, 4, 1)).toEqual(
		decodeJpegSamples(original, 8, 8, 4, 0),
	)
	expect(decodeJpegSamples(adobe(2), 8, 8, 4, 0)).toEqual(
		decodeJpegSamples(original, 8, 8, 4, 1),
	)
	expect(decodeJpegSamples(adobe(2), 8, 8, 4).slice(0, 4)).toEqual(
		Uint8Array.of(220, 220, 255, 200),
	)
})

it("rejects progressive DCT, mismatched component geometry, truncation, and excessive allocations", () => {
	const original = fixture("cmyk.jpg"),
		progressive = Uint8Array.from(original)
	const frame = Buffer.from(progressive).indexOf(Buffer.from([255, 192]))
	progressive[frame + 1] = 194
	expect(() => decodeJpegSamples(progressive, 8, 8, 4)).toThrow(
		/baseline sequential/,
	)
	expect(() => decodeJpegSamples(original, 9, 8, 4)).toThrow(/geometry/)
	expect(() => decodeJpegSamples(original, 8, 8, 3)).toThrow(/geometry/)
	expect(() => decodeJpegSamples(original.subarray(0, -4), 8, 8, 4)).toThrow()
	expect(() => decodeJpegSamples(original, 32_000_001, 1, 4)).toThrow(
		/32 million/,
	)
})

it("reads CMYK JPEG component amounts before Decode instead of display RGB", async () => {
	const jpeg = fixture("cmyk.jpg")
	const data = decodeJpegSamples(jpeg, 8, 8, 4)
	expect(data).toEqual(
		Uint8Array.from(
			{ length: 8 * 8 * 4 },
			(_, i) => [24, 80, 136, 200][i % 4]!,
		),
	)
	const photo = stream(
		{
			...imageEntries,
			Width: 8,
			Height: 8,
			Filter: name("DCTDecode"),
			Decode: array(1, 0, 0, 1, 0, 1, 1, 0),
		},
		jpeg,
	)
	expect(readPlateImage(photo, resolve).data.slice(0, 4)).toEqual(
		Uint8Array.of(231, 80, 136, 55),
	)
	const document = rawDocument((objects) => ({
		resources: dictionary({
			XObject: dictionary({ Photo: objects.add(photo) }),
		}),
		contents: [stream({}, ascii("q 80 0 0 80 0 0 cm /Photo Do Q"))],
	}))
	const coverage = await renderPdfPlateCoverage(document, { resolution: 72 })
	expect(coverage.plates.map((p) => p.pages[0]!.samples[40 * 80 + 40])).toEqual(
		[24, 175, 119, 200],
	)
	// Independent PDFium reader: the original DCT and the lossless equivalent render identically.
	const raw = rawDocument((objects) => ({
		resources: dictionary({
			XObject: dictionary({
				Photo: objects.add(
					stream(
						{ ...imageEntries, Width: 8, Height: 8, Filter: undefined },
						readPlateImage(photo, resolve).data,
					),
				),
			}),
		}),
		contents: [stream({}, ascii("q 80 0 0 80 0 0 cm /Photo Do Q"))],
	}))
	expect(await samples(document, [[40, 40]])).toEqual(
		await samples(raw, [[40, 40]]),
	)
})

it.each([1, 2, 10, 11, 12, 13, 14, 15])(
	"decodes default, TIFF, and PNG predictor %i with exact dimensions",
	(predictor) => {
		const raw = Uint8Array.from({ length: 16 }, (_, i) => (i * 17) % 256)
		const row = 8,
			encoded: number[] = []
		const filter = predictor === 15 ? 4 : predictor >= 10 ? predictor - 10 : 1
		for (let y = 0; y < 2; y++) {
			if (predictor >= 10) encoded.push(filter)
			for (let x = 0; x < row; x++) {
				const at = y * row + x,
					left = x >= 4 ? raw[at - 4]! : 0,
					above = y ? raw[at - row]! : 0,
					upperLeft = y && x >= 4 ? raw[at - row - 4]! : 0
				let prediction = 0
				if (predictor === 2 || filter === 1) prediction = left
				else if (filter === 2) prediction = above
				else if (filter === 3) prediction = Math.floor((left + above) / 2)
				else if (filter === 4) {
					const p = left + above - upperLeft,
						a = Math.abs(p - left),
						b = Math.abs(p - above),
						c = Math.abs(p - upperLeft)
					prediction = a <= b && a <= c ? left : b <= c ? above : upperLeft
				}
				encoded.push(
					predictor === 1 ? raw[at]! : (raw[at]! - prediction + 256) % 256,
				)
			}
		}
		const image = stream(
			{
				...imageEntries,
				DecodeParms: dictionary({
					Predictor: predictor,
					Colors: 4,
					Columns: 2,
					BitsPerComponent: 8,
				}),
			},
			zlibSync(Uint8Array.from(encoded)),
		)
		expect(readPlateImage(image, resolve).data).toEqual(raw)
	},
)

it("accepts harmless grayscale mask DecodeParms and non-integer Decode ranges", () => {
	const mask = stream(
		{
			...imageEntries,
			ColorSpace: name("DeviceGray"),
			DecodeParms: dictionary({ Colors: 1, Columns: 2, BitsPerComponent: 8 }),
		},
		zlibSync(Uint8Array.of(0, 64, 128, 255)),
	)
	const photo = stream(
		{
			...imageEntries,
			SMask: {
				kind: "reference",
				objectNumber: 1 as never,
				generation: 0 as never,
			},
			Decode: array(0.25, 0.75, 0, 1, 0, 1, 0, 1),
		},
		zlibSync(new Uint8Array(16)),
	)
	const decoded = readPlateImage(photo, (v) =>
		v !== null && typeof v === "object" && v.kind === "reference"
			? mask
			: resolve(v),
	)
	expect(decoded.alpha!.data).toEqual(Uint8Array.of(0, 64, 128, 255))
	expect(decoded.data.filter((_, i) => i % 4 === 0)).toEqual(
		Uint8Array.of(64, 64, 64, 64),
	)
})

it("extracts ICCBased CMYK amounts without requiring or applying an output intent", async () => {
	const profile = readFileSync(
		new URL(
			"../public/fixtures/print-images/CGATS21_CRPC6.icc",
			import.meta.url,
		),
	)
	const document = rawDocument((objects) => {
		const icc = array(
			name("ICCBased"),
			objects.add(
				stream({ N: 4, Filter: name("FlateDecode") }, zlibSync(profile)),
			),
		)
		return {
			resources: dictionary({
				ColorSpace: dictionary({ Press: icc }),
				XObject: dictionary({
					Photo: objects.add(
						stream(
							{ ...imageEntries, Width: 1, Height: 1, ColorSpace: icc },
							zlibSync(Uint8Array.of(0, 64, 128, 255)),
						),
					),
				}),
			}),
			contents: [
				stream(
					{},
					ascii(
						"/Press cs 0.1 0.2 0.3 0.4 sc 0 0 80 40 re f q 80 0 0 40 0 40 cm /Photo Do Q",
					),
				),
			],
		}
	})
	const coverage = await renderPdfPlateCoverage(document, { resolution: 72 })
	expect(coverage.plates.map((p) => p.pages[0]!.samples[20 * 80 + 40])).toEqual(
		[255, 191, 127, 0],
	)
	expect(coverage.plates.map((p) => p.pages[0]!.samples[60 * 80 + 40])).toEqual(
		[230, 204, 179, 153],
	)
})

it("requires explicit gray-to-black interpretation, including inherited default black", async () => {
	const document = rawDocument(() => ({
		contents: [stream({}, ascii("0 0 40 80 re f 0.5 g 40 0 40 80 re f"))],
	}))
	expect(() => previewPdfPlates(document)).toThrow(/DeviceGray/)
	const proof = await renderPdfPlateCoverage(document, {
		gray: "black-only",
		resolution: 72,
	})
	expect(proof.plates.map((p) => p.pages[0]!.samples[40 * 80 + 20])).toEqual([
		255, 255, 255, 0,
	])
	expect(proof.plates[3]!.pages[0]!.samples[40 * 80 + 60]).toBe(128)
})

it.each([
	dictionary({ Predictor: 3 }),
	dictionary({ Predictor: 15, Colors: 3, Columns: 2 }),
	dictionary({ ColorTransform: 2 }),
	dictionary({ Invented: 1 }),
])("rejects unsupported predictor and codec parameters", (DecodeParms) => {
	expect(() =>
		readPlateImage(
			stream({ ...imageEntries, DecodeParms }, zlibSync(new Uint8Array(16))),
			resolve,
		),
	).toThrow()
})
