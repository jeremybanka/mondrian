import type {
	PdfDictionary,
	PdfDictionaryEntries,
	PdfObjectBuilder,
	PdfPagesDictionary,
	PdfStream,
	PdfVersion,
} from "../../../src/index.ts"
import {
	array,
	createPdfObjectBuilder,
	dictionary,
	name,
	rgb,
	separation,
	serializePdf,
} from "../../../src/index.ts"
import { renderPdf } from "../../../src/testing.ts"

export const red = separation("Red / # ink", {
	type: "exponential",
	zero: rgb(1, 1, 1),
	full: rgb(1, 0, 0),
	exponent: 1,
})

export const blue = separation("Blue", {
	type: "exponential",
	zero: rgb(1, 1, 1),
	full: rgb(0, 0, 1),
	exponent: 1,
})

export const white = [255, 255, 255, 255]

export function rawDocument(
	make: (objects: PdfObjectBuilder) => {
		contents: readonly PdfStream[]
		resources?: PdfDictionary
		page?: PdfDictionaryEntries
	},
	version: PdfVersion = "1.7",
) {
	const objects = createPdfObjectBuilder()
	const data = make(objects)
	const pages = objects.reserve<PdfPagesDictionary>()
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			Contents: array(...data.contents.map((content) => objects.add(content))),
			...data.page,
		}),
	)
	pages.set(
		dictionary({
			Type: name("Pages"),
			Kids: array(page),
			Count: 1,
			MediaBox: array(0, 0, 80, 80),
			Resources: data.resources ?? dictionary({}),
		}),
	)
	const root = objects.add(
		dictionary({ Type: name("Catalog"), Pages: pages.ref }),
	)
	return objects.build({ root, version })
}

export async function samples(
	document: Parameters<typeof serializePdf>[0],
	points: readonly (readonly [number, number])[],
) {
	const page = (await renderPdf(serializePdf(document), { resolution: 72 }))
		.pages[0]!
	return points.map(([x, y]) => {
		const offset = ((page.height - y - 1) * page.width + x) * 4
		return Array.from(page.pixels.slice(offset, offset + 4))
	})
}
