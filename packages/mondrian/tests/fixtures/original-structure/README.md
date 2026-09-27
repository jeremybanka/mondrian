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

## Real cryptographic signature

`signed-receipt.pdf` is an original one-page receipt with a genuine `adbe.pkcs7.detached` signature. `signing-source.ts` authors its unsigned PDF and reserved signature space. `generate-signed.ts` generates a fresh original RSA-2048 key in memory, creates its self-signed X.509 certificate and constructs the detached SHA-256 CMS signature in memory with Node cryptography over the PDF's actual `/ByteRange`. **OpenSSL 3.6.4** and Poppler then verify the public signed result independently. The complete document is covered except the signature's own hex-string token. The certificate's subject, serial, validity (2026–2126), signing time, visible contents and identifiers are fixed. Deliberate regeneration creates a new key, certificate, signature, PDF hash and proof; the committed public PDF/proof assets keep CI deterministic.

The original signing key has been discarded. No private key is stored or distributed. On regeneration, the ephemeral key remains a Node key object in memory; it is never exported, written to a file, passed to a subprocess, included in a command-line argument or logged. Only the public certificate and signature are retained. The certificate is self-signed and has no real-world identity, authority or trust relationship. This fixture establishes cryptographic integrity, not trusted authorship, certificate-chain validation, revocation, timestamps, or long-term signature validity.

`signature-proof.json` binds the unsigned-source hash, final PDF hash, signed-byte hash, certificate hash and actual byte ranges to independent successful **OpenSSL CMS verification** and **Poppler pdfsig 26.06.0 PDF-signature verification**. Poppler reports both “Total document signed” and “Signature is Valid.” Certificate trust checking and online OCSP are disabled for this intentionally self-signed test identity.

Before parsing, runtime tests independently read the narrow CMS structure and use Node's cryptographic verifier to check SHA-256/RSA against the embedded certificate and exact signed ranges. A single-byte change to visible content fails verification. Parsing and rewriting preserve the complete graph and CMS bytes, match the page's independent text/pixels, and serialize deterministically; the test also explicitly proves the rewritten PDF's old signature is no longer valid. This closes genuinely signed-input parity without claiming signed-byte preservation across a rewrite.

Regenerate deliberately with OpenSSL 3.6.4 and Poppler pdfsig 26.06.0:

```sh
OPENSSL=/path/to/openssl PDFSIG=/path/to/pdfsig node packages/mondrian/tests/fixtures/original-structure/generate-signed.ts
```

The initial Poppler verifier was `/nix/store/7wbqrbafwmwza2yj9mng0727bkz70jxb-poppler-utils-26.06.0/bin/pdfsig`. Neither external verifier nor any private signing key is used at runtime by the test suite; tests read only the committed PDF, proof metadata, source description and embedded certificate. The visible page has one reviewed PNG baseline.
