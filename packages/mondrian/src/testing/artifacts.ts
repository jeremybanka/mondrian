// SPDX-License-Identifier: MPL-2.0

import { createCanvas, loadImage } from "@napi-rs/canvas"
import { randomUUID } from "node:crypto"
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises"
import { fileURLToPath } from "node:url"
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path"

import type {
	PdfRenderOptions,
	RenderedPdf,
	RenderedPdfPage,
} from "./render.ts"
import { renderPdf } from "./render.ts"

const textEncoder = new TextEncoder()

export type PdfArtifactMode = "update" | "verify"
export type PdfArtifactStatus = "matched" | "mismatched" | "updated"
export type PdfArtifactChangeKind = "added" | "changed" | "removed"

export interface PdfArtifactChange {
	readonly kind: PdfArtifactChangeKind
	readonly path: string
}

export interface PdfPageDifference {
	readonly file: string
	readonly differingPixels: number
	readonly expectedWidth?: number
	readonly expectedHeight?: number
	readonly actualWidth?: number
	readonly actualHeight?: number
	readonly error?: string
}

export interface PdfArtifactOptions extends PdfRenderOptions {
	/** The tracked directory owned by this artifact. */
	readonly directory: string | URL
	/** Defaults to update locally and verify when CI is truthy. */
	readonly mode?: PdfArtifactMode
	/** An owned directory where verification failure assets are written. */
	readonly failureDirectory?: string | URL
}

export interface PdfArtifactResult {
	readonly mode: PdfArtifactMode
	readonly status: PdfArtifactStatus
	readonly directory: string
	readonly failureDirectory?: string
	readonly pageCount: number
	readonly changes: readonly PdfArtifactChange[]
	readonly pageDifferences: readonly PdfPageDifference[]
}

interface PdfArtifactManifest {
	readonly formatVersion: 1
	readonly renderer: RenderedPdf["renderer"]
	readonly resolution: number
	readonly background: string
	readonly renderAnnotations: boolean
	readonly pages: readonly {
		readonly file: string
		readonly width: number
		readonly height: number
	}[]
}

interface PageDiffOutput {
	readonly difference: PdfPageDifference
	readonly png?: Uint8Array
}

export function defaultPdfArtifactMode(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): PdfArtifactMode {
	const override = environment.MONDRIAN_PDF_ARTIFACT_MODE
	if (override !== undefined) {
		if (override === "update" || override === "verify") {
			return override
		}
		throw new Error(
			"MONDRIAN_PDF_ARTIFACT_MODE must be either update or verify",
		)
	}

	const ci = environment.CI?.toLowerCase()
	return ci !== undefined && ci !== "" && ci !== "0" && ci !== "false"
		? "verify"
		: "update"
}

export async function checkPdfArtifact(
	bytes: Uint8Array,
	options: PdfArtifactOptions,
): Promise<PdfArtifactResult> {
	const directory = absolutePath(options.directory)
	const failureDirectory =
		options.failureDirectory === undefined
			? undefined
			: absolutePath(options.failureDirectory)
	if (
		failureDirectory !== undefined &&
		(pathsContainOneAnother(directory, failureDirectory) ||
			pathsContainOneAnother(failureDirectory, directory))
	) {
		throw new Error(
			"PDF artifact and failure directories must not contain one another",
		)
	}
	const mode = options.mode ?? defaultPdfArtifactMode()
	const rendered = await renderPdf(bytes, options)
	const candidate = artifactFiles(rendered)
	const existing = await readDirectoryFiles(directory)
	const changes = compareFileSets(existing, candidate)

	if (changes.length === 0) {
		await removeFailureDirectory(failureDirectory)
		return Object.freeze({
			mode,
			status: "matched",
			directory,
			pageCount: rendered.pages.length,
			changes: Object.freeze([]),
			pageDifferences: Object.freeze([]),
		})
	}

	if (mode === "update") {
		await replaceDirectory(directory, candidate)
		await removeFailureDirectory(failureDirectory)
		return Object.freeze({
			mode,
			status: "updated",
			directory,
			pageCount: rendered.pages.length,
			changes: Object.freeze(changes),
			pageDifferences: Object.freeze([]),
		})
	}

	const pageDiffOutputs = await comparePages(existing, rendered)
	if (failureDirectory !== undefined) {
		await writeFailureDirectory(
			failureDirectory,
			bytes,
			existing,
			candidate,
			changes,
			pageDiffOutputs,
		)
	}

	return Object.freeze({
		mode,
		status: "mismatched",
		directory,
		...(failureDirectory === undefined ? {} : { failureDirectory }),
		pageCount: rendered.pages.length,
		changes: Object.freeze(changes),
		pageDifferences: Object.freeze(
			pageDiffOutputs.map(({ difference }) => difference),
		),
	})
}

