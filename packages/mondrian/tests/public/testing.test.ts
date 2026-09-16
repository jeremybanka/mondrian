import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vite-plus/test"
import { createPdfDocument, rectangle } from "mondrian.pdf"
import {
	checkPdfArtifact,
	defaultPdfArtifactMode,
	renderPdf,
} from "mondrian.pdf/testing"
import "mondrian.pdf/vitest"

it("renders each page at the requested resolution and background", async () => {
	const pdf = createPdfDocument()
	pdf.setPages(
		pdf.page({ mediaBox: rectangle(0, 0, 100, 60) }),
		pdf.page({ mediaBox: rectangle(0, 0, 40, 80) }),
	)
	const result = await renderPdf(pdf.serialize(), {
		resolution: 144,
		background: "#123456",
	})
	expect(
		result.pages.map(({ pageNumber, width, height }) => ({
			pageNumber,
			width,
			height,
		})),
	).toEqual([
		{ pageNumber: 1, width: 200, height: 120 },
		{ pageNumber: 2, width: 80, height: 160 },
	])
	for (const page of result.pages) {
		expect(Array.from(page.pixels.slice(0, 4))).toEqual([0x12, 0x34, 0x56, 255])
		// PNG's signature is a format requirement, independent of compression.
		expect(Array.from(page.png.slice(0, 8))).toEqual([
			137, 80, 78, 71, 13, 10, 26, 10,
		])
	}
})

it("updates artifacts explicitly and verifies changes without overwriting the baseline", async () => {
	const root = await mkdtemp(join(tmpdir(), "mondrian-artifact-contract-"))
	try {
		const pdf = createPdfDocument()
		pdf.setPages(pdf.page({ mediaBox: rectangle(0, 0, 20, 20) }))
		const bytes = pdf.serialize()
		const directory = join(root, "baseline")
		const options = {
			directory,
			failureDirectory: join(root, "failure"),
			resolution: 72,
		}
		expect(
			(await checkPdfArtifact(bytes, { ...options, mode: "verify" })).status,
		).toBe("mismatched")
		expect(
			(await checkPdfArtifact(bytes, { ...options, mode: "update" })).status,
		).toBe("updated")
		async function baselineFiles(
			relativeDirectory = "",
		): Promise<readonly (readonly [string, Buffer])[]> {
			const entries = await readdir(join(directory, relativeDirectory), {
				withFileTypes: true,
			})
			const files = await Promise.all(
				entries.map(async (entry) => {
					const path = join(relativeDirectory, entry.name)
					return entry.isDirectory()
						? baselineFiles(path)
						: [[path, await readFile(join(directory, path))] as const]
				}),
			)
			return files.flat().sort(([left], [right]) => left.localeCompare(right))
		}
		const baseline = await baselineFiles()
		expect(
			(await checkPdfArtifact(bytes, { ...options, mode: "verify" })).status,
		).toBe("matched")
		expect(
			(
				await checkPdfArtifact(bytes, {
					...options,
					mode: "verify",
					background: "#ff0000",
				})
			).status,
		).toBe("mismatched")
		expect(await baselineFiles()).toEqual(baseline)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

it("registers the Vitest matcher and fails it when a rendered page changes", async () => {
	const root = await mkdtemp(join(tmpdir(), "mondrian-matcher-contract-"))
	try {
		const pdf = createPdfDocument()
		pdf.setPages(pdf.page({ mediaBox: rectangle(0, 0, 20, 20) }))
		const bytes = pdf.serialize()
		const options = {
			artifactRoot: join(root, "baseline"),
			failureRoot: join(root, "failure"),
			resolution: 72,
		}
		await expect(bytes).toMatchPdfArtifact("blank-page", {
			...options,
			mode: "update",
		})
		await expect(bytes).toMatchPdfArtifact("blank-page", {
			...options,
			mode: "verify",
		})
		await expect(
			expect(bytes).toMatchPdfArtifact("blank-page", {
				...options,
				mode: "verify",
				background: "#0000ff",
			}),
		).rejects.toThrow()
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

it("defaults artifact verification to CI while honoring an explicit mode", () => {
	expect(defaultPdfArtifactMode({ CI: "true" })).toBe("verify")
	expect(defaultPdfArtifactMode({})).toBe("update")
	expect(
		defaultPdfArtifactMode({
			CI: "true",
			MONDRIAN_PDF_ARTIFACT_MODE: "update",
		}),
	).toBe("update")
})
