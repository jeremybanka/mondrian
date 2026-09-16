import { expect, it } from "vite-plus/test"
import { createPdfDocument, rectangle } from "../../../src/index.ts"
import { visualArtifactOptions } from "./setup.ts"

it("proofs Helvetica and Courier on a shared page", async () => {
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
	await expect(pdf.serialize()).toMatchPdfArtifact(
		"distinct-fonts",
		visualArtifactOptions,
	)
})

it("proofs red and blue images on a shared page", async () => {
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
	await expect(pdf.serialize()).toMatchPdfArtifact(
		"distinct-images",
		visualArtifactOptions,
	)
})
