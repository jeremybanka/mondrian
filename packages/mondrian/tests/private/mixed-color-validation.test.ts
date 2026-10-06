import { expect, it } from "vite-plus/test"
import { readFileSync } from "node:fs"
import { zlibSync } from "fflate"
import {
	array,
	ascii,
	createPdfDocument,
	dictionary,
	name,
	hexString,
	nameBytes,
	rectangle,
	stream,
	rgb,
	separation,
} from "../../src/index.ts"
import type {
	PdfDictionaryEntries,
	PdfIndirectValue,
	PdfValue,
} from "../../src/index.ts"
import { preparePdfForPrint, prepareRgbImage } from "../../src/print.ts"
import { decodedPdfStream, readIccSpace } from "../../src/print/pdf-color.ts"
import { rawDocument } from "./fixtures/plates.ts"
import {
	destinationProfile,
	sourceProfile,
	printOptions,
} from "../public/fixtures/mixed-color/document.ts"

const resolve = (v: PdfValue | undefined): PdfIndirectValue | undefined =>
	v !== null && typeof v === "object" && v.kind === "reference" ? undefined : v
const fixture = (file: string) =>
	readFileSync(
		new URL(`../public/fixtures/print-images/${file}`, import.meta.url),
	)
const grayProfile = () => {
	const bytes = Uint8Array.from(sourceProfile),
		view = new DataView(bytes.buffer)
	bytes.set(new TextEncoder().encode("GRAY"), 16)
	for (let i = 0; i < view.getUint32(128); i++) {
		const at = 132 + i * 12
		if (new TextDecoder().decode(bytes.subarray(at, at + 4)) === "rTRC")
			bytes.set(new TextEncoder().encode("kTRC"), at)
	}
	return bytes
}

it("honors embedded RGB PNG profiles and preserves straight source alpha", () => {
	const p3 = prepareRgbImage(fixture("p3.png"))
	expect(
		Buffer.from(p3.sourceProfile).equals(fixture("DisplayP3-v4.icc")),
	).toBe(true)
	expect([...p3.alpha!]).toEqual([0, 64, 128, 255])
	expect(Array.from(p3.data.subarray(0, 3))).toEqual([210, 85, 35])
	expect(() => prepareRgbImage(fixture("untagged.png"))).toThrow(
		/sourceProfile/,
	)
	expect(() => prepareRgbImage(fixture("rgba.png"))).toThrow(/sourceProfile/)
	expect(() =>
		prepareRgbImage(fixture("rgba.png"), { sourceProfile: destinationProfile }),
	).toThrow(/RGB source/)
})

it("rejects contradictory authoring ICC, alpha, rendering-intent and blending descriptions", () => {
	const pdf = createPdfDocument({
		blendingSpace: { rgbProfile: sourceProfile },
	})
	const valid = {
		width: 1,
		height: 1,
		data: Uint8Array.of(0, 0, 0),
		sourceProfile,
	}
	expect(() => pdf.rgbImage({ ...valid, data: Uint8Array.of(0, 0) })).toThrow(
		/three bytes/,
	)
	expect(() => pdf.rgbImage({ ...valid, alpha: Uint8Array.of(0, 1) })).toThrow(
		/one byte/,
	)
	expect(() =>
		pdf.rgbImage({ ...valid, renderingIntent: "unknown" as never }),
	).toThrow(/rendering intent/)
	expect(() =>
		createPdfDocument({ version: "1.3", blendingSpace: "DeviceCMYK" }),
	).toThrow(/1.4/)
	expect(() =>
		createPdfDocument({ blendingSpace: { rgbProfile: destinationProfile } }),
	).toThrow(/RGB blending/)
	expect(() =>
		separation("Test ink", {
			type: "exponential",
			zero: rgb(1, 1, 1),
			full: rgb(0, 1, 0),
			sourceProfile: destinationProfile,
			exponent: 1,
		}),
	).toThrow(/profile-qualified/)
})

