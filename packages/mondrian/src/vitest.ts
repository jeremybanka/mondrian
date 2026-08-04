// SPDX-License-Identifier: MPL-2.0

import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { expect } from "vitest"
import type { ExpectStatic, MatcherState } from "vitest"

import type {
	PdfArtifactMode,
	PdfArtifactOptions,
	PdfArtifactResult,
	PdfRenderOptions,
} from "./testing.ts"
import { checkPdfArtifact } from "./testing.ts"

export interface PdfArtifactMatcherOptions extends PdfRenderOptions {
	/** Defaults to update locally and verify when CI is truthy. */
	readonly mode?: PdfArtifactMode
	/** Defaults to __pdf_artifacts__ beside the current test file. */
	readonly artifactRoot?: string | URL
	/** Defaults to artifacts/pdf from the working directory. */
	readonly failureRoot?: string | URL
}

declare module "vitest" {
	interface Assertion<T = any> {
		toMatchPdfArtifact(
			name?: string,
			options?: PdfArtifactMatcherOptions,
		): Promise<void>
	}
}

export function installPdfArtifactMatchers(
	expectInstance: ExpectStatic = expect,
): void {
	expectInstance.extend({ toMatchPdfArtifact })
}

async function toMatchPdfArtifact(
	this: MatcherState,
	received: unknown,
	name?: string,
	options: PdfArtifactMatcherOptions = {},
) {
	if (this.isNot) {
		throw new Error("toMatchPdfArtifact cannot be used with .not")
	}
	if (!(received instanceof Uint8Array)) {
		throw new TypeError("toMatchPdfArtifact expects serialized PDF bytes")
	}
	if (this.testPath === undefined || this.currentTestName === undefined) {
		throw new Error("toMatchPdfArtifact requires an active Vitest test")
	}

	const artifactName = slug(name ?? this.currentTestName)
	const artifactRoot =
		options.artifactRoot === undefined
			? join(
					dirname(this.testPath),
					"__pdf_artifacts__",
					basename(this.testPath),
				)
			: absolutePath(options.artifactRoot)
	const failureRoot =
		options.failureRoot === undefined
			? join(process.cwd(), "artifacts", "pdf")
			: absolutePath(options.failureRoot)
	const testPath = safeRelativePath(relative(process.cwd(), this.testPath))
	const result = await checkPdfArtifact(
		received,
		matcherArtifactOptions(
			join(artifactRoot, artifactName),
			join(failureRoot, testPath, artifactName),
			options,
		),
	)

	if (result.status === "updated") {
		console.info(formatUpdate(result))
	}

	return {
		pass: result.status !== "mismatched",
		message: () => formatMismatch(result),
	}
}

function matcherArtifactOptions(
	directory: string,
	failureDirectory: string,
	options: PdfArtifactMatcherOptions,
): PdfArtifactOptions {
	return {
		directory,
		failureDirectory,
		...(options.mode === undefined ? {} : { mode: options.mode }),
		...(options.resolution === undefined
			? {}
			: { resolution: options.resolution }),
		...(options.background === undefined
			? {}
			: { background: options.background }),
		...(options.renderAnnotations === undefined
			? {}
			: { renderAnnotations: options.renderAnnotations }),
	}
}

function formatUpdate(result: PdfArtifactResult): string {
	const changes = result.changes
		.map((change) => `  ${change.kind.padEnd(7)} ${change.path}`)
		.join("\n")
	return `PDF artifact updated: ${result.directory}\n${changes}`
}

function formatMismatch(result: PdfArtifactResult): string {
	const changes = result.changes
		.map((change) => `  would ${change.kind.padEnd(7)} ${change.path}`)
		.join("\n")
	const pixels = result.pageDifferences
		.filter((page) => page.differingPixels > 0 || page.error !== undefined)
		.map(
			(page) =>
				`  ${page.file}: ${page.differingPixels.toLocaleString("en-US")} differing pixels${
					page.error === undefined ? "" : ` (${page.error})`
				}`,
		)
		.join("\n")
	return [
		`PDF visual artifacts would be updated in ${result.directory}`,
		changes,
		pixels,
		result.failureDirectory === undefined
			? ""
			: `Failure report: ${join(result.failureDirectory, "report.html")}`,
	]
		.filter((part) => part !== "")
		.join("\n")
}

function slug(value: string): string {
	const result = value
		.normalize("NFKD")
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/gu, "-")
		.replaceAll(/^-|-$/gu, "")
		.slice(0, 100)
	return result === "" ? "pdf" : result
}

function safeRelativePath(path: string): string {
	return path
		.split(/[\\/]+/u)
		.filter((part) => part !== ".." && part !== "")
		.map(slug)
		.join("/")
}

function absolutePath(path: string | URL): string {
	return resolve(path instanceof URL ? fileURLToPath(path) : path)
}

installPdfArtifactMatchers()
