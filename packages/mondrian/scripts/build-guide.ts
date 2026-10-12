import { chmod } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { build } from "vite-plus"

await build({
	configFile: fileURLToPath(new URL("../app/vite.config.ts", import.meta.url)),
	build: {
		outDir: fileURLToPath(new URL("../dist/app/", import.meta.url)),
		emptyOutDir: true,
	},
})
await chmod(new URL("../dist/mondrian.mjs", import.meta.url), 0o755)
