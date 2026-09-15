import { describe, expect, it } from "vite-plus/test"
import type {
	PdfColorContent,
	PdfDictionary,
	PdfDocument,
	PdfGraphicsBuilder,
	PdfPageDictionary,
	PdfPagesDictionary,
	PdfProcessColor,
	PdfVersion,
} from "../src/index.ts"
import {
	array,
	bindColorContent,
	cmyk,
	colorContent,
	createPdfDocument,
	createPdfObjectBuilder,
	dictionary,
	fillColor,
	gray,
	name,
	pageSizes,
	paintState,
	rgb,
	separation,
	serializePdf,
	spot,
	strokeColor,
} from "../src/index.ts"

const orange = separation("Brand Orange / #1", {
	type: "exponential",
	zero: cmyk(0, 0, 0, 0),
	full: cmyk(0, 0.66, 1, 0),
	exponent: 1,
})
const blue = separation("Brand Blue", {
	type: "exponential",
	zero: rgb(1, 1, 1),
	full: rgb(0, 0.2, 0.8),
	exponent: 2,
})
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const body = (document: PdfDocument): string => decode(serializePdf(document))

function lowLevel(
	contents: readonly PdfColorContent[],
	version: PdfVersion = "1.7",
): PdfDocument {
	const objects = createPdfObjectBuilder()
	const bound = bindColorContent(objects, contents)
	const pages = objects.reserve<PdfPagesDictionary>()
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 300, 300),
			Resources: bound.resources,
			Contents: objects.add(bound.stream),
		}) satisfies PdfPageDictionary,
	)
	pages.set(dictionary({ Type: name("Pages"), Count: 1, Kids: array(page) }))
	const root = objects.add(
		dictionary({ Type: name("Catalog"), Pages: pages.ref }),
	)
	return objects.build({ root, version })
}

function graphics(
	callback: (g: PdfGraphicsBuilder) => void,
	version: PdfVersion = "1.7",
): PdfDocument {
	const pdf = createPdfDocument({ version })
	pdf.setPages(
		pdf.page({ mediaBox: pageSizes.letter, content: [pdf.graphics(callback)] }),
	)
	return pdf.compile()
}

