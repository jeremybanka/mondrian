import { describe, expect, it } from "vite-plus/test"
import { compatibilityExitCode } from "../../scripts/check-compatibility.ts"

const missingSuite = {
	gitWasClean: true,
	lastReleaseFound: true,
	lastReleaseTag: "refs/tags/mondrian.pdf@0.1.0",
	testsWereFound: false,
	summary: 'No tests were found matching the pattern "tests/public/**/*".',
} as const

describe("compatibility suite migration", () => {
	it("allows only the known release that predates the public suite", () => {
		expect(compatibilityExitCode(missingSuite)).toBe(0)
		expect(
			compatibilityExitCode({
				...missingSuite,
				lastReleaseTag: "refs/tags/mondrian.pdf@0.2.0",
			}),
		).toBe(2)
	})

	it("fails if the release could not be inspected", () => {
		expect(
			compatibilityExitCode({
				...missingSuite,
				summary: "Failed to list production files: unavailable",
			}),
		).toBe(2)
	})

	it("fails for dirty repositories and missing release tags", () => {
		expect(
			compatibilityExitCode({ gitWasClean: false, summary: "Dirty" }),
		).toBe(2)
		expect(
			compatibilityExitCode({
				gitWasClean: true,
				lastReleaseFound: false,
				summary: "No tags",
			}),
		).toBe(2)
	})

	it("requires certification when released tests fail", () => {
		const result = {
			...missingSuite,
			testsWereFound: true,
			testsFound: ["tests/public/documents.test.ts"],
			breakingChangesFound: true,
			testResult: "Tests failed",
			breakingChangesCertified: false,
			certificationStdout: "",
			certificationStderr: "",
		} as const
		expect(compatibilityExitCode(result)).toBe(1)
		expect(
			compatibilityExitCode({ ...result, breakingChangesCertified: true }),
		).toBe(0)
		expect(
			compatibilityExitCode({ ...result, breakingChangesFound: false }),
		).toBe(0)
	})
})
