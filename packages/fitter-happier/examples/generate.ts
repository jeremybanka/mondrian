import { mkdir, writeFile } from "node:fs/promises"
import { computeLayout } from "fitter-happier"
import { serializePdf } from "mondrian.pdf"
import { lowerLayoutNodeToPdf } from "../src/index.ts"
import { layoutFixtures } from "./layouts.ts"

export async function generateExamples(): Promise<readonly URL[]> {
	const outputDirectory = new URL("../../../output/pdf/", import.meta.url)
	await mkdir(outputDirectory, { recursive: true })
	const outputs: URL[] = []

	for (const fixture of layoutFixtures) {
		const lowering = await lowerLayoutNodeToPdf(fixture.node, {
			computeLayout,
			width: fixture.width,
			height: fixture.height,
			metadata: {
				title: fixture.slug,
				subject: fixture.description,
				creator: "mondrian.fitter-happier",
				producer: "mondrian.pdf",
			},
		})
		const output = new URL(
			`fitter-happier-${fixture.slug}.pdf`,
			outputDirectory,
		)
		const bytes = serializePdf(lowering.document)
		await writeFile(output, bytes)
		outputs.push(output)
		console.log(
			`${fixture.slug}: ${bytes.length} bytes, ${lowering.document.objects.length} PDF objects`,
		)
	}

	return Object.freeze(outputs)
}
