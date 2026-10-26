import { defineConfig } from "vite-plus"

export default defineConfig({
	lint: {
		ignorePatterns: [".dagger/**", "**/dist/**", "**/node_modules/**"],
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
	staged: {
		"*": ["dprint fmt", "vp check --no-fmt --fix"],
	},
})
