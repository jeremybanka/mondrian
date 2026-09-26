import { expect, it } from "vite-plus/test"
import { zlibSync } from "fflate"
import type { PdfPagesDictionary, PdfReference } from "../../src/index.ts"
import {
	array,
	ascii,
	bindColorContent,
	colorContent,
	compressColorContent,
	createPdfObjectBuilder,
	dictionary,
	fillColor,
	formColorContent,
	name,
	serializePdf,
	spot,
	stream,
} from "../../src/index.ts"
import { previewPdfPlates, renderPdf } from "../../src/testing.ts"
import { red, blue, white, rawDocument, samples } from "./fixtures/plates.ts"
import "../../src/vitest.ts"

it("prunes shadowed inherited Form graphs while retaining other references", async () => {
	let originals: PdfReference[] = []
	let retained: PdfReference | undefined
	const source = rawDocument((objects) => {
		const form = (commands: string, resources = dictionary({})) =>
			objects.add(
				stream(
					{
						Type: name("XObject"),
						Subtype: name("Form"),
						BBox: array(0, 0, 80, 80),
						Resources: resources,
					},
					ascii(commands),
				),
			)
		const child = form("1 0 0 0 k 10 10 60 60 re f")
		const outer = form(
			"/Child Do",
			dictionary({ XObject: dictionary({ Child: child }) }),
		)
		const unused = form(`%${"unused".repeat(20_000)}\n`)
		retained = form("% Retained by a non-resource reference\n")
		originals = [child, outer, unused]
		return {
			resources: dictionary({
				XObject: dictionary({
					Outer: outer,
					Unused: unused,
					Retained: retained,
				}),
			}),
			page: { PrivateData: retained },
			contents: [stream({}, ascii("/Outer Do"))],
		}
	})
	const before = serializePdf(source)
	const plates = previewPdfPlates(source)
	for (const { document } of plates) {
		const ids = new Set(
			document.objects.map(({ objectNumber }) => objectNumber),
		)
		for (const original of originals)
			expect(ids.has(original.objectNumber)).toBe(false)
		expect(
			document.objects.find(
				({ objectNumber }) => objectNumber === retained!.objectNumber,
			),
		).toEqual(
			source.objects.find(
				({ objectNumber }) => objectNumber === retained!.objectNumber,
			),
		)
		expect(serializePdf(document).length).toBeLessThan(before.length / 10)
	}
	expect(serializePdf(source)).toEqual(before)
	expect(await samples(plates[0]!.document, [[40, 40]])).toEqual([
		[0, 174, 239, 255],
	])
	expect(await samples(plates[1]!.document, [[40, 40]])).toEqual([white])
})

it("keeps cached Forms separate for different page resources", async () => {
	const objects = createPdfObjectBuilder()
	const parent = objects.reserve<PdfPagesDictionary>()
	const inner = objects.add(
		stream(
			{
				Type: name("XObject"),
				Subtype: name("Form"),
				BBox: array(0, 0, 80, 80),
			},
			ascii("/CS0 cs 1 scn 10 10 60 60 re f"),
		),
	)
	const outer = objects.add(
		stream(
			{
				Type: name("XObject"),
				Subtype: name("Form"),
				BBox: array(0, 0, 80, 80),
				Resources: dictionary({ XObject: dictionary({ Inner: inner }) }),
			},
			ascii("/Inner Do"),
		),
	)
	const contents = objects.add(stream({}, ascii("/Outer Do")))
	const pages = [red, blue].map((ink) => {
		const colors = bindColorContent(objects, [
			colorContent([fillColor(spot(ink, 1))]),
		])
		return objects.add(
			dictionary({
				Type: name("Page"),
				Parent: parent.ref,
				Resources: dictionary({
					...colors.resources.entries,
					XObject: dictionary({ Outer: outer }),
				}),
				Contents: contents,
			}),
		)
	})
	parent.set(
		dictionary({
			Type: name("Pages"),
			Kids: array(...pages),
			Count: pages.length,
			MediaBox: array(0, 0, 80, 80),
		}),
	)
	const root = objects.add(
		dictionary({ Type: name("Catalog"), Pages: parent.ref }),
	)
	const plates = previewPdfPlates(objects.build({ root }))
	for (const [index, color] of [
		[4, [255, 0, 0, 255]],
		[5, [0, 0, 255, 255]],
	] as const) {
		const rendered = await renderPdf(serializePdf(plates[index]!.document), {
			resolution: 72,
		})
		for (const [pageIndex, page] of rendered.pages.entries()) {
			const offset = ((page.height - 1 - 40) * page.width + 40) * 4
			expect(Array.from(page.pixels.slice(offset, offset + 4))).toEqual(
				pageIndex === index - 4 ? color : white,
			)
		}
	}
})

