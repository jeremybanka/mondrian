# Mondrian

Workspace for typed PDF compilation targets.

- [`mondrian.pdf`](packages/mondrian) provides the low-level PDF object model,
  invariant-preserving builder, validator, and serializer.

The `fitter-happier` integration is maintained in the `fitter-happier`
repository and consumes the published `mondrian.pdf` package.

## Coverage

Run `MONDRIAN_PDF_ARTIFACT_MODE=verify pnpm cov` to run the test suite with
coverage. Reports are written to `packages/mondrian/coverage` in text, HTML,
and Istanbul JSON formats.

Run `pnpm cov:check` to compare statement coverage with the base revision.
Bun is installed through `mise.toml`. The local `coverage.sqlite` database is
ignored by Git.

The Coverage CI job runs on pull requests and pushes to `main`. Set the
`RECOVERAGE_CLOUD_TOKEN` GitHub Actions secret to enable persistent tracking
under the report name `mondrian`. Main-branch runs publish the baseline;
pull requests fail if statement coverage decreases.

CI uploads coverage reports and available PDF diagnostics as the `Coverage`
artifact, retained for seven days.

## License

Mondrian is licensed under the [Mozilla Public License 2.0](LICENSE). The MPL
is permissive about use and integration: you may use Mondrian for any purpose,
including in commercial or proprietary software, and combine it with code
under other licenses. New files may remain under terms of your choice.

If you distribute modifications to Mondrian's MPL-covered files, you must make
the source for those files available under MPL 2.0. Private and internal
modifications do not need to be published. This is file-level sharing, not
whole-program copyleft. See [Mozilla's official MPL 2.0 FAQ](https://www.mozilla.org/MPL/2.0/FAQ/) for details.

## Repository commands

See [the command guide](docs/commands.md) for formatting, static checks, tests, coverage where available, and release commands.