it.each([
	{ outputCondition: "" },
	{ untaggedRgb: destinationProfile },
	{ untaggedRgb: undefined },
	{ processNumbers: undefined },
	{ processNumbers: { sourceProfile, blackOnly: "preserve" } },
	{ gray: { sourceProfile } },
])(
	"requires complete, non-contradictory printing policies (%#)",
	async (change) => {
		await expect(
			preparePdfForPrint(
				rawDocument(() => ({ contents: [] })),
				{ ...printOptions, ...change } as never,
			),
		).rejects.toThrow()
	},
)

it("color-converts tagged grayscale using its embedded profile and an explicit grayscale policy", async () => {
	const gray = grayProfile()
	const source = rawDocument((objects) => ({
		resources: dictionary({
			ColorSpace: dictionary({
				Tone: array(name("ICCBased"), objects.add(stream({ N: 1 }, gray))),
			}),
		}),
		contents: [stream({}, ascii("/Tone cs 0.4 sc 0 0 80 80 re f"))],
	}))
	const result = await preparePdfForPrint(source, {
		...printOptions,
		gray: { sourceProfile: gray },
	})
	expect(result.report.conversions.every((c) => c.action === "convert")).toBe(
		true,
	)
	const untagged = await preparePdfForPrint(
		rawDocument(() => ({
			contents: [stream({}, ascii("0.4 g 0 0 80 80 re f"))],
		})),
		{ ...printOptions, gray: { sourceProfile: gray } },
	)
	expect(untagged.report.conversions[0]!.action).toBe("convert")
	expect(
		readIccSpace(
			array(name("ICCBased"), {
				kind: "reference",
				objectNumber: 1 as never,
				generation: 0 as never,
			}),
			(v) =>
				v !== null && typeof v === "object" && v.kind === "reference"
					? stream({ N: 1 }, gray)
					: resolve(v),
		)!.channels,
	).toBe(1)
})

it("rejects mismatched established CMYK profiles and explicitly retargets image samples without changing K-only pixels", async () => {
	const different = Uint8Array.from(destinationProfile)
	different[33] = different[33]! ^ 1
	const source = rawDocument((objects) => ({
		resources: dictionary({
			XObject: dictionary({
				Photo: objects.add(
					stream(
						{
							Subtype: name("Image"),
							Width: 2,
							Height: 1,
							ColorSpace: array(
								name("ICCBased"),
								objects.add(stream({ N: 4 }, different)),
							),
							BitsPerComponent: 8,
						},
						Uint8Array.of(0, 0, 0, 99, 32, 64, 128, 50),
					),
				),
			}),
		}),
		contents: [stream({}, ascii("q 80 0 0 80 0 0 cm /Photo Do Q"))],
	}))
	await expect(preparePdfForPrint(source, printOptions)).rejects.toThrow(
		/profile differs/,
	)
	const result = await preparePdfForPrint(source, {
		...printOptions,
		processNumbers: { sourceProfile: different, blackOnly: "preserve" },
	})
	const image = result.document.objects
		.map((o) => o.value)
		.find(
			(v) =>
				v !== null &&
				typeof v === "object" &&
				v.kind === "stream" &&
				v.entries.Subtype !== undefined,
		)!
	if (image === null || typeof image !== "object" || image.kind !== "stream")
		throw new Error("Expected image")
	expect(decodedPdfStream(image, resolve, 8).slice(0, 4)).toEqual(
		Uint8Array.of(0, 0, 0, 99),
	)
})

it("requires an explicit decision when native process paint's declared printing condition differs", async () => {
	const different = Uint8Array.from(destinationProfile)
	different[33] = different[33]! ^ 1
	const pdf = createPdfDocument({
		outputIntent: { profile: different, identifier: "Prior test condition" },
	})
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 80, 80),
			content: [
				pdf.graphics((g) =>
					g.cmykFill(0.2, 0.3, 0.4, 0.5).rectangle(0, 0, 80, 80).fill(),
				),
			],
		}),
	)
	await expect(preparePdfForPrint(pdf.compile(), printOptions)).rejects.toThrow(
		/Declared CMYK output profile differs/,
	)
})

