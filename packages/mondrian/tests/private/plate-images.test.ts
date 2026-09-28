import { expect, it } from "vite-plus/test"
import {
	array,
	dictionary,
	name,
	stream,
	ascii,
	reference,
} from "../../src/index.ts"
import type {
	PdfDictionaryEntries,
	PdfDocument,
	PdfStream,
} from "../../src/index.ts"
import { previewPdfPlates } from "../../src/testing.ts"
import { rawDocument, samples, white } from "./fixtures/plates.ts"
import { zlibSync, unzlibSync } from "fflate"

function imageDocument(
	options: {
		overprint?: boolean
		mode?: number
		opacity?: number
		spot?: boolean
		entries?: PdfDictionaryEntries
		maskEntries?: PdfDictionaryEntries
		group?: PdfDictionaryEntries
		form?: boolean
	} = {},
) {
	return rawDocument((objects) => {
		const mask = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Image"),
					Width: 3,
					Height: 1,
					ColorSpace: name("DeviceGray"),
					BitsPerComponent: 8,
					...options.maskEntries,
				},
				Uint8Array.of(0, 128, 255),
			),
		)
		const image = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Image"),
					Width: 3,
					Height: 1,
					ColorSpace: name("DeviceCMYK"),
					BitsPerComponent: 8,
					Filter: name("FlateDecode"),
					SMask: mask,
					...options.entries,
				},
				zlibSync(Uint8Array.of(0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0)),
			),
		)
		const states = dictionary({
			Print: dictionary({
				op: options.overprint ?? false,
				OPM: options.mode ?? 0,
				ca: options.opacity ?? 1,
			}),
		})
		const colors = dictionary({
			Ink: array(
				name("Separation"),
				name("Red"),
				name("DeviceRGB"),
				dictionary({
					FunctionType: 2,
					Domain: array(0, 1),
					C0: array(1, 1, 1),
					C1: array(1, 0, 0),
					N: 1,
				}),
			),
		})
		const source = options.form
			? objects.add(
					stream(
						{
							Type: name("XObject"),
							Subtype: name("Form"),
							BBox: array(0, 0, 80, 80),
							Resources: dictionary({ XObject: dictionary({ Photo: image }) }),
						},
						ascii("q 80 0 0 80 0 0 cm /Photo Do Q"),
					),
				)
			: image
		return {
			contents: [
				stream(
					{},
					ascii(
						`${options.spot ? "/Ink cs 1 scn" : "1 1 0 0 k"} 0 0 80 80 re f /Print gs q ${options.form ? "" : "80 0 0 80 0 0 cm"} /Photo Do Q`,
					),
				),
			],
			resources: dictionary({
				XObject: dictionary({ Photo: source }),
				ExtGState: states,
				ColorSpace: colors,
			}),
			...(options.group ? { page: { Group: dictionary(options.group) } } : {}),
		}
	})
}

it.each([0, 1])(
	"retains alpha and knocks out zero process samples even in overprint mode %s",
	async (mode) => {
		const source = imageDocument({ overprint: true, mode })
		const cyan = previewPdfPlates(source)[0]!.document
		const result = await samples(cyan, [
			[10, 40],
			[40, 40],
			[70, 40],
		])
		expect(result[0]).not.toEqual(white)
		expect(result[1]).not.toEqual(result[0])
		expect(result[1]).not.toEqual(white)
		expect(result[2]).toEqual(white)
	},
)

it.each([false, true])(
	"preserves the alpha shape on spot plates with overprint %s",
	async (overprint) => {
		const spot = previewPdfPlates(imageDocument({ spot: true, overprint }))[4]!
			.document
		const result = await samples(spot, [
			[10, 40],
			[40, 40],
			[70, 40],
		])
		expect(result[0]).toEqual([255, 0, 0, 255])
		if (overprint) expect(result).toEqual([result[0], result[0], result[0]])
		else {
			expect(result[1]![1]).toBeGreaterThan(100)
			expect(result[1]![1]).toBeLessThan(155)
			expect(result[2]).toEqual(white)
		}
	},
)

