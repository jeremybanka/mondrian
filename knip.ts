import type { KnipConfig } from "knip"

// Public source entrypoints remain roots, including CLIs, workers, and conditional exports.
// Formatter plugins and JSON schemas are loaded by configuration paths, not imports.
// Generated distributions are checked through their authored source entrypoints.
export default {
	workspaces: {
		".": {
			entry: ["scripts/*.{ts,tsx}"],
			project: ["*.ts", "scripts/**/*.{ts,tsx}"],
			ignoreDependencies: [
				"@dprint/json",
				"@dprint/markdown",
				"@dprint/oxc",
				"@dprint/toml",
				"dprint-plugin-malva",
				"dprint-plugin-yaml",
				// Keep workspace CLIs available for manual contributor use.
				"mondrian.pdf",
			],
		},
		"packages/mondrian": {
			entry: [
				"bin/mondrian.ts!",
				"src/index.ts!",
				"src/inspect.ts!",
				"src/print.ts!",
				"src/testing.ts!",
				"src/vitest.ts!",
				"breakage.config.ts",
				"tests/**/fixtures/**/*.{ts,tsx,js,mjs,cjs}",
				"app/src/main.tsx!",
				"app/src/inspection.worker.ts!",
				"app/vite.config.ts",
				"app/eslint.config.ts",
			],
			project: [
				"*.ts",
				"{src,bin}/**/*.{ts,tsx}!",
				"{tests,__tests__,peer-environments,examples}/**/*.{ts,tsx,js,mjs,cjs}",
				"app/**/*.{ts,tsx}!",
			],
		},
	},
	ignore: ["**/dist/**"],
} satisfies KnipConfig
