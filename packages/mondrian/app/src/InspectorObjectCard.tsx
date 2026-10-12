import type { PdfInspectedObject } from "mondrian.pdf/inspect"

import { objectExplanations } from "./inspection-knowledge.ts"
import css from "./InspectorObjectCard.module.css"

export function InspectorObjectCard({
	object,
	selected,
	focused,
}: {
	object: PdfInspectedObject
	selected: boolean
	focused: boolean
}) {
	return (
		<inspector-object-card
			className={css.class}
			data-selected={selected}
			data-focused={focused}
		>
			<object-label>
				<code>
					{object.objectNumber} {object.generation} obj
				</code>
				<span>{object.role}</span>
			</object-label>
			<a
				href={`/inspect?object=${encodeURIComponent(object.id)}`}
				aria-current={selected ? "true" : undefined}
			>
				<strong>{object.role}</strong>
				<span aria-hidden="true">↗</span>
			</a>
			<p>
				{
					(objectExplanations[object.role] ?? objectExplanations.Dictionary)!
						.text
				}
			</p>
			<object-meta>
				<span>{object.keys.length} fields</span>
				<span>{object.references.length} links</span>
				<span>
					{object.streamBytes !== undefined
						? `${object.streamBytes.toLocaleString()} bytes`
						: object.pages.length
							? `Page ${object.pages.slice(0, 3).join(", ")}`
							: "No indexed page uses"}
				</span>
			</object-meta>
			<object-keys>
				{object.keys.slice(0, 6).map((key) => (
					<code key={key}>/{key}</code>
				))}
			</object-keys>
		</inspector-object-card>
	)
}
