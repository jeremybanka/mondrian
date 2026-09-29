import { readFileSync } from "node:fs"
import { crc32 } from "node:zlib"
import { expect, it } from "vite-plus/test"
import { decodeImage } from "../../src/print/decode-image.ts"
import { prepareCmykImage } from "../../src/print.ts"
import { iccColorSpace } from "../../src/icc.ts"

const fixture = (file: string) =>
	readFileSync(
		new URL(`../public/fixtures/print-images/${file}`, import.meta.url),
	)
const destinationProfile = fixture("CGATS21_CRPC6.icc")

it.each([
	{ bytes: null, diagnostic: /Expected PNG or JPEG bytes/ },
	{ bytes: Uint8Array.of(1, 2, 3), diagnostic: /supports PNG and JPEG/ },
	{ bytes: Uint8Array.of(255, 216, 0), diagnostic: /Invalid JPEG marker/ },
	{
		bytes: Uint8Array.of(255, 216, 255, 224),
		diagnostic: /Truncated JPEG marker/,
	},
	{
		bytes: Uint8Array.of(255, 216, 255, 224, 0, 1),
		diagnostic: /marker length/,
	},
	{
		bytes: Uint8Array.of(255, 216, 255, 224, 0, 10),
		diagnostic: /marker length/,
	},
	{
		bytes: Uint8Array.of(255, 216, 255, 192, 0, 8, 16, 0, 1, 0, 1, 3),
		diagnostic: /Only 8-bit RGB or grayscale/,
	},
	{
		bytes: Uint8Array.of(255, 216, 255, 192, 0, 8, 8, 0, 1, 0, 1, 4),
		diagnostic: /Only 8-bit RGB or grayscale/,
	},
	{
		bytes: Uint8Array.of(255, 216, 255, 1, 255, 217),
		diagnostic: /Image dimensions/,
	},
])(
	"rejects malformed image envelopes before decoding: $diagnostic",
	({ bytes, diagnostic }) => {
		expect(() => decodeImage(bytes as Uint8Array)).toThrow(diagnostic)
	},
)

it("rejects trailing PNG payloads and incomplete chunk envelopes", () => {
	const original = fixture("rgba.png")
	expect(() =>
		decodeImage(Buffer.concat([original, Uint8Array.of(0)])),
	).toThrow(/Invalid PNG end/)
	expect(() => decodeImage(original.subarray(0, 34))).toThrow(
		/Truncated PNG chunk/,
	)
	expect(() => decodeImage(original.subarray(0, 45))).toThrow(
		/Truncated PNG chunk/,
	)
})

function chunk(kind: string, data: Uint8Array) {
	const result = Buffer.alloc(12 + data.length)
	result.writeUInt32BE(data.length)
	result.write(kind, 4)
	result.set(data, 8)
	result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4)
	return result
}
function png(...metadata: Buffer[]) {
	const original = fixture("untagged.png")
	return Buffer.concat([
		original.subarray(0, 33),
		...metadata,
		original.subarray(33),
	])
}
function iccSegment(sequence: number, count: number, bytes: Uint8Array) {
	const header = Buffer.alloc(4)
	header[0] = 255
	header[1] = 0xe2
	header.writeUInt16BE(bytes.length + 16, 2)
	return Buffer.concat([
		header,
		Buffer.from("ICC_PROFILE\0"),
		Buffer.from([sequence, count]),
		bytes,
	])
}
function jpeg(...metadata: Buffer[]) {
	const original = fixture("rgb.jpg")
	return Buffer.concat([
		original.subarray(0, 2),
		...metadata,
		original.subarray(2),
	])
}

it("assembles out-of-order JPEG ICC segments and uses the embedded profile", async () => {
	const profile = fixture("DisplayP3-v4.icc")
	const input = jpeg(
		iccSegment(2, 2, profile.subarray(240)),
		iccSegment(1, 2, profile.subarray(0, 240)),
	)
	expect(decodeImage(input).sourceProfile).toEqual(profile)
	const embedded = await prepareCmykImage(input, { destinationProfile })
	const explicit = await prepareCmykImage(fixture("rgb.jpg"), {
		destinationProfile,
		sourceProfile: profile,
	})
	expect(embedded.data).toEqual(explicit.data)
})

