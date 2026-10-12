import { useI, useO } from "atom.io/react"
import { useEffect, useRef } from "react"

import { chapters } from "./chapters.ts"
import css from "./GuideApp.module.css"
import { GuideContents } from "./GuideContents.tsx"
import { LessonPage } from "./LessonPage.tsx"
import { chapterSelector, connectRouter } from "./router.ts"
import { menuOpenAtom } from "./state.ts"

export function GuideApp() {
	const chapter = useO(chapterSelector)
	const menuOpen = useO(menuOpenAtom)
	const setMenuOpen = useI(menuOpenAtom)
	const main = useRef<HTMLElement>(null)
	const previous = useRef(chapter)
	useEffect(connectRouter, [])
	useEffect(() => {
		const lesson = chapters.find((entry) => entry.id === chapter)
		document.title = `${lesson?.title ?? "Page not found"} · How does a PDF work? · Mondrian`
		setMenuOpen(false)
		if (previous.current !== chapter) {
			main.current?.focus({ preventScroll: true })
			previous.current = chapter
		}
	}, [chapter, setMenuOpen])

	return (
		<guide-app className={css.class}>
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
				<a
					href="https://github.com/jeremybanka/mondrian"
					target="_blank"
					rel="noreferrer"
					data-source
				>
					View source <span aria-hidden="true">↗</span>
				</a>
				<button
					type="button"
					aria-expanded={menuOpen}
					aria-controls="guide-contents"
					onClick={() => setMenuOpen(!menuOpen)}
					data-menu
				>
					{menuOpen ? "Close" : "Contents"} <span aria-hidden="true">☰</span>
				</button>
			</header>
			<main>
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
			</main>
		</guide-app>
	)
}
