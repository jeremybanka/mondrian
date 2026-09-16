import "../../src/vitest.ts"
import { describe, expect, it } from "vite-plus/test"
import { deflateSync } from "node:zlib"
import type {
	PdfDictionary,
	PdfObjectBuilder,
	PdfReference,
	PdfPagesDictionary,
	PdfStream,
	PdfVersion,
} from "../../src/index.ts"
import {
	array,
	ascii,
	bindColorContent,
	colorContent,
	compressColorContent,
	formColorContent,
	createPdfObjectBuilder,
	dictionary,
	fillColor,
	name,
	rgb,
	separation,
	serializePdf,
	spot,
	stream,
	reference,
	generationNumber,
	validatePdf,
	paintState,
	nameBytes,
	dictionaryEntry,
} from "../../src/index.ts"
import { renderPdf } from "../../src/testing.ts"

const redInk = separation("Review Red", {
	type: "exponential",
	zero: rgb(1, 1, 1),
	full: rgb(1, 0, 0),
	exponent: 1,
})
const rectangle = colorContent([fillColor(spot(redInk, 1)), "0 0 100 100 re f"])

describe("second independent review regressions", () => {
	it("retains required resources when compressing a bound stream description", () => {
		const objects = createPdfObjectBuilder()
		const bound = bindColorContent(objects, [rectangle])
		const compressed: PdfStream = {
			...bound.stream,
			entries: { ...bound.stream.entries, Filter: name("FlateDecode") },
			data: deflateSync(bound.stream.data),
		}
		expect(() => page(objects, compressed, dictionary({}))).toThrow(
			"bound PDF color resource",
		)
	})

	it.each([false, true])(
		"checks required resources inside a Form, compressed=%s",
		(compressed) => {
			const objects = createPdfObjectBuilder()
			const bound = bindColorContent(objects, [rectangle])
			const form: PdfStream = {
				...bound.stream,
				entries: {
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 100, 100),
					Resources: dictionary({}),
					...(compressed ? { Filter: name("FlateDecode") } : {}),
				},
				data: compressed ? deflateSync(bound.stream.data) : bound.stream.data,
			}
			expect(() =>
				page(
					objects,
					stream({}, ascii("/Shape Do")),
					dictionary({ XObject: dictionary({ Shape: objects.add(form) }) }),
				),
			).toThrow("bound PDF color resource")
		},
	)

	it("renders a compressed Form with the installed resources as a red rectangle", async () => {
		const objects = createPdfObjectBuilder()
		const bound = bindColorContent(objects, [rectangle])
		const form: PdfStream = {
			...bound.stream,
			entries: {
				Type: name("XObject"),
				Subtype: name("Form"),
				BBox: array(0, 0, 100, 100),
				Resources: bound.resources,
				Filter: name("FlateDecode"),
			},
			data: deflateSync(bound.stream.data),
		}
		const document = page(
			objects,
			stream({}, ascii("/Shape Do")),
			dictionary({ XObject: dictionary({ Shape: objects.add(form) }) }),
		)
		const rendered = await renderPdf(serializePdf(document), { resolution: 72 })
		expect(
			Array.from(
				rendered.pages[0]!.pixels.slice(
					(50 * 100 + 50) * 4,
					(50 * 100 + 50) * 4 + 4,
				),
			),
		).toEqual([255, 0, 0, 255])
	})
	it("provides compression and Form helpers that keep the resource declaration", async () => {
		const objects = createPdfObjectBuilder()
		const bound = bindColorContent(objects, [rectangle])
		const compressed = compressColorContent(bound)
		expect(() => page(objects, compressed.stream, dictionary({}))).toThrow(
			"bound PDF color resource",
		)
		const form = formColorContent(compressed, [0, 0, 100, 100])
		const nested = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 100, 100),
					Resources: dictionary({
						XObject: dictionary({ Inner: objects.add(form) }),
					}),
				},
				ascii("/Inner Do"),
			),
		)
		const document = page(
			objects,
			stream({}, ascii("/Outer Do")),
			dictionary({ XObject: dictionary({ Outer: nested }) }),
		)
		const rendered = await renderPdf(serializePdf(document), { resolution: 72 })
		expect(
			Array.from(
				rendered.pages[0]!.pixels.slice(
					(50 * 100 + 50) * 4,
					(50 * 100 + 50) * 4 + 4,
				),
			),
		).toEqual([255, 0, 0, 255])
		await expect(serializePdf(document)).toMatchPdfArtifact("compressed-form", {
			resolution: 72,
		})
		expect(() => compressColorContent(compressed)).toThrow("unfiltered")
		expect(() => formColorContent(bound, [0, 0, 0, 100])).toThrow(
			"bounding box",
		)
	})

	it("rejects a nested Form whose required ink is absent from its own scope", () => {
		const objects = createPdfObjectBuilder()
		const bound = bindColorContent(objects, [rectangle])
		const form = formColorContent(bound, [0, 0, 100, 100])
		const missing = objects.add({
			...form,
			entries: { ...form.entries, Resources: dictionary({}) },
		})
		const outer = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 100, 100),
					Resources: dictionary({
						...bound.resources.entries,
						XObject: dictionary({ Inner: missing }),
					}),
				},
				ascii("/Inner Do"),
			),
		)
		expect(() =>
			page(
				objects,
				stream({}, ascii("/Outer Do")),
				dictionary({ XObject: dictionary({ Outer: outer }) }),
			),
		).toThrow("bound PDF color resource")
	})

	it("retains requirements through a document structuredClone", () => {
		const objects = createPdfObjectBuilder()
		const bound = bindColorContent(objects, [rectangle])
		const document = structuredClone(
			page(objects, bound.stream, bound.resources),
		)
		const missing = {
			...document,
			objects: document.objects.map((object) => {
				const value = object.value
				return value !== null &&
					typeof value === "object" &&
					value.kind === "dictionary" &&
					value.entries.Contents !== undefined
					? {
							...object,
							value: dictionary({
								...value.entries,
								Resources: dictionary({}),
							}),
						}
					: object
			}),
		}
		expect(() => serializePdf(missing)).toThrow("bound PDF color resource")
	})
	it("accepts equivalent reconstructed references in a manual document", () => {
		const objects = createPdfObjectBuilder()
		const bound = bindColorContent(objects, [rectangle])
		const valid = page(objects, bound.stream, bound.resources)
		const spaces = bound.resources.entries.ColorSpace as PdfDictionary
		const original = spaces.entries.CS0 as PdfReference
		const replace = (replacement: PdfReference) => ({
			...valid,
			objects: valid.objects.map((object) => {
				const value = object.value
				return value !== null &&
					typeof value === "object" &&
					value.kind === "dictionary" &&
					value.entries.Contents !== undefined
					? {
							...object,
							value: dictionary({
								...value.entries,
								Resources: dictionary({
									ColorSpace: dictionary({ CS0: replacement }),
								}),
							}),
						}
					: object
			}),
		})
		const equivalent = replace(
			reference(original.objectNumber, original.generation),
		)
		expect(serializePdf(equivalent)).toEqual(serializePdf(valid))
		const wrongGeneration = replace(
			reference(original.objectNumber, generationNumber(1)),
		)
		expect(
			validatePdf(wrongGeneration).some(
				(d) => d.code === "invalid-color-resource",
			),
		).toBe(true)
		const unowned = dictionary({
			ColorSpace: dictionary({
				CS0: reference(original.objectNumber, original.generation),
			}),
		})
		expect(() => page(objects, bound.stream, unowned)).toThrow()
	})

	it.each([
		{
			label: "spot tint function",
			fragment: rectangle,
			unsupported: "1.2",
			supported: "1.3",
		},
		{
			label: "explicit paint state",
			fragment: colorContent([
				paintState({
					fillOverprint: false,
					strokeOverprint: false,
					overprintMode: 0,
				}),
			]),
			unsupported: "1.3",
			supported: "1.4",
		},
	] as const)(
		"validates $label versions after structuredClone",
		({ fragment, unsupported, supported }) => {
			const objects = createPdfObjectBuilder()
			const bound = bindColorContent(objects, [fragment])
			const original = page(objects, bound.stream, bound.resources, supported)
			const cloned = structuredClone(original)
			expect(serializePdf(cloned)).toEqual(serializePdf(original))
			const downgraded = { ...cloned, version: unsupported }
			expect(
				validatePdf(downgraded).some(
					(d) => d.code === "unsupported-version-feature",
				),
			).toBe(true)
			expect(() => serializePdf(downgraded)).toThrow(
				`requires PDF ${supported}`,
			)
		},
	)

	it.each([false, true])(
		"derives manually authored tint function requirements from PDF entries, byte keys=%s",
		(byteKeys) => {
			const objects = createPdfObjectBuilder()
			const fn = dictionary(
				{
					Domain: array(0, 1),
					C0: array(1, 1, 1),
					C1: array(1, 0, 0),
					N: 1,
					...(byteKeys ? {} : { FunctionType: 2 }),
				},
				...(byteKeys
					? [dictionaryEntry(nameBytes(ascii("FunctionType")), 2)]
					: []),
			)
			const resources = dictionary({
				ColorSpace: dictionary({
					Red: objects.add(
						array(
							name("Separation"),
							name("Manual Red"),
							name("DeviceRGB"),
							fn,
						),
					),
				}),
			})
			const doc = page(
				objects,
				stream({}, ascii("/Red cs 1 scn 0 0 100 100 re f")),
				resources,
				"1.3",
			)
			expect(() => serializePdf({ ...doc, version: "1.2" })).toThrow(
				"requires PDF 1.3",
			)
		},
	)
})

function page(
	objects: PdfObjectBuilder,
	content: PdfStream,
	resources: PdfDictionary,
	version: PdfVersion = "1.7",
) {
	const pages = objects.reserve<PdfPagesDictionary>()
	const child = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 100, 100),
			Contents: objects.add(content),
			Resources: resources,
		}),
	)
	pages.set(dictionary({ Type: name("Pages"), Kids: array(child), Count: 1 }))
	const root = objects.add(
		dictionary({ Type: name("Catalog"), Pages: pages.ref }),
	)
	return objects.build({ root, version })
}
