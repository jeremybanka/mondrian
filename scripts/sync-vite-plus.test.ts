import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { syncVitePlus } from "./sync-vite-plus.ts"

function fixture(version = "1.0.0-rc.0") {
	const root = mkdtempSync(join(tmpdir(), "vite-plus-sync-"))
	mkdirSync(join(root, "packages/example"), { recursive: true })
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({
			private: true,
			devDependencies: {
				"vite-plus": version,
				"@vitest/coverage-v8": "5.0.2",
				"@vitest/coverage-istanbul": "4.1.11",
				"@vitest/eslint-plugin": "1.6.0",
				"@vitejs/plugin-react": "6.0.0",
			},
		}),
	)
	writeFileSync(
		join(root, "packages/example/package.json"),
		JSON.stringify({
			name: "example",
			devDependencies: { vitest: "5.0.2", vite: "8.1.3" },
			optionalDependencies: { "@voidzero-dev/vite-plus-core": "0.3.3" },
			peerDependencies: { vitest: ">=4.1.3" },
			peerDependenciesMeta: { vitest: { optional: true } },
		}),
	)
	writeFileSync(
		join(root, "pnpm-workspace.yaml"),
		[
			"packages:",
			"  - packages/*",
			"minimumReleaseAge: 1440",
			"overrides:",
			"  unrelated: 1.2.3",
			"  vite: 8.1.3",
			"  vitest: 5.0.2",
			"",
		].join("\n"),
	)
	return root
}

function readJson(root: string, file: string) {
	return JSON.parse(readFileSync(join(root, file), "utf8"))
}

for (const [version, vitest] of [
	["0.3.3", "4.1.11"],
	["1.0.0-rc.0", "5.0.1"],
] as const) {
	await test(`aligns the workspace with vite-plus@${version}, including downgrades`, async (t) => {
		const root = fixture(version)
		t.after(() => rmSync(root, { recursive: true, force: true }))
		const vite = `npm:@voidzero-dev/vite-plus-core@${version}`
		const loadRelease = async (requested: string) => {
			assert.equal(requested, version)
			return { name: "vite-plus", version, dependencies: { vite, vitest } }
		}
		await syncVitePlus(root, loadRelease)
		assert.deepEqual(readJson(root, "package.json").devDependencies, {
			"vite-plus": version,
			"@vitest/coverage-v8": vitest,
			"@vitest/coverage-istanbul": vitest,
			"@vitest/eslint-plugin": "1.6.0",
			"@vitejs/plugin-react": "6.0.0",
		})
		const member = readJson(root, "packages/example/package.json")
		assert.deepEqual(member.devDependencies, { vitest, vite })
		assert.deepEqual(member.optionalDependencies, {
			"@voidzero-dev/vite-plus-core": version,
		})
		assert.deepEqual(member.peerDependencies, { vitest: ">=4.1.3" })
		assert.deepEqual(member.peerDependenciesMeta, {
			vitest: { optional: true },
		})
		assert.deepEqual(
			JSON.parse(
				execFileSync(
					"pnpm",
					["config", "get", "--location=project", "--json", "overrides"],
					{ cwd: root, encoding: "utf8" },
				),
			),
			{
				unrelated: "1.2.3",
				"vite@*": vite,
				"vitest@*": vitest,
			},
		)
		assert.match(
			readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"),
			/minimumReleaseAge: 1440/,
		)
		const files = [
			"package.json",
			"packages/example/package.json",
			"pnpm-workspace.yaml",
		]
		const before = files.map((file) => readFileSync(join(root, file), "utf8"))
		await syncVitePlus(root, loadRelease)
		assert.deepEqual(
			files.map((file) => readFileSync(join(root, file), "utf8")),
			before,
		)
	})
}

await test("rejects unpinned upstream metadata before changing files", async (t) => {
	const root = fixture()
	t.after(() => rmSync(root, { recursive: true, force: true }))
	const files = [
		"package.json",
		"packages/example/package.json",
		"pnpm-workspace.yaml",
	]
	const before = files.map((file) => readFileSync(join(root, file), "utf8"))
	await assert.rejects(
		syncVitePlus(root, async () => ({
			name: "vite-plus",
			version: "1.0.0-rc.0",
			dependencies: {
				vite: "npm:@voidzero-dev/vite-plus-core@1.0.0-rc.0",
				vitest: "^5.0.1",
			},
		})),
		/does not declare exact Vite and Vitest versions/,
	)
	assert.deepEqual(
		files.map((file) => readFileSync(join(root, file), "utf8")),
		before,
	)
})

await test("rejects a floating leader version instead of following latest", async (t) => {
	const root = fixture("latest")
	t.after(() => rmSync(root, { recursive: true, force: true }))
	await assert.rejects(
		syncVitePlus(root, async () => {
			assert.fail("must not fetch a floating release")
		}),
		/must be an exact version/,
	)
})
