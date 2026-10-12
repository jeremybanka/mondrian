// SPDX-License-Identifier: MPL-2.0

import { readFile, readdir } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { extname, join } from "node:path"
import { createInspectorApi } from "./inspector-api.ts"

const contentTypes: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".wasm": "application/wasm",
}

interface GuideAsset {
	readonly body: Buffer
	readonly contentType: string
}

/** Serve only the packaged application, independently of the caller's cwd. */
export async function createGuideServer(directory: URL): Promise<Server> {
	const assets = new Map<string, GuideAsset>()
	async function load(path: URL | string, prefix: string): Promise<void> {
		for (const entry of await readdir(path, { withFileTypes: true })) {
			const location =
				path instanceof URL
					? new URL(encodeURIComponent(entry.name), path)
					: join(path, entry.name)
			const route = `${prefix}/${entry.name}`
			if (entry.isDirectory()) {
				await load(
					location instanceof URL ? new URL(`${location.href}/`) : location,
					route,
				)
			} else if (entry.isFile()) {
				assets.set(route, {
					body: await readFile(location),
					contentType:
						contentTypes[extname(entry.name).toLowerCase()] ??
						"application/octet-stream",
				})
			}
		}
	}
	try {
		await load(directory, "")
	} catch (cause) {
		throw new Error(
			"The packaged PDF guide is missing or unreadable. Reinstall mondrian.pdf, or build the package in a source checkout.",
			{ cause },
		)
	}
	const index = assets.get("/index.html")
	if (index === undefined) {
		throw new Error(
			"The packaged PDF guide has no index.html. Reinstall mondrian.pdf, or build the package in a source checkout.",
		)
	}

	const inspect = createInspectorApi()
	return createServer((request, response) => {
		if ((request.url ?? "").startsWith("/api/inspect")) {
			void inspect(request, response).catch(() => {
				if (!response.headersSent) response.writeHead(500)
				response.end()
			})
			return
		}
		response.setHeader("X-Content-Type-Options", "nosniff")
		if (request.method !== "GET" && request.method !== "HEAD") {
			response.writeHead(405, {
				Allow: "GET, HEAD",
				"Content-Type": "text/plain; charset=utf-8",
			})
			response.end("Method not allowed\n")
			return
		}
		let pathname: string
		try {
			pathname = decodeURIComponent(
				new URL(request.url ?? "/", "http://localhost").pathname,
			)
			if (
				pathname.includes("\\") ||
				pathname.includes("\0") ||
				pathname.split("/").some((part) => part === "..")
			) {
				throw new Error("Invalid path")
			}
		} catch {
			response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
			response.end(
				request.method === "HEAD" ? undefined : "Invalid request path\n",
			)
			return
		}
		const asset =
			assets.get(pathname) ??
			(!pathname.startsWith("/assets/") && extname(pathname) === ""
				? index
				: undefined)
		if (asset === undefined) {
			response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
			response.end(request.method === "HEAD" ? undefined : "Not found\n")
			return
		}
		response.writeHead(200, {
			"Content-Type": asset.contentType,
			"Content-Length": asset.body.length,
			"Cache-Control": pathname.startsWith("/assets/")
				? "public, max-age=31536000, immutable"
				: "no-cache",
		})
		response.end(request.method === "HEAD" ? undefined : asset.body)
	})
}