it("does not let a cached Form bypass inherited opacity validation", () => {
	const source = rawDocument((objects) => {
		const form = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 80, 80),
				},
				ascii("20 20 40 40 re B"),
			),
		)
		return {
			resources: dictionary({
				XObject: dictionary({ Fm: form }),
				ExtGState: dictionary({ Unequal: dictionary({ CA: 0.5 }) }),
			}),
			contents: [
				stream({}, ascii("1 0 0 0 k 0 1 0 0 K /Fm Do /Unequal gs /Fm Do")),
			],
		}
	})
	expect(() => previewPdfPlates(source)).toThrow(/unequal opacities/u)
})

it("projects shared compressed Forms per invocation, with inherited colors and private resource scopes", async () => {
	const source = rawDocument((objects) => {
		const parentInk = bindColorContent(objects, [
			colorContent([fillColor(spot(blue, 1))]),
		])
		const childInk = bindColorContent(objects, [
			colorContent([fillColor(spot(red, 1))]),
		])
		const form = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 40, 20),
					Resources: childInk.resources,
					Filter: name("FlateDecode"),
					Matrix: array(1, 0, 0, 1, 5, 0),
				},
				zlibSync(ascii("0 0 20 20 re f /CS0 cs 0.5 scn 20 0 20 20 re f")),
			),
		)
		return {
			resources: dictionary({
				...parentInk.resources.entries,
				XObject: dictionary({ Fm: form }),
			}),
			contents: [
				stream(
					{},
					ascii("1 0 0 0 k /Fm Do q 1 0 0 1 0 30 cm /CS0 cs 1 scn /Fm Do Q"),
				),
			],
		}
	})
	const plates = previewPdfPlates(structuredClone(source))
	expect(plates.map(({ name }) => name)).toEqual([
		"Cyan",
		"Magenta",
		"Yellow",
		"Black",
		"Blue",
		"Red / # ink",
	])
	const cyan = await samples(plates[0]!.document, [
		[15, 10],
		[35, 10],
		[15, 40],
	])
	expect(cyan[0]).not.toEqual(white)
	expect(cyan.slice(1)).toEqual([white, white])
	expect(
		await samples(plates[4]!.document, [
			[15, 10],
			[35, 40],
			[15, 40],
		]),
	).toEqual([white, white, [0, 0, 255, 255]])
	const reds = await samples(plates[5]!.document, [
		[35, 10],
		[35, 40],
	])
	expect(reds[0]).toEqual(reds[1])
	expect(reds[0]![0]).toBe(255)
	expect(reds[0]![1]).toBeCloseTo(128, -1)
})

it("resolves resource-less nested Forms against the page resources", async () => {
	const source = rawDocument((objects) => {
		const colors = bindColorContent(objects, [
			colorContent([fillColor(spot(red, 1))]),
		])
		const inner = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 80, 80),
				},
				ascii("/CS0 cs 1 scn 10 10 60 60 re f"),
			),
		)
		const outer = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 80, 80),
					Resources: dictionary({ XObject: dictionary({ Inner: inner }) }),
				},
				ascii("/Inner Do"),
			),
		)
		return {
			resources: dictionary({
				...colors.resources.entries,
				XObject: dictionary({ Outer: outer }),
			}),
			contents: [stream({}, ascii("/Outer Do"))],
		}
	})
	expect(await samples(source, [[40, 40]])).toEqual([[255, 0, 0, 255]])
	const plates = previewPdfPlates(source)
	expect(
		await samples(plates[4]!.document, [
			[40, 40],
			[5, 5],
		]),
	).toEqual([[255, 0, 0, 255], white])
	await expect(serializePdf(plates[4]!.document)).toMatchPdfArtifact(
		"nested-form-page-resources",
		{ resolution: 96 },
	)
})

it("handles bound compressed content and nested Forms without losing resource declarations", async () => {
	const source = rawDocument((objects) => {
		const bound = compressColorContent(
			bindColorContent(objects, [
				colorContent([fillColor(spot(red, 0.75)), "0 0 30 30 re f"]),
			]),
		)
		const inner = objects.add(formColorContent(bound, [0, 0, 30, 30]))
		const outer = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 30, 30),
					Resources: dictionary({ XObject: dictionary({ Inner: inner }) }),
				},
				ascii("/Inner Do"),
			),
		)
		return {
			resources: dictionary({ XObject: dictionary({ Outer: outer }) }),
			contents: [stream({}, ascii("/Outer Do"))],
		}
	})
	const plates = previewPdfPlates(source)
	expect(await samples(plates[0]!.document, [[10, 10]])).toEqual([white])
	const result = await samples(plates[4]!.document, [[10, 10]])
	expect(result[0]![0]).toBe(255)
	expect(result[0]![1]).toBeCloseTo(64, -1)
})
