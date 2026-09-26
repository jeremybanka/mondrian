import assert from "node:assert/strict"
import {
	array,
	ascii,
	createPdfObjectBuilder,
	dictionary,
	name,
	stream,
} from "../../../src/index.ts"
import type {
	PdfDictionary,
	PdfPagesDictionary,
	PdfReference,
} from "../../../src/index.ts"
import { previewPdfPlates } from "../../../src/testing/plates.ts"

// Run in a separate process with a bounded heap: timing alone is too dependent
// on CI load, and caching a tree before stringify still expands shared children.
const objects = createPdfObjectBuilder()
const definition = () => {
	let child: PdfReference<PdfDictionary> = objects.add(
		dictionary({
			FunctionType: 2,
			Domain: array(0, 1),
			C0: array(1, 1, 1),
			C1: array(1, 0, 0),
			N: 1,
		}),
	)
	for (let depth = 0; depth < 16; depth++)
		child = objects.add(
			dictionary({
				FunctionType: 3,
				Domain: array(0, 1),
				Functions: array(child, child),
				Bounds: array(0.5),
				Encode: array(0, 1, 0, 1),
			}),
		)
	return array(name("Separation"), name("Red"), name("DeviceRGB"), child)
}
const first = definition()
const second = definition()
const pages = objects.reserve<PdfPagesDictionary>()
const page = objects.add(
	dictionary({
		Type: name("Page"),
		Parent: pages.ref,
		MediaBox: array(0, 0, 80, 80),
		Resources: dictionary({ ColorSpace: dictionary({ A: first, B: second }) }),
		Contents: objects.add(
			stream(
				{},
				ascii("/A cs 1 scn 10 10 20 20 re f /B cs 1 scn 50 10 20 20 re f"),
			),
		),
	}),
)
pages.set(dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }))
const root = objects.add(
	dictionary({ Type: name("Catalog"), Pages: pages.ref }),
)
const source = objects.build({ root })
const plates = previewPdfPlates(source, { permitColors: ["spot"] })
assert.deepEqual(
	plates.map(({ name }) => name),
	["Red"],
)
assert.ok(plates[0]!.document.objects.length <= source.objects.length)
