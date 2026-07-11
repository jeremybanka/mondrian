import { defineConfig } from "vite-plus"

export default defineConfig({
	test: {
		include: ["examples/generate.test.ts"],
	},
})