it.each<PdfDictionaryEntries>([
	{ N: 4 },
	{ N: 3, Range: array(0, 0.5, 0, 1, 0, 1) },
	{ N: 3, Alternate: name("DeviceCMYK") },
	{ N: 3, Alternate: array(name("DeviceRGB")) },
])(
	"rejects ICC resource channel/range/alternate contradictions: %j",
	(entries) => {
		expect(() =>
			readIccSpace(
				array(name("ICCBased"), {
					kind: "reference",
					objectNumber: 1 as never,
					generation: 0 as never,
				}),
				(v) =>
					v !== null && typeof v === "object" && v.kind === "reference"
						? stream(entries, sourceProfile)
						: resolve(v),
			),
		).toThrow()
	},
)

it.each<PdfDictionaryEntries>([
	{ S: name("Other"), CS: name("DeviceRGB") },
	{ S: name("Transparency"), CS: name("DeviceRGB"), K: true },
	{ S: name("Transparency"), CS: name("DeviceRGB"), I: 1 },
	{ S: name("Transparency") },
	{ S: name("Transparency"), CS: name("DeviceGray") },
	{ S: name("Transparency"), CS: name("Unregistered") },
])(
	"rejects unsupported or uninterpreted page compositing descriptions: %j",
	(Group) => {
		const source = rawDocument(() => ({
			page: { Group: dictionary(Group) },
			contents: [stream({}, ascii("0 0 0 1 k 0 0 80 80 re f"))],
		}))
		return expect(preparePdfForPrint(source, printOptions)).rejects.toThrow(
			/Page 1/,
		)
	},
)

it("checks CMYK group profile associations and rejects untagged RGB blending without source interpretation", async () => {
	const different = Uint8Array.from(destinationProfile)
	different[33] = different[33]! ^ 1
	const source = rawDocument((objects) => ({
		page: {
			Group: dictionary({
				S: name("Transparency"),
				CS: array(name("ICCBased"), objects.add(stream({ N: 4 }, different))),
			}),
		},
		contents: [stream({}, ascii("0 0 0 1 k 0 0 80 80 re f"))],
	}))
	await expect(preparePdfForPrint(source, printOptions)).rejects.toThrow(
		/CMYK blending profile differs/,
	)
	const unknown = rawDocument(() => ({
		page: {
			Group: dictionary({ S: name("Transparency"), CS: name("DeviceRGB") }),
		},
		contents: [stream({}, ascii("0 0 0 1 k 0 0 80 80 re f"))],
	}))
	await expect(
		preparePdfForPrint(unknown, { ...printOptions, untaggedRgb: "reject" }),
	).rejects.toThrow(/RGB blending requires/)
})

it.each([
	"1.1 0 0 rg 0 0 80 80 re f",
	"1 2 Tr",
	"-1 Tr",
	"/DeviceRGB cs 0.1 sc 0 0 80 80 re f",
])(
	"rejects invalid process and text-mode descriptions before returning prepared data: %s",
	(content) => {
		return expect(
			preparePdfForPrint(
				rawDocument(() => ({ contents: [stream({}, ascii(content))] })),
				printOptions,
			),
		).rejects.toThrow(/Page 1/)
	},
)

it("preserves stroked live text with explicit conversion and text clipping modes", async () => {
	const source = rawDocument(() => ({
		resources: dictionary({
			Font: dictionary({
				F: dictionary({
					Type: name("Font"),
					Subtype: name("Type1"),
					BaseFont: name("Helvetica"),
				}),
			}),
		}),
		contents: [stream({}, ascii("BT /F 18 Tf 1 Tr 20 20 Td (Proof) Tj ET"))],
	}))
	const result = await preparePdfForPrint(source, printOptions)
	expect(
		result.report.conversions.some((c) =>
			c.location.includes("implicit stroke"),
		),
	).toBe(true)
})

