import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { afterEach, describe, expect, it } from "vite-plus/test"

import { createPdfDocument, pageSizes } from "../src/index.ts"
import {
	checkPdfArtifact,
	defaultPdfArtifactMode,
	renderPdf,
} from "../src/testing.ts"
import "../src/vitest.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true })),
	)
})

describe("PDF visual artifacts", () => {
	it("renders every page to deterministic PNG data", async () => {
		const rendered = await renderPdf(examplePdf("Hello", 2), { resolution: 72 })

		expect(rendered).toMatchObject({
			background: "#ffffff",
			renderAnnotations: true,
			renderer: {
				canvas: "@napi-rs/canvas@1.0.2",
				name: "pdfjs",
				version: "6.1.200",
			},
			resolution: 72,
		})
		expect(rendered.pages).toHaveLength(2)
		expect(rendered.pages[0]).toMatchObject({
			pageNumber: 1,
			width: 612,
			height: 792,
		})
		expect(String.fromCharCode(...rendered.pages[0]!.png.slice(1, 4))).toBe(
			"PNG",
		)
		expect(rendered.pages[0]!.pixels.some((channel) => channel !== 255)).toBe(
			true,
		)
	})

	it("validates renderer options and honors explicit rendering controls", async () => {
		await expect(renderPdf("pdf" as never)).rejects.toThrow(
			"requires a Uint8Array",
		)
		for (const resolution of [0, -1, Number.POSITIVE_INFINITY]) {
			await expect(
				renderPdf(examplePdf("Invalid"), { resolution }),
			).rejects.toThrow("resolution must be a positive number")
		}

		const rendered = await renderPdf(examplePdf("Controls"), {
			background: "#fef3c7",
			renderAnnotations: false,
			resolution: 36,
		})
		expect(rendered).toMatchObject({
			background: "#fef3c7",
			renderAnnotations: false,
			resolution: 36,
		})
	})

	it("selects update locally and verify in CI with an explicit override", () => {
		expect(defaultPdfArtifactMode({})).toBe("update")
		expect(defaultPdfArtifactMode({ CI: "true" })).toBe("verify")
		expect(defaultPdfArtifactMode({ CI: "false" })).toBe("update")
		expect(
			defaultPdfArtifactMode({
				CI: "true",
				MONDRIAN_PDF_ARTIFACT_MODE: "update",
			}),
		).toBe("update")
		expect(() =>
			defaultPdfArtifactMode({ MONDRIAN_PDF_ARTIFACT_MODE: "sometimes" }),
		).toThrow("must be either update or verify")
	})

	it("updates tracked artifacts and verifies them without rewriting", async () => {
		const root = await temporaryDirectory()
		const directory = join(root, "invoice")
		const first = await checkPdfArtifact(examplePdf("Original"), {
			directory,
			mode: "update",
			resolution: 72,
		})

		expect(first.status).toBe("updated")
		expect(first.changes).toEqual([
			{ kind: "added", path: "manifest.json" },
			{ kind: "added", path: "page-001.png" },
		])
		expect(await readdir(directory)).toEqual(["manifest.json", "page-001.png"])

		const manifest = JSON.parse(
			await readFile(join(directory, "manifest.json"), "utf8"),
		)
		expect(manifest).toMatchObject({
			formatVersion: 1,
			resolution: 72,
			pages: [{ file: "page-001.png", width: 612, height: 792 }],
		})

		const verified = await checkPdfArtifact(examplePdf("Original"), {
			directory,
			mode: "verify",
			resolution: 72,
		})
		expect(verified).toMatchObject({
			status: "matched",
			changes: [],
			pageDifferences: [],
		})
	})

	it("accepts URL directories and detects same-length manifest changes", async () => {
		const root = await temporaryDirectory()
		const directory = join(root, "url-artifact")
		const directoryUrl = pathToFileURL(directory)
		await checkPdfArtifact(examplePdf("URL"), {
			directory: directoryUrl,
			mode: "update",
			resolution: 72,
		})

		const manifestPath = join(directory, "manifest.json")
		const manifest = await readFile(manifestPath, "utf8")
		await writeFile(
			manifestPath,
			manifest.replace('"formatVersion": 1', '"formatVersion": 2'),
		)

		const result = await checkPdfArtifact(examplePdf("URL"), {
			directory: directoryUrl,
			mode: "verify",
			resolution: 72,
		})
		expect(result.changes).toContainEqual({
			kind: "changed",
			path: "manifest.json",
		})
	})

	it("reports image differences without changing the tracked artifact", async () => {
		const root = await temporaryDirectory()
		const directory = join(root, "invoice")
		const failureDirectory = join(root, "failures")
		await checkPdfArtifact(examplePdf("Before"), {
			directory,
			mode: "update",
			resolution: 72,
		})
		const expectedPage = await readFile(join(directory, "page-001.png"))

		const result = await checkPdfArtifact(examplePdf("After"), {
			directory,
			failureDirectory,
			mode: "verify",
			resolution: 72,
		})

		expect(result.status).toBe("mismatched")
		expect(result.changes).toContainEqual({
			kind: "changed",
			path: "page-001.png",
		})
		expect(result.pageDifferences[0]!.differingPixels).toBeGreaterThan(0)
		expect(await readFile(join(directory, "page-001.png"))).toEqual(
			expectedPage,
		)
		expect(
			await readFile(join(failureDirectory, "actual.pdf")),
		).not.toHaveLength(0)
		expect(
			await readFile(join(failureDirectory, "report.html"), "utf8"),
		).toContain("PDF artifact difference")
		expect(
			await readFile(join(failureDirectory, "diff", "page-001.png")),
		).not.toHaveLength(0)

		await checkPdfArtifact(examplePdf("Before"), {
			directory,
			failureDirectory,
			mode: "verify",
			resolution: 72,
		})
		await expect(
			readFile(join(failureDirectory, "report.html")),
		).rejects.toMatchObject({ code: "ENOENT" })
	})

	it("removes stale page artifacts in update mode", async () => {
		const root = await temporaryDirectory()
		const directory = join(root, "pages")
		await checkPdfArtifact(examplePdf("Two", 2), {
			directory,
			mode: "update",
			resolution: 72,
		})

		const result = await checkPdfArtifact(examplePdf("One"), {
			directory,
			mode: "update",
			resolution: 72,
		})

		expect(result.changes).toContainEqual({
			kind: "removed",
			path: "page-002.png",
		})
		expect(await readdir(directory)).toEqual(["manifest.json", "page-001.png"])
	})

	it("reports added and missing pages without rewriting baselines", async () => {
		const root = await temporaryDirectory()
		const onePage = join(root, "one-page")
		await checkPdfArtifact(examplePdf("One"), {
			directory: onePage,
			mode: "update",
			resolution: 72,
		})
		const added = await checkPdfArtifact(examplePdf("Two", 2), {
			directory: onePage,
			mode: "verify",
			resolution: 72,
		})
		expect(added).toMatchObject({ status: "mismatched" })
		expect(added.failureDirectory).toBeUndefined()
		expect(added.changes).toContainEqual({
			kind: "added",
			path: "page-002.png",
		})
		const addedPage = added.pageDifferences.find(
			({ file }) => file === "page-002.png",
		)
		expect(addedPage).toMatchObject({ file: "page-002.png", actualWidth: 612 })
		expect(addedPage).not.toHaveProperty("expectedWidth")

		const twoPages = join(root, "two-pages")
		const failures = join(root, "missing-page-failure")
		await checkPdfArtifact(examplePdf("Two", 2), {
			directory: twoPages,
			mode: "update",
			resolution: 72,
		})
		const removed = await checkPdfArtifact(examplePdf("One"), {
			directory: twoPages,
			failureDirectory: failures,
			mode: "verify",
			resolution: 72,
		})
		expect(removed.changes).toContainEqual({
			kind: "removed",
			path: "page-002.png",
		})
		const removedPage = removed.pageDifferences.find(
			({ file }) => file === "page-002.png",
		)
		expect(removedPage).toMatchObject({
			file: "page-002.png",
			expectedWidth: 612,
		})
		expect(removedPage).not.toHaveProperty("actualWidth")
		expect(await readFile(join(failures, "report.html"), "utf8")).toContain(
			"actual missing",
		)
	})

	it("reports corrupt images and nested unexpected artifacts", async () => {
		const root = await temporaryDirectory()
		const directory = join(root, "corrupt")
		const failures = join(root, "corrupt-failure")
		await checkPdfArtifact(examplePdf("Corrupt"), {
			directory,
			mode: "update",
			resolution: 72,
		})
		await writeFile(join(directory, "page-001.png"), Uint8Array.of(1, 2, 3))

		const corrupt = await checkPdfArtifact(examplePdf("Corrupt"), {
			directory,
			failureDirectory: failures,
			mode: "verify",
			resolution: 72,
		})
		expect(corrupt.pageDifferences[0]).toEqual(
			expect.objectContaining({
				file: "page-001.png",
				error: expect.any(String),
			}),
		)

		await checkPdfArtifact(examplePdf("Nested"), {
			directory,
			mode: "update",
			resolution: 72,
		})
		await mkdir(join(directory, "nested"))
		await writeFile(
			join(directory, "nested", "unexpected.bin"),
			Uint8Array.of(1),
		)
		const nested = await checkPdfArtifact(examplePdf("Nested"), {
			directory,
			mode: "verify",
			resolution: 72,
		})
		expect(nested.changes).toContainEqual({
			kind: "removed",
			path: join("nested", "unexpected.bin"),
		})
	})

	it("rejects overlapping tracked and failure directories", async () => {
		const root = await temporaryDirectory()

		await expect(
			checkPdfArtifact(examplePdf("Unsafe"), {
				directory: root,
				failureDirectory: join(root, "failure"),
				mode: "verify",
				resolution: 72,
			}),
		).rejects.toThrow("must not contain one another")
	})

	it("integrates local updates and verification with Vitest", async () => {
		const artifactRoot = await temporaryDirectory()
		const failureRoot = await temporaryDirectory()
		const bytes = examplePdf("Matcher")

		await expect(bytes).toMatchPdfArtifact("invoice", {
			artifactRoot,
			failureRoot,
			mode: "update",
			resolution: 72,
		})
		await expect(bytes).toMatchPdfArtifact("invoice", {
			artifactRoot,
			failureRoot,
			mode: "verify",
			resolution: 72,
		})

		await expect(
			expect(examplePdf("Changed")).toMatchPdfArtifact("invoice", {
				artifactRoot,
				failureRoot,
				mode: "verify",
				resolution: 72,
			}),
		).rejects.toThrow("would be updated")
	})

	it("validates matcher inputs and supports URL artifact roots", async () => {
		const artifactRoot = await temporaryDirectory()
		const failureRoot = await temporaryDirectory()
		const bytes = examplePdf("Matcher options")

		await expect(
			expect(bytes).not.toMatchPdfArtifact("negated", {
				artifactRoot,
				failureRoot,
			}),
		).rejects.toThrow("cannot be used with .not")
		await expect(
			expect("not PDF bytes").toMatchPdfArtifact("invalid", {
				artifactRoot,
				failureRoot,
			}),
		).rejects.toThrow("expects serialized PDF bytes")

		await expect(bytes).toMatchPdfArtifact(undefined, {
			artifactRoot: pathToFileURL(`${artifactRoot}/`),
			background: "#ffffff",
			failureRoot: pathToFileURL(`${failureRoot}/`),
			mode: "update",
			renderAnnotations: false,
			resolution: 36,
		})
		expect(await readdir(artifactRoot)).toHaveLength(1)

		await expect(bytes).toMatchPdfArtifact("***", {
			artifactRoot,
			failureRoot,
			mode: "update",
		})
		expect(await readdir(artifactRoot)).toContain("pdf")
	})
})

function examplePdf(text: string, pageCount = 1): Uint8Array {
	const pdf = createPdfDocument()
	const helvetica = pdf.standardFont("Helvetica")
	const pages = Array.from({ length: pageCount }, (_, index) =>
		pdf.page({
			mediaBox: pageSizes.letter,
			content: [
				pdf.text((builder) =>
					builder
						.font(helvetica, 24)
						.moveText(72, 700)
						.show(`${text} ${index + 1}`),
				),
			],
		}),
	)
	pdf.setPages(pages[0]!, ...pages.slice(1))
	return pdf.serialize()
}

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "mondrian-pdf-testing-"))
	temporaryDirectories.push(directory)
	return directory
}
