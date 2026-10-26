import {
	check,
	Container,
	dag,
	Directory,
	func,
	object,
	Workspace,
} from "@dagger.io/dagger"

/** The same repository commands before and after a push. */
@object()
export class Ci {
	source: Directory
	manifests: Directory

	constructor(ws: Workspace) {
		this.source = ws.directory("/", {
			gitignore: true,
			exclude: [
				".git",
				"**/node_modules",
				"**/dist",
				"**/coverage",
				"**/artifacts",
				".dagger/modules/ci/clients",
				".dagger/modules/ci/entrypoint",
				".dagger/modules/ci/__dagger.dispatch.ts",
			],
		})
		this.manifests = ws.directory("/", {
			include: [
				"package.json",
				"mise.toml",
				"pnpm-lock.yaml",
				"pnpm-workspace.yaml",
				".pnpmfile.mjs",
				"packages/*/package.json",
			],
		})
	}

	/** Install once per dependency/toolchain change, before copying source. */
	private async dependencies(): Promise<Container> {
		const manifest = JSON.parse(
			await this.manifests.file("package.json").contents(),
		) as {
			engines: { node: string }
			packageManager: string
		}
		const bunVersion = /^bun = "([^"]+)"$/m.exec(
			await this.manifests.file("mise.toml").contents(),
		)?.[1]
		if (!bunVersion) throw new Error("mise.toml must pin a Bun version")
		return dag
			.container()
			.from(`node:${manifest.engines.node}-bookworm`)
			.withEnvVariable("CI", "true")
			.withExec(
				[
					"npm",
					"install",
					"--global",
					manifest.packageManager,
					`bun@${bunVersion}`,
				],
				{ disableDaggerInDagger: true },
			)
			.withWorkdir("/src")
			.withMountedCache("/pnpm/store", dag.cacheVolume("mondrian-pnpm-store"))
			.withExec(
				["pnpm", "config", "set", "store-dir", "/pnpm/store", "--global"],
				{ disableDaggerInDagger: true },
			)
			.withDirectory("/src", this.manifests)
			.withExec(["pnpm", "install", "--frozen-lockfile"], {
				disableDaggerInDagger: true,
			})
	}

	/** Open this container with `dagger api call ci container terminal` to debug. */
	@func()
	async container(): Promise<Container> {
		return (await this.dependencies()).withDirectory("/src", this.source)
	}

	private async built(): Promise<Container> {
		return (await this.container()).withExec(["pnpm", "run", "build"], {
			disableDaggerInDagger: true,
		})
	}

	/** Validate formatting using the repository's dprint policy. */
	@func()
	@check()
	async format(): Promise<void> {
		await (
			await this.container()
		)
			.withExec(["pnpm", "run", "check:fmt"], { disableDaggerInDagger: true })
			.sync()
	}

	/** Validate the guide's ESLint rules. */
	@func()
	@check()
	async eslint(): Promise<void> {
		await (
			await this.container()
		)
			.withExec(["pnpm", "run", "check:eslint"], {
				disableDaggerInDagger: true,
			})
			.sync()
	}

	/** Validate component CSS ownership. */
	@func()
	@check()
	async lasertag(): Promise<void> {
		await (
			await this.container()
		)
			.withExec(["pnpm", "run", "check:lasertag"], {
				disableDaggerInDagger: true,
			})
			.sync()
	}

	/** Run Vite Plus validation and application TypeScript checks. */
	@func()
	@check()
	async vitePlus(): Promise<void> {
		await (
			await this.container()
		)
			.withExec(["pnpm", "run", "check:vp"], { disableDaggerInDagger: true })
			.sync()
	}

	/** Check consumer declarations after the shared build. */
	@func()
	@check()
	async publicTypes(): Promise<void> {
		await (
			await this.built()
		)
			.withExec(["pnpm", "run", "check:public-types"], {
				disableDaggerInDagger: true,
			})
			.sync()
	}

	/** Run tests once, including browser bundles that consume package exports. */
	@func()
	@check()
	async test(): Promise<void> {
		await (
			await this.built()
		)
			.withExec(["pnpm", "run", "test"], { disableDaggerInDagger: true })
			.sync()
	}

	/** Build and verify the packed application's binary, assets, and API. */
	@func()
	@check()
	async build(): Promise<void> {
		await (
			await this.built()
		)
			.withExec(["pnpm", "--filter", "mondrian.pdf", "test:package"], {
				disableDaggerInDagger: true,
			})
			.sync()
	}
}
