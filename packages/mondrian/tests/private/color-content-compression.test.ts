import { inflateSync } from "node:zlib"
import { expect, it } from "vite-plus/test"
import { compressColorContent, dictionary, stream } from "../../src/index.ts"

it("round-trips content across DEFLATE block transitions", () => {
	// Fixed-seed xorshift bytes resist compression without ambient randomness.
	let seed = 0x12345678
	const data = Uint8Array.from({ length: 170_000 }, () => {
		seed ^= seed << 13
		seed ^= seed >>> 17
		seed ^= seed << 5
		return seed & 0xff
	})
	const bound = { stream: stream({}, data), resources: dictionary({}) }
	const compressed = compressColorContent(bound).stream.data
	// After the two-byte zlib header, BFINAL=0 proves another block follows.
	// Keep block layout private: it is not a public compression contract.
	expect(compressed[2]! & 1).toBe(0)
	expect(new Uint8Array(inflateSync(compressed))).toEqual(data)
})
