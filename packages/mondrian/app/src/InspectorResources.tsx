import { useI, useO } from "atom.io/react"
import { useEffect, useState } from "react"

import type { InspectionSession } from "./inspector-state.ts"
import {
	inspectorColorAtom,
	inspectorInkAtom,
	inspectorPageAtom,
	inspectorRequest,
	inspectorSearchAtom,
	inspectorTabAtom,
} from "./inspector-state.ts"
import { InspectorPreview } from "./InspectorPreview.tsx"
import css from "./InspectorResources.module.css"

export function InspectorResources({
	session,
	mode,
}: {
	session: InspectionSession
	mode: "palette" | "bitmaps" | "inks" | "diagnostics"
}) {
	const focused = useO(inspectorColorAtom),
		setFocused = useI(inspectorColorAtom)
	const page = useO(inspectorPageAtom)
	const search = useO(inspectorSearchAtom).toLowerCase()
	const [gray, setGray] = useState(false)
	const [plates, setPlates] = useState<
		readonly { name: string; colorSpace: string }[]
	>([])
	const plate = useO(inspectorInkAtom),
		setPlate = useI(inspectorInkAtom)
	const setTab = useI(inspectorTabAtom),
		setPage = useI(inspectorPageAtom)
	const [message, setMessage] = useState("Loading available inks…")
	useEffect(() => {
		if (mode !== "inks") return
		const controller = new AbortController()
		setPlates([])
		setMessage("Checking the plate program…")
		void inspectorRequest(
			session,
			`plates${gray ? "?gray=black-only" : ""}`,
			controller.signal,
		)
			.then(async (response) => {
				const result = (await response.json()) as {
					name: string
					colorSpace: string
				}[]
				if (!controller.signal.aborted) {
					setPlates(result)
					setPlate((selected) =>
						result.some((ink) => ink.name === selected)
							? selected
							: (result[0]?.name ?? null),
					)
					setMessage(
						result.length
							? "Choose an ink to view its separation."
							: "No supported ink plates found.",
					)
				}
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted)
					setMessage(
						`Ink proof unavailable: ${error instanceof Error ? error.message : String(error)}`,
					)
			})
		return () => controller.abort()
	}, [gray, mode, session, setPlate])
	const bitmaps = session.index.bitmaps.filter((image) =>
		`${image.id} ${image.colorSpace} ${image.filters}`
			.toLowerCase()
			.includes(search),
	)
	const colors = session.index.colors.filter((color) =>
		`${color.space} ${color.components.join(" ")}`
			.toLowerCase()
			.includes(search),
	)
	return (
		<inspector-resources className={css.class}>
			{mode === "palette" && (
				<>
					<h2>Palette</h2>
					<p>
						Source colors observed at fill, stroke, and text painting
						operations. Swatches are screen approximations. Images and shadings
						can contain additional colors.
					</p>
					{session.index.notices.length > 0 && (
						<p data-warning>
							Color inventory is partial: {session.index.notices.length} content
							streams or contexts could not be fully inspected. See Diagnostics.
						</p>
					)}
					{colors.length === 0 && <p>No supported paint colors found.</p>}
					{colors.slice(0, 300).map((color) => (
						<color-module key={color.id} data-focused={focused === color.id}>
							<button
								type="button"
								aria-pressed={focused === color.id}
								onClick={() =>
									setFocused(focused === color.id ? null : color.id)
								}
							>
								<color-swatch
									style={{
										background:
											color.swatch ??
											"repeating-linear-gradient(45deg,#ddd 0 4px,#fafafa 4px 8px)",
									}}
								/>
								<strong>{color.space}</strong>
								<code>{color.components.join(" · ")}</code>
							</button>
							<p>
								{color.uses.length} observed uses · Page{" "}
								{[...new Set(color.uses.map((use) => use.page))].join(", ")}
							</p>
							<color-uses>
								{color.uses.slice(0, 24).map((use, index) => (
									<a
										key={index}
										href={`/inspect?object=${encodeURIComponent(use.object)}`}
									>
										{use.object.replace(":", " ")} obj · decoded byte{" "}
										{use.offset} →
									</a>
								))}
							</color-uses>
							<color-plates>
								{(color.space === "DeviceCMYK"
									? ["Cyan", "Magenta", "Yellow", "Black"].filter(
											(_ink, index) => color.components[index]! > 0,
										)
									: color.space.startsWith("Separation /")
										? [color.space.slice("Separation /".length)]
										: []
								).map((ink) => (
									<button
										key={ink}
										type="button"
										onClick={() => {
											setPlate(ink)
											setPage(color.uses[0]?.page ?? 1)
											setTab("inks")
										}}
									>
										View {ink} ink →
									</button>
								))}
							</color-plates>
						</color-module>
					))}
					{colors.length > 300 && (
						<p>Showing 300 matching colors; narrow the search to see more.</p>
					)}
				</>
			)}
			{mode === "bitmaps" && (
				<>
					<h2>Embedded bitmaps</h2>
					<p>
						Image XObjects and their masks, including objects not used by a
						page. Thumbnails decode on demand; metadata remains available when a
						codec cannot be previewed.
					</p>
					{bitmaps.length === 0 && <p>No image XObjects found.</p>}
					{bitmaps.slice(0, 100).map((image) => (
						<bitmap-module key={image.id}>
							<a href={`/inspect?object=${encodeURIComponent(image.id)}`}>
								<strong>{image.id.replace(":", " ")} obj</strong>
								<span>Inspect →</span>
							</a>
							<dl>
								<dt>Dimensions</dt>
								<dd>
									{image.width ?? "?"} × {image.height ?? "?"}
								</dd>
								<dt>Components</dt>
								<dd>
									{image.colorSpace} · {image.bits ?? "?"} bits
								</dd>
								<dt>Encoding</dt>
								<dd>{image.filters}</dd>
								<dt>Source ICC</dt>
								<dd>
									{image.profile ? (
										<a
											href={`/inspect?object=${encodeURIComponent(image.profile)}`}
										>
											{image.profile.replace(":", " ")} R →
										</a>
									) : (
										"No embedded ICC reference"
									)}
								</dd>
								<dt>Transparency</dt>
								<dd>
									{image.stencil ? (
										"Stencil image"
									) : image.mask ? (
										<a
											href={`/inspect?object=${encodeURIComponent(image.mask)}`}
										>
											Soft mask {image.mask.replace(":", " ")} R →
										</a>
									) : (
										"No soft mask"
									)}
								</dd>
							</dl>
							<InspectorPreview
								session={session}
								path={`image/${image.id}`}
								label={`Bitmap ${image.id.replace(":", " ")}`}
								lazy
							/>
						</bitmap-module>
					))}
					{bitmaps.length > 100 && (
						<p>Showing 100 matching images; narrow the search to see more.</p>
					)}
				</>
			)}
			{mode === "inks" && (
				<>
					<h2>Ink plates</h2>
					<p>
						CMYK channels and named spot inks, preserving supported knockout and
						overprint. Different source colors can share an ink plate. No
						destination color conversion is performed.
					</p>
					<label>
						<input
							type="checkbox"
							checked={gray}
							onChange={(event) => setGray(event.target.checked)}
						/>{" "}
						Interpret DeviceGray as black ink
					</label>
					<p aria-live="polite">{message}</p>
					<ink-list>
						{plates.map((ink) => (
							<button
								key={ink.name}
								type="button"
								aria-pressed={plate === ink.name}
								onClick={() => setPlate(ink.name)}
							>
								{ink.name}
								<small>{ink.colorSpace}</small>
							</button>
						))}
					</ink-list>
					{plate && (
						<InspectorPreview
							session={session}
							path={`page/${page}?plate=${encodeURIComponent(plate)}${gray ? "&gray=black-only" : ""}`}
							label={`${plate} · Page ${page}`}
						/>
					)}
					<a href="/mondrian#color">
						Learn about color interpretation and print preparation ↗
					</a>
				</>
			)}
			{mode === "diagnostics" && (
				<>
					<h2>Diagnostics</h2>
					<p>
						Structural validation, parser recovery, and capability limits are
						separate results. Rendering a page successfully does not certify PDF
						conformance.
					</p>
					{session.diagnostics.length === 0 && (
						<p data-success>No Mondrian structural diagnostics.</p>
					)}
					{session.diagnostics.map((diagnostic, index) => (
						<diagnostic-module key={index}>
							<strong>
								{diagnostic.severity.toUpperCase()} · {diagnostic.code}
							</strong>
							<code>{diagnostic.path}</code>
							<p>{diagnostic.message}</p>
						</diagnostic-module>
					))}
					{session.warnings.map((warning, index) => (
						<diagnostic-module key={`warning-${index}`}>
							<strong>RECOVERY · original byte {warning.offset}</strong>
							<p>{warning.message}</p>
						</diagnostic-module>
					))}
					{session.index.notices.map((notice, index) => (
						<diagnostic-module key={`notice-${index}`}>
							<a href={`/inspect?object=${encodeURIComponent(notice.object)}`}>
								{notice.object.replace(":", " ")} obj →
							</a>
							<p>{notice.message}</p>
						</diagnostic-module>
					))}
				</>
			)}
		</inspector-resources>
	)
}
