import { getState, setState } from "atom.io"
import { inspectPdf } from "mondrian.pdf/inspect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import type { InspectionSession } from "../src/inspector-state.ts"
import {
	inspectionSessionAtom,
	inspectorCapabilitiesAtom,
	inspectorRequest,
} from "../src/inspector-state.ts"
import { createSpecimen } from "../src/specimen.ts"

describe("preview capability reporting", () => {
	let session: InspectionSession
	const request = vi.fn<typeof fetch>()
	beforeEach(() => {
		const document = createSpecimen()
		session = {
			name: "sample.pdf",
			bytes: new Uint8Array(),
			document,
			index: inspectPdf(document),
			diagnostics: [],
			warnings: [],
			password: "",
			recover: false,
		}
		setState(inspectionSessionAtom, session)
		setState(inspectorCapabilitiesAtom, [])
		request.mockReset()
		request.mockResolvedValueOnce(Response.json({ id: "preview-session" }))
		vi.stubGlobal("fetch", request)
	})
	afterEach(() => {
		vi.unstubAllGlobals()
		setState(inspectionSessionAtom, null)
		setState(inspectorCapabilitiesAtom, [])
	})
	it("keeps plate limitations distinct from structural findings and clears them after a successful retry", async () => {
		request.mockResolvedValueOnce(
			Response.json(
				{ error: "DeviceRGB is not permitted for plate previews" },
				{ status: 422 },
			),
		)
		await expect(inspectorRequest(session, "plates")).rejects.toThrow(
			"DeviceRGB",
		)
		expect(getState(inspectorCapabilitiesAtom)).toEqual([
			{
				key: "plates",
				label: "Ink plates",
				message: "DeviceRGB is not permitted for plate previews",
			},
		])
		expect(session.diagnostics).toEqual([])
		request.mockResolvedValueOnce(Response.json([]))
		await inspectorRequest(session, "plates?gray=black-only")
		expect(getState(inspectorCapabilitiesAtom)).toEqual([])
	})
	it("reports preview service failures without erasing other resource limitations", async () => {
		request.mockRejectedValueOnce(new TypeError("Preview server offline"))
		await expect(inspectorRequest(session, "image/4:0")).rejects.toThrow(
			"offline",
		)
		request.mockResolvedValueOnce(new Response("image"))
		await inspectorRequest(session, "page/1")
		expect(getState(inspectorCapabilitiesAtom)).toEqual([
			{
				key: "image/4:0",
				label: "Bitmap 4 0",
				message: "Preview server offline",
			},
		])
	})
	it("does not report cancelled requests or failures belonging to a replaced document", async () => {
		const controller = new AbortController()
		controller.abort()
		request.mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"))
		await expect(
			inspectorRequest(session, "page/1", controller.signal),
		).rejects.toThrow("Cancelled")
		expect(getState(inspectorCapabilitiesAtom)).toEqual([])
		setState(inspectionSessionAtom, { ...session, name: "replacement.pdf" })
		await expect(inspectorRequest(session, "page/1")).rejects.toThrow(
			"Document changed",
		)
		expect(getState(inspectorCapabilitiesAtom)).toEqual([])
	})
})
