import { readFileSync } from "node:fs"
import { expect, it } from "vite-plus/test"
import { prepareCmykImage } from "mondrian.pdf/print"

const fixture = (file: string) =>
	readFileSync(new URL(`./fixtures/print-images/${file}`, import.meta.url))
const destinationProfile = fixture("CGATS21_CRPC6.icc")

it.each(["adobe-rgb.jpg", "component-rgb.jpg"])(
	"prepares RGB-encoded JPEG colors consistently with equivalent PNG samples: %s",
	async (file) => {
		const jpeg = await prepareCmykImage(fixture(file), {
			destinationProfile,
			sourceProfile: "srgb",
		})
		const png = await prepareCmykImage(fixture("rgb-encoded-reference.png"), {
			destinationProfile,
		})
		expect([jpeg.width, jpeg.height]).toEqual([png.width, png.height])
		expect(jpeg.data).toEqual(png.data)
	},
)

it.each(["rgba.png", "rgba-interlaced.png", "palette.png"])(
	"preserves straight alpha when preparing %s for print",
	async (file) => {
		const prepared = await prepareCmykImage(fixture(file), {
			destinationProfile,
		})
		expect([prepared.width, prepared.height]).toEqual([4, 1])
		expect(Array.from(prepared.alpha!)).toEqual([0, 64, 128, 255])
		expect(prepared.data.length).toBe(16)
		for (let pixel = 1; pixel < 4; pixel++)
			expect(prepared.data.slice(pixel * 4, pixel * 4 + 4)).toEqual(
				prepared.data.slice(0, 4),
			)
		expect(prepared.data.some((value) => value > 0)).toBe(true)
		expect(
			Buffer.from(prepared.destinationProfile).equals(destinationProfile),
		).toBe(true)
	},
)

it("honors embedded source profiles and explicit source assumptions", async () => {
	const embedded = await prepareCmykImage(fixture("p3.png"), {
		destinationProfile,
	})
	const explicit = await prepareCmykImage(fixture("untagged.png"), {
		destinationProfile,
		sourceProfile: fixture("DisplayP3-v4.icc"),
	})
	expect(embedded.data).toEqual(explicit.data)
	const srgb = await prepareCmykImage(fixture("rgba.png"), {
		destinationProfile,
	})
	expect(embedded.data).not.toEqual(srgb.data)
	await expect(
		prepareCmykImage(fixture("untagged.png"), { destinationProfile }),
	).rejects.toThrow()
	const assumed = await prepareCmykImage(fixture("untagged.png"), {
		destinationProfile,
		sourceProfile: "srgb",
	})
	expect(assumed.data).toEqual(srgb.data)
})

it("prepares JPEGs and keeps returned buffers independently owned", async () => {
	const options = { destinationProfile, sourceProfile: "srgb" as const }
	const first = await prepareCmykImage(fixture("rgb.jpg"), options)
	const second = await prepareCmykImage(fixture("rgb.jpg"), options)
	expect(first.data).toEqual(second.data)
	expect([first.width, first.height]).toEqual([4, 1])
	expect(Array.from(first.alpha ?? new Uint8Array(4).fill(255))).toEqual([
		255, 255, 255, 255,
	])
	first.data.fill(0)
	first.destinationProfile.fill(0)
	expect(second.data.some((value) => value > 0)).toBe(true)
	expect(
		Buffer.from(second.destinationProfile).equals(destinationProfile),
	).toBe(true)
})
