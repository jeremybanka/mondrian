import { useEffect, useRef, useState } from "react"

import type { InspectionPlacement } from "./inspection-learning.ts"
import type { InspectionSession } from "./inspector-state.ts"
import { inspectorRequest } from "./inspector-state.ts"
import css from "./InspectorPreview.module.css"

export function InspectorPreview({
	session,
	path,
	label,
	lazy = false,
	placements = [],
	placementNote,
}: {
	session: InspectionSession
	path: string
	label: string
	lazy?: boolean
	placements?: readonly InspectionPlacement[]
	placementNote?: string | undefined
}) {
	const root = useRef<HTMLElement>(null)
	const [visible, setVisible] = useState(!lazy)
	useEffect(() => {
		if (!lazy || !root.current) return
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setVisible(true)
					observer.disconnect()
				}
			},
			{ rootMargin: "120px" },
		)
		observer.observe(root.current)
		return () => observer.disconnect()
	}, [lazy])
	const [url, setUrl] = useState<string | null>(null)
	const [message, setMessage] = useState("Loading preview…")
	useEffect(() => {
		if (!visible) return
		const controller = new AbortController()
		let address: string | undefined
		setUrl(null)
		setMessage("Loading preview…")
		void inspectorRequest(session, path, controller.signal)
			.then(async (response) => {
				const blob = await response.blob()
				if (controller.signal.aborted) return
				address = URL.createObjectURL(blob)
				setUrl(address)
				setMessage(
					response.headers.get("x-preview-interpretation") ??
						"Original file rendered by PDFium; structural validation is reported separately.",
				)
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted)
					setMessage(
						`Preview unavailable: ${error instanceof Error ? error.message : String(error)}`,
					)
			})
		return () => {
			controller.abort()
			if (address) URL.revokeObjectURL(address)
		}
	}, [path, session, visible])
	return (
		<inspector-preview className={css.class} ref={root}>
			<h3>{label}</h3>
			{url && (
				<preview-image>
					<img src={url} alt={label} />
					{placements.length > 0 && (
						<svg
							viewBox="0 0 1 1"
							preserveAspectRatio="none"
							role="img"
							aria-label={`${placements.length} image placement ${placements.length === 1 ? "outline" : "outlines"}`}
						>
							{placements.map((placement, index) => (
								<polygon
									key={`${placement.object}-${placement.offset}-${index}`}
									points={placement.points
										.map((point) => point.join(","))
										.join(" ")}
									vectorEffect="non-scaling-stroke"
								>
									<title>
										Image {placement.resource.replace(":", " ")} R · decoded
										byte {placement.offset}
									</title>
								</polygon>
							))}
						</svg>
					)}
				</preview-image>
			)}
			<p aria-live="polite">{message}</p>
			{placementNote && <p>{placementNote}</p>}
		</inspector-preview>
	)
}
