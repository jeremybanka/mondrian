import { readFileSync } from "node:fs"
import { crc32 } from "node:zlib"
import { expect, it } from "vite-plus/test"
import { prepareCmykImage } from "../../src/print.ts"
import { decodeImage } from "../../src/print/decode-image.ts"
import { iccColorSpace } from "../../src/icc.ts"

const fixture = (file: string) =>
	readFileSync(
		new URL(`../public/fixtures/print-images/${file}`, import.meta.url),
	)
const destinationProfile = fixture("CGATS21_CRPC6.icc")

it("expands palette transparency without changing the straight samples", () => {
	const rgba = decodeImage(fixture("rgba.png"))
	const palette = decodeImage(fixture("palette.png"))
	expect(palette.rgba).toEqual(rgba.rgba)
	expect(Array.from(rgba.rgba)).toEqual([
		210, 85, 35, 0, 210, 85, 35, 64, 210, 85, 35, 128, 210, 85, 35, 255,
	])
})

it("expands grayscale while retaining its alpha", async () => {
	const prepared = await prepareCmykImage(fixture("gray.png"), {
		destinationProfile,
		sourceProfile: "srgb",
	})
	expect(Array.from(prepared.alpha!)).toEqual([0, 64, 128, 255])
	expect(prepared.data.slice(0, 4)).toEqual(prepared.data.slice(12))
})

it.each([
	(bytes: Buffer) => bytes.subarray(0, 28),
	(bytes: Buffer) => {
		bytes[45] = bytes[45]! ^ 1
		return bytes
	},
	(bytes: Buffer) => {
		bytes.writeUInt32BE(0xfffffff0, 16)
		bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29)
		return bytes
	},
	(bytes: Buffer) => {
		bytes[24] = 16
		bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29)
		return bytes
	},
	(bytes: Buffer) => bytes.subarray(0, -12),
])(
	"rejects damaged or unsupported PNG input before color conversion",
	async (change) => {
		await expect(
			prepareCmykImage(change(fixture("rgba.png")), { destinationProfile }),
		).rejects.toThrow()
	},
)

it("validates ICC envelopes, source channels, and conversion options", async () => {
	expect(() => iccColorSpace(new Uint8Array(10))).toThrow()
	const invalid = Uint8Array.from(destinationProfile)
	invalid[36] = 0
	expect(() => iccColorSpace(invalid)).toThrow()
	await expect(
		prepareCmykImage(fixture("rgba.png"), {
			destinationProfile: fixture("DisplayP3-v4.icc"),
		}),
	).rejects.toThrow()
	await expect(
		prepareCmykImage(fixture("rgba.png"), {
			destinationProfile,
			sourceProfile: destinationProfile,
		}),
	).rejects.toThrow()
	await expect(
		prepareCmykImage(fixture("rgba.png"), {
			destinationProfile,
			renderingIntent: "invalid" as never,
		}),
	).rejects.toThrow()
	await expect(
		prepareCmykImage(fixture("rgba.png"), {
			destinationProfile,
			blackPointCompensation: 1 as never,
		}),
	).rejects.toThrow()
})

it("snapshots profiles before asynchronous engine initialization and conversion", async () => {
	const destination = Buffer.from(destinationProfile)
	const source = fixture("DisplayP3-v4.icc")
	const pending = prepareCmykImage(fixture("untagged.png"), {
		destinationProfile: destination,
		sourceProfile: source,
	})
	destination.fill(0)
	source.fill(0)
	const image = await pending
	expect(Buffer.from(image.destinationProfile).equals(destinationProfile)).toBe(
		true,
	)
	expect(image.data.some((value) => value > 0)).toBe(true)
})
