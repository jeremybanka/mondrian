# Mondrian

Workspace for typed PDF compilation targets.

- [`mondrian.pdf`](packages/mondrian) provides the low-level PDF object model,
  invariant-preserving builder, validator, and serializer.

The `fitter-happier` integration is maintained in the `fitter-happier`
repository and consumes the published `mondrian.pdf` package.

## Coverage

Run `MONDRIAN_PDF_ARTIFACT_MODE=verify pnpm coverage` to run the test suite with
coverage. Reports are written to `packages/mondrian/coverage` in text, HTML,
and Istanbul JSON formats.

Run `pnpm coverage:track` after generating coverage to capture and compare it
with the main-branch baseline using [Recoverage](https://recoverage.cloud).
Bun is installed through `mise.toml`. The local `coverage.sqlite` database is
ignored by Git.

The Coverage CI job runs on pull requests and pushes to `main`. Set the
`RECOVERAGE_CLOUD_TOKEN` GitHub Actions secret to enable persistent tracking
under the report name `mondrian`. Main-branch runs publish the baseline;
pull requests compare against it and fail if statement coverage decreases.
The first main-branch coverage run must publish a baseline before pull-request
comparisons can succeed.

CI uploads coverage reports and available PDF diagnostics as the `Coverage`
artifact, retained for seven days.

## Release compatibility

Run `pnpm test:semver` from a clean checkout to run the current public tests and
then the public tests from the latest `mondrian.pdf@` release tag against the
current implementation.
The Break Check CI job runs this command alongside Vitest and Coverage. The
command discovers workspace packages with a `test:semver` script automatically.
Checks need access to the Git remote named `origin` and explicitly disable
task caching because remote release tags can change independently of the
checkout.

The compatibility contract lives in `packages/mondrian/tests/public/`; run it
directly with `pnpm --filter mondrian.pdf test:once:public`. Break Check restores
released tests and helpers, type-checks and runs them, then restores the checkout.
Implementation and visual regression tests live in `tests/private/`. See the
[test guide](packages/mondrian/tests/README.md) for the boundary and the release
baseline requirement. Release 0.1.0 predates the public suite, so Break Check
will fail until a release contains it. While
`mondrian.pdf` is pre-1.0, intentional breaking changes require a minor or major
changeset for `mondrian.pdf` to certify them.

## License

Mondrian is licensed under the [Mozilla Public License 2.0](LICENSE). The MPL
is permissive about use and integration: you may use Mondrian for any purpose,
including in commercial or proprietary software, and combine it with code
under other licenses. New files may remain under terms of your choice.

If you distribute modifications to Mondrian's MPL-covered files, you must make
the source for those files available under MPL 2.0. Private and internal
modifications do not need to be published. This is file-level sharing, not
whole-program copyleft. See [Mozilla's official MPL 2.0 FAQ](https://www.mozilla.org/MPL/2.0/FAQ/) for details.
