const TYPESCRIPT_FOR_VITE_PLUS_CORE = "6.0.3"
const TYPESCRIPT_FOR_TYPESCRIPT_ESLINT_8 = "6.0.3"

// Borrow atom.io's compiler-API compatibility bridge while keeping tsc on TS 7.
// Remove when TypeScript ESLint supports TypeScript 7's compiler API.
const TYPESCRIPT_ESLINT_PACKAGES = new Set([
	"typescript-eslint",
	"@typescript-eslint/eslint-plugin",
	"@typescript-eslint/parser",
	"@typescript-eslint/project-service",
	"@typescript-eslint/rule-tester",
	"@typescript-eslint/tsconfig-utils",
	"@typescript-eslint/type-utils",
	"@typescript-eslint/typescript-estree",
	"@typescript-eslint/utils",
])

const needsTypescriptEslint6 = (packageJson) =>
	TYPESCRIPT_ESLINT_PACKAGES.has(packageJson.name) &&
	packageJson.version?.startsWith("8.") === true &&
	packageJson.peerDependencies?.typescript !== undefined

// Vite+ core's declaration bundler reads the TypeScript compiler API that
// TypeScript 7 no longer exposes from the package root. Remove this once Vite+
// supports TypeScript 7 for declaration generation.
const needsTypescript6 = (packageJson) =>
	packageJson.name === "@voidzero-dev/vite-plus-core" &&
	packageJson.version?.startsWith("0.2.") === true &&
	packageJson.peerDependencies?.typescript !== undefined

export const hooks = {
	readPackage(packageJson) {
		const eslintTypescript6 = needsTypescriptEslint6(packageJson)
		if (needsTypescript6(packageJson) || eslintTypescript6) {
			delete packageJson.peerDependencies.typescript
			delete packageJson.peerDependenciesMeta?.typescript
			packageJson.dependencies = {
				...packageJson.dependencies,
				typescript: eslintTypescript6
					? TYPESCRIPT_FOR_TYPESCRIPT_ESLINT_8
					: TYPESCRIPT_FOR_VITE_PLUS_CORE,
			}
		}

		return packageJson
	},
}
