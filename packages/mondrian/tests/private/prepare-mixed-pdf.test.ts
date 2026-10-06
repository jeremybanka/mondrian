import { expect, it } from "vite-plus/test"
import {
	array,
	ascii,
	dictionary,
	name,
	stream,
	serializePdf,
	parsePdf,
	createPdfDocument,
	rectangle,
} from "../../src/index.ts"
import { preparePdfForPrint } from "../../src/print.ts"
import { rawDocument } from "./fixtures/plates.ts"
import {
	printOptions,
	sourceProfile,
	destinationProfile,
} from "../public/fixtures/mixed-color/document.ts"
import type { PdfDocument } from "../../src/index.ts"
import { renderPdfPlateCoverage } from "../../src/testing.ts"
import { readPlateImage } from "../../src/testing/plate-image.ts"

function preparedRaster(document: PdfDocument) {
	const values = new Map(
		document.objects.map((object) => [object.objectNumber, object.value]),
	)
	const image = document.objects
		.map((object) => object.value)
		.find(
			(value) =>
				value !== null &&
				typeof value === "object" &&
				value.kind === "stream" &&
				value.entries.ColorSpace !== null &&
				typeof value.entries.ColorSpace === "object" &&
				value.entries.ColorSpace.kind === "name" &&
				value.entries.ColorSpace.value === "DeviceCMYK",
		)
	if (image === null || typeof image !== "object" || image.kind !== "stream")
		throw new Error("Expected prepared CMYK image")
	return readPlateImage(image, (value) =>
		value !== null && typeof value === "object" && value.kind === "reference"
			? values.get(value.objectNumber)
			: value,
	)
}

it("keeps already prepared CMYK samples and source alpha while associating their declared destination", async () => {
	const data = Uint8Array.of(0, 0, 0, 99, 32, 64, 128, 50),
		alpha = Uint8Array.of(64, 255)
	const pdf = createPdfDocument({
		outputIntent: {
			profile: destinationProfile,
			identifier: "Test destination",
		},
	})
	const image = pdf.image({
		width: 2,
		height: 1,
		data,
		alpha,
		destinationProfile,
	})
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 80, 80),
			content: [pdf.graphics((g) => g.drawImage(image, 0, 0, 80, 80))],
		}),
	)
	const preserved = await preparePdfForPrint(pdf.compile(), printOptions)
	expect(preparedRaster(preserved.document).data).toEqual(data)
	expect(preparedRaster(preserved.document).alpha!.data).toEqual(alpha)
	const tagged = rawDocument((objects) => ({
		resources: dictionary({
			XObject: dictionary({
				Photo: objects.add(
					stream(
						{
							Subtype: name("Image"),
							Width: 2,
							Height: 1,
							BitsPerComponent: 8,
							ColorSpace: array(
								name("ICCBased"),
								objects.add(stream({ N: 4 }, destinationProfile)),
							),
						},
						data,
					),
				),
			}),
		}),
		contents: [stream({}, ascii("q 80 0 0 80 0 0 cm /Photo Do Q"))],
	}))
	expect(
		preparedRaster((await preparePdfForPrint(tagged, printOptions)).document)
			.data,
	).toEqual(data)
}, 30_000)

it("applies explicit gray-to-black image interpretation without changing its independent alpha", async () => {
	const alpha = Uint8Array.of(0, 64, 128, 255)
	const source = rawDocument((objects) => {
		const mask = objects.add(
			stream(
				{
					Subtype: name("Image"),
					Width: 4,
					Height: 1,
					BitsPerComponent: 8,
					ColorSpace: name("DeviceGray"),
				},
				alpha,
			),
		)
		return {
			resources: dictionary({
				XObject: dictionary({
					Gray: objects.add(
						stream(
							{
								Subtype: name("Image"),
								Width: 4,
								Height: 1,
								BitsPerComponent: 8,
								ColorSpace: name("DeviceGray"),
								SMask: mask,
							},
							Uint8Array.of(0, 64, 128, 255),
						),
					),
				}),
			}),
			contents: [stream({}, ascii("q 80 0 0 80 0 0 cm /Gray Do Q"))],
		}
	})
	const raster = preparedRaster(
		(await preparePdfForPrint(source, printOptions)).document,
	)
	expect(raster.data).toEqual(
		Uint8Array.of(0, 0, 0, 255, 0, 0, 0, 191, 0, 0, 0, 127, 0, 0, 0, 0),
	)
	expect(raster.alpha!.data).toEqual(alpha)
})

