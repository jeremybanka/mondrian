import type { PdfIndirectObject } from "mondrian.pdf"
import type { PdfInspectedObject } from "mondrian.pdf/inspect"
import {
	decodePdfInspectionStream,
	inspectPdfContent,
	pdfDictionaryEntries,
	pdfInspectionSyntax,
} from "mondrian.pdf/inspect"
import { useMemo, useState } from "react"

import {
	fieldExplanations,
	objectExplanations,
} from "./inspection-knowledge.ts"
import type { InspectionSession } from "./inspector-state.ts"
import css from "./InspectorObjectDetail.module.css"

function modelText(value: unknown): string {
	let remaining = 1000
	return JSON.stringify(
		value,
		(_key, item: unknown) => {
			if (--remaining < 0) return "[display truncated]"
			if (item instanceof Uint8Array)
				return {
					type: "Uint8Array",
					length: item.length,
					firstBytes: Array.from(item.subarray(0, 64)),
				}
			if (Array.isArray(item)) return item.slice(0, 64)
			if (typeof item === "object" && item !== null)
				return Object.fromEntries(Object.entries(item).slice(0, 64))
			return item
		},
		2,
	).slice(0, 16384)
}

export function InspectorObjectDetail({
	session,
	object,
	summary,
}: {
	session: InspectionSession
	object: PdfIndirectObject
	summary: PdfInspectedObject
}) {
	const [view, setView] = useState("fields")
	const value = object.value
	const structured =
		typeof value === "object" &&
		value !== null &&
		(value.kind === "dictionary" || value.kind === "stream")
	const stream =
		typeof value === "object" && value !== null && value.kind === "stream"
			? value
			: null
	const explanation =
		objectExplanations[summary.role] ?? objectExplanations.Dictionary!
	const text = useMemo(() => {
		try {
			if (view === "model") return modelText(object)
			if (view === "syntax")
				return `${summary.objectNumber} ${summary.generation} obj\n${pdfInspectionSyntax(value)}\nendobj`
			if (!stream) return ""
			if (view === "encoded")
				return Array.from(stream.data.subarray(0, 4096), (byte) =>
					byte.toString(16).padStart(2, "0"),
				).join(" ")
			const bytes = decodePdfInspectionStream(session.document, stream)
			if (view === "decoded")
				return `${bytes.length.toLocaleString()} decoded bytes\n\n${new TextDecoder().decode(bytes.subarray(0, 16384))}`
			if (view === "operators")
				return inspectPdfContent(bytes)
					.slice(0, 200)
					.map(
						(op) =>
							`${String(op.offset).padStart(6)}  ${op.operands.map((operand) => pdfInspectionSyntax(operand)).join(" ")} ${op.operator}`,
					)
					.join("\n")
			return ""
		} catch (error) {
			return `This view is unavailable: ${error instanceof Error ? error.message : String(error)}\n\nThe encoded bytes and object fields remain available.`
		}
	}, [object, session.document, stream, summary, value, view])
	const fields = structured ? pdfDictionaryEntries(value).slice(0, 128) : []
	return (
		<inspector-object-detail className={css.class}>
			<detail-heading>
				<code>
					{summary.objectNumber} {summary.generation} obj
				</code>
				<h2>{summary.role}</h2>
				<p>{explanation.text}</p>
				<a href={explanation.lesson}>Read the explanation in the guide ↗</a>
			</detail-heading>
			<nav aria-label="Object detail views">
				{[
					"fields",
					"syntax",
					"model",
					...(stream
						? [
								"encoded",
								"decoded",
								...(summary.role === "Content stream" ||
								summary.role === "Form XObject"
									? ["operators"]
									: []),
							]
						: []),
				].map((tab) => (
					<button
						key={tab}
						type="button"
						aria-pressed={view === tab}
						onClick={() => setView(tab)}
					>
						{tab === "syntax"
							? "Generated syntax"
							: tab[0]!.toUpperCase() + tab.slice(1)}
					</button>
				))}
			</nav>
			{view === "fields" ? (
				<field-list>
					{fields.length ? (
						fields.map(([key, item]) => (
							<details key={key}>
								<summary>
									<code>/{key}</code>
									<span>{pdfInspectionSyntax(item).slice(0, 160)}</span>
								</summary>
								<p>
									{fieldExplanations[key] ??
										"This field is retained in the PDF model. Its meaning depends on the dictionary’s role and the producer’s conventions."}
								</p>
								{summary.references
									.filter((link) => link.path.startsWith(`/${key}`))
									.slice(0, 32)
									.map((link, index) => (
										<a
											key={index}
											href={`/inspect?object=${encodeURIComponent(link.id)}`}
										>
											{link.id.replace(":", " ")} R →
										</a>
									))}
							</details>
						))
					) : (
						<pre>
							<code>{pdfInspectionSyntax(value)}</code>
						</pre>
					)}
				</field-list>
			) : (
				<pre aria-label={`${view} view`}>
					<code>{text}</code>
				</pre>
			)}
			<p data-note>
				Displays are bounded and may be truncated. Generated syntax is derived
				from the parsed model; it is not the original file’s byte layout.
				Encoded bytes belong to that model and may have been decrypted. Stream
				offsets are decoded offsets.
			</p>
			<reference-list>
				<h3>References</h3>
				{summary.references.length ? (
					summary.references.slice(0, 100).map((link, index) => (
						<a
							key={index}
							href={`/inspect?object=${encodeURIComponent(link.id)}`}
						>
							<code>{link.id.replace(":", " ")} R</code>
							<span>{link.path}</span>
						</a>
					))
				) : (
					<p>No outgoing references.</p>
				)}
				<h3>Referenced by</h3>
				{summary.referencedBy.length ? (
					summary.referencedBy.slice(0, 100).map((link, index) => (
						<a
							key={index}
							href={`/inspect?object=${encodeURIComponent(link.id)}`}
						>
							<code>{link.id.replace(":", " ")} obj</code>
							<span>{link.path}</span>
						</a>
					))
				) : (
					<p>No incoming object references.</p>
				)}
			</reference-list>
		</inspector-object-detail>
	)
}
