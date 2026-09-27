# Original 3D payload

`moss-tetrahedron.prc` is an original, asymmetric tetrahedron with vertices `(0,0,0)`, `(2,0,0)`, `(0,3,0)`, and `(0.4,0.6,4)`, four triangular faces, and an original green material. The geometry, material, PDF wrapper, annotation appearance, and generator use the repository's MPL-2.0 license. No external model, artwork, texture, or other asset is included.

The 537-byte PRC was generated with the standalone PRC writer from [Asymptote](https://github.com/vectorgraphics/asymptote/tree/e2a77cadae8c479f4b753a6a86571b0882971cf8/prc), pinned to revision `e2a77cadae8c479f4b753a6a86571b0882971cf8`. This LGPL-3.0-or-later tool is used only for generation and is not vendored or required in CI. The generated mesh contains original data, not the tool's example models. The UUID clock is fixed. Its SHA-256 is `2d94c5efad647591b46ea73f3c4070401b0f3b3f04b37593b698ac3fb7258209`.

## Independent evidence

The generator compiles both the writer and the separate `PRCTools` reader. After generating the PRC twice and confirming identical bytes, it decodes the file with the reader and checks all 12 vertex coordinates, all 12 triangle indices, the face count, named part, and model section. This establishes a real mesh, rather than a placeholder with a PRC header. The runtime test binds the committed file to those verified bytes, parses and rewrites a PDF containing it, and independently extracts the payload through pdf-lib to check its hash and annotation/view relationships.

PDFium proves the page text, geometry, and static annotation appearance before and after the roundtrip; the reviewed PNG is committed. PDFium does not render the interactive PRC mesh, so that page proof does not establish interactive 3D behavior. The payload check is required separately. The fixture replaces the exploratory `three-dimensional` sample's PRC-payload preservation characteristic; U3D and complex CAD assemblies are not claimed.

## Regeneration

Clone the pinned Asymptote revision locally, install a C++17 compiler and zlib development files, and run `node packages/mondrian/tests/fixtures/original-corpus/generate-prc.ts /path/to/asymptote`. Optional second and third arguments supply zlib include and library directories. `PRC_CXX` can select the compiler. Generation was verified with GCC 15.3.0 and zlib 1.3.2. This generation command uses no network; tests only read the committed asset. Review any asset/hash changes and update and review the associated PNG before committing.
