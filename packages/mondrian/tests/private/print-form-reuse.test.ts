import { expect, it } from "vite-plus/test"
import {
	array,
	ascii,
	createPdfObjectBuilder,
	dictionary,
	name,
	stream,
} from "../../src/index.ts"
import type {
	PdfDocument,
	PdfPagesDictionary,
	PdfReference,
	PdfStream,
} from "../../src/index.ts"
import { preparePdfForPrint } from "../../src/print.ts"
import { rawDocument } from "./fixtures/plates.ts"
import {
	printOptions,
	sourceProfile,
} from "../public/fixtures/mixed-color/document.ts"
import { renderPdfPlateCoverage } from "../../src/testing.ts"

function forms(document: PdfDocument) {
	return document.objects
		.map((o) => o.value)
		.filter(
			(v): v is PdfStream =>
				v !== null &&
				typeof v === "object" &&
				v.kind === "stream" &&
				v.entries.Subtype !== null &&
				typeof v.entries.Subtype === "object" &&
				v.entries.Subtype.kind === "name" &&
				v.entries.Subtype.value === "Form",
		)
}
function repeatedFormGraph(levels: number) {
	const objects = createPdfObjectBuilder(),
		pages = objects.reserve<PdfPagesDictionary>()
	let child: PdfReference<PdfStream> = objects.add(
		stream(
			{
				Type: name("XObject"),
				Subtype: name("Form"),
				BBox: array(0, 0, 80, 80),
			},
			ascii("0 0 0 1 k 0 0 80 80 re f"),
		),
	)
	for (let i = 0; i < levels; i++)
		child = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 80, 80),
					Resources: dictionary({ XObject: dictionary({ Child: child }) }),
				},
				ascii("/Child Do /Child Do"),
			),
		)
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 80, 80),
			Resources: dictionary({ XObject: dictionary({ Top: child }) }),
			Contents: objects.add(stream({}, ascii("/Top Do"))),
		}),
	)
	pages.set(dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }))
	return objects.build({
		root: objects.add(dictionary({ Type: name("Catalog"), Pages: pages.ref })),
		version: "1.7",
	})
}

it("keeps a compact shared Form graph compact during preparation", async () => {
	const input = repeatedFormGraph(12)
	expect(input.objects).toHaveLength(17)
	const prepared = await preparePdfForPrint(input, {
		...printOptions,
		maxDecodedImageBytes: 1,
	})
	expect(forms(prepared.document)).toHaveLength(13)
	expect(prepared.document.objects.length).toBeLessThan(25)
})

it("reuses equivalent inherited source paint while retaining distinct color and intent", async () => {
	const input = rawDocument((objects) => {
		const mark = objects.add(
			stream(
				{ Subtype: name("Form"), BBox: array(0, 0, 80, 80) },
				ascii("0 0 40 40 re f"),
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
				XObject: dictionary({ Mark: mark }),
			}),
			contents: [
				stream(
					{},
					ascii(
						"/RGB cs 0.8 0.15 0.05 sc /Mark Do /RGB cs 0.8 0.15 0.05 sc /Mark Do q /AbsoluteColorimetric ri /Mark Do Q 0.1 0.6 0.2 sc /Mark Do",
					),
				),
			],
		}
	})
	const prepared = await preparePdfForPrint(input, printOptions)
	expect(forms(prepared.document)).toHaveLength(3)
	const coverage = await renderPdfPlateCoverage(prepared.document, {
		resolution: 72,
	})
	expect(coverage.plates).toHaveLength(4)
})

it("bounds unique Form work independently of the image budget", async () => {
	const input = repeatedFormGraph(4)
	await expect(
		preparePdfForPrint(input, { ...printOptions, maxFormContexts: 3 }),
	).rejects.toThrow(/Form.*maxFormContexts/)
	await expect(
		preparePdfForPrint(input, { ...printOptions, maxFormBytes: 1 }),
	).rejects.toThrow(/Form.*maxFormBytes/)
	await expect(
		preparePdfForPrint(input, { ...printOptions, maxFormBytes: 100 }),
	).rejects.toThrow(/Form.*maxFormBytes/)
	await expect(
		preparePdfForPrint(input, { ...printOptions, maxFormContexts: NaN }),
	).rejects.toThrow(/maxFormContexts/)
	await expect(
		preparePdfForPrint(input, { ...printOptions, maxFormBytes: 0 }),
	).rejects.toThrow(/maxFormBytes/)
})

it("keeps inherited stroke paint and text rendering modes separate when sharing Forms", async () => {
	const input = rawDocument((objects) => {
		const mark = objects.add(
			stream(
				{ Subtype: name("Form"), BBox: array(0, 0, 80, 80) },
				ascii("BT /F 16 Tf 10 30 Td (Ink) Tj ET"),
			),
		)
		return {
			resources: dictionary({
				Font: dictionary({
					F: dictionary({
						Type: name("Font"),
						Subtype: name("Type1"),
						BaseFont: name("Helvetica"),
					}),
				}),
				XObject: dictionary({ Mark: mark }),
			}),
			contents: [
				stream(
					{},
					ascii(
						"0.2 0.3 0.4 0.5 k 0.6 0.5 0.4 0.3 K /Mark Do /Mark Do 1 Tr /Mark Do 0.1 0.2 0.3 0.4 K /Mark Do",
					),
				),
			],
		}
	})
	expect(
		forms((await preparePdfForPrint(input, printOptions)).document),
	).toHaveLength(3)
})

it("keeps page resource contexts separate for the same resource-less Form", async () => {
	const objects = createPdfObjectBuilder(),
		pages = objects.reserve<PdfPagesDictionary>()
	const mark = objects.add(
		stream(
			{ Subtype: name("Form"), BBox: array(0, 0, 80, 80) },
			ascii("/Ink cs 0.5 scn 0 0 80 80 re f"),
		),
	)
	const ink = (label: string) =>
		array(
			name("Separation"),
			name(label),
			name("DeviceRGB"),
			dictionary({
				FunctionType: 2,
				Domain: array(0, 1),
				C0: array(1, 1, 1),
				C1: array(0.3, 0.5, 0.7),
				N: 1,
			}),
		)
	const pageRefs = ["First Ink", "Second Ink"].map((label) =>
		objects.add(
			dictionary({
				Type: name("Page"),
				Parent: pages.ref,
				MediaBox: array(0, 0, 80, 80),
				Resources: dictionary({
					XObject: dictionary({ Mark: mark }),
					ColorSpace: dictionary({ Ink: ink(label) }),
				}),
				Contents: objects.add(stream({}, ascii("/Mark Do /Mark Do"))),
			}),
		),
	)
	pages.set(
		dictionary({ Type: name("Pages"), Count: 2, Kids: array(...pageRefs) }),
	)
	const input = objects.build({
		root: objects.add(dictionary({ Type: name("Catalog"), Pages: pages.ref })),
		version: "1.7",
	})
	const prepared = await preparePdfForPrint(input, printOptions)
	expect(forms(prepared.document)).toHaveLength(2)
	const plates = await renderPdfPlateCoverage(prepared.document, {
		resolution: 72,
	})
	expect(plates.plates.map((p) => p.name)).toEqual([
		"Cyan",
		"Magenta",
		"Yellow",
		"Black",
		"First Ink",
		"Second Ink",
	])
	expect(plates.plates[4]!.pages[0]!.samples[40 * 80 + 40]).toBe(128)
	expect(plates.plates[4]!.pages[1]!.samples[40 * 80 + 40]).toBe(255)
	expect(plates.plates[5]!.pages[1]!.samples[40 * 80 + 40]).toBe(128)
})
