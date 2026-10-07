import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vite-plus"

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: [
			{
				find: /^mondrian\.pdf$/,
				replacement: fileURLToPath(
					new URL("../../packages/mondrian/src/index.ts", import.meta.url),
				),
			},
		],
	},
	test: { include: ["tests/**/*.test.ts"] },
})
