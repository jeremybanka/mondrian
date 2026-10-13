import type { PdfDocument, PdfValue } from "mondrian.pdf"
import {
	array,
	ascii,
	dictionary,
	indirectObject,
	name,
	reference,
	stream,
} from "mondrian.pdf"
import { inspectPdf, inspectPdfContent } from "mondrian.pdf/inspect"
import { describe, expect, it } from "vite-plus/test"

import {
	inspectionHref,
	inspectionPageProgram,
	inspectionSearchText,
	operationResource,
} from "../src/inspection-learning.ts"

function fixture(
	program = "q 20 0 0 30 10 20 cm /Im0 Do Q",
	pageFields: Record<string, PdfValue> = {},
): PdfDocument {
	return {
		version: "1.7",
		root: reference(1),
		objects: [
			indirectObject(
				1,
				dictionary({ Type: name("Catalog"), Pages: reference(2) }),
			),
			indirectObject(
				2,
				dictionary({
					Type: name("Pages"),
					Kids: array(reference(3)),
					Count: 1,
					MediaBox: array(0, 0, 100, 100),
					Resources: dictionary({
						XObject: dictionary({ Im0: reference(5) }),
						Font: dictionary({ F1: reference(6) }),
					}),
				}),
			),
			indirectObject(
				3,
				dictionary({
					Type: name("Page"),
					Parent: reference(2),
					Contents: reference(4),
					...pageFields,
				}),
			),
			indirectObject(4, stream({}, ascii(program))),
			indirectObject(
				5,
				stream(
					{
						Type: name("XObject"),
						Subtype: name("Image"),
						Width: 1,
						Height: 1,
						ColorSpace: name("DeviceRGB"),
						BitsPerComponent: 8,
					},
					new Uint8Array([255, 0, 0]),
				),
			),
			indirectObject(
				6,
				dictionary({
					Type: name("Font"),
					Subtype: name("Type1"),
					BaseFont: name("Helvetica"),
				}),
			),
		],
	}
}

describe("inspector learning navigation", () => {
	it("finds objects by visible references, PDF names, and incoming resource aliases", () => {
		const document = fixture()
		const index = inspectPdf(document)
		const image = index.objects.find((object) => object.id === "5:0")!
		const text = inspectionSearchText(image, document.objects[4]!.value)
		for (const query of [
			"5:0",
			"5 0",
			"5 0 r",
			"5 0 obj",
			"/im0",
			"image",
			"devicergb",
			"colorspace",
			"/colorspace",
			"/devicergb",
		])
			expect(text).toContain(query)
		expect(inspectionHref("4:0", 0, 1)).toBe(
			"/inspect?object=4%3A0&offset=0&page=1",
		)
	})
	it("resolves drawing resources using their category rather than their name alone", () => {
		const resources = new Map([
			["XObject/R1", "5:0"],
			["Font/R1", "6:0"],
		])
		const operations = inspectPdfContent(ascii("/R1 Do /R1 12 Tf"))
		expect(operationResource(operations[0]!, resources)).toBe("5:0")
		expect(operationResource(operations[1]!, resources)).toBe("6:0")
	})
})

describe("image placement outlines", () => {
	it("uses inherited resources and geometry and restores transformations between placements", () => {
		const document = fixture(
			"q 20 0 0 30 10 20 cm /Im0 Do Q q 10 0 0 10 50 60 cm /Im0 Do Q",
		)
		const result = inspectionPageProgram(document, inspectPdf(document), 1)
		expect(result.resources.get("XObject/Im0")).toBe("5:0")
		expect(result.placements.map((placement) => placement.points)).toEqual([
			[
				[0.1, 0.8],
				[0.3, 0.8],
				[0.3, 0.5],
				[0.1, 0.5],
			],
			[
				[0.5, 0.4],
				[0.6, 0.4],
				[0.6, 0.30000000000000004],
				[0.5, 0.30000000000000004],
			],
		])
		expect(result.placements[0]).toMatchObject({
			object: "4:0",
			resource: "5:0",
			offset: 21,
		})
	})
	it.each([0, 90, 180, 270, -90])(
		"maps cropped image bounds into a preview rotated by %s degrees",
		(rotation) => {
			const document = fixture("20 0 0 20 20 20 cm /Im0 Do", {
				CropBox: array(10, 10, 90, 90),
				Rotate: rotation,
			})
			const points = inspectionPageProgram(document, inspectPdf(document), 1)
				.placements[0]!.points
			const expected: Record<number, readonly number[]> = {
				0: [0.125, 0.875],
				90: [0.125, 0.125],
				180: [0.875, 0.125],
				270: [0.875, 0.875],
				[-90]: [0.875, 0.875],
			}
			expect(points[0]).toEqual(expected[rotation])
		},
	)
	it("composes transforms in PDF order, including reflected and sheared placements", () => {
		const document = fixture("1 0 0 1 10 20 cm -20 10 5 30 0 0 cm /Im0 Do")
		const points = inspectionPageProgram(document, inspectPdf(document), 1)
			.placements[0]!.points
		expect(points).toEqual([
			[0.1, 0.8],
			[-0.1, 0.7],
			[-0.05, 0.4],
			[0.15, 0.5],
		])
	})
	it("carries the graphics state across a page’s content-stream array", () => {
		const document = fixture("q 20 0 0 30 10 20 cm", {
			Contents: array(reference(4), reference(7)),
		})
		const combined = {
			...document,
			objects: [
				...document.objects,
				indirectObject(7, stream({}, ascii("/Im0 Do Q"))),
			],
		}
		expect(
			inspectionPageProgram(combined, inspectPdf(combined), 1).placements[0],
		).toMatchObject({
			object: "7:0",
			offset: 0,
			points: [
				[0.1, 0.8],
				[0.3, 0.8],
				[0.3, 0.5],
				[0.1, 0.5],
			],
		})
	})
	it("reports unsupported or malformed programs without inventing placement bounds", () => {
		for (const program of ["Q /Im0 Do", "1 2 cm /Im0 Do", "BI /W 1 ID x EI"]) {
			const document = fixture(program)
			const result = inspectionPageProgram(document, inspectPdf(document), 1)
			expect(result.placements).toEqual([])
			expect(result.message).toContain("unavailable")
		}
	})
	it("does not outline nested Form images as direct page placements", () => {
		const document = fixture("/Im0 Do")
		const form = {
			...document,
			objects: document.objects.map((object) =>
				object.objectNumber === 5
					? indirectObject(
							5,
							stream(
								{
									Type: name("XObject"),
									Subtype: name("Form"),
									BBox: array(0, 0, 1, 1),
								},
								ascii("0 0 1 1 re f"),
							),
						)
					: object,
			),
		}
		const result = inspectionPageProgram(form, inspectPdf(form), 1)
		expect(result.placements).toEqual([])
		expect(result.message).toContain("Forms are not outlined")
	})
})
