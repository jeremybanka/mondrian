# Tagged RGB handoff and explicit print preparation

Color-managed RGB photographs can coexist with native CMYK paint and named spot inks. The photograph's source ICC profile describes its pixels; the document's CMYK OutputIntent describes a destination printing condition. These profiles need not match. Merely attaching an OutputIntent neither converts RGB samples nor makes a PDF/X file.

## Authoring a tagged RGB handoff

`PdfDocumentBuilder.rgbImage()` accepts eight-bit interleaved RGB samples, RGB source ICC profile bytes, and optional straight alpha. Mondrian creates the ICCBased image space, profile stream, grayscale soft mask, and scoped image resources. `prepareRgbImage()` in `mondrian.pdf/print` decodes PNG/JPEG bytes without converting color or premultiplying alpha. It uses a recognized embedded RGB profile or the caller's explicit override. If the file only declares sRGB or is untagged, supply verified RGB profile bytes; the string `"srgb"` remains available for conversion through `prepareCmykImage()`.

```ts
import { createPdfDocument, rectangle, rgb, separation } from "mondrian.pdf"
import { prepareRgbImage } from "mondrian.pdf/print"

const pdf = createPdfDocument({
	blendingSpace: { rgbProfile: sourceRgbProfile },
	// Optional, independent of the source RGB profile:
	outputIntent: { profile: pressCmykProfile, identifier: printingCondition },
})
const photograph = pdf.rgbImage(
	prepareRgbImage(pngBytes, {
		sourceProfile: sourceRgbProfile,
		renderingIntent: "perceptual",
	}),
)
const ink = separation("Forest Green", {
	type: "exponential",
	zero: rgb(1, 1, 1),
	full: rgb(0.2, 0.55, 0.32),
	sourceProfile: sourceRgbProfile,
	exponent: 1,
})
pdf.setPages(
	pdf.page({
		mediaBox: rectangle(0, 0, 360, 260),
		content: [
			pdf.graphics((g) => {
				g.spotFill(ink, 0.8).rectangle(18, 22, 150, 196).fill()
				g.drawImage(photograph, 80, 18, 200, 218)
			}),
		],
	}),
)
```

Transparent RGB authoring requires an explicit `blendingSpace`, either `{ rgbProfile }` or `"DeviceCMYK"`. A CMYK OutputIntent defaults the builder's blending space to DeviceCMYK; an explicit RGB blending space takes precedence. Profile-qualified spot alternates use ICCBased RGB while their name and numeric tint continue to define the actual spot plate. [The complete example](../examples/mixed-color-images.ts) adds live K-only text and a second ink.

## Application-managed CMYK preparation

```ts
import { parsePdf, serializePdf } from "mondrian.pdf"
import { preparePdfForPrint } from "mondrian.pdf/print"
import { renderPdfPlateCoverage } from "mondrian.pdf/testing"

const prepared = await preparePdfForPrint(parsePdf(inputBytes), {
	destinationProfile: pressCmykProfile,
	outputCondition: printingCondition,
	renderingIntent: "relative-colorimetric",
	objectIntents: "honor", // Or deliberately "override".
	blackPointCompensation: true,
	untaggedRgb: "reject", // Or "srgb" or explicit RGB ICC bytes.
	gray: "black-only", // Or "reject" or { sourceProfile: grayIccBytes }.
	spots: "preserve",
	processNumbers: "preserve",
	blending: "destination",
})
const deliveredBytes = serializePdf(prepared.document)
const coverage = await renderPdfPlateCoverage(prepared.document, {
	resolution: 144,
})
```

The application selects the printing condition, source assumptions, rendering intent, black-point compensation, gray interpretation, spot preservation, process-number policy, and blending policy. Embedded ICCBased sources are honored. `objectIntents: "honor"` tracks image Intent, `ri`, and ExtGState RI through `q`/`Q` and Form invocation. `"override"` replaces those intent choices deliberately. `gray: "black-only"` maps gray `g` to `[0, 0, 0, 1-g]`, including implicit default black. A supplied grayscale profile instead uses ICC conversion; `"reject"` rejects gray that needs interpretation.

Vector and text paint retain their source space and component values in graphics state. Conversion uses the intent active at each fill/stroke painting operation, so setting `ri` or ExtGState RI before or after assigning a color produces the same ink amounts when the painting states agree. Changing intent between paintings of a reused color is honored; `q`/`Q` restore both source paint and intent, and Forms inherit that source state. Fill and stroke resolve independently. An image's explicit Intent continues to take precedence when object intents are honored.

`processNumbers: "preserve"` retains native vector CMYK numbers at their original precision and keeps established CMYK image samples. An ICCBased CMYK source or a declared CMYK OutputIntent must agree with the selected destination. To retarget other process colors, use `{ sourceProfile: priorCmykProfile, blackOnly: "preserve" }`; embedded per-object profiles still take precedence. K-only paint and image pixels retain their exact K value and zero C/M/Y. This avoids silently turning black-only text into four-color black.

The prepared document contains destination CMYK image samples and process paint, plus the original named Separation resources. Live text, font programs, vector paths, geometry, glyph positioning, transforms, clipping, image dimensions, and source alpha samples remain. Preparation replaces image codecs with lossless Flate samples, preserves independently decoded masks, and removes obsolete source objects. Extraction never performs the conversion again. The report records the destination profile SHA-256, output condition, resolved object intents, black-point-compensation policy, group source associations, and each conversion/preservation action with page/object/resource context.

