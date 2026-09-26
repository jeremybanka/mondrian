import { expect, it } from "vite-plus/test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import type {
	PdfDictionary,
	PdfPagesDictionary,
	PdfStream,
	PdfReference,
} from "../../src/index.ts"
import {
	array,
	ascii,
	bindColorContent,
	colorContent,
	createPdfObjectBuilder,
	dictionary,
	fillColor,
	name,
	nameBytes,
	serializePdf,
	spot,
	stream,
	textString,
} from "../../src/index.ts"
import { previewPdfPlates } from "../../src/testing.ts"
import { planPdfPlates } from "../../src/testing/plate-plan.ts"
import { red, white, rawDocument, samples } from "./fixtures/plates.ts"

it("keeps page replacement linear for shuffled, noncontiguous object numbers", () => {
	const readsFor = (pageCount: number) => {
		const objects = createPdfObjectBuilder()
		const parent = objects.reserve<PdfPagesDictionary>()
		const pages = Array.from({ length: pageCount }, (_, index) => {
			objects.add(null) // Unreachable slots leave gaps in the final object numbers.
			const contents = objects.add(
				stream({}, ascii(`1 0 0 0 k ${index} 0 10 10 re f`)),
			)
			return objects.add(
				dictionary({
					Type: name("Page"),
					Parent: parent.ref,
					Contents: contents,
					PrivateIndex: index,
				}),
			)
		})
		parent.set(
			dictionary({
				Type: name("Pages"),
				Kids: array(...pages),
				Count: pageCount,
				MediaBox: array(0, 0, 200, 200),
				Resources: dictionary({}),
			}),
		)
		const root = objects.add(
			dictionary({ Type: name("Catalog"), Pages: parent.ref }),
		)
		const built = objects.build({ root })
		let reads = 0
		const source = {
			...built,
			objects: [...built.objects].reverse().map((object) => ({
				...object,
				get objectNumber() {
					reads++
					return object.objectNumber
				},
			})),
		}
		for (const plate of previewPdfPlates(source)) {
			const byNumber = new Map(
				plate.document.objects.map((object) => [
					object.objectNumber,
					object.value,
				]),
			)
			for (const [index, page] of pages.entries()) {
				const value = byNumber.get(page.objectNumber)
				expect(value).toMatchObject({
					kind: "dictionary",
					entries: { PrivateIndex: index },
				})
				if (
					value === null ||
					typeof value !== "object" ||
					value.kind !== "dictionary"
				)
					throw new Error("Missing page")
				const contents = value.entries.Contents as PdfReference
				const content = byNumber.get(contents.objectNumber) as PdfStream
				expect(Buffer.from(content.data).toString("latin1")).toContain(
					`${index} 0 10 10 re`,
				)
			}
		}
		return reads
	}
	// Count actual object-number accesses, avoiding environment-dependent timing.
	// Quadrupling pages should scale linearly, not rescan all objects per page.
	expect(readsFor(128)).toBeLessThan(readsFor(32) * 5)
})

it("indexes each resource category once per discovery despite repeated escaped-name lookups", () => {
	const scans = new Map<string, number>()
	const source = rawDocument((objects) => {
		const values = {
			Font: objects.add(
				dictionary({
					Type: name("Font"),
					Subtype: name("Type1"),
					BaseFont: name("Helvetica"),
				}),
			),
			ExtGState: objects.add(dictionary({ ca: 1 })),
			ColorSpace: objects.add(name("DeviceCMYK")),
			XObject: objects.add(
				stream(
					{
						Type: name("XObject"),
						Subtype: name("Form"),
						BBox: array(0, 0, 80, 80),
						Resources: dictionary({}),
					},
					ascii(""),
				),
			),
		}
		const nil = objects.add(null)
		const categories = Object.entries(values).map(([category, value]) => {
			const table = dictionary(
				{
					...Object.fromEntries(
						Array.from({ length: 64 }, (_, index) => [`Unused${index}`, value]),
					),
					Absent: nil,
				},
				[nameBytes(ascii("Resource /")), value],
			)
			return [
				category,
				objects.add({
					...table,
					entries: new Proxy(table.entries, {
						ownKeys(target) {
							scans.set(category, (scans.get(category) ?? 0) + 1)
							return Reflect.ownKeys(target)
						},
					}),
				}),
			]
		})
		return {
			resources: dictionary(Object.fromEntries(categories)),
			contents: [
				stream(
					{},
					ascii(
						Array.from({ length: 128 }, (_, index) => {
							const key =
								index % 2 === 0 ? "/Resource#20#2f" : "/Resourc#65#20#2F"
							return `${key} gs ${key} cs ${key} Do BT ${key} 12 Tf ET`
						}).join("\n"),
					),
				),
			],
		}
	})
	// Count discovery work independently of object-builder validation.
	scans.clear()
	for (let run = 1; run <= 2; run++) {
		const plan = planPdfPlates(source, new Set(["cmyk"]))
		expect(
			plan.pages[0]!.scope.instructions.filter(({ kind }) => kind === "form"),
		).toHaveLength(128)
		expect(Object.fromEntries(scans)).toEqual({
			Font: run,
			ExtGState: run,
			ColorSpace: run,
			XObject: run,
		})
	}
})

