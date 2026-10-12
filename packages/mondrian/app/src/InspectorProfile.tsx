import { useEffect, useState } from "react"

import type { InspectionSession } from "./inspector-state.ts"
import { inspectorRequest } from "./inspector-state.ts"
import css from "./InspectorProfile.module.css"

export function InspectorProfile({
	session,
	id,
}: {
	session: InspectionSession
	id: string
}) {
	const [data, setData] = useState<Record<string, unknown> | null>(null)
	const [message, setMessage] = useState("Reading ICC header and description…")
	useEffect(() => {
		const controller = new AbortController()
		setData(null)
		void inspectorRequest(session, `profile/${id}`, controller.signal)
			.then(async (response) => {
				const result = (await response.json()) as Record<string, unknown>
				if (!controller.signal.aborted) {
					setData(result)
					setMessage(
						"Profile header metadata; this does not certify a printing condition.",
					)
				}
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted)
					setMessage(error instanceof Error ? error.message : String(error))
			})
		return () => controller.abort()
	}, [id, session])
	return (
		<inspector-profile className={css.class}>
			<h3>ICC profile characteristics</h3>
			{data && (
				<dl>
					{Object.entries(data).map(([key, value]) => (
						<profile-field key={key}>
							<dt>{key}</dt>
							<dd>
								{typeof value === "string" || typeof value === "number"
									? value
									: JSON.stringify(value)}
							</dd>
						</profile-field>
					))}
				</dl>
			)}
			<p aria-live="polite">{message}</p>
		</inspector-profile>
	)
}