## Blending semantics

`blending: "destination"` explicitly requests ICC conversion of individual source samples/paint before Normal blending of the resulting ink amounts. Image alpha and constant opacity then interpolate those defined destination amounts against the existing plate backdrop; spot tint remains independent of its display alternate. Knockout and overprint retain the existing plate semantics, including image zero-valued process components. Both isolated and non-isolated page groups are treated as the page's outer group. Form transparency groups remain unsupported.

This policy intentionally retargets an RGB page blending space. ICC conversion is generally nonlinear, so converting each object and then blending CMYK can differ from blending RGB first and then converting the composite. Source RGB composite appearance is not promised to remain identical; profile gamut mapping can also change it. `blending: "preserve-source"` rejects RGB page groups with an actionable diagnostic, instead of silently changing the requested source blending order. It accepts established destination CMYK groups. Metadata alone cannot establish this conversion or compositing contract.

For a CMYK page group, an embedded ICCBased group profile defines the blending association. DeviceCMYK groups use the caller's explicit `processNumbers.sourceProfile` when retargeting; under `processNumbers: "preserve"`, they use the declared CMYK OutputIntent, or destination amounts when no CMYK OutputIntent exists. The report records the effective profile association. A group associated with a different profile requires explicit process retargeting and `blending: "destination"`; source preservation rejects it even if the page contains no process paint.

Preserving RGB source compositing before destination conversion remains unfinished capability tracked separately in [#192](https://github.com/jeremybanka/mondrian/issues/192). Its acceptance must use an independent reference for that blending order and distinguish gamut mapping from a change of compositing order. Unsupported source-preserving preparation continues to reject explicitly.

The regression contract compares destination blending against independently authored vector paint using the converted component amounts, with at most one coverage byte of difference for combined image-mask/constant-opacity rounding. Exact dimensions and alpha are checked without tolerance. The representative 809 × 884 RGB JPEG fixture retains two spot plates and embedded text; reviewed RGB/destination composites and six numeric plate proofs accompany the tests. The [PDF transparency specification errata](https://pdf-issues.pdfa.org/32000-2-2020/clause11.html) documents allowed group color spaces and default-space interactions.

## Pure extraction

`previewPdfPlates()` and `renderPdfPlateCoverage()` accept native DeviceCMYK and ICCBased CMYK paint/images with established four-channel interpretation, without requiring an OutputIntent. ICC profile N, signature, component ranges, and alternate space must agree. DefaultGray/DefaultRGB/DefaultCMYK replacements are rejected. DeviceGray vector paint requires an explicit `{ gray: "black-only" }` extraction policy. ICCBased gray still requires preparation.

Image extraction supports unfiltered/Flate eight-bit samples, default DecodeParms, TIFF predictor 2, PNG predictors 10–15, and single-scan interleaved baseline JPEG/DCT. JPEG component transforms follow APP14 metadata before ColorTransform, then PDF Decode ranges are applied to channel samples; samples never pass through display RGB to obtain CMYK amounts. Normalized Decode endpoints in `[0,1]` can scale or invert individual channels. See [PDF 1.7, Table 3.11](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.7old.pdf) for marker precedence.

Preparation and plate extraction accept and preserve explicit `AIS: false` in graphics-state dictionaries: alpha constants have ordinary opacity semantics. This includes Normal blending, fill/stroke alpha constants, overprint flags/mode, and `SMask: None`. `AIS: true` (alpha-as-shape) and malformed non-boolean values remain unsupported. The [public synthetic opacity fixture](../tests/public/fixtures/mixed-color/opacity.ts) covers these settings without private artwork or metadata.

## Limits and remaining unsupported constructs

Images are limited to 32 million pixels, profile streams to 16 MiB, content/Form streams to 16 MiB each, and JPEG input/component allocations to 256 MiB. Decompression is bounded by declared geometry, including predictor row bytes. Preparation additionally limits aggregate decoded image/mask bytes to 512 MiB by default; `maxDecodedImageBytes` can explicitly select a smaller budget or increase it to at most 1 GiB. Inputs are copied before asynchronous conversion and color-engine profiles/transforms are released in `finally` blocks.

Equivalent Form invocations reuse a prepared Form within the same page-resource context. The cache distinguishes source fill/stroke spaces and components, implicit paint, rendering intent, and text rendering mode; transforms, clipping, opacity, fonts, and overprint remain inherited PDF state. Preparation limits unique Form contexts with `maxFormContexts` (4096 by default, at most 65536) and aggregate decoded/generated Form program bytes with `maxFormBytes` (64 MiB by default, at most 1 GiB). These budgets apply independently of image decoding and reject excessive work with page/Form context.

Progressive, arithmetic, and multi-scan JPEG; image matte/color-key/stencil semantics; non-default ICC component ranges; default color-space replacement; Form transparency groups; arbitrary blend modes; general DeviceN, patterns, shading, annotations, trapping, screening, and press certification remain unsupported. Preparation validates the entire resulting plate program before returning anything and fails with page/object/resource context when faithful supported semantics are unavailable. No Ghostscript process is required. The application owns final artwork approval and print acceptance.
