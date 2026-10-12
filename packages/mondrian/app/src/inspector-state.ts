import { atom, getState, selector, setState } from "atom.io"
import type { PdfDiagnostic, PdfDocument } from "mondrian.pdf"
import type { PdfInspection } from "mondrian.pdf/inspect"
import { pdfObjectId } from "mondrian.pdf/inspect"

import { pathnameAtom } from "./router.ts"

export interface InspectionSession {
	readonly name: string
	readonly bytes: Uint8Array
	readonly document: PdfDocument
	readonly index: PdfInspection
	readonly diagnostics: readonly PdfDiagnostic[]
	readonly warnings: readonly { message: string; offset: number }[]
	readonly password: string
	readonly recover: boolean
}
export const inspectionSessionAtom = atom<InspectionSession | null>({
	key: "inspectionSession",
	default: null,
})
export const inspectionStatusAtom = atom<string>({
	key: "inspectionStatus",
	default: "",
})
export const inspectionErrorAtom = atom<string>({
	key: "inspectionError",
	default: "",
})
export const inspectorTabAtom = atom<
	"objects" | "palette" | "bitmaps" | "inks" | "diagnostics"
>({ key: "inspectorTab", default: "objects" })
export const inspectorSearchAtom = atom<string>({
	key: "inspectorSearch",
	default: "",
})
export const inspectorPageAtom = atom<number>({
	key: "inspectorPage",
	default: 1,
})
export const inspectorColorAtom = atom<string | null>({
	key: "inspectorColor",
	default: null,
})
export const inspectorInkAtom = atom<string | null>({
	key: "inspectorInk",
	default: null,
})
export const inspectorObjectSelector = selector<string | null>({
	key: "inspectorObject",
	get: ({ get }) =>
		new URLSearchParams(get(pathnameAtom).split("?")[1]).get("object"),
})
let worker: Worker | undefined
let generation = 0
let originalFile: File | undefined
let backend:
	| { session: InspectionSession; promise: Promise<string> }
	| undefined

export function navigateInspector(id?: string): void {
	const target = `/inspect${id ? `?object=${encodeURIComponent(id)}` : ""}`
	if (location.pathname + location.search !== target)
		history.pushState(null, "", target)
	setState(pathnameAtom, target)
}
export function cancelInspection(): void {
	generation++
	worker?.terminate()
	worker = undefined
	setState(inspectionStatusAtom, "")
}
export function closeInspection(): void {
	cancelInspection()
	if (backend)
		void backend.promise
			.then((id) => fetch(`/api/inspect/${id}`, { method: "DELETE" }))
			.catch(() => undefined)
	backend = undefined
	originalFile = undefined
	setState(inspectionSessionAtom, null)
	setState(inspectionErrorAtom, "")
	setState(inspectorColorAtom, null)
	setState(inspectorInkAtom, null)
	navigateInspector()
}
export async function openPdfFile(
	file: File,
	password = "",
	recover = false,
): Promise<void> {
	closeInspection()
	originalFile = file
	const ticket = generation
	navigateInspector()
	setState(inspectorTabAtom, "objects")
	setState(inspectorSearchAtom, "")
	setState(inspectorPageAtom, 1)
	if (file.size > 32 * 1024 * 1024) {
		setState(inspectionErrorAtom, "Choose a PDF of at most 32 MiB.")
		return
	}
	setState(inspectionStatusAtom, `Parsing ${file.name}…`)
	try {
		const bytes = new Uint8Array(await file.arrayBuffer())
		if (ticket !== generation) return
		worker = new Worker(new URL("./inspection.worker.ts", import.meta.url), {
			type: "module",
		})
		const fail = (message: string) => {
			if (ticket === generation) {
				setState(inspectionErrorAtom, message)
				setState(inspectionStatusAtom, "")
				worker?.terminate()
				worker = undefined
			}
		}
		worker.onerror = (event) =>
			fail(event.message || "The PDF inspection worker failed")
		worker.onmessage = (
			event: MessageEvent<
				{ error?: string } & Omit<
					InspectionSession,
					"name" | "bytes" | "password" | "recover"
				>
			>,
		) => {
			if (ticket !== generation) return
			if (event.data.error) {
				fail(event.data.error)
				return
			}
			setState(inspectionSessionAtom, {
				...event.data,
				name: file.name,
				bytes,
				password,
				recover,
			})
			setState(inspectionStatusAtom, "")
			worker?.terminate()
			worker = undefined
			navigateInspector(
				pdfObjectId(
					event.data.document.root.objectNumber,
					event.data.document.root.generation,
				),
			)
		}
		const copy = bytes.slice()
		worker.postMessage({ bytes: copy, password, recover }, [copy.buffer])
	} catch (error) {
		if (ticket === generation) {
			setState(
				inspectionErrorAtom,
				error instanceof Error ? error.message : String(error),
			)
			setState(inspectionStatusAtom, "")
		}
	}
}
export function retryInspection(password: string, recover: boolean): void {
	if (originalFile) void openPdfFile(originalFile, password, recover)
}
export async function inspectorRequest(
	session: InspectionSession,
	path: string,
	signal?: AbortSignal,
): Promise<Response> {
	if (!backend || backend.session !== session) {
		const promise = fetch("/api/inspect", {
			method: "POST",
			headers: {
				"Content-Type": "application/pdf",
				"X-Pdf-Password": encodeURIComponent(session.password),
				"X-Pdf-Recover": String(session.recover),
			},
			body: Uint8Array.from(session.bytes),
		}).then(async (response) => {
			const result = (await response.json()) as { id?: string; error?: string }
			if (!response.ok || !result.id)
				throw new Error(
					result.error ?? "The local preview service is unavailable",
				)
			return result.id
		})
		backend = { session, promise }
		void promise.catch(() => {
			if (backend?.promise === promise) backend = undefined
		})
	}
	const id = await backend.promise
	if (getState(inspectionSessionAtom) !== session)
		throw new Error("Document changed; preview cancelled")
	const response = await fetch(
		`/api/inspect/${id}/${path}`,
		signal ? { signal } : {},
	)
	if (!response.ok) {
		const result = (await response.json()) as { error?: string }
		throw new Error(result.error ?? "Preview is unavailable")
	}
	return response
}
