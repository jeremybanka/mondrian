import { createPdfDocument, rectangle, rgb, separation } from "mondrian.pdf"
import { prepareRgbImage } from "mondrian.pdf/print"

/** Tagged RGB handoff. The source profile is independent of the later press condition. */
export function taggedRgbImageExample(
	jpeg: Uint8Array,
	sourceProfile: Uint8Array,
	alpha?: Uint8Array,
) {
	const source = prepareRgbImage(jpeg, {
		sourceProfile,
		renderingIntent: "perceptual",
	})
	const pdf = createPdfDocument({
		version: "1.5",
		blendingSpace: { rgbProfile: sourceProfile },
	})
	const image = pdf.rgbImage({
			...source,
			...(alpha === undefined ? {} : { alpha }),
		}),
		font = pdf.standardFont("Helvetica")
	const inks = [
		separation("Forest Green", {
			type: "exponential",
			zero: rgb(1, 1, 1),
			full: rgb(0.2, 0.55, 0.32),
			sourceProfile,
			exponent: 1,
		}),
		separation("Violet", {
			type: "exponential",
			zero: rgb(1, 1, 1),
			full: rgb(0.46, 0.25, 0.75),
			sourceProfile,
			exponent: 1,
		}),
	]
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 360, 260),
			content: [
				pdf.graphics((g) => {
					g.cmykFill(0.04, 0.08, 0.12, 0).rectangle(0, 0, 360, 260).fill()
					g.spotFill(inks[0]!, 0.8).rectangle(18, 22, 150, 196).fill()
					g.spotFill(inks[1]!, 0.6).rectangle(180, 22, 162, 196).fill()
					g.drawImage(image, 80, 18, 200, 218)
				}),
				pdf.text((t) =>
					t
						.font(font, 18)
						.cmykFill(0, 0, 0, 1)
						.moveText(20, 232)
						.show("WOODLAND STUDY"),
				),
			],
		}),
	)
	return pdf.compile()
}
