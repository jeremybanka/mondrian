import { expect, it } from "vite-plus/test"
import {
	ascii,
	createPdfDocument,
	literalString,
	rectangle,
} from "mondrian.pdf"
import { renderPdf } from "mondrian.pdf/testing"
import { readPdf } from "./harness/read-pdf.ts"

it("places text using its matrix, spacing, horizontal scale, leading, and rise", async () => {
	const pdf = createPdfDocument()
	const courier = pdf.standardFont("Courier")
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 180, 180),
			content: [
				pdf.text((text) =>
					text
						.font(courier, 10)
						.setTextMatrix(1, 0, 0, 1, 20, 140)
						.characterSpacing(2)
						.wordSpacing(4)
						.horizontalScale(200)
						.leading(16)
						.rise(3)
						.show("A B")
						.nextLine()
						.show("C")
						.rise(0)
						.setTextMatrix(1, 0, 0, 1, 20, 100)
						.show(literalString(ascii("D"))),
				),
			],
		}),
	)
	const characters = (await readPdf(pdf.serialize())).pageCharacters[0]!
	// Courier advances 6 points at size 10. After character/word spacing and
	// 200% horizontal scaling, A advances 16 points and the space advances 24.
	for (const [letter, x, y] of [
		["A", 20, 143],
		["B", 60, 143],
		["C", 20, 127],
		["D", 20, 100],
	] as const) {
		const character = characters.find(({ text }) => text === letter)
		expect(character).toBeDefined()
		expect(character!.x).toBeCloseTo(x, 4)
		expect(character!.y).toBeCloseTo(y, 4)
	}
})

it("paints paths, scopes transforms, and places a JPEG at the requested size", async () => {
	// Fixed red 2x3 RGB JPEG, generated once with Pillow.
	const redTwoByThreeJpeg = Uint8Array.from(
		Buffer.from(
			[
				"ffd8ffe000104a46494600010100000100010000ffdb004300100b0c0e0c0a100e0d0e12",
				"11101318281a181616183123251d283a333d3c3933383740485c4e404457453738506d51",
				"575f626768673e4d71797064785c656763ffdb0043011112121815182f1a1a2f63423842",
				"636363636363636363636363636363636363636363636363636363636363636363636363",
				"6363636363636363636363636363ffc00011080003000203012200021101031101ffc400",
				"1500010100000000000000000000000000000005ffc40014100100000000000000000000",
				"000000000000ffc4001501010100000000000000000000000000000506ffc40014110100",
				"000000000000000000000000000000ffda000c03010002110311003f008a00b5e3ffd9",
			].join(""),
			"hex",
		),
	)
	const pdf = createPdfDocument()
	const image = pdf.jpeg(redTwoByThreeJpeg)
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 100, 100),
			content: [
				pdf.graphics((g) =>
					g
						.concatMatrix(2, 0, 0, 2, 10, 10)
						.rgbFill(0, 1, 0)
						.rectangle(0, 0, 10, 10)
						.fill(),
				),
				pdf.graphics((g) =>
					g
						.rgbFill(0, 0, 1)
						.rgbStroke(0, 0, 0)
						.lineWidth(4)
						.moveTo(40, 10)
						.lineTo(60, 10)
						.lineTo(60, 30)
						.lineTo(40, 30)
						.closePath()
						.fillAndStroke()
						.moveTo(10, 45)
						.lineTo(60, 45)
						.stroke()
						.drawImage(image, 70, 10, 20, 30),
				),
			],
		}),
	)
	const bytes = pdf.serialize()
	expect((await readPdf(bytes)).pages).toEqual([
		{ width: 100, height: 100, rotation: 0, text: "" },
	])
	const page = (await renderPdf(bytes, { resolution: 72 })).pages[0]!
	function colorAt(x: number, y: number) {
		const offset = ((99 - y) * page.width + x) * 4
		return Array.from(page.pixels.slice(offset, offset + 4))
	}
	// Sample interiors, away from antialiased edges. These are color/placement
	// requirements, not a promise to retain a renderer's exact page pixels.
	expect(colorAt(20, 20)).toEqual([0, 255, 0, 255])
	expect(colorAt(5, 5)).toEqual([255, 255, 255, 255])
	expect(colorAt(50, 20)).toEqual([0, 0, 255, 255])
	expect(colorAt(40, 20)).toEqual([0, 0, 0, 255])
	expect(colorAt(30, 45)).toEqual([0, 0, 0, 255])
	const [red, green, blue, alpha] = colorAt(80, 25)
	expect(red).toBeGreaterThan(240)
	expect(green).toBeLessThan(10)
	expect(blue).toBeLessThan(10)
	expect(alpha).toBe(255)
	expect(colorAt(80, 45)).toEqual([255, 255, 255, 255])
})
