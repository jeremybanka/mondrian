import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import type { Server } from "node:http"
import { request } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { createPdfDocument, parsePdf, rectangle } from "mondrian.pdf"
import { inspectPdf } from "mondrian.pdf/inspect"
import { afterAll, beforeAll, expect, it, vi } from "vite-plus/test"

import { createGuideServer } from "../../src/guide-server.ts"

let directory: string, server: Server, origin: string
beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "mondrian-inspector-api-"))
	await writeFile(join(directory, "index.html"), "<h1>Inspector</h1>")
	server = await createGuideServer(pathToFileURL(`${directory}/`))
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
	const address = server.address()
	if (!address || typeof address === "string")
		throw new Error("Server address missing")
	origin = `http://127.0.0.1:${address.port}`
})
afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()))
	await rm(directory, { recursive: true, force: true })
})

it("renders selected original pages and ink proofs, and expires closed sessions", async () => {
	const pdf = createPdfDocument()
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 72, 72),
			content: [
				pdf.graphics((g) =>
					g.cmykFill(1, 0, 0, 0).rectangle(0, 0, 72, 72).fill(),
				),
			],
		}),
	)
	const response = await fetch(`${origin}/api/inspect`, {
		method: "POST",
		headers: { Origin: origin },
		body: Uint8Array.from(pdf.serialize()),
	})
	expect(response.status).toBe(200)
	const { id } = (await response.json()) as { id: string }
	const page = await fetch(`${origin}/api/inspect/${id}/page/1`)
	expect(page.status).toBe(200)
	expect(page.headers.get("content-type")).toBe("image/png")
	expect(new Uint8Array(await page.arrayBuffer()).slice(0, 4)).toEqual(
		Uint8Array.of(137, 80, 78, 71),
	)
	const plates = await fetch(`${origin}/api/inspect/${id}/plates`)
	expect(await plates.json()).toEqual(
		["Cyan", "Magenta", "Yellow", "Black"].map((name) => ({
			name,
			colorSpace: "cmyk",
		})),
	)
	expect(
		(await fetch(`${origin}/api/inspect/${id}/page/1?plate=Cyan`)).status,
	).toBe(200)
	expect(
		(await fetch(`${origin}/api/inspect/${id}/page/1?plate=Missing`)).status,
	).toBe(422)
	expect((await fetch(`${origin}/api/inspect/${id}/page/2`)).status).toBe(422)
	await fetch(`${origin}/api/inspect/${id}`, {
		method: "DELETE",
		headers: { Origin: origin },
	})
	expect((await fetch(`${origin}/api/inspect/${id}/page/1`)).status).toBe(404)
})

it("rejects cross-origin uploads and invalid files while leaving navigation available", async () => {
	expect(
		(
			await fetch(`${origin}/api/inspect`, {
				method: "POST",
				headers: { Origin: "http://elsewhere.invalid" },
				body: "x",
			})
		).status,
	).toBe(403)
	expect(
		(await fetch(`${origin}/api/inspect`, { method: "POST", body: "x" }))
			.status,
	).toBe(422)
	expect((await fetch(`${origin}/inspect`)).status).toBe(200)
})

it("rejects oversized uploads both before reading and during chunked transfer", async () => {
	const declared = await new Promise<number | undefined>((resolve, reject) => {
		const upload = request(
			`${origin}/api/inspect`,
			{ method: "POST", headers: { "Content-Length": 32 * 1024 * 1024 + 1 } },
			(response) => {
				response.resume()
				response.on("end", () => {
					resolve(response.statusCode)
					upload.destroy()
				})
			},
		)
		upload.on("error", reject)
		upload.end()
	})
	expect(declared).toBe(413)
	const data = new Uint8Array(33 * 1024 * 1024)
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(data)
			controller.close()
		},
	})
	const response = await fetch(`${origin}/api/inspect`, {
		method: "POST",
		body,
		headers: { Connection: "close" },
		duplex: "half",
	})
	expect(response.status).toBe(422)
	expect(await response.json()).toMatchObject({
		error: "PDF inspection is limited to 32 MiB",
	})
})

