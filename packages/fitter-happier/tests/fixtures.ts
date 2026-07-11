const rgbJpegHex = [
	"ffd8ffe000104a46494600010100000100010000ffdb004300100b0c0e0c0a100e0d0e12",
	"11101318281a181616183123251d283a333d3c3933383740485c4e404457453738506d51",
	"575f626768673e4d71797064785c656763ffdb0043011112121815182f1a1a2f63423842",
	"636363636363636363636363636363636363636363636363636363636363636363636363",
	"6363636363636363636363636363ffc00011080003000203012200021101031101ffc400",
	"1500010100000000000000000000000000000005ffc40014100100000000000000000000",
	"000000000000ffc4001501010100000000000000000000000000000506ffc40014110100",
	"000000000000000000000000000000ffda000c03010002110311003f008a00b5e3ffd9",
].join("")

export function rgbJpegDataUrl(): string {
	const bytes = new Uint8Array(rgbJpegHex.length / 2)
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(
			rgbJpegHex.slice(index * 2, index * 2 + 2),
			16,
		)
	}
	return `data:image/jpeg;base64,${encodeBase64(bytes)}`
}

function encodeBase64(bytes: Uint8Array): string {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	let result = ""
	for (let offset = 0; offset < bytes.length; offset += 3) {
		const first = bytes[offset] ?? 0
		const second = bytes[offset + 1] ?? 0
		const third = bytes[offset + 2] ?? 0
		const bits = (first << 16) | (second << 8) | third
		result += alphabet[(bits >>> 18) & 0x3f]
		result += alphabet[(bits >>> 12) & 0x3f]
		result += offset + 1 < bytes.length ? alphabet[(bits >>> 6) & 0x3f] : "="
		result += offset + 2 < bytes.length ? alphabet[bits & 0x3f] : "="
	}
	return result
}
