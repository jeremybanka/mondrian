import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const packageRoot = path.resolve(import.meta.dirname, "..")
const root = path.resolve(packageRoot, "../..")
const base = process.env.COVERAGE_BASE_REF ?? "origin/main"

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function run(command: string, args: string[], cwd: string): void {
	const result = spawnSync(command, args, { cwd, stdio: "inherit" })
	if (result.error) throw result.error
	if (result.status !== 0)
		throw new Error(`${command} failed (${result.status}).`)
}

function statements(directory: string): number {
	const report = JSON.parse(
		readFileSync(
			path.join(directory, "coverage/coverage-summary.json"),
			"utf8",
		),
	) as {
		total?: { statements?: { total: number; covered: number } }
	}
	const summary = report.total?.statements
	if (
		!summary ||
		!Number.isSafeInteger(summary.total) ||
		!Number.isSafeInteger(summary.covered) ||
		summary.total <= 0 ||
		summary.covered < 0 ||
		summary.covered > summary.total
	) {
		throw new Error(
			`Missing or empty source statement coverage in ${directory}.`,
		)
	}
	return Math.floor((summary.covered / summary.total) * 10000) / 100
}

git("fetch", "origin", base.replace(/^origin\//, ""), "--no-tags")
const baseline = git("rev-parse", `${base}^{commit}`)
const current = statements(packageRoot)
if (git("rev-parse", "HEAD") === baseline) {
	// Keep publishing the default branch's report through the existing CLI.
	run(
		path.join(packageRoot, "node_modules/.bin/recoverage"),
		["capture"],
		packageRoot,
	)
} else {
	const directory = mkdtempSync(
		path.join(tmpdir(), "mondrian-source-baseline-"),
	)
	try {
		const archive = execFileSync(
			"git",
			[
				"archive",
				"--format=tar",
				baseline,
				"packages/mondrian",
				"tsconfig.json",
			],
			{ cwd: root, maxBuffer: 128 * 1024 * 1024 },
		)
		execFileSync("tar", ["-xf", "-", "-C", directory], { input: archive })
		const previousPackage = path.join(directory, "packages/mondrian")
		symlinkSync(
			path.join(root, "node_modules"),
			path.join(directory, "node_modules"),
			"dir",
		)
		symlinkSync(
			path.join(packageRoot, "node_modules"),
			path.join(previousPackage, "node_modules"),
			"dir",
		)
		// Apply one source instrumentation policy to both implementations. The
		// hosted baseline was measured through bundles and has different spans.
		cpSync(
			path.join(packageRoot, "vite.config.ts"),
			path.join(previousPackage, "vite.config.ts"),
		)
		cpSync(
			path.join(root, "tsconfig.json"),
			path.join(directory, "tsconfig.json"),
		)
		run(
			path.join(root, "node_modules/.bin/vp"),
			["test", "run", "--coverage", "--passWithNoTests=false"],
			previousPackage,
		)
		const previous = statements(previousPackage)
		console.log(
			`Source statement coverage: ${previous}% -> ${current}% (base ${baseline}).`,
		)
		if (current < previous)
			throw new Error("Source statement coverage decreased.")
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}