it("reports unsupported RGB plates separately from successful parsing and rendering", async () => {
	const pdf = createPdfDocument()
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 72, 72),
			content: [
				pdf.graphics((g) => g.rgbFill(1, 0, 0).rectangle(0, 0, 72, 72).fill()),
			],
		}),
	)
	const response = await fetch(`${origin}/api/inspect`, {
		method: "POST",
		body: Uint8Array.from(pdf.serialize()),
	})
	const { id } = (await response.json()) as { id: string }
	expect(response.status).toBe(200)
	expect((await fetch(`${origin}/api/inspect/${id}/plates`)).status).toBe(422)
	expect((await fetch(`${origin}/api/inspect/${id}/page/1`)).status).toBe(200)
})

it("provides image thumbnails and ICC metadata through independent capabilities", async () => {
	const profile = new Uint8Array(
		await readFile(
			new URL(
				"../public/fixtures/mixed-color/sRGB-v2-micro.icc",
				import.meta.url,
			),
		),
	)
	const pdf = createPdfDocument({ blendingSpace: { rgbProfile: profile } })
	const image = pdf.rgbImage({
		width: 1,
		height: 1,
		data: Uint8Array.of(255, 0, 0),
		sourceProfile: profile,
	})
	pdf.setPages(
		pdf.page({
			mediaBox: rectangle(0, 0, 72, 72),
			content: [pdf.graphics((g) => g.drawImage(image, 0, 0, 72, 72))],
		}),
	)
	const bytes = pdf.serialize(),
		index = inspectPdf(parsePdf(bytes)),
		bitmap = index.bitmaps[0]!
	const response = await fetch(`${origin}/api/inspect`, {
		method: "POST",
		body: Uint8Array.from(bytes),
	})
	const { id } = (await response.json()) as { id: string }
	const thumbnail = await fetch(
		`${origin}/api/inspect/${id}/image/${bitmap.id}`,
	)
	expect(thumbnail.status).toBe(200)
	expect(thumbnail.headers.get("x-preview-interpretation")).toContain(
		"ICC profile",
	)
	const metadata = await fetch(
		`${origin}/api/inspect/${id}/profile/${bitmap.profile}`,
	)
	expect(await metadata.json()).toMatchObject({
		colorSpace: "RGB",
		declaredChannels: 3,
	})
	expect((await fetch(`${origin}/api/inspect/${id}/image/999:0`)).status).toBe(
		422,
	)
	expect(
		(await fetch(`${origin}/api/inspect/${id}/profile/999:0`)).status,
	).toBe(422)
	expect((await fetch(`${origin}/api/inspect/${id}/page/0`)).status).toBe(422)
	expect((await fetch(`${origin}/api/inspect/${id}/unknown`)).status).toBe(404)
	expect(
		(await fetch(`${origin}/api/inspect/${id}/page/1`, { method: "POST" }))
			.status,
	).toBe(405)
	expect(
		(
			await fetch(`${origin}/api/inspect`, {
				method: "POST",
				headers: { Origin: "not-a-url" },
				body: "x",
			})
		).status,
	).toBe(403)
})

it("caps sessions and expires idle documents", async () => {
	const pdf = createPdfDocument()
	pdf.setPages(pdf.page({ mediaBox: rectangle(0, 0, 10, 10) }))
	const ids: string[] = []
	for (let index = 0; index < 4; index++) {
		const response = await fetch(`${origin}/api/inspect`, {
			method: "POST",
			body: Uint8Array.from(pdf.serialize()),
		})
		ids.push(((await response.json()) as { id: string }).id)
	}
	expect((await fetch(`${origin}/api/inspect/${ids[0]}/page/1`)).status).toBe(
		404,
	)
	const now = Date.now()
	const clock = vi.spyOn(Date, "now").mockReturnValue(now + 31 * 60 * 1000)
	try {
		expect((await fetch(`${origin}/api/inspect/${ids[3]}/page/1`)).status).toBe(
			404,
		)
	} finally {
		clock.mockRestore()
	}
})
