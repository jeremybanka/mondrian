import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { runInNewContext } from "node:vm"
import { inflateSync } from "node:zlib"
import { expect, it } from "vite-plus/test"

const execFileAsync = promisify(execFile)

it("bundles a core-only package import for browsers with Bun", async () => {
	const bundle = await browserBundle(`
		import { createPdfDocument } from "mondrian.pdf"
		console.log(createPdfDocument)
	`)
	const output: unknown[] = []
	runInNewContext(bundle, {
		console: { log: (value: unknown) => output.push(value) },
	})
	expect(output).toEqual([expect.any(Function)])
})

it("compresses color content in a browser bundle without Node globals", async () => {
	const bundle = await browserBundle(`
		import {
			bindColorContent, colorContent, compressColorContent,
			createPdfObjectBuilder, fillColor, rgb, separation, spot,
		} from "mondrian.pdf"
		const ink = separation("Browser Red", {
			type: "exponential", zero: rgb(1, 1, 1), full: rgb(1, 0, 0), exponent: 1,
		})
		const bound = bindColorContent(createPdfObjectBuilder(), [
			colorContent([fillColor(spot(ink, 1)), "0 0 100 100 re f\\n".repeat(100)]),
		])
		const compressed = compressColorContent(bound)
		console.log({
			original: Array.from(bound.stream.data),
			compressed: Array.from(compressed.stream.data),
			filter: compressed.stream.entries.Filter,
			resourcesPreserved: compressed.resources === bound.resources &&
				compressed.stream.requiredResources === bound.stream.requiredResources,
		})
	`)
	let output:
		| {
				original: number[]
				compressed: number[]
				filter: unknown
				resourcesPreserved: boolean
		  }
		| undefined
	// A fresh VM supplies JavaScript globals, but no Buffer, process, or require.
	runInNewContext(bundle, {
		TextEncoder,
		TextDecoder,
		console: {
			log: (value: typeof output) => {
				output = value
			},
		},
	})
	expect(output).toBeDefined()
	expect(output!.filter).toEqual({ kind: "name", value: "FlateDecode" })
	expect(output!.resourcesPreserved).toBe(true)
	expect(Array.from(inflateSync(Uint8Array.from(output!.compressed)))).toEqual(
		output!.original,
	)
	expect(output!.compressed.length).toBeLessThan(output!.original.length)
})

async function browserBundle(source: string): Promise<string> {
	// Keep the entry inside the package so Bun resolves its published export map.
	const directory = await mkdtemp(
		fileURLToPath(new URL(".browser-bundle-", import.meta.url)),
	)
	try {
		const entry = join(directory, "entry.ts")
		const output = join(directory, "bundle.js")
		await writeFile(entry, source)
		await execFileAsync(
			"bun",
			[
				"build",
				entry,
				"--target",
				"browser",
				"--format",
				"iife",
				"--outfile",
				output,
			],
			{ timeout: 30_000 },
		)
		return await readFile(output, "utf8")
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}
