import { readFileSync } from "node:fs"
import { createCanvas, loadImage } from "@napi-rs/canvas"
import { expect, it } from "vite-plus/test"
import { decodeImage } from "../../src/print/decode-image.ts"

const fixture = (file: string) =>
	readFileSync(
		new URL(`../public/fixtures/print-images/${file}`, import.meta.url),
	)

it.each(["Adobe", "JFIF"])(
	"requires an exact %s application-marker signature",
	(kind) => {
		const rgb = fixture("rgb.jpg")
		if (kind === "Adobe") {
			const input = fixture("adobe-rgb.jpg")
			input[6] = input[6]! | 0x80
			expect(decodeImage(input).rgba).toEqual(decodeImage(rgb).rgba)
		} else {
			const input = fixture("component-rgb.jpg")
			const app0 = Buffer.from(rgb.subarray(2, 20))
			app0[4] = app0[4]! | 0x80
			expect(
				Array.from(
					decodeImage(
						Buffer.concat([input.subarray(0, 2), app0, input.subarray(2)]),
					).rgba,
				),
			).toEqual(
				Array.from(decodeImage(fixture("rgb-encoded-reference.png")).rgba),
			)
		}
	},
)

it.each(["adobe-rgb.jpg", "component-rgb.jpg", "rgb.jpg"])(
	"matches an independent JPEG decoder for %s",
	async (file) => {
		const input = fixture(file)
		const reference = await loadImage(input)
		const context = createCanvas(reference.width, reference.height).getContext(
			"2d",
		)
		context.drawImage(reference, 0, 0)
		const expected = context.getImageData(
			0,
			0,
			reference.width,
			reference.height,
		).data
		const actual = decodeImage(input)
		expect([actual.width, actual.height]).toEqual([
			reference.width,
			reference.height,
		])
		// Independent YCbCr conversion can differ by one sample through rounding.
		const tolerance = file === "rgb.jpg" ? 1 : 0
		for (const [index, value] of actual.rgba.entries())
			expect(Math.abs(value - expected[index]!)).toBeLessThanOrEqual(tolerance)
	},
)

it("honors Adobe transform 1 for conventional YCbCr component planes", () => {
	const input = fixture("adobe-rgb.jpg")
	input[17] = 1
	expect(decodeImage(input).rgba).toEqual(decodeImage(fixture("rgb.jpg")).rgba)
})

it("rejects contradictory and unsupported Adobe/JFIF declarations", () => {
	const adobe = fixture("adobe-rgb.jpg")
	const unsupported = Buffer.from(adobe)
	unsupported[17] = 2
	expect(() => decodeImage(unsupported)).toThrow(/Adobe color transform/)
	const conflicting = Buffer.from(adobe.subarray(2, 18))
	conflicting[15] = 1
	expect(() =>
		decodeImage(
			Buffer.concat([adobe.subarray(0, 2), conflicting, adobe.subarray(2)]),
		),
	).toThrow(/Conflicting JPEG Adobe/)
	const jfif = fixture("rgb.jpg")
	expect(() =>
		decodeImage(
			Buffer.concat([
				adobe.subarray(0, 2),
				jfif.subarray(2, 20),
				adobe.subarray(2),
			]),
		),
	).toThrow(/Conflicting JPEG JFIF/)
})
