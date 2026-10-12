#!/usr/bin/env node

import { parseArgs } from "node:util"

import { createGuideServer } from "../src/guide-server.ts"

try {
	const { values } = parseArgs({
		options: {
			help: { type: "boolean", short: "h" },
			host: { type: "string", default: "127.0.0.1" },
			port: { type: "string", default: "3000" },
		},
	})
	if (values.help) {
		process.stdout.write(
			"Usage: mondrian [--host <address>] [--port <number>]\n\nServe the bundled PDF field guide.\n\n  --host  Listen address (default: 127.0.0.1)\n  --port  Listen port (default: 3000; 0 selects a free port)\n  -h, --help  Show this help\n",
		)
	} else {
		const port = Number(values.port)
		if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port > 65535) {
			throw new Error("--port must be an integer from 0 through 65535")
		}
		if (values.host.trim() === "") throw new Error("--host must not be empty")
		const server = await createGuideServer(new URL("./app/", import.meta.url))
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject)
			server.listen(port, values.host, resolve)
		})
		const address = server.address()
		if (address === null || typeof address === "string")
			throw new Error("The guide server did not start")
		const host = values.host.includes(":") ? `[${values.host}]` : values.host
		process.stdout.write(
			`Mondrian PDF field guide: http://${host}:${address.port}/\n`,
		)
		const stop = () => server.close()
		process.once("SIGINT", stop)
		process.once("SIGTERM", stop)
	}
} catch (error) {
	process.stderr.write(
		`mondrian: ${error instanceof Error ? error.message : String(error)}\n`,
	)
	process.exitCode = 1
}
