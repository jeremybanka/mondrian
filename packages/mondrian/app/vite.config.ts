import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vite-plus"

import { createInspectorApi } from "../src/inspector-api.ts"

export default defineConfig({
	root: fileURLToPath(new URL("./", import.meta.url)),
	plugins: [
		react(),
		{
			name: "mondrian-local-inspector",
			configureServer(server) {
				const inspect = createInspectorApi()
				server.middlewares.use((request, response, next) => {
					void inspect(request, response)
						.then((handled) => {
							if (!handled) next()
						})
						.catch(next)
				})
			},
		},
	],
	resolve: {
		alias: [
			{
				find: "mondrian.pdf/inspect",
				replacement: fileURLToPath(
					new URL("../src/inspect.ts", import.meta.url),
				),
			},
			{
				find: /^mondrian\.pdf$/,
				replacement: fileURLToPath(new URL("../src/index.ts", import.meta.url)),
			},
		],
	},
	test: { include: ["tests/**/*.test.ts"] },
})
