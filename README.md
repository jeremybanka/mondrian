# Mondrian

Workspace for typed PDF compilation targets.

- [`mondrian.pdf`](packages/mondrian) provides the low-level PDF object model,
  invariant-preserving builder, validator, and serializer.
- [`mondrian.fitter-happier`](packages/fitter-happier) is the isolated bridge
  that lowers a `fitter-happier` `LayoutNode` tree into a validated, one-page
  `mondrian.pdf` `PdfDocument`. Serialization remains a consumer concern.
