// SPDX-License-Identifier: MPL-2.0
import { WirePdf } from "../original-corpus/wire.ts"

export const signatureCapacity = 2048
export const byteRangePlaceholder = "[0 0000000000 0000000000 0000000000]"
export function unsignedReceipt(): string {
	return new WirePdf("1.7")
		.add(1, "<< /Type /Catalog /Pages 2 0 R /AcroForm 6 0 R >>")
		.add(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
		.add(
			3,
			"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R /Annots [8 0 R] >>",
		)
		.stream(
			4,
			"",
			"BT /F1 20 Tf 24 195 Td (Receipt for a paper moon) Tj ET\nBT /F1 12 Tf 24 163 Td (Parcel MOON-031 / seven imaginary tokens) Tj ET\nBT /F1 11 Tf 24 140 Td (Signed only by an original test certificate.) Tj ET\nq 0.15 0.55 0.65 rg 24 45 372 65 re f Q\nBT /F1 15 Tf 1 1 1 rg 39 72 Td (A real signature on invented content) Tj ET\n",
		)
		.add(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
		.add(6, "<< /Fields [8 0 R] /SigFlags 3 >>")
		.add(
			7,
			`<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /M (D:20260901120000Z) /Name (Original fixture signer) /Reason (Test-only proof of signed-byte preservation) /ByteRange ${byteRangePlaceholder} /Contents <${"0".repeat(signatureCapacity * 2)}> >>`,
		)
		.add(
			8,
			"<< /Type /Annot /Subtype /Widget /FT /Sig /T (OriginalSignature) /V 7 0 R /P 3 0 R /Rect [0 0 0 0] /F 132 >>",
		)
		.write()
}
