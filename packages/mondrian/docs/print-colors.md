# Process and named spot colors

## Contract

The conformance production has two US Letter pages (612 × 792 points), no
rotation, a fixed title, standard Helvetica fonts, and no images or ambient
metadata. Page 1 contains gray/RGB and individual cyan, magenta, yellow, and
K-only black samples; two named inks each at 0/25/50/75/100% tint; fills,
strokes, and live text. Page 2 contains opaque process/spot overlaps with
explicit fill/stroke overprint and knockout, both overprint modes, and state
scoping. Structural tests inspect channel values, Separation resources, tint
functions, paint operators, and graphics-state dictionaries independently of
the composite visual proof.

The object-builder example preserves custom curves, positioned text, and
cached content fragments. It binds all fragments sharing a page resource
scope together. Rebuilding a graph reuses descriptions and derives new
references. Changing an ink definition requires replacing the cached fragment;
combining old and changed definitions of the same named ink fails.

## Color descriptions and units

`rgb(r, g, b)`, `gray(g)`, and `cmyk(c, m, y, k)` return immutable typed
process colors. All components are finite numbers from 0 through 1. Convert
percentages or 8-bit application channels at the application boundary.
Mondrian neither clamps components nor converts between spaces. K-only black
is `cmyk(0, 0, 0, 1)` and remains exactly those four native channels.

`fillColor(color)` and `strokeColor(color)` describe content operations for
the object workflow. Semantic graphics and text builders accept the same
colors through `.fillColor(color)` and `.strokeColor(color)`, with
`.rgbFill/Stroke`, `.grayFill/Stroke`, `.cmykFill/Stroke`, and
`.spotFill/Stroke` conveniences. Existing graphics RGB methods retain their
operators and rendered output. Text `.renderingMode(1)` strokes glyphs;
`.renderingMode(2)` fills and strokes them without outlining text. Mode 3 is
invisible text. Clipping modes 4–7 are rejected: a semantic text fragment cannot
share a clipping scope with subsequent artwork. Use the object-layer workflow
when explicitly authoring that scope.

## Named inks

```ts
import { cmyk, separation, spot } from "mondrian.pdf"

const orange = separation("Brand Orange", {
	type: "exponential",
	zero: cmyk(0, 0, 0, 0),
	full: cmyk(0, 0.66, 1, 0),
	exponent: 1,
})
const halfOrange = spot(orange, 0.5)
```

The reusable ink and each paint's tint are distinct. The supported tint
transform is PDF FunctionType 2: one input in `[0, 1]`, endpoints in the same
gray/RGB/CMYK alternate space, and a finite positive exponent. The API derives
the input domain and output range/arity. It encodes the endpoint interpolation
without sampling or converting it. Other function kinds, foreign function
handles, and arbitrary function dictionaries are not accepted by this API.

Names are exact, case-sensitive printable ASCII strings. No trimming, case
folding, palette lookup, or ink aliasing occurs. PDF delimiters, spaces, and
`#` are escaped by the existing PDF name encoder. Non-ASCII names and special
plate names `All`, `None`, `Cyan`, `Magenta`, `Yellow`, and `Black` are rejected
by this initial named-ink API. Applications own canonical swatch identities.

Repeated identical ink descriptions share one document resource. The same
name with any different alternate definition or exponent is an error, even
across pages or separate object-builder binding calls. Unused application
swatches do not register resources. Registration order follows first use;
fixed descriptions, ordering, metadata, and IDs produce deterministic bytes.

## Resource lifecycle and cached streams

See [the executable examples](../examples/print-colors.ts). The semantic
builder binds resources during compilation. Its existing font/image/content
handles remain document-owned.

For the object workflow, cache `colorContent([...])` fragments containing
shared typed paint operations interleaved with your existing ASCII path,
positioned-glyph, or image commands. Call `bindColorContent(objects, fragments)`
for **all fragments that share a page or Form resource dictionary**. It
returns a content stream and its ColorSpace/ExtGState resource dictionaries.
Install both, and add your existing Font/XObject dictionaries alongside them.
Do not merge independently bound color scopes: their local names may collide.

