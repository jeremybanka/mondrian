# Original image codec fixtures

These five visible, one-page PDFs close the original corpus's JPEG 2000/JPX, CCITT fax, JBIG2, and LZW image-stream coverage gaps. Their raster content is entirely original: `pixels.ts` draws an invented paper lantern and an arithmetic color study. The generators, pixel data, JP2 asset, and page proofs use this repository's MPL-2.0 license. No external image, photograph, font, or downloaded PDF is incorporated; no external asset license or attribution is needed.

| Fixture              | Executed encoding | Specific coverage                                                                                                   |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `lossless-jpx`       | `/JPXDecode`      | Lossless RGB JPEG 2000 in a JP2 container, reversible wavelets, three components                                    |
| `group4-fax`         | `/CCITTFaxDecode` | T.6 Group 4, horizontal-mode run codes, 64 columns/rows, explicit `K`, `Rows`, `Columns`, and `BlackIs1` parameters |
| `jbig2-lantern`      | `/JBIG2Decode`    | Embedded JBIG2 segments: page information, lossless immediate generic MMR region, and end of page                   |
| `lzw-early-change-0` | `/LZWDecode`      | Actual dictionary references, 9/10/11/12-bit codes, dictionary clears, explicit `EarlyChange 0`                     |
| `lzw-early-change-1` | `/LZWDecode`      | The same authored pixels with `EarlyChange 1` and its different code-width boundaries                               |

`encoders.ts` contains narrow deterministic fixture writers for Group 4, generic-region JBIG2, and LZW. The Group 4 run-length codewords are protocol constants from [ITU-T T.6, Table 2](https://www.itu.int/rec/dologin_pub.asp?id=T-REC-T.6-198811-I!!PDF-E&lang=e&type=items). The JBIG2 segment layout was checked against [Mozilla's independent decoder](https://github.com/mozilla/pdf.js/blob/v4.10.38/src/core/jbig2.js); no implementation or asset was copied from it. The codecs are fixture construction helpers, not published APIs or production encoders.

`color-study.jp2` is an original binary asset generated from `colorPixels()` by OpenJPEG 2.5.4. Its SHA-256 is `40bfc670eda7ecacbefd6e614d1003c6b756f03b668f3998a285874a310a62ff`. The offline generator rejects other OpenJPEG versions and sets lossless coding, four resolutions, no component transform, and a fixed original comment. It uses the native executable only when deliberately regenerating this asset; tests do not use native codecs, system images, fonts, or network access. Encoder options are described in [OpenJPEG's documentation](https://github.com/uclouvain/openjpeg/wiki/DocJ2KCodec). From this directory:

```sh
node generate-jp2.ts /path/to/OpenJPEG-2.5.4/bin/opj_compress
```

## Evidence and scope

The private structural tests require successful strict parse/validation, deterministic generation/serialization, byte-exact image data preservation, unchanged filter and decode-parameter dictionaries, and a content stream that actually paints the image. LZW checks also require dictionary codes, all four bit widths, and multiple clear codes. The pinned JP2 hash makes asset changes deliberate.

The private visual tests independently load both the source PDF and the parser's rewritten PDF in pinned PDFium. Each must exactly match an independently rendered **uncompressed image reference constructed from the original pixels**, including complete page pixel hashes, text, geometry, rotation, and valid cross-reference tables. This prevents a broken encoder and matching parser output from merely agreeing on a blank or damaged image. Each rewritten page also matches a reviewed committed 72 dpi baseline. Negative controls remove the image `Do` operator and separately bypass its filter while retaining its encoded bytes; both must change the rendered pixel hash, proving that the intended image and decoder execute.

These tests close the named filter-family gaps. They do not claim every variation of those codec standards: CCITT uses Group 4 horizontal coding; JBIG2 uses a generic MMR region rather than symbol dictionaries, arithmetic coding, refinement, or shared globals; JPEG 2000 uses lossless RGB rather than every lossy, alpha, or color-space variation. These are private parser regression fixtures, and their exact bytes, numbering, graphs, and proof baselines add no public semver commitments.

From `packages/mondrian`:

```sh
MONDRIAN_PDF_ARTIFACT_MODE=verify pnpm exec vp test run tests/private/original-codecs.test.ts tests/private/visual-regressions/original-codecs.test.ts
```

For intentional visual changes, run in update mode, inspect all five changed page images, then rerun in verify mode. Commit the source and reviewed artifacts together.
