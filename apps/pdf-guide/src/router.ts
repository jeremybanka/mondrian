import { atom, selector, setState } from "atom.io"
import type { Tree, TreePath } from "treetrunks"
import { isTreePath, optional } from "treetrunks"

export const routes = optional({
	anatomy: null,
	objects: null,
	pages: null,
	drawing: null,
	mondrian: null,
}) satisfies Tree
export type Route = TreePath<typeof routes>
export type ChapterId = "overview" | Exclude<Route[0], undefined>

export function resolveChapter(pathname: string): ChapterId | null {
	const segments = pathname.split("/").filter(Boolean)
	return isTreePath(routes, segments) ? (segments[0] ?? "overview") : null
}

export function chapterHref(chapter: ChapterId): string {
	return chapter === "overview" ? "/" : `/${chapter}`
}

export const pathnameAtom = atom<string>({
	key: "pathname",
	default: typeof window === "undefined" ? "/" : window.location.pathname,
})
export const chapterSelector = selector<ChapterId | null>({
	key: "chapter",
	get: ({ get }) => resolveChapter(get(pathnameAtom)),
})

export function connectRouter(): () => void {
	const update = () => setState(pathnameAtom, window.location.pathname)
	const onClick = (event: MouseEvent) => {
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return
		const anchor =
			event.target instanceof Element ? event.target.closest("a") : null
		if (
			!(anchor instanceof HTMLAnchorElement) ||
			anchor.hasAttribute("download") ||
			(anchor.target && anchor.target !== "_self")
		)
			return
		const url = new URL(anchor.href)
		if (
			url.origin !== window.location.origin ||
			url.hash ||
			resolveChapter(url.pathname) === null
		)
			return
		event.preventDefault()
		if (url.pathname !== window.location.pathname) {
			history.pushState(null, "", url.pathname + url.search)
			update()
			window.scrollTo({ top: 0, behavior: "instant" })
		}
	}
	update()
	document.addEventListener("click", onClick)
	window.addEventListener("popstate", update)
	return () => {
		document.removeEventListener("click", onClick)
		window.removeEventListener("popstate", update)
	}
}
