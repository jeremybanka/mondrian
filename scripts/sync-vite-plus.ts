import { execFileSync } from "node:child_process"
import { globSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

type Manifest = {
	name?: string
	version?: string
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
	optionalDependencies?: Record<string, string>
}

const exactVersion = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/

async function fetchRelease(version: string): Promise<Manifest> {
	const response = await fetch(
		`https://registry.npmjs.org/vite-plus/${encodeURIComponent(version)}`,
		{ signal: AbortSignal.timeout(30_000) },
	)
	if (!response.ok) {
		throw new Error(`Cannot read vite-plus@${version}: ${response.status}`)
	}
	return (await response.json()) as Manifest
}

// Read the version Renovate selected, never the installed package or npm's latest tag.
export async function syncVitePlus(
	root: string,
	loadRelease: (version: string) => Promise<Manifest> = fetchRelease,
): Promise<void> {
	const files = [
		"package.json",
		...globSync("packages/*/package.json", { cwd: root }),
	]
	const manifests = files.map((file) => ({
		file,
		manifest: JSON.parse(readFileSync(join(root, file), "utf8")) as Manifest,
	}))
	const version = manifests[0]?.manifest.devDependencies?.["vite-plus"]
	if (!version || !exactVersion.test(version)) {
		throw new Error("The root vite-plus dependency must be an exact version")
	}
	const release = await loadRelease(version)
	const vitest = release.dependencies?.vitest
	const vite = release.dependencies?.vite
	const core = vite?.match(/^npm:@voidzero-dev\/vite-plus-core@(.+)$/)?.[1]
	if (
		release.name !== "vite-plus" ||
		release.version !== version ||
		!vitest ||
		!exactVersion.test(vitest) ||
		!vite ||
		!core ||
		!exactVersion.test(core)
	) {
		throw new Error(
			`vite-plus@${version} does not declare exact Vite and Vitest versions`,
		)
	}
	const versions: Record<string, string> = {
		"vite-plus": version,
		vite,
		vitest,
		"@voidzero-dev/vite-plus-core": core,
	}
	for (const { file, manifest } of manifests) {
		let changed = false
		// Published peer ranges are a compatibility contract, not toolchain pins.
		for (const section of [
			"dependencies",
			"devDependencies",
			"optionalDependencies",
		] as const) {
			for (const [name, current] of Object.entries(manifest[section] ?? {})) {
				// The ESLint plugin has an independent release cycle.
				const target =
					name.startsWith("@vitest/") && name !== "@vitest/eslint-plugin"
						? vitest
						: versions[name]
				if (target && current !== target) {
					manifest[section]![name] = target
					changed = true
				}
			}
		}
		if (changed) {
			writeFileSync(
				join(root, file),
				`${JSON.stringify(manifest, null, "\t")}\n`,
			)
		}
	}

	// Let pnpm edit its YAML configuration, preserving unrelated settings/overrides.
	const pnpm = (args: string[]) =>
		execFileSync("pnpm", args, { cwd: root, encoding: "utf8" })
	const overrides = JSON.parse(
		pnpm(["config", "get", "--location=project", "--json", "overrides"]),
	) as Record<string, string> | null
	const aligned: Record<string, string> = {
		...overrides,
		"vite@*": vite,
		"vitest@*": vitest,
	}
	// Remove legacy bare pins that would compete with the managed @* overrides.
	delete aligned.vite
	delete aligned.vitest
	pnpm([
		"config",
		"set",
		"--location=project",
		"--json",
		"overrides",
		JSON.stringify(aligned),
	])
	console.log(`Aligned vite-plus@${version}: ${vite}, vitest@${vitest}`)
}

if (import.meta.main) {
	await syncVitePlus(process.cwd())
	// Renovate's normal artifact update is skipped until the versions agree.
	execFileSync("pnpm", ["install", "--lockfile-only", "--ignore-scripts"], {
		stdio: "inherit",
	})
}