describe("shared print colors", () => {
	it("preserves normalized gray, RGB, every CMYK channel, K-only black, fills and strokes", () => {
		const document = graphics((g) =>
			g
				.grayFill(0.25)
				.grayStroke(0.75)
				.rgbFill(0.1, 0.2, 0.3)
				.rgbStroke(1, 0, 0)
				.cmykFill(0.123456789, 0.2, 0.3, 0.4)
				.cmykStroke(0, 0, 0, 1)
				.rectangle(10, 10, 30, 30)
				.fillAndStroke(),
		)
		const content = body(document)
		for (const command of [
			"0.25 g",
			"0.75 G",
			"0.1 0.2 0.3 rg",
			"1 0 0 RG",
			"0.123456789 0.2 0.3 0.4 k",
			"0 0 0 1 K",
		])
			expect(content).toContain(command)
	})

	it("uses identical paint encoding for both workflows", () => {
		const semantic = graphics((g) =>
			g
				.fillColor(cmyk(0, 0.66, 1, 0))
				.strokeColor(spot(orange, 0.5))
				.paintState({
					fillOverprint: true,
					strokeOverprint: false,
					overprintMode: 1,
				}),
		)
		const low = lowLevel([
			colorContent([
				fillColor(cmyk(0, 0.66, 1, 0)),
				strokeColor(spot(orange, 0.5)),
				paintState({
					fillOverprint: true,
					strokeOverprint: false,
					overprintMode: 1,
				}),
			]),
		])
		const content = (d: PdfDocument) =>
			d.objects.flatMap(({ value }) =>
				value !== null && typeof value === "object" && value.kind === "stream"
					? [decode(value.data)]
					: [],
			)
		expect(content(semantic)).toEqual(content(low))
	})

	it("emits two real Separation resources and tint transforms, with repeated ink reuse", () => {
		const document = graphics((g) => {
			for (const tint of [0, 0.25, 0.5, 0.75, 1])
				g.spotFill(orange, tint)
					.spotStroke(blue, tint)
					.rectangle(0, 0, 10, 10)
					.fillAndStroke()
			g.spotFill(separation(orange.name, orange.tintTransform), 1)
		})
		const value = body(document)
		expect(value.match(/\/Separation /gu)).toHaveLength(2)
		expect(value).toContain("/Brand#20Orange#20#2F#20#231 /DeviceCMYK")
		expect(value).toContain("/FunctionType 2")
		expect(value).toContain("/C0 [0 0 0 0]")
		expect(value).toContain("/C1 [0 0.66 1 0]")
		expect(value).toContain("/Domain [0 1]")
		expect(value).toContain("/Range [0 1 0 1 0 1 0 1]")
		expect(value).toContain("/N 2")
		for (const tint of [0, 0.25, 0.5, 0.75, 1]) {
			expect(value).toContain(`/CS0 cs\n${tint} scn`)
			expect(value).toContain(`/CS1 CS\n${tint} SCN`)
		}
		expect(value).not.toContain("0 0.66 1 0 k")
	})

	it("supports a gray alternate and preserves exact case-sensitive ink identities", () => {
		const ink = separation("gray ink", {
			type: "exponential",
			zero: gray(1),
			full: gray(0.2),
			exponent: 0.5,
		})
		const result = body(
			graphics((g) =>
				g
					.spotFill(ink, 0.25)
					.spotFill(separation("Gray ink", ink.tintTransform), 1),
			),
		)
		expect(result.match(/\/Separation /gu)).toHaveLength(2)
		expect(result).toContain("/DeviceGray")
		expect(result).toContain("/N 0.5")
	})

	it("paints native text in process and spot colors and scopes its state", () => {
		const pdf = createPdfDocument()
		const font = pdf.standardFont("Helvetica")
		pdf.setPages(
			pdf.page({
				mediaBox: pageSizes.letter,
				content: [
					pdf.text((t) =>
						t
							.font(font, 12)
							.cmykFill(0, 0, 0, 1)
							.spotStroke(orange, 0.5)
							.renderingMode(2)
							.show("Native text"),
					),
					pdf.text((t) => t.font(font, 12).show("Default paint")),
				],
			}),
		)
		const value = decode(pdf.serialize())
		expect(value).toContain(
			"q\nBT\n/F0 12 Tf\n0 0 0 1 k\n/CS0 CS\n0.5 SCN\n2 Tr\n(Native text) Tj\nET\nQ\n/F0 12 Tf\nq\nBT",
		)
	})

	it("encodes complete, independent overprint/knockout states and deduplicates them", () => {
		const document = graphics((g) => {
			g.paintState({
				fillOverprint: true,
				strokeOverprint: false,
				overprintMode: 1,
			})
			g.paintState({
				fillOverprint: false,
				strokeOverprint: true,
				overprintMode: 0,
			})
			g.paintState({
				fillOverprint: false,
				strokeOverprint: false,
				overprintMode: 0,
			})
			g.paintState({
				fillOverprint: true,
				strokeOverprint: false,
				overprintMode: 1,
				fillOpacity: 1,
				blendMode: "Normal",
			})
		})
		const value = body(document)
		expect(value.match(/\/Type \/ExtGState/gu)).toHaveLength(3)
		expect(value).toContain(
			"/op true /OP false /OPM 1 /ca 1 /CA 1 /BM /Normal /SMask /None",
		)
		expect(value).toContain("/op false /OP true /OPM 0")
		expect(value).toContain("/op false /OP false /OPM 0")
		expect(value).toContain("q\n/GS0 gs\n/GS1 gs\n/GS2 gs\n/GS0 gs\nQ")
	})

	it("reuses cached descriptions across fresh graphs, rebinding resource names and references", () => {
		const cached = colorContent([
			fillColor(spot(orange, 1)),
			"10 10 20 20 re f",
		])
		const first = serializePdf(lowLevel([cached]))
		expect(serializePdf(lowLevel([cached]))).toEqual(first)
		const reordered = body(
			lowLevel([colorContent([fillColor(spot(blue, 1))]), cached]),
		)
		expect(reordered).toContain("/CS1 cs\n1 scn\n10 10 20 20 re f")
		const changed = separation(orange.name, {
			...orange.tintTransform,
			full: cmyk(0, 0.5, 1, 0),
		})
		const replacement = colorContent([
			fillColor(spot(changed, 1)),
			"10 10 20 20 re f",
		])
		expect(serializePdf(lowLevel([replacement]))).not.toEqual(first)
		expect(serializePdf(lowLevel([cached]))).toEqual(first)
		expect(() => lowLevel([cached, replacement])).toThrow(
			"Conflicting definitions",
		)
	})

	it("copies caller data before caching and compiling", () => {
		const components: [number, number, number, number] = [0, 0.66, 1, 0]
		const color: PdfProcessColor = { space: "DeviceCMYK", components }
		const parts = [fillColor(color), "10 10 20 20 re f"]
		const cached = colorContent(parts)
		components[1] = 0
		parts.length = 0
		expect(body(lowLevel([cached]))).toContain("0 0.66 1 0 k")
		expect(Object.isFrozen(orange.tintTransform.full.components)).toBe(true)
	})

	it("detects conflicting ink definitions across pages and binding scopes", () => {
		const conflict = separation(orange.name, {
			...orange.tintTransform,
			exponent: 2,
		})
		const pdf = createPdfDocument()
		pdf.setPages(
			...([orange, conflict].map((ink) =>
				pdf.page({
					mediaBox: pageSizes.letter,
					content: [pdf.graphics((g) => g.spotFill(ink, 1))],
				}),
			) as [ReturnType<typeof pdf.page>, ReturnType<typeof pdf.page>]),
		)
		expect(() => pdf.compile()).toThrow("Conflicting definitions")
		const objects = createPdfObjectBuilder()
		bindColorContent(objects, [colorContent([fillColor(spot(orange, 1))])])
		expect(() =>
			bindColorContent(objects, [
				colorContent([strokeColor(spot(conflict, 1))]),
			]),
		).toThrow("Conflicting definitions")
	})

	it.each([NaN, Infinity, -Infinity, -0.01, 1.01])(
		"rejects invalid components and tints: %s",
		(value) => {
			for (const make of [
				() => rgb(value, 0, 0),
				() => gray(value),
				() => cmyk(0, 0, 0, value),
				() => spot(orange, value),
			])
				expect(make).toThrow()
			expect(() => graphics((g) => g.cmykStroke(value, 0, 0, 0))).toThrow()
			expect(() =>
				colorContent([
					{
						op: "fillColor",
						color: { space: "DeviceRGB", components: [0, value, 0] },
					},
				]),
			).toThrow()
		},
	)

	it("rejects malformed descriptions, arity, reserved names, and transparency", () => {
		for (const color of [
			null,
			{ space: "DeviceRGB", components: [0, 1] },
			{ space: "DeviceCMYK", components: [0, 0, 0, 0, 0] },
			{ space: "DeviceN", components: [1] },
			{ space: "DeviceGray", components: [0], alpha: 0.5 },
		])
			expect(() => fillColor(color as never)).toThrow()
		for (const inkName of [
			"",
			"All",
			"None",
			"Cyan",
			"Magenta",
			"Yellow",
			"Black",
			"NUL\0",
			"非ASCII",
		])
			expect(() => separation(inkName, orange.tintTransform)).toThrow()
		for (const transform of [
			{ ...orange.tintTransform, type: "sampled" },
			{ ...orange.tintTransform, zero: rgb(1, 1, 1) },
			{ ...orange.tintTransform, exponent: 0 },
			{ ...orange.tintTransform, exponent: NaN },
			{ ...orange.tintTransform, domain: [0, 1, 0, 1] },
		])
			expect(() => separation("Ink", transform as never)).toThrow()
		for (const state of [
			null,
			{},
			{ fillOverprint: true, strokeOverprint: false, overprintMode: 2 },
			{
				fillOverprint: true,
				strokeOverprint: false,
				overprintMode: 1,
				fillOpacity: 0.5,
			},
			{
				fillOverprint: false,
				strokeOverprint: false,
				overprintMode: 0,
				strokeOpacity: 0.5,
			},
			{
				fillOverprint: false,
				strokeOverprint: false,
				overprintMode: 0,
				blendMode: "Multiply",
			},
			{
				fillOverprint: false,
				strokeOverprint: false,
				overprintMode: 0,
				softMask: {},
			},
		])
			expect(() => paintState(state as never)).toThrow()
		expect(() => spot({} as never, 1)).toThrow("Separation")
		expect(() => colorContent([{} as never])).toThrow("Unknown")
		expect(() => colorContent(["é"])).toThrow()
		expect(() =>
			bindColorContent(createPdfObjectBuilder(), [{} as never]),
		).toThrow("Unknown")
		expect(() =>
			createPdfDocument().text((t) => t.renderingMode(8 as never)),
		).toThrow("rendering mode")
	})

	it("preserves callback lifetimes for the shared painting surface", () => {
		let captured: PdfGraphicsBuilder | undefined
		graphics((g) => {
			captured = g
		})
		expect(() => captured?.spotFill(orange, 1)).toThrow("outside its callback")
	})

	it("rejects foreign and unresolved resources in bound content", () => {
		const foreign = bindColorContent(createPdfObjectBuilder(), [
			colorContent([fillColor(spot(orange, 1))]),
		])
		for (const useForeign of [true, false]) {
			const objects = createPdfObjectBuilder()
			const resources = useForeign
				? foreign.resources
				: dictionary({
						ColorSpace: dictionary({
							CS0: objects.reserve<PdfDictionary>().ref,
						}),
					})
			const pages = objects.reserve<PdfPagesDictionary>()
			const page = objects.add(
				dictionary({
					Type: name("Page"),
					Parent: pages.ref,
					MediaBox: array(0, 0, 100, 100),
					Resources: resources,
					Contents: objects.add(foreign.stream),
				}) satisfies PdfPageDictionary,
			)
			pages.set(
				dictionary({ Type: name("Pages"), Count: 1, Kids: array(page) }),
			)
			const root = objects.add(
				dictionary({ Type: name("Catalog"), Pages: pages.ref }),
			)
			expect(() => objects.build({ root })).toThrow()
		}
	})

	it("rejects omitted or mismatched bound resources and accepts inherited scope with content arrays", () => {
		for (const mode of ["missing", "mismatched", "inherited"] as const) {
			const objects = createPdfObjectBuilder()
			const bound = bindColorContent(objects, [
				colorContent([
					fillColor(spot(orange, 1)),
					paintState({
						fillOverprint: true,
						strokeOverprint: false,
						overprintMode: 1,
					}),
				]),
			])
			const other = bindColorContent(objects, [
				colorContent([fillColor(spot(blue, 1))]),
			])
			const pages = objects.reserve<PdfPagesDictionary>()
			const page = objects.add(
				dictionary({
					Type: name("Page"),
					Parent: pages.ref,
					MediaBox: array(0, 0, 100, 100),
					...(mode === "inherited"
						? {}
						: {
								Resources:
									mode === "missing" ? dictionary({}) : other.resources,
							}),
					Contents: array(objects.add(bound.stream)),
				}) satisfies PdfPageDictionary,
			)
			pages.set(
				dictionary({
					Type: name("Pages"),
					Count: 1,
					Kids: array(page),
					...(mode === "inherited"
						? { Resources: objects.add(bound.resources) }
						: {}),
				}),
			)
			const root = objects.add(
				dictionary({ Type: name("Catalog"), Pages: pages.ref }),
			)
			if (mode === "inherited")
				expect(() => objects.build({ root })).not.toThrow()
			else
				expect(() => objects.build({ root })).toThrow(
					"bound PDF color resource",
				)
		}
	})

	it("rejects reusing a bound stream with newly created resources from a different document", () => {
		const cached = colorContent([fillColor(spot(orange, 1))])
		const foreign = bindColorContent(createPdfObjectBuilder(), [cached])
		const objects = createPdfObjectBuilder()
		const local = bindColorContent(objects, [cached])
		const pages = objects.reserve<PdfPagesDictionary>()
		const page = objects.add(
			dictionary({
				Type: name("Page"),
				Parent: pages.ref,
				MediaBox: array(0, 0, 100, 100),
				Resources: local.resources,
				Contents: objects.add(foreign.stream),
			}) satisfies PdfPageDictionary,
		)
		pages.set(dictionary({ Type: name("Pages"), Count: 1, Kids: array(page) }))
		const root = objects.add(
			dictionary({ Type: name("Catalog"), Pages: pages.ref }),
		)
		expect(() => objects.build({ root })).toThrow(
			"bind the cached fragment again",
		)
	})

	it("gates version-dependent color resources in both builders", () => {
		expect(() => graphics((g) => g.cmykFill(0, 0, 0, 1), "1.0")).not.toThrow()
		expect(() => graphics((g) => g.spotFill(orange, 1), "1.2")).toThrow(
			"PDF 1.3",
		)
		expect(() =>
			lowLevel([colorContent([fillColor(spot(orange, 1))])], "1.2"),
		).toThrow("PDF 1.3")
		expect(() =>
			graphics(
				(g) =>
					g.paintState({
						fillOverprint: false,
						strokeOverprint: false,
						overprintMode: 0,
					}),
				"1.3",
			),
		).toThrow("PDF 1.4")
	})
})
