import { breakCheck } from "break-check"
import type { BreakCheckOptions, BreakCheckOutcome } from "break-check"
import { readFileSync } from "node:fs"

type Result = BreakCheckOutcome & { summary: string }

export function compatibilityExitCode(result: Result): number {
	if ("breakingChangesFound" in result) {
		return result.breakingChangesFound && !result.breakingChangesCertified
			? 1
			: 0
	}
	// 0.1.0 predates the public suite. Do not exempt missing suites in later releases,
	// dirty checkouts, missing tags, or failures to read the release tree.
	if (
		"testsWereFound" in result &&
		!result.testsWereFound &&
		result.lastReleaseTag === "refs/tags/mondrian.pdf@0.1.0" &&
		result.summary ===
			'No tests were found matching the pattern "tests/public/**/*".'
	) {
		return 0
	}
	return 2
}

if (import.meta.main) {
	const config: BreakCheckOptions = JSON.parse(
		readFileSync(
			new URL("../break-check.config.json", import.meta.url),
			"utf8",
		),
	)
	const result = await breakCheck(config)
	process.exitCode = compatibilityExitCode(result)
	console.log(result.summary)
	if (process.exitCode === 0 && !("breakingChangesFound" in result)) {
		console.log(
			"The current public suite passed. Release 0.1.0 predates this suite; release comparison begins with the next release containing tests/public/.",
		)
	} else if (
		process.exitCode !== 0 ||
		("breakingChangesFound" in result && result.breakingChangesFound)
	) {
		console.error(result)
	}
}
