# Original save-structure and scale fixtures

Everything in this directory is original fixture material under the repository's MPL-2.0 license. No external document, font, artwork, signature, or payload is copied. Generation-time tools process original inputs; their program licenses do not introduce third-party assets into the output. Tests run from deterministic committed fixtures or deterministic in-process generators, without external executables or network access. All assertions are private regressions, not semver commitments.

## Valid linearization

`linearized-garden.pdf` is a four-page original booklet with shared standard-font and original JPEG resources. `booklet.ts` authors it with `PdfDocumentBuilder`; `generate-linearized.ts` processes those bytes using **qpdf 12.3.2**, `--linearize --deterministic-id`. The JPEG comes from this repository's original-corpus generator, not an external asset. The resulting PDF is 4,391 bytes.

`linearization-proof.json` records qpdf's successful independent syntax and **full linearization/hint-table checks**, its decoded hint tables, and SHA-256 hashes of both the authored source and linearized result. The runtime test binds the exact fixture to this proof, checks the actual linearization dictionary, then validates, serializes, strictly reparses, compares the complete graph, and checks deterministic second serialization. The retained linearization dictionary/hint stream produce two expected unreachable-object warnings; rewriting does not preserve a valid linearized layout.

The visual test independently compares all four authored, linearized, and rewritten pages using pinned PDFium: valid cross-references, geometry, rotation, extracted text, and exact pixels. Every rewritten page also has a reviewed committed PNG baseline. This closes valid-input linearization parity; it does not claim that serialization creates linearized output or that partial HTTP range-loading behavior is tested.

Regenerate deliberately from the repository root, with exactly qpdf 12.3.2 available:

```sh
QPDF=/path/to/qpdf node packages/mondrian/tests/fixtures/original-structure/generate-linearized.ts
```

The tool used for the initial proof was `/nix/store/371lq857w4zqspb5kmk6f7f615430cb4-qpdf-12.3.2-bin/bin/qpdf`. Review changed proof hashes, qpdf output, and all four page baselines after regeneration. CI never invokes qpdf.