it("requires supported XObject color/compositing semantics and diagnoses their resource names", async () => {
	const spot = array(
		name("Separation"),
		name("Test Ink"),
		name("DeviceRGB"),
		dictionary({
			FunctionType: 2,
			Domain: array(0, 1),
			C0: array(1, 1, 1),
			C1: array(0, 1, 0),
			N: 1,
		}),
	)
	const image = (entries: PdfDictionaryEntries) =>
		rawDocument((objects) => ({
			resources: dictionary({
				XObject: dictionary({
					Photo: objects.add(
						stream(
							{
								Subtype: name("Image"),
								Width: 1,
								Height: 1,
								BitsPerComponent: 8,
								ColorSpace: name("DeviceRGB"),
								...entries,
							},
							Uint8Array.of(1, 2, 3),
						),
					),
				}),
			}),
			contents: [stream({}, ascii("/Photo Do"))],
		}))
	await expect(
		preparePdfForPrint(image({ ColorSpace: spot }), printOptions),
	).rejects.toThrow(/Image \/Photo.*Separation images/)
	await expect(
		preparePdfForPrint(image({ Width: name("Unknown") }), printOptions),
	).rejects.toThrow(/Image \/Photo.*dimensions/)
	const form = rawDocument((objects) => ({
		resources: dictionary({
			XObject: dictionary({
				Layer: objects.add(
					stream(
						{
							Subtype: name("Form"),
							BBox: array(0, 0, 80, 80),
							Group: dictionary({
								S: name("Transparency"),
								CS: name("DeviceRGB"),
							}),
						},
						ascii("0 0 0 1 k 0 0 80 80 re f"),
					),
				),
			}),
		}),
		contents: [stream({}, ascii("/Layer Do"))],
	}))
	await expect(preparePdfForPrint(form, printOptions)).rejects.toThrow(
		/Form transparency/,
	)
	const other = rawDocument((objects) => ({
		resources: dictionary({
			XObject: dictionary({
				Other: objects.add(
					stream({ Subtype: name("PS") }, ascii("0 0 80 80 re fill")),
				),
			}),
		}),
		contents: [stream({}, ascii("/Other Do"))],
	}))
	await expect(preparePdfForPrint(other, printOptions)).rejects.toThrow(
		/XObject \/Other subtype/,
	)
})

it("rejects a recursive Form program instead of expanding it indefinitely", async () => {
	const source = rawDocument((objects) => {
		const form = objects.reserve<import("../../src/index.ts").PdfStream>()
		form.set(
			stream(
				{
					Subtype: name("Form"),
					BBox: array(0, 0, 80, 80),
					Resources: dictionary({ XObject: dictionary({ Loop: form.ref }) }),
				},
				ascii("/Loop Do"),
			),
		)
		return {
			resources: dictionary({ XObject: dictionary({ Loop: form.ref }) }),
			contents: [stream({}, ascii("/Loop Do"))],
		}
	})
	await expect(preparePdfForPrint(source, printOptions)).rejects.toThrow(
		/Cyclic.*Form/,
	)
})

it("reuses normalized image samples across repeated placements", async () => {
	const source = rawDocument((objects) => ({
		resources: dictionary({
			XObject: dictionary({
				Photo: objects.add(
					stream(
						{
							Subtype: name("Image"),
							Width: 1,
							Height: 1,
							ColorSpace: name("DeviceRGB"),
							BitsPerComponent: 8,
						},
						Uint8Array.of(80, 120, 180),
					),
				),
			}),
		}),
		contents: [
			stream(
				{},
				ascii("q 40 0 0 80 0 0 cm /Photo Do Q q 40 0 0 80 40 0 cm /Photo Do Q"),
			),
		],
	}))
	const result = await preparePdfForPrint(source, printOptions)
	expect(
		result.document.objects.filter(
			(o) =>
				o.value !== null &&
				typeof o.value === "object" &&
				o.value.kind === "stream" &&
				o.value.entries.Subtype !== undefined,
		),
	).toHaveLength(1)
	expect(result.report.conversions).toHaveLength(1)
})

it.each([
	"Q",
	"q 0 0 0 1 k 0 0 80 80 re f",
	"/UnknownIntent ri 0 0 0 1 k 0 0 80 80 re f",
])("rejects unbalanced or uninterpreted graphics state: %s", (content) => {
	return expect(
		preparePdfForPrint(
			rawDocument(() => ({ contents: [stream({}, ascii(content))] })),
			printOptions,
		),
	).rejects.toThrow(/Page 1/)
})

