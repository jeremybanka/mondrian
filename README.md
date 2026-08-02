# Mondrian

Workspace for typed PDF compilation targets.

- [`mondrian.pdf`](packages/mondrian) provides the low-level PDF object model,
  invariant-preserving builder, validator, and serializer.
- [`mondrian.fitter-happier`](packages/fitter-happier) is the isolated bridge
  that lowers a `fitter-happier` `LayoutNode` tree into a validated, one-page
  `mondrian.pdf` `PdfDocument`. Serialization remains a consumer concern.

## License

Mondrian is licensed under the [Mozilla Public License 2.0](LICENSE). The MPL
is permissive about use and integration: you may use Mondrian for any purpose,
including in commercial or proprietary software, and combine it with code
under other licenses. New files may remain under terms of your choice.

If you distribute modifications to Mondrian's MPL-covered files, you must make
the source for those files available under MPL 2.0. Private and internal
modifications do not need to be published. This is file-level sharing, not
whole-program copyleft. See [Mozilla's official MPL 2.0 FAQ](https://www.mozilla.org/MPL/2.0/FAQ/) for details.
