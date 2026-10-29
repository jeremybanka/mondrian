// Run from the repository root: node --expose-gc packages/mondrian/scripts/benchmark-page-diff.ts
// Measures comparison of two separately allocated, already decoded 20 MP pages.
// PDF rendering and baseline PNG decoding are intentionally outside the timing.
// Reference run on Node 26.12.1 (Linux), two warmups and seven measured calls:
// c8d4d1f (only exporting makePageDiff): median 1150.97 ms, peak RSS 1714820 KiB.
// With the equality fast path: median 4.31 ms, peak RSS 259408 KiB (~267x faster).
// Peak RSS covers the entire process; timing is informational, not a CI threshold.
import { strict as assert } from "node:assert"
import { performance } from "node:perf_hooks"

import { makePageDiff } from "../src/testing/artifacts.ts"

const width = 5_000
const height = 4_000
const pixels = new Uint8ClampedArray(width * height * 4)
for (let offset = 0; offset < pixels.length; offset += 4) {
	const shade = (offset / 4) % 256
	pixels.set([shade, shade, shade, 255], offset)
}
const expected = { width, height, pixels }
const actual = {
	width,
	height,
	pixels: pixels.slice(),
	pageNumber: 1,
	png: new Uint8Array(),
}
const samples: number[] = []
let diagnosticBytes = 0
for (let iteration = 0; iteration < 9; iteration += 1) {
	globalThis.gc?.()
	const start = performance.now()
	const result = makePageDiff(expected, actual)
	const elapsed = performance.now() - start
	assert.equal(result.difference.differingPixels, 0)
	diagnosticBytes = result.png?.byteLength ?? 0
	if (iteration >= 2) samples.push(elapsed)
}
samples.sort((left, right) => left - right)
console.log(
	JSON.stringify(
		{
			node: process.version,
			pixels: width * height,
			samples: samples.length,
			medianMs: samples[Math.floor(samples.length / 2)],
			minMs: samples[0],
			diagnosticBytes,
			maxRssKiB: process.resourceUsage().maxRSS,
		},
		null,
		2,
	),
)
