import { readFile } from "node:fs/promises"
import { PNG } from "pngjs"
import {
	ascii,
	createPdfDocument,
	dictionary,
	indirectObject,
	name,
	rectangle,
	reference,
	stream,
} from "mondrian.pdf"
import type { PdfCatalogDictionary, PdfDocument } from "mondrian.pdf"
import { inspectPdf } from "mondrian.pdf/inspect"
import { expect, it } from "vite-plus/test"

import {
	inspectBitmapPng,
	inspectIccProfile,
} from "../../src/inspection/bitmap.ts"

it("previews tagged RGB with independent alpha and reports ICC characteristics", async () => {
	const profile = new Uint8Array(
		await readFile(
			new URL(
				"../public/fixtures/mixed-color/sRGB-v2-micro.icc",
				import.meta.url,
			),
		),
	)
	const pdf = createPdfDocument({ blendingSpace: { rgbProfile: profile } })
	const image = pdf.rgbImage({
		width: 2,
		height: 1,
		data: Uint8Array.of(255, 0, 0, 0, 0, 255),
		alpha: Uint8Array.of(255, 128),
		sourceProfile: profile,
	})
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 100, 100),
			content: [pdf.graphics((g) => g.drawImage(image, 0, 0, 100, 100))],
		}),
	)
	const document = pdf.compile(),
		index = inspectPdf(document),
		bitmap = index.bitmaps.find((entry) => entry.profile !== null)!
	expect(bitmap).toMatchObject({
		width: 2,
		height: 1,
		bits: 8,
		colorSpace: "ICCBased",
	})
	expect(index.objects.find((entry) => entry.id === bitmap.profile)?.role).toBe(
		"ICC profile",
	)
	const observed = await inspectBitmapPng(document, bitmap.id)
	const pixels = PNG.sync.read(Buffer.from(observed.png))
	expect([pixels.width, pixels.height]).toEqual([2, 1])
	expect([pixels.data[3], pixels.data[7]]).toEqual([255, 128])
	expect(pixels.data[0]).toBeGreaterThan(250)
	expect(pixels.data[6]).toBeGreaterThan(250)
	expect(observed.interpretation).toContain("ICC profile")
	expect(inspectIccProfile(document, bitmap.profile!)).toMatchObject({
		colorSpace: "RGB",
		declaredChannels: 3,
		bytes: profile.length,
	})
})

it("selects individual original pages without changing their contents", async () => {
	const { renderPdf } = await import("mondrian.pdf/testing")
	const pdf = createPdfDocument()
	pdf.setPages(
		pdf.page({ mediaBox: rectangle(0, 0, 40, 50) }),
		pdf.page({ mediaBox: rectangle(0, 0, 60, 70) }),
	)
	const result = await renderPdf(pdf.serialize(), {
		pageNumbers: [2],
		resolution: 72,
		maxPagePixels: 5000,
	})
	expect(
		result.pages.map(({ pageNumber, width, height }) => [
			pageNumber,
			width,
			height,
		]),
	).toEqual([[2, 60, 70]])
	await expect(
		renderPdf(pdf.serialize(), { pageNumbers: [3] }),
	).rejects.toThrow("out of range")
	await expect(
		renderPdf(pdf.serialize(), {
			pageNumbers: [2],
			resolution: 72,
			maxPagePixels: 1,
		}),
	).rejects.toThrow("pixel limit")
})

it("labels unprofiled channel previews and rejects unsupported image shapes/codecs", async () => {
	for (const [space, data] of [
		["DeviceRGB", Uint8Array.of(255, 0, 0)],
		["DeviceGray", Uint8Array.of(128)],
		["DeviceCMYK", Uint8Array.of(255, 0, 0, 0)],
	] as const) {
		const document = {
			version: "1.7",
			root: reference<PdfCatalogDictionary>(1),
			objects: [
				indirectObject(
					1,
					stream(
						{
							Type: name("XObject"),
							Subtype: name("Image"),
							Width: 1,
							Height: 1,
							BitsPerComponent: 8,
							ColorSpace: name(space),
						},
						data,
					),
				),
			],
		} satisfies PdfDocument
		const preview = await inspectBitmapPng(document, "1:0")
		expect(preview.interpretation).toContain("approximation")
		expect(PNG.sync.read(Buffer.from(preview.png)).data[3]).toBe(255)
	}
	const document = {
		version: "1.7",
		root: reference<PdfCatalogDictionary>(1),
		objects: [
			indirectObject(1, dictionary({})),
			indirectObject(2, stream({ Width: 5000, Height: 5000 }, ascii("x"))),
			indirectObject(
				3,
				stream({ Width: 1, Height: 1, ColorSpace: name("Lab") }, ascii("x")),
			),
		],
	} satisfies PdfDocument
	await expect(inspectBitmapPng(document, "1:0")).rejects.toThrow(
		"not an image",
	)
	await expect(inspectBitmapPng(document, "2:0")).rejects.toThrow(
		"four million",
	)
	await expect(inspectBitmapPng(document, "3:0")).rejects.toThrow(
		"Preview supports",
	)
	expect(() => inspectIccProfile(document, "1:0")).toThrow("not a stream")
})

it("reads a multilingual v4 ICC description without changing the profile bytes", async () => {
	const profile = new Uint8Array(
		await readFile(
			new URL(
				"../public/fixtures/print-images/DisplayP3-v4.icc",
				import.meta.url,
			),
		),
	)
	const document = {
		version: "1.7",
		root: reference<PdfCatalogDictionary>(1),
		objects: [indirectObject(1, stream({ N: 3 }, profile))],
	} satisfies PdfDocument
	const metadata = inspectIccProfile(document, "1:0")
	expect(metadata.version).toMatch(/^4\./)
	expect(metadata.description).not.toBe("No description tag")
	expect(metadata.colorSpace).toBe("RGB")
	expect(document.objects[0]?.value).toMatchObject({ data: profile })
})
