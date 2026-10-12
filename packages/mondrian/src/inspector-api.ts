// SPDX-License-Identifier: MPL-2.0
import { randomUUID } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import { parsePdf } from "./parse.ts"
import type { PdfDocument } from "./objects.ts"
import type { PdfPlatePreview } from "./testing/plates.ts"
import { serializePdf } from "./serialize.ts"

interface Session {
	bytes: Uint8Array
	document: PdfDocument
	password: string
	touched: number
	plates?: readonly PdfPlatePreview[]
	gray?: boolean
}
const maximumBytes = 32 * 1024 * 1024
let rendering: Promise<unknown> = Promise.resolve()
function serializeWork<T>(work: () => Promise<T>): Promise<T> {
	const result = rendering.then(work)
	rendering = result.catch(() => undefined)
	return result
}

/** In-memory documents and lazy rendering for the local inspector. No disk persistence. */
export function createInspectorApi() {
	const sessions = new Map<string, Session>()
	return async (
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<boolean> => {
		const url = new URL(request.url ?? "/", "http://localhost")
		if (!url.pathname.startsWith("/api/inspect")) return false
		const json = (status: number, value: unknown) => {
			response.writeHead(status, {
				"Content-Type": "application/json",
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
			})
			response.end(JSON.stringify(value))
		}
		const origin = request.headers.origin
		let sameOrigin = true
		try {
			sameOrigin =
				!origin ||
				(origin !== "null" && new URL(origin).host === request.headers.host)
		} catch {
			sameOrigin = false
		}
		if (request.headers["sec-fetch-site"] === "cross-site" || !sameOrigin) {
			json(403, { error: "Document requests must come from this application" })
			return true
		}
		try {
			for (const [key, session] of sessions)
				if (Date.now() - session.touched > 30 * 60 * 1000) sessions.delete(key)
			if (request.method === "POST" && url.pathname === "/api/inspect") {
				if (Number(request.headers["content-length"]) > maximumBytes) {
					response.setHeader("Connection", "close")
					json(413, { error: "PDF inspection is limited to 32 MiB" })
					return true
				}
				const chunks: Buffer[] = []
				let size = 0
				for await (const chunk of request) {
					const data = Buffer.from(chunk)
					size += data.length
					if (size > maximumBytes)
						throw new RangeError("PDF inspection is limited to 32 MiB")
					chunks.push(data)
				}
				const bytes = Uint8Array.from(Buffer.concat(chunks))
				const password = decodeURIComponent(
					String(request.headers["x-pdf-password"] ?? ""),
				)
				const document = parsePdf(bytes, {
					password,
					recover: request.headers["x-pdf-recover"] === "true",
				})
				if (document.objects.length > 100000)
					throw new RangeError("Inspection is limited to 100,000 objects")
				while (sessions.size >= 3)
					sessions.delete(sessions.keys().next().value!)
				const id = randomUUID()
				sessions.set(id, { bytes, document, password, touched: Date.now() })
				json(200, { id })
				return true
			}
			const parts = url.pathname.split("/").slice(3),
				id = parts[0] ?? "",
				action = parts[1],
				argument = parts[2]
			const session = sessions.get(id)
			if (!session) {
				json(404, {
					error: "Document session expired. Reopen the file to preview it.",
				})
				return true
			}
			session.touched = Date.now()
			if (request.method === "DELETE" && !action) {
				sessions.delete(id)
				json(200, { closed: true })
				return true
			}
			if (request.method !== "GET") {
				json(405, { error: "Unsupported inspector method" })
				return true
			}
			if (action === "profile" && argument) {
				const { inspectIccProfile } = await import("./inspection/bitmap.ts")
				json(200, inspectIccProfile(session.document, argument))
				return true
			}
			if (action === "image" && argument) {
				const { inspectBitmapPng } = await import("./inspection/bitmap.ts")
				const result = await serializeWork(() =>
					inspectBitmapPng(session.document, argument),
				)
				response.writeHead(200, {
					"Content-Type": "image/png",
					"Cache-Control": "no-store",
					"X-Preview-Interpretation": result.interpretation,
				})
				response.end(result.png)
				return true
			}
			const gray = url.searchParams.get("gray") === "black-only"
			if (
				action === "plates" ||
				(action === "page" && url.searchParams.has("plate"))
			) {
				if (!session.plates || session.gray !== gray) {
					const { previewPdfPlates } = await import("./testing/plates.ts")
					session.plates = await serializeWork(async () =>
						previewPdfPlates(
							session.document,
							gray ? { gray: "black-only" } : {},
						),
					)
					session.gray = gray
				}
				if (action === "plates") {
					json(
						200,
						session.plates.map(({ name, colorSpace }) => ({
							name,
							colorSpace,
						})),
					)
					return true
				}
			}
			if (action === "page") {
				const page = Number(argument)
				if (!Number.isSafeInteger(page) || page < 1)
					throw new RangeError("Choose a valid page number")
				const { renderPdf } = await import("./testing/render.ts")
				const selected = url.searchParams.get("plate")
				const plate =
					selected === null
						? undefined
						: session.plates?.find(({ name }) => name === selected)
				if (selected !== null && !plate)
					throw new TypeError("Unknown ink plate")
				const result = await serializeWork(() =>
					renderPdf(plate ? serializePdf(plate.document) : session.bytes, {
						pageNumbers: [page],
						resolution: 96,
						maxPagePixels: 4000000,
						...(plate ? {} : { password: session.password }),
					}),
				)
				response.writeHead(200, {
					"Content-Type": "image/png",
					"Cache-Control": "no-store",
				})
				response.end(result.pages[0]!.png)
				return true
			}
			json(404, { error: "Unknown inspection capability" })
		} catch (error) {
			if (!response.headersSent)
				json(422, {
					error: error instanceof Error ? error.message : String(error),
				})
			else response.end()
		}
		return true
	}
}
