import { scaleLinear } from "@visx/scale"
import { Bar } from "@visx/shape"
import { useI, useO } from "atom.io/react"

import css from "./FileExplorer.module.css"
import { fileSections } from "./specimen.ts"
import { drawingXAtom, fileSectionAtom } from "./state.ts"

export function FileExplorer() {
	const x = useO(drawingXAtom)
	const selected = useO(fileSectionAtom)
	const select = useI(fileSectionAtom)
	const sections = fileSections(x)
	const section =
		sections.find((entry) => entry.id === selected) ?? sections[1]!
	const length = sections.at(-1)!.end
	const scale = scaleLinear({ domain: [0, length], range: [0, 700] })
	return (
		<file-explorer className={css.class}>
			<explorer-heading>
				<span>THE FILE, BYTE BY BYTE</span>
				<small>{length} bytes · PDF 1.7</small>
			</explorer-heading>
			<svg
				viewBox="0 0 700 45"
				role="img"
				aria-label="Relative byte lengths of the header, objects, cross-reference, trailer, and ending"
			>
				{sections.map((entry, index) => (
					<Bar
						key={entry.id}
						x={scale(entry.start)}
						y={5}
						width={Math.max(1, scale(entry.end) - scale(entry.start) - 2)}
						height={30}
						fill={
							["#dcb766", "#c3b8e3", "#b4ccb9", "#b5c8d8", "#d8bdb2"][index]
						}
						opacity={entry.id === selected ? 1 : 0.45}
					/>
				))}
			</svg>
			<nav aria-label="File sections">
				{sections.map((entry, index) => (
					<button
						type="button"
						key={entry.id}
						aria-pressed={entry.id === selected}
						onClick={() => select(entry.id)}
					>
						<span>{String(index + 1).padStart(2, "0")}</span>
						{entry.label}
					</button>
				))}
			</nav>
			<file-detail>
				<section-description>
					<small>
						OFFSET {section.start} → {section.end - 1}
					</small>
					<h3>{section.label}</h3>
					<p>{section.note}</p>
					<span>{section.end - section.start} bytes in this section</span>
				</section-description>
				<pre aria-label={`${section.label} PDF syntax`}>
					<code>{section.syntax}</code>
				</pre>
			</file-detail>
			<explorer-note>
				<span aria-hidden="true">↳</span> Positions are zero-based byte offsets,
				not Unicode character counts.
			</explorer-note>
		</file-explorer>
	)
}
