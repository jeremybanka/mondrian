import { expect, it } from "vite-plus/test"
import {
	ascii,
	createPdfDocument,
	literalString,
	rectangle,
} from "mondrian.pdf"
import { readPdf, renderPdf } from "mondrian.pdf/testing"

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
						.rgbStroke(1, 0, 1)
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
	expect(colorAt(40, 20)).toEqual([255, 0, 255, 255])
	expect(colorAt(30, 45)).toEqual([255, 0, 255, 255])
	const [red, green, blue, alpha] = colorAt(80, 25)
	expect(red).toBeGreaterThan(240)
	expect(green).toBeLessThan(10)
	expect(blue).toBeLessThan(10)
	expect(alpha).toBe(255)
	expect(colorAt(80, 45)).toEqual([255, 255, 255, 255])
})

it("preserves distinct requested fonts and their advances on the same page", async () => {
	const pdf = createPdfDocument()
	const helvetica = pdf.standardFont("Helvetica")
	const courier = pdf.standardFont("Courier")
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 180, 120),
			content: [
				pdf.text((text) =>
					text.font(helvetica, 20).moveText(20, 80).show("HH"),
				),
				pdf.text((text) => text.font(courier, 20).moveText(20, 40).show("CC")),
			],
		}),
	)
	const result = await readPdf(pdf.serialize())
	expect(
		result.pageFonts[0]!.filter(({ text }) => text === "H" || text === "C"),
	).toEqual([
		{ text: "H", font: "Helvetica" },
		{ text: "H", font: "Helvetica" },
		{ text: "C", font: "Courier" },
		{ text: "C", font: "Courier" },
	])
	// Standard font metrics: Helvetica H is 722/1000 em; Courier is 600/1000.
	const helveticaCharacters = result.pageCharacters[0]!.filter(
		({ text }) => text === "H",
	)
	const courierCharacters = result.pageCharacters[0]!.filter(
		({ text }) => text === "C",
	)
	expect(helveticaCharacters[1]!.x - helveticaCharacters[0]!.x).toBeCloseTo(
		14.44,
		3,
	)
	expect(courierCharacters[1]!.x - courierCharacters[0]!.x).toBeCloseTo(12, 3)
})

it("keeps two distinguishable image resources independent on the same page", async () => {
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
	// Fixed blue 2x3 RGB JPEG, generated once with @napi-rs/canvas.
	const blueTwoByThreeJpeg = Uint8Array.from(
		Buffer.from(
			"/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgn/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCe4CqYO//Z",
			"base64",
		),
	)
	const pdf = createPdfDocument()
	const red = pdf.jpeg(redTwoByThreeJpeg)
	const blue = pdf.jpeg(blueTwoByThreeJpeg)
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 100, 60),
			content: [
				pdf.graphics((g) =>
					g.drawImage(red, 10, 10, 20, 30).drawImage(blue, 60, 10, 20, 30),
				),
			],
		}),
	)
	const bytes = pdf.serialize()
	expect((await readPdf(bytes)).pages).toEqual([
		{ width: 100, height: 60, rotation: 0, text: "" },
	])
	const page = (await renderPdf(bytes, { resolution: 72 })).pages[0]!
	function colorAt(x: number, y: number) {
		const offset = ((59 - y) * page.width + x) * 4
		return Array.from(page.pixels.slice(offset, offset + 4))
	}
	const redPixel = colorAt(20, 25)
	const bluePixel = colorAt(70, 25)
	expect(redPixel[0]).toBeGreaterThan(240)
	expect(redPixel[1]).toBeLessThan(10)
	expect(redPixel[2]).toBeLessThan(10)
	expect(bluePixel[0]).toBeLessThan(10)
	expect(bluePixel[1]).toBeLessThan(10)
	expect(bluePixel[2]).toBeGreaterThan(240)
})