it("projects images inside Forms under constant opacity and explicit CMYK page blending", async () => {
	const document = imageDocument({
		form: true,
		opacity: 0.5,
		group: {
			S: name("Transparency"),
			CS: name("DeviceCMYK"),
			I: true,
			K: false,
		},
	})
	const [cyan] = previewPdfPlates(document)
	const result = await samples(cyan!.document, [
		[10, 40],
		[40, 40],
		[70, 40],
	])
	expect(new Set(result.map((pixel) => pixel.join(","))).size).toBe(3)
	expect(result.every((pixel) => pixel.join(",") !== white.join(","))).toBe(
		true,
	)
})

it("projects only the selected component and retains independently owned mask bytes", () => {
	const source = imageDocument()
	const plates = previewPdfPlates(source)
	for (const [channel, plate] of plates.entries()) {
		const images = imageStreams(plate.document, "/DeviceCMYK")
		expect(images).toHaveLength(1)
		const data = images[0]!.entries.Filter
			? unzlibSync(images[0]!.data)
			: images[0]!.data
		expect(Array.from(data)).toEqual(
			Array.from({ length: 12 }, (_, index) =>
				channel === 1 && index % 4 === 1 ? 255 : 0,
			),
		)
	}
	const mask = imageStreams(plates[0]!.document, "/DeviceGray")[0]!
	mask.data.fill(23)
	const again = previewPdfPlates(source)
	expect(again[1]!.document).toEqual(plates[1]!.document)
})

function imageStreams(document: PdfDocument, space: string): PdfStream[] {
	return document.objects
		.map((object) => object.value)
		.filter((value): value is PdfStream => {
			if (
				value === null ||
				typeof value !== "object" ||
				value.kind !== "stream"
			)
				return false
			const color = value.entries.ColorSpace
			return (
				color !== null &&
				typeof color === "object" &&
				color.kind === "name" &&
				`/${color.value}` === space
			)
		})
}

it.each([
	{ entries: { BitsPerComponent: 16 } },
	{ entries: { Mask: array(0, 0, 0, 0, 0, 0, 0, 0) } },
	{ entries: { DecodeParms: dictionary({ Predictor: 15 }) } },
	{ entries: { ColorSpace: name("DeviceRGB") } },
	{ entries: { Width: 4 } },
	{ maskEntries: { Width: 2 } },
	{ maskEntries: { Width: 1, Height: 3 } },
	{ maskEntries: { ColorSpace: name("DeviceRGB") } },
	{ maskEntries: { Matte: array(0, 0, 0, 0) } },
	{ maskEntries: { SMask: reference(1) } },
	{ group: { S: name("Transparency"), CS: name("DeviceRGB") } },
	{ group: { S: name("Transparency"), CS: name("DeviceCMYK"), K: true } },
])(
	"rejects unsupported image/mask/blending semantics before projection: %j",
	(options) => {
		expect(() => previewPdfPlates(imageDocument(options))).toThrow()
	},
)

it("resolves image color aliases and retains clipping and transforms across reused images", async () => {
	const document = rawDocument((objects) => {
		const image = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Image"),
					Width: 1,
					Height: 1,
					ColorSpace: name("Print"),
					BitsPerComponent: 8,
					SMask: objects.add(null),
				},
				Uint8Array.of(255, 0, 0, 0),
			),
		)
		return {
			resources: dictionary({
				ColorSpace: dictionary({
					Print: objects.add(array(name("DeviceCMYK"))),
				}),
				XObject: dictionary({ Photo: image }),
			}),
			contents: [
				stream(
					{},
					ascii(
						"q 10 10 20 20 re W n 40 0 0 40 0 0 cm /Photo Do Q q 20 0 0 20 50 50 cm /Photo Do Q",
					),
				),
			],
		}
	})
	const [cyan, magenta] = previewPdfPlates(document)
	expect(
		await samples(cyan!.document, [
			[5, 5],
			[15, 15],
			[35, 35],
			[60, 60],
			[75, 75],
		]),
	).toEqual([white, [0, 174, 239, 255], white, [0, 174, 239, 255], white])
	expect(
		await samples(magenta!.document, [
			[15, 15],
			[60, 60],
		]),
	).toEqual([white, white])
	expect(imageStreams(cyan!.document, "/DeviceCMYK")).toHaveLength(1)
})
