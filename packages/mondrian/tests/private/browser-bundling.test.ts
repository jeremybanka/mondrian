import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { runInNewContext } from "node:vm"
import { inflateSync } from "node:zlib"
import { expect, it } from "vite-plus/test"
import type { PdfDictionary } from "mondrian.pdf"

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
			originalResources: bound.resources,
			resources: compressed.resources,
			requiredResources: compressed.stream.requiredResources,
		})
	`)
	let output:
		| {
				original: number[]
				compressed: number[]
				filter: unknown
				originalResources: PdfDictionary
				resources: PdfDictionary
				requiredResources: PdfDictionary | undefined
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
	expect(output!.resources).toEqual(output!.originalResources)
	expect(output!.requiredResources).toEqual(output!.originalResources)
	expect(Array.from(inflateSync(Uint8Array.from(output!.compressed)))).toEqual(
		output!.original,
	)
	expect(output!.compressed.length).toBeLessThan(output!.original.length)
})

it("parses PDFs in a browser bundle without Node globals", async () => {
	const bundle = await browserBundle(`
		import { createPdfDocument, parsePdf, rectangle, serializePdf } from "mondrian.pdf"
		const pdf = createPdfDocument()
		pdf.setPages(pdf.page({ mediaBox: rectangle(0, 0, 100, 100) }))
		const original = pdf.serialize()
		const parsed = parsePdf(original)
		console.log({ version: parsed.version, count: parsed.objects.length, same: serializePdf(parsed).every((byte, index) => byte === original[index]) })
	`)
	const output: unknown[] = []
	runInNewContext(bundle, {
		TextEncoder,
		TextDecoder,
		console: { log: (value: unknown) => output.push(value) },
	})
	expect(output).toEqual([{ version: "1.7", count: 4, same: true }])
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
