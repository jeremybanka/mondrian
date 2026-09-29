// The pinned upstream package exposes these APIs without TypeScript declarations.
declare module "lcms-wasm" {
	export const TYPE_RGB_8: number
	export const TYPE_GRAY_8: number
	export const TYPE_CMYK_8: number
	export const cmsFLAGS_BLACKPOINTCOMPENSATION: number
	export interface ColorEngine {
		HEAPU8: Uint8Array
		_malloc(size: number): number
		_free(pointer: number): void
		_cmsOpenProfileFromMem(pointer: number, size: number): number
		cmsCreate_sRGBProfile(): number
		cmsCloseProfile(profile: number): void
		cmsCreateTransform(
			input: number,
			inputFormat: number,
			output: number,
			outputFormat: number,
			intent: number,
			flags: number,
		): number
		cmsDeleteTransform(transform: number): void
		cmsDoTransform(
			transform: number,
			samples: Uint8Array,
			count: number,
		): Uint8Array
	}
	export function instantiate(options?: {
		printErr?: (message: string) => void
	}): Promise<ColorEngine>
}
