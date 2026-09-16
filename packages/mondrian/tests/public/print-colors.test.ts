import { expect, it } from "vite-plus/test"
import {
	array,
	bindColorContent,
	cmyk,
	colorContent,
	createPdfDocument,
	createPdfObjectBuilder,
	dictionary,
	fillColor,
	name,
	rectangle,
	rgb,
	separation,
	serializePdf,
	spot,
} from "mondrian.pdf"
import type { PdfPagesDictionary } from "mondrian.pdf"
import { readPdf, renderPdf } from "mondrian.pdf/testing"
import {
	decodePDFRawStream,
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFName,
	PDFRawStream,
} from "pdf-lib"

// Identical preview colors must not collapse two independently named inks.
const alternate = {
	type: "exponential",
	zero: rgb(1, 1, 1),
	full: rgb(1, 0, 0),
	exponent: 1,
} as const
const firstInk = separation("Brand Red", alternate)
const secondInk = separation("Other Red", alternate)

it.each([
	["semantic builder", semanticPage],
	["object builder", objectPage],
] as const)(
	"preserves process channels, named inks, and live text through the %s",
	async (_workflow, makePage) => {
		const bytes = makePage()
		const fills = await paintedFills(bytes)
		// These are PDF paint semantics, not generated resource names or object IDs.
		expect(fills).toEqual(
			expect.arrayContaining([
				{ paint: "path", space: "DeviceCMYK", components: [0, 0, 0, 1] },
				{ paint: "path", space: "Brand Red", components: [1] },
				{ paint: "path", space: "Other Red", components: [0.5] },
				{ paint: "text", space: "Brand Red", components: [0.75] },
			]),
		)

		const read = await readPdf(bytes)
		expect(read.pages[0]!.text).toBe("Ink")
		const firstCharacter = read.pageCharacters[0]!.find(
			({ text }) => text === "I",
		)!
		expect(firstCharacter.x).toBeCloseTo(10, 3)
		expect(firstCharacter.y).toBeCloseTo(70, 3)

		const page = (await renderPdf(bytes, { resolution: 72 })).pages[0]!
		// Interior samples prove usable alternate-color rendering. A small channel
		// tolerance avoids making a renderer's exact rounding a public contract.
		for (const [x, expected] of [
			[75, [255, 0, 0]],
			[125, [255, 128, 128]],
		] as const) {
			const offset = ((page.height - 1 - 25) * page.width + x) * 4
			for (const [channel, value] of expected.entries()) {
				expect(
					Math.abs(page.pixels[offset + channel]! - value),
				).toBeLessThanOrEqual(2)
			}
			expect(page.pixels[offset + 3]).toBe(255)
		}
	},
)

function semanticPage(): Uint8Array {
	const pdf = createPdfDocument()
	const font = pdf.standardFont("Helvetica")
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 150, 100),
			content: [
				pdf.graphics((g) =>
					g
						.cmykFill(0, 0, 0, 1)
						.rectangle(10, 10, 30, 30)
						.fill()
						.spotFill(firstInk, 1)
						.rectangle(60, 10, 30, 30)
						.fill()
						.spotFill(secondInk, 0.5)
						.rectangle(110, 10, 30, 30)
						.fill(),
				),
				pdf.text((t) =>
					t
						.font(font, 12)
						.moveText(10, 70)
						.spotFill(firstInk, 0.75)
						.show("Ink"),
				),
			],
		}),
	)
	return pdf.serialize()
}

function objectPage(): Uint8Array {
	const objects = createPdfObjectBuilder()
	const bound = bindColorContent(objects, [
		colorContent([
			fillColor(cmyk(0, 0, 0, 1)),
			"10 10 30 30 re f",
			fillColor(spot(firstInk, 1)),
			"60 10 30 30 re f",
			fillColor(spot(secondInk, 0.5)),
			"110 10 30 30 re f",
			fillColor(spot(firstInk, 0.75)),
			"BT /Label 12 Tf 10 70 Td (Ink) Tj ET",
		]),
	])
	const font = objects.add(
		dictionary({
			Type: name("Font"),
			Subtype: name("Type1"),
			BaseFont: name("Helvetica"),
		}),
	)
	const pages = objects.reserve<PdfPagesDictionary>()
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 150, 100),
			Resources: dictionary({
				...bound.resources.entries,
				Font: dictionary({ Label: font }),
			}),
			Contents: objects.add(bound.stream),
		}),
	)
	pages.set(dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }))
	const root = objects.add(
		dictionary({ Type: name("Catalog"), Pages: pages.ref }),
	)
	return serializePdf(objects.build({ root }))
}

interface Fill {
	space: string
	components: number[]
}

// Read this fixture's fill operations from the serialized PDF with an independent
// parser. Resolve resource aliases, decode streams, and track q/Q scopes rather
// than matching whole content strings or assuming a particular stream split.
async function paintedFills(bytes: Uint8Array) {
	const pdf = await PDFDocument.load(bytes)
	const page = pdf.getPages()[0]!
	const spaces = page.node
		.Resources()!
		.lookup(PDFName.of("ColorSpace"), PDFDict)
	const resolveSpace = (token: string) => {
		const key = PDFName.of(
			token.slice(1).replace(/#[\da-f]{2}/giu, (s) => s.toUpperCase()),
		)
		const value = spaces.lookup(key)
		if (
			value instanceof PDFArray &&
			value.lookup(0, PDFName).decodeText() === "Separation"
		) {
			return value.lookup(1, PDFName).decodeText()
		}
		return value instanceof PDFName ? value.decodeText() : key.decodeText()
	}
	const contents = page.node.Contents()!
	const streams = contents instanceof PDFArray ? contents.asArray() : [contents]
	const syntax = streams
		.map((ref) => {
			const stream = pdf.context.lookup(ref)
			if (!(stream instanceof PDFRawStream))
				throw new Error("Expected a content stream")
			return new TextDecoder().decode(decodePDFRawStream(stream).decode())
		})
		.join("\n")
	const tokens =
		syntax.match(
			/%[^\r\n]*|\((?:\\[\s\S]|[^\\)])*\)|\/[^\s()[\]<>%/]+|[^\s()[\]<>%/]+|[()[\]<>]/gu,
		) ?? []
	let fill: Fill = { space: "DeviceGray", components: [0] }
	const stack: Fill[] = []
	const operands: string[] = []
	const paints: (Fill & { paint: "path" | "text" })[] = []
	for (const token of tokens) {
		if (token.startsWith("%")) continue
		if (
			token.startsWith("/") ||
			token.startsWith("(") ||
			/^[+\-.\d]/u.test(token) ||
			["[", "]", "<", ">"].includes(token)
		) {
			operands.push(token)
			continue
		}
		if (token === "q") stack.push(fill)
		if (token === "Q") fill = stack.pop()!
		if (token === "cs")
			fill = { space: resolveSpace(operands[0]!), components: [] }
		if (["k", "rg", "g", "sc", "scn"].includes(token)) {
			const space =
				(
					{ k: "DeviceCMYK", rg: "DeviceRGB", g: "DeviceGray" } as Record<
						string,
						string
					>
				)[token] ?? fill.space
			fill = { space, components: operands.map(Number) }
		}
		if (["f", "F", "f*", "B", "B*", "b", "b*"].includes(token))
			paints.push({ ...fill, paint: "path" })
		if (["Tj", "TJ", "'", '"'].includes(token))
			paints.push({ ...fill, paint: "text" })
		operands.length = 0
	}
	return paints
}
