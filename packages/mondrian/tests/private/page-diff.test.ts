import { createCanvas } from "@napi-rs/canvas"
import { PNG } from "pngjs"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { makePageDiff } from "../../src/testing/artifacts.ts"

vi.mock("@napi-rs/canvas", async (importOriginal) => {
	const canvas = await importOriginal<typeof import("@napi-rs/canvas")>()
	return { ...canvas, createCanvas: vi.fn(canvas.createCanvas) }
})

function page(width = 2, height = 1) {
	return {
		width,
		height,
		pixels: new Uint8ClampedArray(width * height * 4).fill(255),
		pageNumber: 1,
		png: new Uint8Array(),
	}
}

function diagnostic(png: Uint8Array | undefined) {
	expect(png).toBeDefined()
	expect(createCanvas).toHaveBeenCalledOnce()
	return PNG.sync.read(Buffer.from(png!))
}

beforeEach(() => vi.clearAllMocks())

describe("page diff diagnostics", () => {
	it("skips canvas allocation and PNG encoding for identical RGBA views", () => {
		const expected = page()
		const actual = page()
		// Different offsets, lengths of backing buffers, and bytes outside the views.
		expected.pixels = new Uint8ClampedArray([
			9, 10, 20, 30, 40, 50, 60, 70, 80, 9,
		]).subarray(1, 9)
		actual.pixels = new Uint8ClampedArray([
			8, 8, 10, 20, 30, 40, 50, 60, 70, 80, 8, 8,
		]).subarray(2, 10)
		expect(makePageDiff(expected, actual)).toEqual({
			difference: {
				differingPixels: 0,
				expectedWidth: 2,
				expectedHeight: 1,
				actualWidth: 2,
				actualHeight: 1,
			},
		})
		expect(createCanvas).not.toHaveBeenCalled()
	})

	it.each([0, 1, 2, 3, 4, 5, 6, 7])(
		"diagnoses a one-byte change at RGBA offset %i",
		(offset) => {
			const expected = page()
			const actual = page()
			actual.pixels[offset] = 254
			const result = makePageDiff(expected, actual)
			expect(result.difference.differingPixels).toBe(1)
			const png = diagnostic(result.png)
			expect([png.width, png.height]).toEqual([2, 1])
			const changedPixel = Math.floor(offset / 4) * 4
			expect([...png.data.subarray(changedPixel, changedPixel + 4)]).toEqual([
				255, 0, 80, 255,
			])
			const unchangedPixel = changedPixel === 0 ? 4 : 0
			expect([
				...png.data.subarray(unchangedPixel, unchangedPixel + 4),
			]).toEqual([255, 255, 255, 96])
		},
	)

	it("diagnoses changed dimensions even when RGBA buffers match", () => {
		const result = makePageDiff(page(2, 1), page(1, 2))
		expect(result.difference).toEqual({
			differingPixels: 3,
			expectedWidth: 2,
			expectedHeight: 1,
			actualWidth: 1,
			actualHeight: 2,
		})
		const png = diagnostic(result.png)
		expect([png.width, png.height]).toEqual([2, 2])
		expect([...png.data.subarray(4)]).toEqual(
			Array.from({ length: 3 }, () => [255, 0, 80, 255]).flat(),
		)
	})

	it.each(["expected", "actual"])("diagnoses a missing %s page", (missing) => {
		const result = makePageDiff(
			missing === "expected" ? undefined : page(),
			missing === "actual" ? undefined : page(),
		)
		expect(result.difference).toEqual({
			differingPixels: 2,
			...(missing === "expected"
				? { actualWidth: 2, actualHeight: 1 }
				: { expectedWidth: 2, expectedHeight: 1 }),
		})
		const png = diagnostic(result.png)
		expect([png.width, png.height]).toEqual([2, 1])
		expect([...png.data]).toEqual([255, 0, 80, 255, 255, 0, 80, 255])
	})
})