async function removeFailureDirectory(
	directory: string | undefined,
): Promise<void> {
	if (directory !== undefined) {
		await rm(directory, { force: true, recursive: true })
	}
}

function artifactFiles(rendered: RenderedPdf): ReadonlyMap<string, Uint8Array> {
	const digits = Math.max(3, String(rendered.pages.length).length)
	const pages = rendered.pages.map((page) => ({
		file: pageFile(page.pageNumber, digits),
		width: page.width,
		height: page.height,
	}))
	const manifest: PdfArtifactManifest = {
		formatVersion: 1,
		renderer: rendered.renderer,
		resolution: rendered.resolution,
		background: rendered.background,
		renderAnnotations: rendered.renderAnnotations,
		pages,
	}
	const files = new Map<string, Uint8Array>([
		[
			"manifest.json",
			textEncoder.encode(`${JSON.stringify(manifest, null, "\t")}\n`),
		],
	])
	for (const [index, page] of rendered.pages.entries()) {
		files.set(pages[index]!.file, page.png)
	}
	return files
}

function pageFile(pageNumber: number, digits: number): string {
	return `page-${String(pageNumber).padStart(digits, "0")}.png`
}

function compareFileSets(
	expected: ReadonlyMap<string, Uint8Array>,
	actual: ReadonlyMap<string, Uint8Array>,
): PdfArtifactChange[] {
	const paths = new Set([...expected.keys(), ...actual.keys()])
	const changes: PdfArtifactChange[] = []
	for (const path of [...paths].sort()) {
		const expectedBytes = expected.get(path)
		const actualBytes = actual.get(path)
		if (expectedBytes === undefined) {
			changes.push(Object.freeze({ kind: "added", path }))
		} else if (actualBytes === undefined) {
			changes.push(Object.freeze({ kind: "removed", path }))
		} else if (!equalBytes(expectedBytes, actualBytes)) {
			changes.push(Object.freeze({ kind: "changed", path }))
		}
	}
	return changes
}

async function comparePages(
	expected: ReadonlyMap<string, Uint8Array>,
	actual: RenderedPdf,
): Promise<PageDiffOutput[]> {
	const digits = Math.max(3, String(actual.pages.length).length)
	const actualPages = new Map(
		actual.pages.map((page) => [pageFile(page.pageNumber, digits), page]),
	)
	const files = new Set([
		...[...expected.keys()].filter(isPageFile),
		...actualPages.keys(),
	])
	const outputs: PageDiffOutput[] = []

	for (const file of [...files].sort()) {
		const expectedBytes = expected.get(file)
		const actualPage = actualPages.get(file)
		try {
			const expectedImage =
				expectedBytes === undefined ? undefined : await decodePng(expectedBytes)
			const diff = makePageDiff(expectedImage, actualPage)
			outputs.push({
				difference: Object.freeze({ file, ...diff.difference }),
				...(diff.png === undefined ? {} : { png: diff.png }),
			})
		} catch (error) {
			outputs.push({
				difference: Object.freeze({
					file,
					differingPixels:
						actualPage?.width && actualPage.height
							? actualPage.width * actualPage.height
							: 0,
					...(actualPage === undefined
						? {}
						: {
								actualWidth: actualPage.width,
								actualHeight: actualPage.height,
							}),
					error: error instanceof Error ? error.message : String(error),
				}),
			})
		}
	}
	return outputs
}

