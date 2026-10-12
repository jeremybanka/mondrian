import { useI, useO } from "atom.io/react"
import { pdfObjectId } from "mondrian.pdf/inspect"
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"

import {
	cancelInspection,
	closeInspection,
	inspectionErrorAtom,
	inspectionSessionAtom,
	inspectionStatusAtom,
	inspectorColorAtom,
	inspectorObjectSelector,
	inspectorPageAtom,
	inspectorSearchAtom,
	inspectorTabAtom,
	navigateInspector,
	openPdfFile,
	retryInspection,
} from "./inspector-state.ts"
import { InspectorObjectCard } from "./InspectorObjectCard.tsx"
import { InspectorObjectDetail } from "./InspectorObjectDetail.tsx"
import css from "./InspectorPage.module.css"
import { InspectorPreview } from "./InspectorPreview.tsx"
import { InspectorProfile } from "./InspectorProfile.tsx"
import { InspectorResources } from "./InspectorResources.tsx"

export function InspectorPage() {
	const session = useO(inspectionSessionAtom),
		status = useO(inspectionStatusAtom),
		error = useO(inspectionErrorAtom)
	const tab = useO(inspectorTabAtom),
		setTab = useI(inspectorTabAtom)
	const search = useO(inspectorSearchAtom),
		setSearch = useI(inspectorSearchAtom)
	const query = useDeferredValue(search).toLowerCase()
	const selected = useO(inspectorObjectSelector)
	const focused = useO(inspectorColorAtom),
		setFocused = useI(inspectorColorAtom)
	const page = useO(inspectorPageAtom),
		setPage = useI(inspectorPageAtom)
	const [password, setPassword] = useState(""),
		[recover, setRecover] = useState(false)
	const [top, setTop] = useState(0),
		[height, setHeight] = useState(700)
	const scroller = useRef<HTMLElement>(null)
	const filtered = useMemo(
		() =>
			(session?.index.objects ?? []).filter((object) =>
				`${object.id} ${object.role} ${object.keys.join(" ")}`
					.toLowerCase()
					.includes(query),
			),
		[query, session],
	)
	const byId = useMemo(
		() =>
			new Map(
				(session?.document.objects ?? []).map((object) => [
					pdfObjectId(object.objectNumber, object.generation),
					object,
				]),
			),
		[session],
	)
	const summary = session?.index.objects.find(
		(object) => object.id === selected,
	)
	const object = selected ? byId.get(selected) : undefined
	const colorObjects = new Set(
		session?.index.colors
			.find((color) => color.id === focused)
			?.uses.map((use) => use.object) ?? [],
	)
	useEffect(() => {
		if (selected) setTab("objects")
	}, [selected, setTab])
	useEffect(() => {
		if (tab !== "objects" || !scroller.current) return
		const root = scroller.current
		const observer = new ResizeObserver(() => setHeight(root.clientHeight))
		observer.observe(root)
		return () => observer.disconnect()
	}, [session, tab])
	useEffect(() => {
		if (tab !== "objects" || !scroller.current) return
		const index = filtered.findIndex((entry) => entry.id === selected)
		if (index >= 0) {
			scroller.current.scrollTop = index * 200
			setTop(index * 200)
		}
	}, [filtered, selected, tab])
	const start = Math.max(0, Math.floor(top / 200) - 3),
		end = Math.min(filtered.length, Math.ceil((top + height) / 200) + 3)
	const upload = (file: File | undefined) => {
		if (file) void openPdfFile(file)
	}
	const download = () => {
		if (!session) return
		const url = URL.createObjectURL(
			new Blob([Uint8Array.from(session.bytes)], { type: "application/pdf" }),
		)
		const anchor = document.createElement("a")
		anchor.href = url
		anchor.download = session.name
		anchor.click()
		setTimeout(() => URL.revokeObjectURL(url), 1000)
	}
	return (
		<inspector-page className={css.class} id="main" tabIndex={-1}>
			<inspector-toolbar>
				<file-heading>
					<small>MONDRIAN / DOCUMENT EXPLORER</small>
					<h1>{session ? session.name : "Look inside a PDF."}</h1>
					<p>
						{session
							? `PDF ${session.document.version} · ${session.index.objects.length.toLocaleString()} objects · ${session.index.pages.length} pages · ${(session.bytes.length / 1024).toFixed(1)} KiB`
							: "Drop a PDF anywhere, or choose a file to follow its objects, resources, and drawing programs."}
					</p>
				</file-heading>
				<file-actions>
					<label>
						Choose PDF
						<input
							type="file"
							accept="application/pdf,.pdf"
							onChange={(event) => {
								upload(event.target.files?.[0])
								event.target.value = ""
							}}
						/>
					</label>
					{session && (
						<>
							<button type="button" onClick={download}>
								Original PDF ↓
							</button>
							<button type="button" onClick={closeInspection}>
								Close
							</button>
						</>
					)}
					{status && (
						<button type="button" onClick={cancelInspection}>
							Cancel parsing
						</button>
					)}
				</file-actions>
			</inspector-toolbar>
			{status && (
				<p data-status role="status">
					{status}
				</p>
			)}
			{error && (
				<section data-error role="alert">
					<h2>Couldn’t inspect this file.</h2>
					<p>{error}</p>
					<label>
						Password, if needed
						<input
							type="password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							autoComplete="off"
						/>
					</label>
					<label>
						<input
							type="checkbox"
							checked={recover}
							onChange={(event) => setRecover(event.target.checked)}
						/>{" "}
						Retry with Mondrian’s supported header/xref recovery
					</label>
					<button
						type="button"
						onClick={() => retryInspection(password, recover)}
					>
						Retry parsing
					</button>
					<p>Recovery is opt-in and every recovered condition is reported.</p>
				</section>
			)}
			{!session && !status && !error && (
				<section data-empty>
					<span aria-hidden="true">↧</span>
					<h2>Every page has a story underneath.</h2>
					<p>
						Open a PDF to inspect its catalog, pages, fonts, bitmaps, profiles,
						and streams. The original file stays unchanged. Parsing runs in a
						browser worker; preview requests send the bytes to this
						application’s server, where they are held in memory.
					</p>
					<p>One PDF at a time · up to 32 MiB · read-only inspection</p>
					<a href="/objects">Start with the lesson on objects & references ↗</a>
				</section>
			)}
			{session && (
				<>
					<inspector-navigation>
						<nav aria-label="Inspection panels">
							{(
								[
									"objects",
									"palette",
									"bitmaps",
									"inks",
									"diagnostics",
								] as const
							).map((mode) => (
								<button
									key={mode}
									type="button"
									aria-pressed={tab === mode}
									onClick={() => setTab(mode)}
								>
									{mode === "objects"
										? "Objects"
										: mode === "palette"
											? "Palette"
											: mode === "bitmaps"
												? "Bitmaps"
												: mode === "inks"
													? "Ink plates"
													: "Diagnostics"}
									<small>
										{mode === "objects"
											? session.index.objects.length
											: mode === "palette"
												? session.index.colors.length
												: mode === "bitmaps"
													? session.index.bitmaps.length
													: mode === "diagnostics"
														? session.diagnostics.length +
															session.warnings.length +
															session.index.notices.length
														: "CMYK + spot"}
									</small>
								</button>
							))}
						</nav>
						<label>
							Search
							<input
								type="search"
								placeholder="Object, field, color space…"
								value={search}
								onChange={(event) => {
									setSearch(event.target.value)
									setTop(0)
									if (scroller.current) scroller.current.scrollTop = 0
								}}
							/>
						</label>
					</inspector-navigation>
					<inspector-workspace>
						<aside aria-label="Document navigation">
							<small>PAGE TREE</small>
							{session.index.pages.slice(0, 1000).map((entry) => (
								<button
									key={entry.id}
									type="button"
									aria-pressed={page === entry.number}
									onClick={() => {
										setPage(entry.number)
										navigateInspector(entry.id)
									}}
								>
									<strong>Page {entry.number}</strong>
									<code>{entry.id.replace(":", " ")} R</code>
								</button>
							))}
							<small>DOCUMENT ROOT</small>
							<a
								href={`/inspect?object=${encodeURIComponent(pdfObjectId(session.document.root.objectNumber, session.document.root.generation))}`}
							>
								Catalog →
							</a>
							<p>
								The parsed graph is available. Check Diagnostics for structural
								findings and analysis limits.
							</p>
							<a href="/pages">How references form a document ↗</a>
						</aside>
						<inspection-stream
							ref={scroller}
							onScroll={(event) => setTop(event.currentTarget.scrollTop)}
							aria-label="Continuous object stream"
						>
							{tab === "objects" ? (
								<>
									<stream-label>
										<span>
											{filtered.length.toLocaleString()} matching objects ·
											ordered by identity
										</span>
										{focused && (
											<button type="button" onClick={() => setFocused(null)}>
												Clear color focus
											</button>
										)}
									</stream-label>
									<object-stage style={{ height: filtered.length * 200 }}>
										{filtered.slice(start, end).map((entry, index) => (
											<object-slot
												key={entry.id}
												style={{
													transform: `translateY(${(start + index) * 200}px)`,
												}}
											>
												<InspectorObjectCard
													object={entry}
													selected={selected === entry.id}
													focused={colorObjects.has(entry.id)}
												/>
											</object-slot>
										))}
									</object-stage>
									{filtered.length === 0 && (
										<p>
											No matching objects. Clear the search to follow a
											reference.
										</p>
									)}
								</>
							) : (
								<InspectorResources session={session} mode={tab} />
							)}
						</inspection-stream>
						<inspection-detail aria-label="Selected object detail">
							{object && summary ? (
								<InspectorObjectDetail
									key={summary.id}
									session={session}
									object={object}
									summary={summary}
								/>
							) : (
								<p>
									Select an object to inspect its fields and references.
									{selected && !object
										? ` Reference ${selected} does not resolve in this graph.`
										: ""}
								</p>
							)}
							{summary?.role === "ICC profile" && (
								<InspectorProfile
									key={summary.id}
									session={session}
									id={summary.id}
								/>
							)}
							{summary &&
								session.index.bitmaps.some(
									(bitmap) => bitmap.id === summary.id,
								) && (
									<InspectorPreview
										session={session}
										path={`image/${summary.id}`}
										label={`Bitmap ${summary.id.replace(":", " ")}`}
									/>
								)}
							{session.index.pages.length > 0 && (
								<>
									<label data-page>
										Preview page
										<input
											type="number"
											min={1}
											max={session.index.pages.length}
											aria-label="Preview page number"
											value={page}
											onChange={(event) => {
												const number = Number(event.target.value)
												if (
													Number.isInteger(number) &&
													number >= 1 &&
													number <= session.index.pages.length
												)
													setPage(number)
											}}
										/>
									</label>
									<InspectorPreview
										session={session}
										path={`page/${page}`}
										label={`Original page ${page}`}
									/>
								</>
							)}
						</inspection-detail>
					</inspector-workspace>
					<p data-footnote>
						Read-only · original bytes retained · objects and references are
						Mondrian’s resolved model · preview data is held in memory on this
						server.
					</p>
				</>
			)}
		</inspector-page>
	)
}
