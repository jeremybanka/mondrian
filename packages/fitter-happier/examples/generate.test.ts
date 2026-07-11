import { readFile } from "node:fs/promises"
import { expect, it } from "vite-plus/test"
import { generateExamples } from "./generate.ts"

it("generates the visual PDF examples", async () => {
	const outputs = await generateExamples()
	expect(outputs.length).toBeGreaterThanOrEqual(5)
	for (const output of outputs) {
		const bytes = await readFile(output)
		expect(String.fromCharCode(...bytes.slice(0, 8))).toBe("%PDF-1.7")
	}
})