function makePageDiff(
	expected: DecodedPng | undefined,
	actual: RenderedPdfPage | undefined,
): {
	readonly difference: Omit<PdfPageDifference, "file">
	readonly png: Uint8Array
} {
	const width = Math.max(expected?.width ?? 0, actual?.width ?? 0)
	const height = Math.max(expected?.height ?? 0, actual?.height ?? 0)
	const canvas = createCanvas(Math.max(1, width), Math.max(1, height))
	const context = canvas.getContext("2d")
	const image = context.createImageData(Math.max(1, width), Math.max(1, height))
	let differingPixels = 0

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const expectedOffset = pixelOffset(expected, x, y)
			const actualOffset = pixelOffset(actual, x, y)
			const different =
				expectedOffset === undefined ||
				actualOffset === undefined ||
				!equalPixel(
					expected!.pixels,
					expectedOffset,
					actual!.pixels,
					actualOffset,
				)
			const outputOffset = (y * Math.max(1, width) + x) * 4
			if (different) {
				differingPixels += 1
				image.data.set([255, 0, 80, 255], outputOffset)
			} else {
				const red = actual!.pixels[actualOffset]
				const green = actual!.pixels[actualOffset + 1]
				const blue = actual!.pixels[actualOffset + 2]
				const gray = Math.round((red! + green! + blue!) / 3)
				image.data.set([gray, gray, gray, 96], outputOffset)
			}
		}
	}

	context.putImageData(image, 0, 0)
	return {
		difference: {
			differingPixels,
			...(expected === undefined
				? {}
				: { expectedWidth: expected.width, expectedHeight: expected.height }),
			...(actual === undefined
				? {}
				: { actualWidth: actual.width, actualHeight: actual.height }),
		},
		png: Uint8Array.from(canvas.toBuffer("image/png")),
	}
}

interface DecodedPng {
	readonly width: number
	readonly height: number
	readonly pixels: Uint8ClampedArray
}

async function decodePng(bytes: Uint8Array): Promise<DecodedPng> {
	const image = await loadImage(bytes)
	const canvas = createCanvas(image.width, image.height)
	const context = canvas.getContext("2d")
	context.drawImage(image, 0, 0)
	return {
		width: image.width,
		height: image.height,
		pixels: context.getImageData(0, 0, image.width, image.height).data,
	}
}

function pixelOffset(
	image: { readonly width: number; readonly height: number } | undefined,
	x: number,
	y: number,
): number | undefined {
	return image !== undefined && x < image.width && y < image.height
		? (y * image.width + x) * 4
		: undefined
}

function equalPixel(
	left: Uint8ClampedArray,
	leftOffset: number,
	right: Uint8ClampedArray,
	rightOffset: number,
): boolean {
	return (
		left[leftOffset] === right[rightOffset] &&
		left[leftOffset + 1] === right[rightOffset + 1] &&
		left[leftOffset + 2] === right[rightOffset + 2] &&
		left[leftOffset + 3] === right[rightOffset + 3]
	)
}

async function writeFailureDirectory(
	directory: string,
	actualPdf: Uint8Array,
	expected: ReadonlyMap<string, Uint8Array>,
	actual: ReadonlyMap<string, Uint8Array>,
	changes: readonly PdfArtifactChange[],
	pageDiffs: readonly PageDiffOutput[],
): Promise<void> {
	const files = new Map<string, Uint8Array>([["actual.pdf", actualPdf]])
	for (const [path, bytes] of expected) {
		files.set(join("expected", path), bytes)
	}
	for (const [path, bytes] of actual) {
		files.set(join("actual", path), bytes)
	}
	for (const { difference, png } of pageDiffs) {
		if (png !== undefined) {
			files.set(join("diff", difference.file), png)
		}
	}
	files.set(
		"report.html",
		textEncoder.encode(failureReport(changes, pageDiffs)),
	)
	await replaceDirectory(directory, files)
}

