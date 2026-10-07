import { LinkVertical } from "@visx/shape"
import { useI, useO } from "atom.io/react"

import { objectDetails } from "./chapters.ts"
import css from "./ObjectExplorer.module.css"
import { objectModel, objectSyntax } from "./specimen.ts"
import {
	drawingXAtom,
	representationAtom,
	selectedObjectAtom,
} from "./state.ts"

const nodes = [
	{ id: 1, x: 220, y: 20 },
	{ id: 2, x: 220, y: 100 },
	{ id: 3, x: 220, y: 180 },
	{ id: 4, x: 95, y: 285 },
	{ id: 5, x: 345, y: 285 },
]
const edges = [
	{ from: 1, to: 2, label: "/Pages" },
	{ from: 2, to: 3, label: "/Kids" },
	{ from: 3, to: 4, label: "/Contents" },
	{ from: 3, to: 5, label: "/Resources /Font /F1" },
]

export function ObjectExplorer() {
	const selected = useO(selectedObjectAtom)
	const select = useI(selectedObjectAtom)
	const representation = useO(representationAtom)
	const setRepresentation = useI(representationAtom)
	const x = useO(drawingXAtom)
	const object =
		objectDetails.find((entry) => entry.id === selected) ?? objectDetails[2]
	return (
		<object-explorer className={css.class}>
			<explorer-heading>
				<span>ONE DOCUMENT. FIVE CONNECTED OBJECTS.</span>
				<small>Select an object to inspect it</small>
			</explorer-heading>
			<explorer-panels>
				<graph-panel>
					<svg
						viewBox="0 0 440 360"
						role="img"
						aria-label="Catalog points to Pages, Pages to Page, Page to Content and Font. The Page also references its parent Pages node."
					>
						{edges.map((edge) => {
							const from = nodes.find((node) => node.id === edge.from)!
							const to = nodes.find((node) => node.id === edge.to)!
							return (
								<g key={edge.label}>
									<LinkVertical
										data={{
											source: { x: from.x, y: from.y + 42 },
											target: { x: to.x, y: to.y },
										}}
										stroke="#bfb8cc"
										strokeWidth={1.3}
										fill="none"
									/>
									<text
										x={(from.x + to.x) / 2 + (edge.to === 4 ? -38 : 8)}
										y={(from.y + 42 + to.y) / 2 - 5}
										fontSize="8"
										fill="#84808d"
										fontFamily="monospace"
									>
										{edge.label}
									</text>
								</g>
							)
						})}
						{nodes.map((node) => (
							<g key={node.id}>
								<rect
									x={node.x - 64}
									y={node.y}
									width="128"
									height="42"
									rx="5"
									fill={node.id === selected ? "#e8e4f5" : "#fcfbf8"}
									stroke={node.id === selected ? "#8f7dad" : "#d9d5df"}
								/>
								<text
									x={node.x - 49}
									y={node.y + 25}
									fontSize="9"
									fontFamily="monospace"
									fill="#9281a8"
								>
									{node.id} 0 R
								</text>
								<text
									x={node.x - 1}
									y={node.y + 25}
									fontSize="12"
									fill="#292b3c"
								>
									{objectDetails.find((entry) => entry.id === node.id)?.label}
								</text>
							</g>
						))}
						<text
							x="220"
							y="349"
							textAnchor="middle"
							fontSize="8"
							fill="#89848d"
						>
							Forward references shown · Page /Parent points back to Pages
						</text>
					</svg>
					<nav aria-label="Select a PDF object">
						{objectDetails.map((entry) => (
							<button
								type="button"
								key={entry.id}
								aria-pressed={selected === entry.id}
								onClick={() => select(entry.id)}
							>
								{entry.id}. {entry.label}
							</button>
						))}
					</nav>
				</graph-panel>
				<inspector-panel>
					<nav aria-label="Object representation">
						<button
							type="button"
							aria-pressed={representation === "syntax"}
							onClick={() => setRepresentation("syntax")}
						>
							PDF syntax
						</button>
						<button
							type="button"
							aria-pressed={representation === "model"}
							onClick={() => setRepresentation("model")}
						>
							Mondrian model
						</button>
					</nav>
					<pre aria-label={`${object.label} ${representation}`}>
						<code>
							{representation === "syntax"
								? objectSyntax(selected, x)
								: objectModel(selected, x)}
						</code>
					</pre>
					<object-caption>
						<span>
							{String(selected).padStart(2, "0")} / {object.type.toUpperCase()}
						</span>
						<h3>{object.label}</h3>
						<p>{object.note}</p>
					</object-caption>
				</inspector-panel>
			</explorer-panels>
		</object-explorer>
	)
}