it("rejects ambiguous/malformed prior output intents and unsupported special color spaces", async () => {
	const source = rawDocument(() => ({ contents: [] }))
	for (const OutputIntents of [
		array(dictionary({}), dictionary({})),
		array(dictionary({ DestOutputProfile: 2 })),
	]) {
		const objects = source.objects.map((o) =>
			o.objectNumber === source.root.objectNumber &&
			o.value !== null &&
			typeof o.value === "object" &&
			o.value.kind === "dictionary"
				? { ...o, value: dictionary({ ...o.value.entries, OutputIntents }) }
				: o,
		)
		await expect(
			preparePdfForPrint({ ...source, objects }, printOptions),
		).rejects.toThrow(/output intents|profile stream/)
	}
	const special = rawDocument(() => ({
		resources: dictionary({
			ColorSpace: dictionary({
				Index: array(
					name("Indexed"),
					name("DeviceRGB"),
					0,
					hexString(Uint8Array.of(0, 0, 0)),
				),
			}),
		}),
		contents: [stream({}, ascii("0 0 0 1 k 0 0 80 80 re f"))],
	}))
	await expect(preparePdfForPrint(special, printOptions)).rejects.toThrow(
		/Unsupported print color space/,
	)
	const malformed = rawDocument(() => ({
		resources: dictionary({ ExtGState: dictionary({ Invalid: 2 }) }),
		contents: [stream({}, ascii("/Invalid gs"))],
	}))
	await expect(preparePdfForPrint(malformed, printOptions)).rejects.toThrow(
		/resource dictionary/,
	)
})

it("bounds profile decoding and accepts an ordinary one-filter array", () => {
	const encoded = stream(
		{ Filter: array(name("FlateDecode")) },
		zlibSync(sourceProfile),
	)
	expect(decodedPdfStream(encoded, resolve, 1000)).toEqual(sourceProfile)
	expect(() => decodedPdfStream(encoded, resolve, 10)).toThrow()
	expect(() =>
		decodedPdfStream(stream({}, sourceProfile), resolve, 10),
	).toThrow(/byte limit/)
	expect(() =>
		decodedPdfStream(
			stream(
				{ Filter: array(name("FlateDecode"), name("FlateDecode")) },
				sourceProfile,
			),
			resolve,
			1000,
		),
	).toThrow(/single FlateDecode/)
	expect(() =>
		decodedPdfStream(
			stream({ Filter: name("DCTDecode") }, sourceProfile),
			resolve,
			1000,
		),
	).toThrow(/stream filter/)
	expect(() =>
		decodedPdfStream(
			stream({ DecodeParms: dictionary({}) }, sourceProfile),
			resolve,
			1000,
		),
	).toThrow(/DecodeParms/)
	expect(() => readIccSpace(array(name("ICCBased"), null), resolve)).toThrow(
		/profile stream/,
	)
})

it("preserves byte-keyed color resources, aliases, ri scopes, and stroked text color state", async () => {
	const source = rawDocument((objects) => ({
		resources: dictionary({
			ColorSpace: dictionary(
				{},
				[nameBytes(Uint8Array.of(82, 71, 66)), name("Alias")],
				[
					nameBytes(new TextEncoder().encode("Alias")),
					array(name("ICCBased"), objects.add(stream({ N: 3 }, sourceProfile))),
				],
			),
		}),
		contents: [
			stream(
				{},
				ascii(
					"/RGB cs /Perceptual ri 0.2 0.3 0.4 sc 0 0 80 80 re f /DeviceCMYK CS 0 0 0 0.25 SC 0 0 m 80 80 l S",
				),
			),
		],
	}))
	const result = await preparePdfForPrint(source, printOptions)
	expect(
		result.report.conversions.some((c) => c.renderingIntent === "perceptual"),
	).toBe(true)
})

it.each<PdfDictionaryEntries>([
	{ DefaultRGB: array(name("DeviceRGB")) },
	{ Loop: name("Loop") },
	{ Pattern: array(name("Pattern")) },
])(
	"rejects default replacements, cyclic aliases, and unsupported spaces: %j",
	(colors) => {
		const source = rawDocument(() => ({
			resources: dictionary({ ColorSpace: dictionary(colors) }),
			contents: [stream({}, ascii("0 0 0 1 k 0 0 80 80 re f"))],
		}))
		return expect(preparePdfForPrint(source, printOptions)).rejects.toThrow(
			/Page 1/,
		)
	},
)
