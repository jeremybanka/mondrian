import { fileURLToPath } from "node:url"

import { defineConfig } from "vite-plus"

export default defineConfig({
	pack: [
		{
			clean: true,
			deps: {
				// tsdown <0.23 compatibility: resolve external dependency subpaths.
				// Remove to preserve subpath imports as written (the new default).
				// https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
				resolveDepSubpath: true,
				dts: {
					neverBundle: [/^[\w@]/],
				},
				neverBundle: true,
				onlyBundle: [],
			},
			dts: {
				entry: [
					"src/index.ts",
					"src/testing.ts",
					"src/vitest.ts",
					"src/print.ts",
				],
				sourcemap: true,
			},
			entry: {
				index: "src/index.ts",
				print: "src/print.ts",
				testing: "src/testing.ts",
				vitest: "src/vitest.ts",
			},
			format: "esm",
			outDir: "dist",
			sourcemap: true,
		},
	],
	test: {
		alias: [
			{
				find: /^mondrian\.pdf$/,
				replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
			},
			...["testing", "vitest", "print"].map((entry) => ({
				find: `mondrian.pdf/${entry}`,
				replacement: fileURLToPath(
					new URL(`./src/${entry}.ts`, import.meta.url),
				),
			})),
		],
		// Vitest v4 compatibility: preserve mock call history.
		// Remove after tests no longer rely on calls from setup or earlier tests.
		// https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
		// https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
		clearMocks: false,
		coverage: {
			include: ["src/**/*.ts"],
			provider: "v8",
			reporter: ["text", "html", "json", "json-summary"],
		},
		include: ["tests/**/*.test.ts"],
		passWithNoTests: true,
	},
})
