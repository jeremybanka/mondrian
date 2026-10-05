import { useO } from "atom.io/react"
import { useEffect, useState } from "react"

import { chapters } from "./chapters.ts"
import css from "./GuideContents.module.css"
import { chapterHref, chapterSelector } from "./router.ts"

export function GuideContents() {
	const chapter = useO(chapterSelector)
	const index = chapters.findIndex((entry) => entry.id === chapter)
	const current = chapters[index]
	const [section, setSection] = useState("idea")
	useEffect(() => {
		setSection("idea")
		const elements = Array.from(
			document.querySelectorAll<HTMLElement>("main section[id]"),
		)
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((entry) => entry.isIntersecting)
					.sort(
						(a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
					)[0]
				if (visible) setSection(visible.target.id)
			},
			{ rootMargin: "-10% 0px -55% 0px" },
		)
		elements.forEach((element) => observer.observe(element))
		return () => observer.disconnect()
	}, [chapter])

	return (
		<guide-contents className={css.class}>
			<nav aria-label="Table of contents">
				<small>
					THE FIELD GUIDE <span>06 CHAPTERS</span>
				</small>
				<ol>
					{chapters.map((entry, number) => (
						<li key={entry.id}>
							<a
								href={chapterHref(entry.id)}
								aria-current={chapter === entry.id ? "page" : undefined}
							>
								<span>{String(number + 1).padStart(2, "0")}</span>
								<strong>{entry.title}</strong>
								<span aria-hidden="true">↗</span>
							</a>
							{entry.id === chapter && (
								<ul>
									{entry.sections.map((item) => (
										<li key={item.id}>
											<a
												href={`#${item.id}`}
												aria-current={
													section === item.id ? "location" : undefined
												}
											>
												{item.label}
											</a>
										</li>
									))}
								</ul>
							)}
						</li>
					))}
				</ol>
			</nav>
			<reading-progress>
				<span>YOUR PLACE IN THE GUIDE</span>
				<progress
					value={index + 1}
					max={chapters.length}
					aria-label="Chapter position"
				/>
				<p>
					Chapter {Math.max(1, index + 1)} of 6{" "}
					<span>{current?.time ?? ""} read</span>
				</p>
			</reading-progress>
			<aside>
				<span aria-hidden="true">↳</span>
				<p>
					No PDF expertise required.
					<br />
					Just a little curiosity.
				</p>
			</aside>
		</guide-contents>
	)
}