it(
	"previews documents above the function argument limit",
	{ timeout: 30_000 },
	() => {
		const count = 150_000
		const built = rawDocument((objects) => {
			const records = Array.from({ length: count }, (_, index) =>
				objects.add(index),
			)
			const colors = bindColorContent(objects, [
				colorContent([fillColor(spot(red, 1)), "10 10 60 60 re f"]),
			])
			return {
				resources: colors.resources,
				page: { PrivateData: { kind: "array", items: records } },
				contents: [colors.stream],
			}
		})
		const source = { ...built, objects: [...built.objects].reverse() }
		const highest = source.objects[0]!.objectNumber
		const [plate] = previewPdfPlates(source, { permitColors: ["spot"] })
		expect(plate!.name).toBe("Red / # ink")
		const ids = new Set<number>()
		let retained = 0
		let sum = 0
		for (const object of plate!.document.objects) {
			ids.add(object.objectNumber)
			if (typeof object.value === "number") {
				retained++
				sum += object.value
			}
		}
		expect(ids.size).toBe(plate!.document.objects.length)
		expect(ids.has(highest + 1)).toBe(true)
		expect(retained).toBe(count)
		expect(sum).toBe((count * (count - 1)) / 2)
	},
)

it(
	"handles shared spot-function graphs within a bounded heap",
	{ timeout: 30_000 },
	async () => {
		await promisify(execFile)(
			process.execPath,
			[
				"--max-old-space-size=64",
				fileURLToPath(
					new URL("./fixtures/plate-spot-graph.ts", import.meta.url),
				),
			],
			{ timeout: 25_000 },
		)
	},
)

// Large graph cloning, comparison, and serialization exceed the default timeout
// on coverage-instrumented CI runners; this regression checks stack safety.
it(
	"preserves long linked bookmark chains without overflowing the call stack",
	{ timeout: 20_000 },
	() => {
		const objects = createPdfObjectBuilder()
		const pages = objects.reserve<PdfPagesDictionary>()
		const page = objects.add(
			dictionary({
				Type: name("Page"),
				Parent: pages.ref,
				MediaBox: array(0, 0, 80, 80),
				Contents: objects.add(stream({}, ascii("1 0 0 0 k 0 0 80 80 re f"))),
			}),
		)
		pages.set(
			dictionary({
				Type: name("Pages"),
				Kids: array(page),
				Count: 1,
				Resources: dictionary({}),
			}),
		)
		const outlines = objects.reserve<PdfDictionary>()
		const bookmarks = Array.from({ length: 4000 }, () =>
			objects.reserve<PdfDictionary>(),
		)
		bookmarks.forEach((bookmark, index) =>
			bookmark.set(
				dictionary({
					Title: textString(`Bookmark ${index}`),
					Parent: outlines.ref,
					Prev: bookmarks[index - 1]?.ref,
					Next: bookmarks[index + 1]?.ref,
					Dest: array(page, name("Fit")),
				}),
			),
		)
		outlines.set(
			dictionary({
				Type: name("Outlines"),
				First: bookmarks[0]!.ref,
				Last: bookmarks.at(-1)!.ref,
				Count: bookmarks.length,
			}),
		)
		const root = objects.add(
			dictionary({
				Type: name("Catalog"),
				Pages: pages.ref,
				Outlines: outlines.ref,
			}),
		)
		const source = objects.build({ root })
		expect(serializePdf(source).length).toBeGreaterThan(400_000)
		const numbers = new Set(bookmarks.map(({ ref }) => ref.objectNumber))
		const expected = source.objects.filter(({ objectNumber }) =>
			numbers.has(objectNumber),
		)
		for (const { document } of previewPdfPlates(source)) {
			expect(
				document.objects.filter(({ objectNumber }) =>
					numbers.has(objectNumber),
				),
			).toEqual(expected)
			expect(serializePdf(document).length).toBeGreaterThan(400_000)
		}
	},
)

it("keeps shared nested Form projections linear in the source graph", async () => {
	const source = rawDocument((objects) => {
		let child = objects.add(
			stream(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: array(0, 0, 80, 80),
				},
				ascii("1 0 0 0 k 10 10 60 60 re f"),
			),
		)
		for (let depth = 0; depth < 12; depth++) {
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
		}
		return {
			resources: dictionary({ XObject: dictionary({ Root: child }) }),
			contents: [stream({}, ascii("/Root Do"))],
		}
	})
	const inputBytes = serializePdf(source).length
	const plates = previewPdfPlates(source)
	for (const plate of plates) {
		expect(plate.document.objects.length).toBeLessThanOrEqual(
			source.objects.length * 2,
		)
		expect(serializePdf(plate.document).length).toBeLessThan(inputBytes * 4)
	}
	expect(
		await samples(plates[0]!.document, [
			[40, 40],
			[5, 5],
		]),
	).toEqual([[0, 174, 239, 255], white])
})
