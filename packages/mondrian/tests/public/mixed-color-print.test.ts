import { expect, it } from "vite-plus/test"
import {
	createPdfDocument,
	parsePdf,
	rectangle,
	rgb,
	separation,
	serializePdf,
} from "mondrian.pdf"
import { preparePdfForPrint, prepareRgbImage } from "mondrian.pdf/print"
import { renderPdfPlateCoverage } from "mondrian.pdf/testing"
import {
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFName,
	PDFNumber,
	PDFRawStream,
	decodePDFRawStream,
} from "pdf-lib"
import {
	mixedColorDocument,
	mixedFixture,
	sourceProfile,
	destinationProfile,
	printOptions,
} from "./fixtures/mixed-color/document.ts"
import { paintedFills } from "./helpers/painted-fills.ts"
import { readPdf } from "../../src/testing/inspection/read-pdf.ts"

function readStream(dict: PDFDict, key: PDFName): PDFRawStream {
	const value = dict.lookup(key)
	if (!(value instanceof PDFRawStream))
		throw new Error("Expected image/profile stream")
	return value
}

it(
	"authors tagged RGB alpha beside process text and profile-qualified named spots",
	{ timeout: 30_000 },
	async () => {
		const data = {
			width: 4,
			height: 1,
			data: Uint8Array.of(210, 85, 35, 210, 85, 35, 210, 85, 35, 210, 85, 35),
			alpha: Uint8Array.of(0, 64, 128, 255),
			sourceProfile,
			renderingIntent: "perceptual" as const,
		}
		const pdf = createPdfDocument({
			blendingSpace: { rgbProfile: sourceProfile },
			outputIntent: {
				profile: destinationProfile,
				identifier: "Test destination",
			},
		})
		const image = pdf.rgbImage(data),
			font = pdf.standardFont("Helvetica")
		const inks = [
			separation("Forest Green", {
				type: "exponential",
				zero: rgb(1, 1, 1),
				full: rgb(0.2, 0.55, 0.32),
				sourceProfile,
				exponent: 1,
			}),
			separation("Violet", {
				type: "exponential",
				zero: rgb(1, 1, 1),
				full: rgb(0.46, 0.25, 0.75),
				sourceProfile,
				exponent: 1,
			}),
		]
		pdf.setPages(
			pdf.page({
				mediaBox: rectangle(0, 0, 80, 80),
				content: [
					pdf.graphics((g) => {
						g.spotFill(inks[0]!, 0.7).rectangle(0, 0, 40, 80).fill()
						g.spotFill(inks[1]!, 0.4).rectangle(40, 0, 40, 80).fill()
						g.drawImage(image, 0, 0, 80, 60)
					}),
					pdf.text((t) =>
						t
							.font(font, 10)
							.cmykFill(0, 0, 0, 1)
							.moveText(2, 65)
							.show("Live black text"),
					),
				],
			}),
		)
		const reader = await PDFDocument.load(pdf.serialize()),
			page = reader.getPages()[0]!
		const images = page.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict)
		const photo = readStream(images, images.keys()[0]!)
		expect(decodePDFRawStream(photo).decode()).toEqual(data.data)
		const profile = photo.dict
			.lookup(PDFName.of("ColorSpace"), PDFArray)
			.lookup(1, PDFRawStream)
		expect(decodePDFRawStream(profile).decode()).toEqual(sourceProfile)
		expect(
			decodePDFRawStream(readStream(photo.dict, PDFName.of("SMask"))).decode(),
		).toEqual(data.alpha)
		const colors = page.node
			.Resources()!
			.lookup(PDFName.of("ColorSpace"), PDFDict)
		expect(
			colors
				.keys()
				.map((key) =>
					colors.lookup(key, PDFArray).lookup(1, PDFName).decodeText(),
				),
		).toEqual(["Forest Green", "Violet"])
		for (const key of colors.keys())
			expect(
				decodePDFRawStream(
					colors
						.lookup(key, PDFArray)
						.lookup(2, PDFArray)
						.lookup(1, PDFRawStream),
				).decode(),
			).toEqual(sourceProfile)
		const intent = reader.catalog
			.lookup(PDFName.of("OutputIntents"), PDFArray)
			.lookup(0, PDFDict)
		expect(
			Buffer.from(
				decodePDFRawStream(
					readStream(intent, PDFName.of("DestOutputProfile")),
				).decode(),
			).equals(destinationProfile),
		).toBe(true)
		const preparation = await preparePdfForPrint(
			parsePdf(pdf.serialize()),
			printOptions,
		)
		const plates = await renderPdfPlateCoverage(preparation.document, {
			resolution: 72,
		})
		expect(plates.plates.map((p) => p.name)).toEqual([
			"Cyan",
			"Magenta",
			"Yellow",
			"Black",
			"Forest Green",
			"Violet",
		])
	},
)