it.each([
	[iccSegment(0, 1, new Uint8Array())],
	[iccSegment(2, 1, new Uint8Array())],
	[iccSegment(1, 2, new Uint8Array())],
	[iccSegment(1, 2, new Uint8Array()), iccSegment(1, 2, new Uint8Array())],
	[iccSegment(1, 2, new Uint8Array()), iccSegment(2, 3, new Uint8Array())],
])(
	"rejects incomplete or contradictory JPEG profile segments",
	(...segments) => {
		expect(() => decodeImage(jpeg(...segments))).toThrow(/ICC profile/)
	},
)

it.each([
	chunk("acTL", new Uint8Array(8)),
	chunk("sRGB", Uint8Array.of(4)),
	chunk("iCCP", Buffer.from("bad\0\x01")),
])("rejects unsupported or malformed PNG metadata", (metadata) => {
	expect(() => decodeImage(png(metadata))).toThrow()
})

it("rejects duplicate and conflicting PNG color declarations", () => {
	const srgb = chunk("sRGB", Uint8Array.of(0))
	expect(() => decodeImage(png(srgb, srgb))).toThrow(/Duplicate/)
	const p3 = fixture("p3.png")
	expect(() =>
		decodeImage(Buffer.concat([p3.subarray(0, 33), srgb, p3.subarray(33)])),
	).toThrow(/conflicting/)
})

it.each([
	[chunk("gAMA", Uint8Array.of(0, 0, 177, 143))],
	[chunk("sRGB", Uint8Array.of(0)), chunk("cICP", Uint8Array.of(1, 13, 0, 1))],
])(
	"requires an explicit interpretation for unsupported PNG color metadata",
	async (...chunks) => {
		const input = png(...chunks)
		await expect(
			prepareCmykImage(input, { destinationProfile }),
		).rejects.toThrow(/sourceProfile/)
		const interpreted = await prepareCmykImage(input, {
			destinationProfile,
			sourceProfile: "srgb",
		})
		const srgb = await prepareCmykImage(fixture("rgba.png"), {
			destinationProfile,
		})
		expect(interpreted.data).toEqual(srgb.data)
		expect(interpreted.alpha).toEqual(srgb.alpha)
	},
)

it("keeps alpha identical across rendering intents and black-point compensation", async () => {
	for (const renderingIntent of [
		"perceptual",
		"relative-colorimetric",
		"saturation",
		"absolute-colorimetric",
	] as const)
		for (const blackPointCompensation of [false, true]) {
			const result = await prepareCmykImage(fixture("rgba.png"), {
				destinationProfile,
				renderingIntent,
				blackPointCompensation,
			})
			expect(result.alpha).toEqual(Uint8Array.of(0, 64, 128, 255))
			expect(result.data).toHaveLength(16)
		}
})

it.each([
	(profile: Buffer) => profile.writeUInt32BE(0, 0),
	(profile: Buffer) => profile.write("link", 12),
	(profile: Buffer) => profile.write("RGB ", 20),
	(profile: Buffer) => profile.writeUInt32BE(0, 128),
	(profile: Buffer) => profile.writeUInt32BE(0, 136),
	(profile: Buffer) => profile.writeUInt32BE(0xfffffff0, 140),
	(profile: Buffer) => profile.write("Lab ", 16),
])("rejects invalid ICC headers and tag bounds", (mutate) => {
	const profile = fixture("DisplayP3-v4.icc")
	mutate(profile)
	expect(() => iccColorSpace(profile)).toThrow()
})

it("rejects profiles that cannot transform samples and permits subsequent valid conversions", async () => {
	const broken = fixture("DisplayP3-v4.icc")
	for (let index = 0; index < broken.readUInt32BE(128); index++)
		broken.write("zzzz", 132 + index * 12)
	await expect(
		prepareCmykImage(fixture("rgba.png"), {
			destinationProfile,
			sourceProfile: broken,
		}),
	).rejects.toThrow()
	const valid = await prepareCmykImage(fixture("rgba.png"), {
		destinationProfile,
	})
	expect(valid.data.some((value) => value > 0)).toBe(true)
})
