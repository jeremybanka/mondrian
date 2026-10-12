import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const consumer = await mkdtemp(join(tmpdir(), "mondrian-installed-guide-"))
try {
	const archive = join(consumer, "mondrian.tgz")
	await execFileAsync("pnpm", ["pack", "--out", archive], { cwd: packageRoot })
	await writeFile(
		join(consumer, "package.json"),
		JSON.stringify({
			name: "mondrian-guide-consumer",
			private: true,
			type: "module",
		}),
	)
	await execFileAsync(
		"pnpm",
		["add", "--offline", "--ignore-scripts", archive],
		{ cwd: consumer },
	)
	const installed = join(consumer, "node_modules", "mondrian.pdf")
	const manifest = JSON.parse(
		await readFile(join(installed, "package.json"), "utf8"),
	) as { bin: { mondrian: string } }
	assert.equal(manifest.bin.mondrian, "./dist/mondrian.mjs")
	const entry = join(installed, manifest.bin.mondrian)
	assert.ok((await readFile(entry, "utf8")).startsWith("#!/usr/bin/env node"))
	const bin = join(
		consumer,
		"node_modules",
		".bin",
		process.platform === "win32" ? "mondrian.cmd" : "mondrian",
	)
	await readFile(bin)
	const command = process.platform === "win32" ? process.execPath : bin
	const prefix = process.platform === "win32" ? [entry] : []
	const help = await execFileAsync(command, [...prefix, "--help"], {
		cwd: consumer,
	})
	assert.match(help.stdout, /Usage: mondrian/)
	await assert.rejects(
		execFileAsync(command, [...prefix, "--port", "invalid"], { cwd: consumer }),
		/Command failed/,
	)

	const child = spawn(command, [...prefix, "--port", "0"], {
		cwd: consumer,
		stdio: ["ignore", "pipe", "pipe"],
	})
	const closed = new Promise<void>((resolve) =>
		child.once("close", () => resolve()),
	)
	let stderr = ""
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString()
	})
	try {
		const url = await new Promise<string>((resolve, reject) => {
			let stdout = ""
			const timeout = setTimeout(
				() => reject(new Error(`Guide startup timed out: ${stderr}`)),
				10000,
			)
			child.on("error", (error) => {
				clearTimeout(timeout)
				reject(error)
			})
			child.on("exit", (code) => {
				clearTimeout(timeout)
				reject(new Error(`Guide exited with ${code}: ${stderr}`))
			})
			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString()
				const match = /http:\/\/127\.0\.0\.1:\d+\//.exec(stdout)
				if (match) {
					clearTimeout(timeout)
					resolve(match[0])
				}
			})
		})
		for (const path of ["", "objects", "pages", "mondrian"]) {
			const response = await fetch(new URL(path, url), {
				signal: AbortSignal.timeout(5000),
			})
			assert.equal(response.status, 200)
			assert.match(await response.text(), /How does a PDF work/)
		}
		for (const name of await readdir(
			join(installed, "dist", "app", "assets"),
		)) {
			const response = await fetch(new URL(`assets/${name}`, url), {
				signal: AbortSignal.timeout(5000),
			})
			assert.equal(response.status, 200)
			assert.ok((await response.arrayBuffer()).byteLength > 0)
		}
		assert.equal((await fetch(new URL("assets/missing.js", url))).status, 404)
		process.stdout.write(
			"Installed-package check passed: mondrian bin, bundled assets, and direct chapter routes.\n",
		)
	} finally {
		child.kill("SIGTERM")
		await closed
	}
} finally {
	await rm(consumer, { recursive: true, force: true })
}