function failureReport(
	changes: readonly PdfArtifactChange[],
	pageDiffs: readonly PageDiffOutput[],
): string {
	const changeItems = changes
		.map(
			(change) =>
				`<li><strong>${change.kind}</strong> <code>${escapeHtml(change.path)}</code></li>`,
		)
		.join("\n")
	const pages = pageDiffs
		.map(({ difference }) => {
			const expected =
				difference.expectedWidth === undefined
					? "missing"
					: `${difference.expectedWidth}×${difference.expectedHeight}`
			const actual =
				difference.actualWidth === undefined
					? "missing"
					: `${difference.actualWidth}×${difference.actualHeight}`
			return `<section>
	<h2>${escapeHtml(difference.file)}</h2>
	<p>${difference.differingPixels.toLocaleString("en-US")} differing pixels; expected ${expected}; actual ${actual}</p>
	<div class="images">
		<figure><figcaption>Expected</figcaption><img src="expected/${difference.file}"></figure>
		<figure><figcaption>Actual</figcaption><img src="actual/${difference.file}"></figure>
		<figure><figcaption>Diff</figcaption><img src="diff/${difference.file}"></figure>
	</div>
</section>`
		})
		.join("\n")
	return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>PDF artifact difference</title>
<style>
body { color: #18181b; font: 15px system-ui, sans-serif; margin: 2rem; }
code { background: #f4f4f5; padding: .15rem .3rem; }
.images { display: grid; gap: 1rem; grid-template-columns: repeat(3, minmax(0, 1fr)); }
figure { margin: 0; min-width: 0; }
figcaption { font-weight: 600; margin-bottom: .5rem; }
img { background: #eee; border: 1px solid #d4d4d8; height: auto; width: 100%; }
</style>
<h1>PDF artifact difference</h1>
<ul>${changeItems}</ul>
${pages}
</html>
`
}

async function replaceDirectory(
	directory: string,
	files: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
	const parent = dirname(directory)
	const name = basename(directory)
	await mkdir(parent, { recursive: true })
	const temporary = await mkdtemp(join(parent, `.${name}.candidate-`))
	let backup: string | undefined

	try {
		for (const [path, bytes] of files) {
			const destination = join(temporary, path)
			await mkdir(dirname(destination), { recursive: true })
			await writeFile(destination, bytes)
		}

		if (await exists(directory)) {
			backup = join(parent, `.${name}.previous-${randomUUID()}`)
			await rename(directory, backup)
		}

		try {
			await rename(temporary, directory)
		} catch (error) {
			if (backup !== undefined) {
				await rename(backup, directory)
				backup = undefined
			}
			throw error
		}
	} finally {
		await rm(temporary, { force: true, recursive: true })
		if (backup !== undefined) {
			await rm(backup, { force: true, recursive: true })
		}
	}
}

async function readDirectoryFiles(
	directory: string,
): Promise<ReadonlyMap<string, Uint8Array>> {
	if (!(await exists(directory))) {
		return new Map()
	}
	const files = new Map<string, Uint8Array>()
	await visit(directory, "", files)
	return files
}

async function visit(
	root: string,
	path: string,
	files: Map<string, Uint8Array>,
): Promise<void> {
	const entries = await readdir(join(root, path), { withFileTypes: true })
	for (const entry of entries) {
		const relativePath = join(path, entry.name)
		if (entry.isDirectory()) {
			await visit(root, relativePath, files)
		} else {
			files.set(
				relativePath,
				Uint8Array.from(await readFile(join(root, relativePath))),
			)
		}
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path)
		return true
	} catch (error) {
		if (isFileSystemError(error, "ENOENT")) {
			return false
		}
		throw error
	}
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) {
		return false
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false
		}
	}
	return true
}

function isPageFile(path: string): boolean {
	return /^page-\d+\.png$/u.test(path)
}

function absolutePath(path: string | URL): string {
	return resolve(path instanceof URL ? fileURLToPath(path) : path)
}

function pathsContainOneAnother(parent: string, child: string): boolean {
	const path = relative(parent, child)
	return (
		path === "" ||
		(path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
	)
}

function isFileSystemError(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
}