function pageProgram(document: PdfDocument): string {
	return document.objects
		.map((o) => o.value)
		.filter(
			(v): v is import("../../src/index.ts").PdfStream =>
				v !== null &&
				typeof v === "object" &&
				v.kind === "stream" &&
				v.entries.Subtype === undefined &&
				v.entries.N === undefined &&
				v.entries.Length1 === undefined,
		)
		.map((v) => Buffer.from(v.data).toString("latin1"))
		.join("\n")
}

it("preserves precise CMYK/gray numbers and inherited default black under the explicit policy", async () => {
	const source = rawDocument(() => ({
		contents: [
			stream(
				{},
				ascii(
					"0 0 20 80 re f 0.123456789 g 20 0 20 80 re f 0 0 0 0.987654321 k 40 0 20 80 re f /DeviceCMYK cs 60 0 20 80 re f",
				),
			),
		],
	}))
	const prepared = await preparePdfForPrint(source, printOptions)
	const text = pageProgram(prepared.document)
	expect(text).toContain("0 0 0 1 k")
	expect(text).toContain("0 0 0 0.876543211 k")
	expect(text).toContain("0 0 0 0.987654321 k")
	await expect(
		preparePdfForPrint(source, { ...printOptions, gray: "reject" }),
	).rejects.toThrow(/implicit fill/)
})

it("handles named RGB paint, initial color-space values, and rendering-intent scoping", async () => {
	const source = rawDocument((objects) => ({
		resources: dictionary({
			ColorSpace: dictionary({
				Photo: array(
					name("ICCBased"),
					objects.add(stream({ N: 3 }, sourceProfile)),
				),
			}),
			ExtGState: dictionary({ Color: dictionary({ RI: name("Perceptual") }) }),
		}),
		contents: [
			stream(
				{},
				ascii(
					"/Photo cs 0 0 20 80 re f q /Color gs 0.7 0.2 0.1 sc 20 0 20 80 re f Q 0.2 0.3 0.4 sc 40 0 20 80 re f",
				),
			),
		],
	}))
	const honor = await preparePdfForPrint(source, printOptions),
		override = await preparePdfForPrint(source, {
			...printOptions,
			objectIntents: "override",
		})
	expect(honor.report.conversions.map((c) => c.renderingIntent)).toEqual([
		"relative-colorimetric",
		"perceptual",
		"relative-colorimetric",
	])
	expect(
		override.report.conversions.every(
			(c) => c.renderingIntent === "relative-colorimetric",
		),
	).toBe(true)
	expect(() => parsePdf(serializePdf(override.document))).not.toThrow()
})

it("normalizes Form content with inherited ICC interpretation without changing transforms or clipping", async () => {
	const source = rawDocument((objects) => ({
		resources: dictionary({
			ColorSpace: dictionary({
				RGB: array(
					name("ICCBased"),
					objects.add(stream({ N: 3 }, sourceProfile)),
				),
			}),
			XObject: dictionary({
				Mark: objects.add(
					stream(
						{
							Type: name("XObject"),
							Subtype: name("Form"),
							BBox: array(0, 0, 80, 80),
						},
						ascii("0.2 0.3 0.4 sc 0 0 80 80 re f"),
					),
				),
			}),
		}),
		contents: [
			stream({}, ascii("/RGB cs q 2 0 0 1 0 0 cm 0 0 20 80 re W n /Mark Do Q")),
		],
	}))
	const prepared = await preparePdfForPrint(source, printOptions)
	expect(pageProgram(prepared.document)).toContain("2 0 0 1 0 0 cm")
	expect(pageProgram(prepared.document)).toContain("0 0 20 80 re")
	const plates = await renderPdfPlateCoverage(prepared.document, {
		resolution: 72,
	})
	expect(plates.plates[0]!.pages[0]!.samples[40 * 80 + 60]).toBe(255)
	expect(plates.plates[0]!.pages[0]!.samples[40 * 80 + 10]).toBeLessThan(255)
})

