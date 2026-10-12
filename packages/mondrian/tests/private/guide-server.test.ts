import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { afterAll, beforeAll, expect, it } from "vite-plus/test"

import { createGuideServer } from "../../src/guide-server.ts"

let directory: string
let server: Server
let url: string

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "mondrian-guide-server-"))
	await mkdir(join(directory, "assets"))
	await writeFile(
		join(directory, "index.html"),
		"<html><h1>PDF field guide</h1></html>",
	)
	await writeFile(
		join(directory, "assets", "guide-hash.js"),
		"console.log('guide')",
	)
	await writeFile(
		join(directory, "assets", "guide-hash.css"),
		"body { margin: 0 }",
	)
	await writeFile(
		join(directory, "favicon.svg"),
		'<svg xmlns="http://www.w3.org/2000/svg" />',
	)
	await symlink(
		new URL("../../package.json", import.meta.url),
		join(directory, "secret.json"),
	)
	server = await createGuideServer(pathToFileURL(`${directory}/`))
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(0, "127.0.0.1", resolve)
	})
	const address = server.address()
	if (address === null || typeof address === "string")
		throw new Error("No test server address")
	url = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
	if (server)
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		)
	if (directory) await rm(directory, { recursive: true, force: true })
})

it("serves the app shell for direct chapter links and unknown client routes", async () => {
	for (const path of [
		"/",
		"/objects",
		"/mondrian?example=color",
		"/not-a-chapter/",
	]) {
		const response = await fetch(url + path)
		expect(response.status).toBe(200)
		expect(response.headers.get("content-type")).toBe(
			"text/html; charset=utf-8",
		)
		expect(response.headers.get("cache-control")).toBe("no-cache")
		expect(await response.text()).toContain("PDF field guide")
	}
})

it("serves scripts, styles and the favicon with their content types", async () => {
	for (const [path, type] of [
		["/assets/guide-hash.js", "text/javascript; charset=utf-8"],
		["/assets/guide-hash.css", "text/css; charset=utf-8"],
		["/favicon.svg", "image/svg+xml"],
	]) {
		const response = await fetch(url + path)
		expect(response.headers.get("content-type")).toBe(type)
		expect(response.headers.get("x-content-type-options")).toBe("nosniff")
		if (path?.startsWith("/assets/"))
			expect(response.headers.get("cache-control")).toContain("immutable")
	}
	const response = await fetch(`${url}/objects`, { method: "HEAD" })
	expect(response.status).toBe(200)
	expect(Number(response.headers.get("content-length"))).toBeGreaterThan(0)
	expect(await response.text()).toBe("")
})

it("keeps missing assets, symlinks and package files outside the served application", async () => {
	for (const path of [
		"/assets/missing.js",
		"/assets/missing",
		"/package.json",
		"/secret.json",
	]) {
		const response = await fetch(url + path)
		expect(response.status).toBe(404)
		expect(await response.text()).toBe("Not found\n")
	}
	for (const path of ["/%", "/%00", "/%5csecret", "/..%2fpackage.json"]) {
		expect((await fetch(url + path)).status).toBe(400)
	}
	const response = await fetch(url, { method: "POST" })
	expect(response.status).toBe(405)
	expect(response.headers.get("allow")).toBe("GET, HEAD")
})

it("reports missing packaged assets instead of starting a broken server", async () => {
	await expect(
		createGuideServer(pathToFileURL(`${directory}/missing/`)),
	).rejects.toThrow("packaged PDF guide is missing")
	await expect(
		createGuideServer(pathToFileURL(`${directory}/assets/`)),
	).rejects.toThrow("no index.html")
})
