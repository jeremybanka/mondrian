import { expect, it } from "vite-plus/test"
import {
	ascii,
	createPdfDocument,
	literalString,
	rectangle,
} from "../../../src/index.ts"
import { visualArtifactOptions } from "./setup.ts"

// Independent, private proofs of the public scenarios. Exact renderer pixels
// and these visual baselines are free to evolve between releases.
it("proofs text spacing and baselines", async () => {
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
	await expect(pdf.serialize()).toMatchPdfArtifact(
		"text-spacing-and-baselines",
		visualArtifactOptions,
	)
})

it("proofs scoped graphics and JPEG placement", async () => {
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
	await expect(pdf.serialize()).toMatchPdfArtifact(
		"scoped-graphics-and-jpeg",
		visualArtifactOptions,
	)
})
