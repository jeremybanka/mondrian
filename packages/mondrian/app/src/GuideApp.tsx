import { useI, useO } from "@atom.io/react"
import { useEffect, useRef } from "react"

import { chapters } from "./chapters.ts"
import css from "./GuideApp.module.css"
import { GuideContents } from "./GuideContents.tsx"
import { openPdfFile } from "./inspector-state.ts"
import { InspectorPage } from "./InspectorPage.tsx"
import { LessonPage } from "./LessonPage.tsx"
import { chapterSelector, connectRouter, pathnameAtom } from "./router.ts"
import { menuOpenAtom } from "./state.ts"

export function GuideApp() {
	const chapter = useO(chapterSelector)
	const inspecting = useO(pathnameAtom).split("?")[0] === "/inspect"
	const menuOpen = useO(menuOpenAtom)
	const setMenuOpen = useI(menuOpenAtom)
	const main = useRef<HTMLElement>(null)
	const previous = useRef(chapter)
	useEffect(connectRouter, [])
	useEffect(() => {
		const lesson = chapters.find((entry) => entry.id === chapter)
		document.title = `${inspecting ? "Inspect a PDF" : (lesson?.title ?? "Page not found")} · Mondrian`
		setMenuOpen(false)
		if (previous.current !== chapter) {
			main.current?.focus({ preventScroll: true })
			previous.current = chapter
		}
		if (location.hash) {
			const frame = requestAnimationFrame(() =>
				document.getElementById(location.hash.slice(1))?.scrollIntoView(),
			)
			return () => cancelAnimationFrame(frame)
		}
	}, [chapter, inspecting, setMenuOpen])

	return (
		<guide-app
			className={css.class}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes("Files")) event.preventDefault()
			}}
			onDrop={(event) => {
				if (event.dataTransfer.files.length) {
					event.preventDefault()
					void openPdfFile(event.dataTransfer.files[0]!)
				}
			}}
		>
			<header>
				<a href="#main" data-skip>
					Skip to lesson
				</a>
				<a href="/" aria-label="Mondrian guide home" data-brand>
					<brand-mark aria-hidden="true">
						<i />
						<i />
						<i />
					</brand-mark>
					<strong>
						mondrian<span>UNDER THE SURFACE</span>
					</strong>
				</a>
				<header-note>A field guide to the Portable Document Format</header-note>
				<a href={inspecting ? "/" : "/inspect"} data-inspect>
					<span data-full>
						{inspecting ? "Read the guide" : "Inspect a PDF"}
					</span>
					<span data-short>{inspecting ? "Guide" : "Inspect"}</span>{" "}
					<span aria-hidden="true">↗</span>
				</a>
				<a
					href="https://github.com/jeremybanka/mondrian"
					target="_blank"
					rel="noreferrer"
					data-source
				>
					View source <span aria-hidden="true">↗</span>
				</a>
				{!inspecting && (
					<button
						type="button"
						aria-expanded={menuOpen}
						aria-controls="guide-contents"
						onClick={() => setMenuOpen(!menuOpen)}
						data-menu
					>
						{menuOpen ? "Close" : "Contents"} <span aria-hidden="true">☰</span>
					</button>
				)}
			</header>
			<main data-inspecting={inspecting}>
				{inspecting ? (
					<InspectorPage />
				) : (
					<>
						<aside id="guide-contents" data-open={menuOpen}>
							<GuideContents />
						</aside>
						<lesson-content id="main" ref={main} tabIndex={-1}>
							{chapter ? (
								<LessonPage key={chapter} chapter={chapter} />
							) : (
								<section data-missing>
									<small>404 / OFF THE MAP</small>
									<h1>This page is missing.</h1>
									<p>
										The reference doesn’t lead to a lesson. Let’s return to the
										beginning.
									</p>
									<a href="/">Back to the guide →</a>
								</section>
							)}
						</lesson-content>
					</>
				)}
			</main>
		</guide-app>
	)
}
