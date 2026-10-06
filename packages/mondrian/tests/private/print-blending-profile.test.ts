import { expect, it } from "vite-plus/test"
import {
	array,
	ascii,
	createPdfObjectBuilder,
	dictionary,
	name,
	stream,
} from "../../src/index.ts"
import type { PdfPagesDictionary } from "../../src/index.ts"
import { preparePdfForPrint } from "../../src/print.ts"
import {
	destinationProfile,
	printOptions,
} from "../public/fixtures/mixed-color/document.ts"
import { syntheticCmykProfile } from "./fixtures/source-cmyk-profile.ts"

const sourceProfile = syntheticCmykProfile()
const retarget = { sourceProfile, blackOnly: "preserve" as const }

/** Two overlapping process colors with ordinary half-opacity in a CMYK page group. */
function cmykGroup(
	group: "device" | "icc",
	profile: Uint8Array = sourceProfile,
	declared = true,
	paint = true,
) {
	const objects = createPdfObjectBuilder(),
		pages = objects.reserve<PdfPagesDictionary>()
	const profileRef = objects.add(stream({ N: 4 }, profile))
	const page = objects.add(
		dictionary({
			Type: name("Page"),
			Parent: pages.ref,
			MediaBox: array(0, 0, 80, 80),
			Group: dictionary({
				S: name("Transparency"),
				CS:
					group === "icc"
						? array(name("ICCBased"), profileRef)
						: name("DeviceCMYK"),
				I: true,
				K: false,
			}),
			Resources: dictionary({
				ExtGState: dictionary({
					Half: dictionary({
						ca: 0.5,
						CA: 0.5,
						BM: name("Normal"),
						AIS: false,
						SMask: name("None"),
					}),
				}),
			}),
			Contents: objects.add(
				stream(
					{},
					ascii(
						paint
							? "0.7 0.1 0.2 0.1 k 0 0 80 80 re f /Half gs 0.1 0.6 0.3 0.2 k 0 0 80 80 re f"
							: "",
					),
				),
			),
		}),
	)
	pages.set(dictionary({ Type: name("Pages"), Kids: array(page), Count: 1 }))
	const intent = objects.add(
		dictionary({
			Type: name("OutputIntent"),
			S: name("GTS_PDFX"),
			DestOutputProfile: profileRef,
		}),
	)
	return objects.build({
		root: objects.add(
			dictionary({
				Type: name("Catalog"),
				Pages: pages.ref,
				...(declared ? { OutputIntents: array(intent) } : {}),
			}),
		),
		version: "1.7",
	})
}

it.each(["device", "icc"] as const)(
	"rejects source preservation for a %s group associated with a different CMYK profile",
	async (group) => {
		await expect(
			preparePdfForPrint(cmykGroup(group), {
				...printOptions,
				processNumbers: retarget,
				blending: "preserve-source",
			}),
		).rejects.toThrow(/CMYK blending profile differs.*destination blending/)
	},
)

it("uses the caller's DeviceCMYK interpretation when there is no OutputIntent", async () => {
	await expect(
		preparePdfForPrint(cmykGroup("device", sourceProfile, false), {
			...printOptions,
			processNumbers: retarget,
			blending: "preserve-source",
		}),
	).rejects.toThrow(/CMYK blending profile differs.*destination blending/)
})

it("checks a declared DeviceCMYK group profile even without process painting", async () => {
	await expect(
		preparePdfForPrint(cmykGroup("device", sourceProfile, true, false), {
			...printOptions,
			blending: "preserve-source",
		}),
	).rejects.toThrow(/CMYK blending profile differs.*destination blending/)
})

it.each(["device", "icc"] as const)(
	"accepts established destination %s groups with source preservation",
	async (group) => {
		const result = await preparePdfForPrint(
			cmykGroup(group, destinationProfile),
			{
				...printOptions,
				blending: "preserve-source",
			},
		)
		expect(result.report.conversions.map((c) => c.action)).toEqual([
			"preserve-process",
			"preserve-process",
		])
		expect(result.report.groups).toHaveLength(1)
		const icc = await preparePdfForPrint(cmykGroup("icc", destinationProfile), {
			...printOptions,
			blending: "preserve-source",
		})
		expect(result.report.groups).toEqual(icc.report.groups)
	},
)

it.each(["device", "icc"] as const)(
	"retargets %s groups when destination blending is explicitly selected",
	async (group) => {
		const result = await preparePdfForPrint(cmykGroup(group), {
			...printOptions,
			processNumbers: retarget,
		})
		expect(
			result.report.conversions.filter((c) => c.action === "convert"),
		).toHaveLength(2)
		const icc = await preparePdfForPrint(cmykGroup("icc"), {
			...printOptions,
			processNumbers: retarget,
		})
		expect(result.report.groups).toEqual(icc.report.groups)
	},
)

it("accepts native destination amounts without an OutputIntent under the preserve policy", async () => {
	await expect(
		preparePdfForPrint(cmykGroup("device", destinationProfile, false), {
			...printOptions,
			blending: "preserve-source",
		}),
	).resolves.toBeDefined()
})

it("honors explicit native-process source interpretation while retaining embedded group precedence", async () => {
	const options = {
		...printOptions,
		processNumbers: {
			sourceProfile: destinationProfile,
			blackOnly: "preserve" as const,
		},
		blending: "preserve-source" as const,
	}
	await expect(
		preparePdfForPrint(cmykGroup("device"), options),
	).resolves.toBeDefined()
	await expect(preparePdfForPrint(cmykGroup("icc"), options)).rejects.toThrow(
		/CMYK blending profile differs/,
	)
})
