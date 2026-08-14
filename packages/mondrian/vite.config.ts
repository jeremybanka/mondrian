import { defineConfig } from "vite-plus"

export default defineConfig({
	pack: [
		{
			clean: true,
			deps: {
				dts: {
					neverBundle: [/^[\w@]/],
				},
				neverBundle: true,
				onlyBundle: [],
			},
			dts: {
				entry: ["src/index.ts", "src/testing.ts", "src/vitest.ts"],
				sourcemap: true,
			},
			entry: {
				index: "src/index.ts",
				testing: "src/testing.ts",
				vitest: "src/vitest.ts",
			},
			format: "esm",
			outDir: "dist",
			sourcemap: true,
		},
	],
	test: {
		coverage: {
			include: ["src/**/*.ts"],
			provider: "v8",
			reporter: ["text", "html"],
		},
		include: ["tests/**/*.test.ts"],
		passWithNoTests: true,
	},
})