it(
	"prepares the representative RGB JPEG/alpha label with reproducible source associations and six retained plates",
	{ timeout: 30_000 },
	async () => {
		const original = mixedColorDocument(),
			bytes = serializePdf(original),
			input = parsePdf(bytes)
		const first = await preparePdfForPrint(input, printOptions),
			second = await preparePdfForPrint(input, printOptions)
		const before = await readPdf(bytes),
			after = await readPdf(serializePdf(first.document))
		expect(after.pages).toEqual(before.pages)
		expect(after.pageCharacters).toEqual(before.pageCharacters)
		expect(after.pageFonts).toEqual(before.pageFonts)
		expect(
			Buffer.from(serializePdf(first.document)).equals(
				serializePdf(second.document),
			),
		).toBe(true)
		expect(first.report).toEqual(second.report)
		expect(
			Buffer.from(serializePdf(input)).equals(serializePdf(parsePdf(bytes))),
		).toBe(true)
		expect(first.report.groups).toHaveLength(1)
		expect(
			first.report.conversions.some(
				(c) =>
					c.location.includes("image /Photo") &&
					c.renderingIntent === "perceptual" &&
					c.source.startsWith("sha256:"),
			),
		).toBe(true)
		const reader = await PDFDocument.load(serializePdf(first.document)),
			page = reader.getPages()[0]!
		expect(page.getSize()).toEqual({ width: 360, height: 260 })
		const images = page.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict)
		const photo = readStream(images, images.keys()[0]!)
		expect(photo.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber()).toBe(
			809,
		)
		expect(photo.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber()).toBe(
			884,
		)
		expect(
			photo.dict.lookup(PDFName.of("ColorSpace"), PDFName).decodeText(),
		).toBe("DeviceCMYK")
		expect(
			Buffer.from(
				decodePDFRawStream(
					readStream(photo.dict, PDFName.of("SMask")),
				).decode(),
			).equals(mixedFixture("alpha.bin")),
		).toBe(true)
		const paints = await paintedFills(serializePdf(first.document))
		expect(paints.find((p) => p.paint === "text")).toEqual({
			paint: "text",
			space: "DeviceCMYK",
			components: [0, 0, 0, 1],
		})
		const plates = await renderPdfPlateCoverage(first.document, {
			resolution: 72,
		})
		expect(plates.plates.map((p) => p.name)).toEqual([
			"Cyan",
			"Magenta",
			"Yellow",
			"Black",
			"Forest Green",
			"Violet",
		])
	},
)

it("rejects absent intent, profile contradictions, and a request to silently preserve RGB source blending", async () => {
	const source = mixedColorDocument()
	await expect(
		preparePdfForPrint(source, {
			...printOptions,
			blending: "preserve-source",
		}),
	).rejects.toThrow(/Page 1.*RGB source blending/)
	await expect(
		preparePdfForPrint(source, {
			...printOptions,
			destinationProfile: undefined as never,
		}),
	).rejects.toThrow()
	await expect(
		preparePdfForPrint(source, { ...printOptions, spots: undefined as never }),
	).rejects.toThrow()
	await expect(
		preparePdfForPrint(source, { ...printOptions, gray: undefined as never }),
	).rejects.toThrow()
	const pdf = createPdfDocument()
	expect(() =>
		pdf.rgbImage({
			width: 1,
			height: 1,
			data: Uint8Array.of(0, 0, 0),
			alpha: Uint8Array.of(128),
			sourceProfile,
		}),
	).toThrow(/blendingSpace/)
	expect(() =>
		pdf.rgbImage({
			width: 1,
			height: 1,
			data: Uint8Array.of(0, 0, 0),
			sourceProfile: destinationProfile,
		}),
	).toThrow(/RGB source/)
})

it("accepts JPEG/PNG files for RGB handoff without destination conversion", () => {
	const jpeg = prepareRgbImage(mixedFixture("photo.jpg"), { sourceProfile })
	expect([jpeg.width, jpeg.height, jpeg.data.length]).toEqual([
		809,
		884,
		809 * 884 * 3,
	])
	expect(jpeg.sourceProfile).toEqual(sourceProfile)
	expect(jpeg.alpha).toBeUndefined()
})
