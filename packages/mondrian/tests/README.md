# Test contracts

`public/` defines behavior consumers can depend on across releases. Break Check
restores this entire directory from the latest release, including fixtures,
the independent PDFium reader, and TypeScript configuration. The public command
type-checks those tests before running them. Add assertions here only when a
failure means an existing consumer capability has broken.

The initial contracts cover page order, geometry, rotation, text and metadata
preservation; explicit PDF versions; deterministic output; interoperability
between the builders, validator, and serializer; reserved references; and
rejection of invalid page ownership and reuse. They exercise the exported source
entry point, not the installed package's export map. Package installation and
declaration packaging are not covered by this suite.

`private/` contains implementation tests, source-entrypoint smoke tests, and
visual regressions. These can evolve without certifying a breaking change. The
visual proof of the public document fixture lives here so renderer versions and
exact pixel baselines do not become API compatibility promises.

Run `pnpm --filter mondrian.pdf test:once:public` for the public suite. Normal
test and coverage commands run both directories. Run `pnpm test:semver` from a
clean checkout for current public tests followed by release compatibility.

Release `mondrian.pdf@0.1.0` predates this directory. For that release only,
missing public tests produce an explicit bootstrap notice after the current
suite passes. Later releases without a public suite fail, as do other
inconclusive checks. Once the next release contains this directory, its tests
become the compatibility baseline automatically. Remove the bootstrap exception
after that release.
