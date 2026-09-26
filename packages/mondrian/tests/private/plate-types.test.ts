import { expectTypeOf, it } from "vite-plus/test"
import type { PdfStream, PdfValue } from "../../src/objects.ts"
import type {
	PlateInk,
	PlateInstruction,
	PlatePaint,
	PlateScope,
} from "../../src/testing/plate-plan.ts"

it("requires space-specific color data and fixed component counts", () => {
	type Color = PlatePaint["color"]
	expectTypeOf<{
		space: "cmyk"
		components: readonly [number, number, number]
	}>().not.toExtend<Color>()
	expectTypeOf<{
		space: "spot"
		components: readonly [number]
	}>().not.toExtend<Color>()
	expectTypeOf<{
		space: "spot"
		components: readonly [number]
		ink: string
	}>().not.toExtend<Color>()
	expectTypeOf<{
		space: "spot"
		components: readonly [number]
		definition: PdfValue
	}>().not.toExtend<Color>()
	expectTypeOf<{
		space: "spot"
		components: readonly [number, number]
		ink: string
		definition: PdfValue
	}>().not.toExtend<Color>()
	expectTypeOf<{
		space: "cmyk"
		components: readonly [number, number, number, number]
	}>().toExtend<Color>()
	expectTypeOf<{
		space: "spot"
		components: readonly [number]
		ink: string
		definition: PdfValue
	}>().toExtend<Color>()
})

it("requires a valid process component or a spot ink identity", () => {
	expectTypeOf<{ name: "Cyan"; colorSpace: "cmyk" }>().not.toExtend<PlateInk>()
	expectTypeOf<{
		name: "Cyan"
		colorSpace: "cmyk"
		component: 4
	}>().not.toExtend<PlateInk>()
	expectTypeOf<{ name: string; colorSpace: "spot" }>().not.toExtend<PlateInk>()
	expectTypeOf<{
		name: "Cyan"
		colorSpace: "cmyk"
		component: 0
	}>().toExtend<PlateInk>()
	expectTypeOf<{
		name: string
		colorSpace: "spot"
		ink: string
	}>().toExtend<PlateInk>()
})

it("requires instruction kinds, source streams for Forms, and paint for paths", () => {
	expectTypeOf<{
		op: string
		operands: readonly string[]
	}>().not.toExtend<PlateInstruction>()
	expectTypeOf<{
		kind: "form"
		op: "Do"
		operands: readonly string[]
		form: PlateScope
	}>().not.toExtend<PlateInstruction>()
	expectTypeOf<{
		kind: "path"
		op: "f"
		operands: readonly string[]
		fill: undefined
		stroke: undefined
	}>().not.toExtend<PlateInstruction>()
	expectTypeOf<{
		kind: "text"
		op: "Tj"
		operands: readonly string[]
		fill: undefined
		stroke: undefined
	}>().not.toExtend<PlateInstruction>()
	expectTypeOf<{
		kind: "raw"
		op: string
		operands: readonly string[]
	}>().toExtend<PlateInstruction>()
	expectTypeOf<{
		kind: "form"
		form: PlateScope & { source: PdfStream }
	}>().toExtend<PlateInstruction>()
	expectTypeOf<{
		kind: "path"
		op: "f"
		operands: readonly string[]
		fill: PlatePaint
		stroke: undefined
	}>().toExtend<PlateInstruction>()
	expectTypeOf<{
		kind: "text"
		op: "Tj"
		operands: readonly string[]
		fill: undefined
		stroke: undefined
		textMode: 7
	}>().toExtend<PlateInstruction>()
})