Cache the unbound fragment, not the binding's document-owned resources. Bind
again in every new graph. Changing a swatch requires a new fragment; include
the entire ink definition and tint in the application's cache invalidation
key. Old fragments intentionally retain their old immutable intent. Foreign
or unresolved references fail normal object-builder validation. For bound page
streams, building also checks that their derived resource entries are installed
in the direct or inherited page scope; missing or replaced entries fail. A bound
spot/state stream cannot be moved into another builder even if local resource
names happen to match. Rebind the cached fragment instead.

Raw strings retain the existing object-layer escape-hatch contract. Callers
own their syntax, balanced `q/Q` and `BT/ET`, and font/image resource names.
They must not inject manual color resources or transparency settings into the
typed painting scope. Mondrian does not parse or certify arbitrary raw PDF
content strings. Generated fragments are wrapped in `q/Q`; graphics fragments
are already scoped, and every semantic text fragment scopes paint and rendering mode consistently.
Text layout parameters (font, spacing, scaling, leading, and rise) retain their
legacy persistence across text fragments, regardless of whether paint is set. Bindings are intended for ordinary page/Form content, not
for insertion inside an open text object.

## Overprint and transparency

`paintState({ fillOverprint, strokeOverprint, overprintMode })` specifies both
paint channels independently. `false` requests knockout, `true` requests
overprint; mode is explicitly `0` or `1`. The API never infers these settings
from an ink name. For DeviceCMYK with overprint enabled, mode 1 preserves
underlying process colorants for zero-valued source components; mode 0 paints
those zero values. Separation painting addresses its named colorant, subject
to the device's separation and overprint behavior.

A paint state emits `op`, `OP`, and `OPM` together, and explicitly restores
opaque Normal blending (`ca = CA = 1`, `BM = Normal`, `SMask = None`). Optional
`fillOpacity`/`strokeOpacity` may only be `1`; `blendMode` may only be `Normal`.
Other values or settings fail clearly. Tint changes ink coverage, not opacity.
Nonopaque painting, soft masks, blend modes, and transparency groups are not
supported combinations in this typed API. Custom low-level PDF descriptions
remain the caller's responsibility.

Process colors work with all supported PDF versions. Exponential Separation
resources require PDF 1.3 or later; explicit opaque paint states require PDF
1.4 or later. Both builder workflows reject earlier output versions when
these resources have been authored.

The encoding follows the [Adobe PDF Reference 1.6](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.6.pdf),
sections 3.9.2 (exponential functions), 4.3.4 (graphics state parameters),
4.5.5 (Separation spaces), and 4.5.6 (overprint control).

## Integration evidence and limits

The create-design example follows the verified
[fill/stroke boundary](https://github.com/jeremybanka/create-font/blob/7812144a54f73bc81f29ea99984382e075fa24cc/packages/create-design/pdf/src/pdf.ts#L83)
and [projection cache](https://github.com/jeremybanka/create-font/blob/7812144a54f73bc81f29ea99984382e075fa24cc/packages/create-design/pdf/src/pdf.ts#L416).
Its unit conversion stays in the adapter; native color operator formatting
and fill-to-stroke string replacement are replaced by shared operations.
Executable tests demonstrate fresh graph binding and ink-change invalidation.
This is an integration demonstration, not a claim of a merged downstream
migration. create-design's existing text outlining is its own renderer choice.

The Pack OS example demonstrates the issue's stated process/spot and overlap
requirements. Its repository returned HTTP 404 to the available GitHub
credentials during implementation, so its exact renderer boundary and actual
downstream adoption could not be verified. Before closing issue #106, record
actual downstream adoption evidence for both applications.

Reviewed PDFium composite images prove appearance in the pinned renderer.
Structural tests prove native process values and Separation encoding; neither
proves a printer's plates, color accuracy, PDF/X compliance, or prepress
approval. ICC spaces/output intents, DeviceN, application swatch policy,
Pantone authority, conversions, photographic CMYK images, trapping, and
special finishes remain outside this API.
