import { changesetsReleaseDelta } from "@breakage/changesets"
import { defineConfig, semverPolicy, type BreakageConfig } from "breakage"

const config: BreakageConfig = defineConfig({
	tagPattern: "refs/tags/mondrian.pdf@",
	testPattern: "{tests/public,src/testing/inspection}/**/*",
	test: "pnpm test:public && pnpm check:public-types",
	release: {
		resolveDelta: changesetsReleaseDelta(),
		policy: semverPolicy({ beforeV1: "minor" }),
	},
})

export default config
