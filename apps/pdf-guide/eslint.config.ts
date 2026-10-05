import * as tsParser from "@typescript-eslint/parser"
import AtomIOPlugin from "atom.io/eslint-plugin"
import type { ESLint, Linter } from "eslint"
import * as ImportPlugin from "eslint-plugin-import-x"
import SimpleImportSortPlugin from "eslint-plugin-simple-import-sort"
import LasertagPlugin from "lasertag/eslint-plugin"

const configs: Linter.Config[] = [
	{
		ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**"],
	},
	{
		files: ["**/*.{ts,tsx}"],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
				sourceType: "module",
			} satisfies tsParser.ParserOptions,
		},
		plugins: {
			"atom.io": AtomIOPlugin,
			// import-x still declares its rules against the older ESLint rule context.
			import: ImportPlugin as unknown as ESLint.Plugin,
			"simple-import-sort": SimpleImportSortPlugin,
		},
		rules: {
			"atom.io/exact-catch-types": "error",
			"atom.io/explicit-state-types": ["error", { permitAnnotation: true }],
			"atom.io/naming-convention": "error",
			"import/newline-after-import": "error",
			"import/no-duplicates": "error",
			"import/extensions": [
				"error",
				"never",
				{
					checkTypeImports: true,
					fix: true,
					ignorePackages: true,
					pattern: { ts: "always", tsx: "always" },
				},
			],
			"simple-import-sort/imports": "error",
			"simple-import-sort/exports": "error",
		},
	},
	{
		files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
		rules: { "no-console": "error" },
	},
	{
		files: ["src/**/*.tsx"],
		plugins: { lasertag: LasertagPlugin },
		rules: {
			"lasertag/access-css-module-class-only": "error",
			"lasertag/ban-div": "error",
			"lasertag/export-own-component-only": "error",
			"lasertag/header-main-footer-as-group": "error",
			"lasertag/import-own-css-module-only": "error",
			"lasertag/name-imported-css-module-as-css": "error",
			"lasertag/render-tag-with-own-name": "error",
		},
	},
]

export default configs
