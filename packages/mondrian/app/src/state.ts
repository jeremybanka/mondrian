import { atom } from "atom.io"

export const selectedObjectAtom = atom<number>({
	key: "selectedObject",
	default: 3,
})
export const representationAtom = atom<"syntax" | "model">({
	key: "representation",
	default: "syntax",
})
export const drawingXAtom = atom<number>({ key: "drawingX", default: 48 })
export const drawingStepAtom = atom<number>({ key: "drawingStep", default: 4 })
export const fileSectionAtom = atom<string>({
	key: "fileSection",
	default: "objects",
})
export const menuOpenAtom = atom<boolean>({ key: "menuOpen", default: false })
