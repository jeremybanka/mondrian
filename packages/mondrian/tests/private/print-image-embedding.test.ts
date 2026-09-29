import { readFileSync } from "node:fs"
import { inflateSync } from "node:zlib"
import { expect, it } from "vite-plus/test"
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib"
import { createPdfDocument, pageSizes } from "mondrian.pdf"

const profile = readFileSync(
	new URL("../public/fixtures/print-images/CGATS21_CRPC6.icc", import.meta.url),
)

it("embeds prepared CMYK samples and independent alpha with the declared output profile", async () => {
	const pdf = createPdfDocument({
		outputIntent: { profile, identifier: "CRPC6" },
	})
	const data = Uint8Array.of(255, 0, 0, 0, 0, 128, 0, 64)
	const alpha = Uint8Array.of(0, 128)
	const image = pdf.image({
		width: 2,
		height: 1,
		data,
		alpha,
		destinationProfile: profile,
	})
	data.fill(99)
	alpha.fill(99)
	pdf.setPages(
		pdf.page({
			mediaBox: pageSizes.letter,
			content: [pdf.graphics((g) => g.drawImage(image, 10, 20, 200, 100))],
		}),
	)
	const parsed = await PDFDocument.load(pdf.serialize())
	const resources = parsed.getPage(0).node.Resources()!
	const xobjects = resources.lookup(
		PDFName.of("XObject"),
	) as import("pdf-lib").PDFDict
	const raster = xobjects.lookup(xobjects.keys()[0]!) as PDFRawStream
	expect(raster.dict.get(PDFName.of("ColorSpace"))?.toString()).toBe(
		"/DeviceCMYK",
	)
	expect(Array.from(inflateSync(raster.contents))).toEqual([
		255, 0, 0, 0, 0, 128, 0, 64,
	])
	const mask = raster.dict.lookup(PDFName.of("SMask")) as PDFRawStream
	expect(Array.from(inflateSync(mask.contents))).toEqual([0, 128])
	expect(mask.dict.get(PDFName.of("ColorSpace"))?.toString()).toBe(
		"/DeviceGray",
	)
	const intents = parsed.catalog.lookup(
		PDFName.of("OutputIntents"),
	) as import("pdf-lib").PDFArray
	const intent = intents.lookup(0) as import("pdf-lib").PDFDict
	const embedded = intent.lookup(
		PDFName.of("DestOutputProfile"),
	) as PDFRawStream
	expect(inflateSync(embedded.contents).equals(profile)).toBe(true)
})

it("rejects missing or conflicting image output profiles and unsupported PDF versions", () => {
	const input = {
		width: 1,
		height: 1,
		data: new Uint8Array(4),
		destinationProfile: profile,
	}
	expect(() => createPdfDocument().image(input)).toThrow()
	const other = Uint8Array.from(profile)
	other[84] = other[84]! ^ 1
	const pdf = createPdfDocument({
		outputIntent: { profile, identifier: "CRPC6" },
	})
	expect(() => pdf.image({ ...input, destinationProfile: other })).toThrow()
	expect(() => pdf.image({ ...input, alpha: new Uint8Array(2) })).toThrow()
	expect(() => pdf.image({ ...input, data: new Uint8Array(3) })).toThrow(
		/four bytes per pixel/,
	)
	expect(() => pdf.image({ ...input, data: [0, 0, 0, 0] as never })).toThrow(
		/four bytes per pixel/,
	)
	expect(() => pdf.image({ ...input, width: 1.5 })).toThrow(/dimensions/)
	expect(() =>
		createPdfDocument({ outputIntent: { profile, identifier: " " } }),
	).toThrow(/identifier/)
	expect(() =>
		createPdfDocument({
			version: "1.3",
			outputIntent: { profile, identifier: "CRPC6" },
		}),
	).toThrow()
})