it("resolves a resource-less nested Form against its page rather than its enclosing Form", async () => {
	const source = rawDocument((objects) => {
		const child = objects.add(
			stream(
				{ Subtype: name("Form"), BBox: array(0, 0, 80, 80) },
				ascii("/RGB cs 0.2 0.3 0.4 sc 0 0 80 80 re f"),
			),
		)
		const parent = objects.add(
			stream(
				{
					Subtype: name("Form"),
					BBox: array(0, 0, 80, 80),
					Resources: dictionary({
						ColorSpace: dictionary({ RGB: name("DeviceCMYK") }),
						XObject: dictionary({ Child: child }),
					}),
				},
				ascii("/Child Do"),
			),
		)
		return {
			resources: dictionary({
				ColorSpace: dictionary({
					RGB: array(
						name("ICCBased"),
						objects.add(stream({ N: 3 }, sourceProfile)),
					),
				}),
				XObject: dictionary({ Parent: parent }),
			}),
			contents: [stream({}, ascii("/Parent Do"))],
		}
	})
	const prepared = await preparePdfForPrint(source, printOptions)
	expect(
		prepared.report.conversions.every((c) => c.source.startsWith("sha256:")),
	).toBe(true)
	const plates = await renderPdfPlateCoverage(prepared.document, {
		resolution: 72,
	})
	expect(plates.plates[0]!.pages[0]!.samples[40 * 80 + 40]).toBeLessThan(255)
})

it("retargets process colors only with source interpretation while preserving every K-only text value", async () => {
	const source = rawDocument(() => ({
		contents: [
			stream(
				{},
				ascii(
					"0 0 0 0.876543211 k 0 0 40 80 re f 0.3 0.4 0.5 0.6 k 40 0 40 80 re f",
				),
			),
		],
	}))
	const prepared = await preparePdfForPrint(source, {
		...printOptions,
		processNumbers: {
			sourceProfile: destinationProfile,
			blackOnly: "preserve",
		},
	})
	expect(pageProgram(prepared.document)).toContain("0 0 0 0.876543211 k")
	expect(prepared.report.conversions.some((c) => c.action === "convert")).toBe(
		true,
	)
})

it("snapshots caller data before asynchronous conversion and prunes obsolete RGB samples", async () => {
	const profile = Uint8Array.from(sourceProfile),
		destination = Uint8Array.from(destinationProfile)
	const source = rawDocument((objects) => ({
		resources: dictionary({
			ColorSpace: dictionary({
				RGB: array(name("ICCBased"), objects.add(stream({ N: 3 }, profile))),
			}),
		}),
		contents: [stream({}, ascii("/RGB cs 0.2 0.3 0.4 sc 0 0 80 80 re f"))],
	}))
	const pending = preparePdfForPrint(source, {
		...printOptions,
		destinationProfile: destination,
	})
	profile.fill(0)
	destination.fill(0)
	const prepared = await pending
	expect(prepared.report.conversions[0]!.source).toMatch(/^sha256:/)
	expect(
		prepared.document.objects.some(
			(o) =>
				o.value !== null &&
				typeof o.value === "object" &&
				o.value.kind === "stream" &&
				o.value.entries.N === 3,
		),
	).toBe(false)
})

it("rejects an aggregate image decode budget before allocating a declared raster", async () => {
	const source = rawDocument((objects) => ({
		resources: dictionary({
			XObject: dictionary({
				Photo: objects.add(
					stream(
						{
							Subtype: name("Image"),
							Width: 1000,
							Height: 1000,
							ColorSpace: name("DeviceRGB"),
							BitsPerComponent: 8,
						},
						new Uint8Array(),
					),
				),
			}),
		}),
		contents: [stream({}, ascii("/Photo Do"))],
	}))
	await expect(
		preparePdfForPrint(source, { ...printOptions, maxDecodedImageBytes: 1 }),
	).rejects.toThrow(/Image \/Photo.*maxDecodedImageBytes/)
	await expect(
		preparePdfForPrint(source, { ...printOptions, maxDecodedImageBytes: NaN }),
	).rejects.toThrow(/positive integer/)
})

it.each([
	"/Missing cs 0 0 80 80 re f",
	"0 0 0 rg 0 0 80 80 re f",
	"0 0 0 1 k /Multiply gs 0 0 80 80 re f",
])(
	"fails with page/object context for unsupported or uninterpreted input: %s",
	async (content) => {
		const source = rawDocument(() => ({
			resources: dictionary({
				ExtGState: dictionary({
					Multiply: dictionary({ BM: name("Multiply") }),
				}),
			}),
			contents: [stream({}, ascii(content))],
		}))
		await expect(
			preparePdfForPrint(source, { ...printOptions, untaggedRgb: "reject" }),
		).rejects.toThrow(/Page 1/)
	},
)
