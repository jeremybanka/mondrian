declare module "node:fs/promises" {
	export function mkdir(
		path: URL,
		options: { readonly recursive: true },
	): Promise<string | undefined>

	export function readFile(path: URL): Promise<Uint8Array>

	export function writeFile(path: URL, data: Uint8Array): Promise<void>
}
