/** Original minimal ICC v2 CMYK input LUT, mapping subtractive RGB to D50 XYZ. */
export function syntheticCmykProfile() {
	const xyz = (values: readonly number[]) => {
		const b = Buffer.alloc(20)
		b.write("XYZ ")
		values.forEach((v, i) => b.writeInt32BE(Math.round(v * 65536), 8 + i * 4))
		return b
	}
	const lut = Buffer.alloc(176)
	lut.write("mft2")
	lut[8] = 4
	lut[9] = 3
	lut[10] = 2
	for (let i = 0; i < 3; i++) lut.writeInt32BE(65536, 12 + (i * 3 + i) * 4)
	lut.writeUInt16BE(2, 48)
	lut.writeUInt16BE(2, 50)
	for (let i = 0; i < 4; i++) lut.writeUInt16BE(65535, 54 + i * 4)
	for (let n = 0; n < 16; n++) {
		const c = (n >> 3) & 1,
			m = (n >> 2) & 1,
			y = (n >> 1) & 1,
			k = n & 1
		const r = (1 - c) * (1 - k),
			g = (1 - m) * (1 - k),
			b = (1 - y) * (1 - k)
		const values = [
			0.4361 * r + 0.3851 * g + 0.1431 * b,
			0.2225 * r + 0.7169 * g + 0.0606 * b,
			0.0139 * r + 0.0971 * g + 0.7141 * b,
		]
		values.forEach((v, i) =>
			lut.writeUInt16BE(Math.round(v * 32768), 68 + n * 6 + i * 2),
		)
	}
	for (let i = 0; i < 3; i++) lut.writeUInt16BE(65535, 166 + i * 4)
	const description = Buffer.alloc(128)
	description.write("desc")
	description.writeUInt32BE(19, 8)
	description.write("Synthetic CMYK LUT\0", 12)
	const tags: [string, Buffer][] = [
		["desc", description],
		["wtpt", xyz([0.9642, 1, 0.8249])],
		["A2B0", lut],
	]
	let offset = 132 + tags.length * 12
	const header = Buffer.alloc(offset)
	header.writeUInt32BE(0x02100000, 8)
	header.write("prtr", 12)
	header.write("CMYK", 16)
	header.write("XYZ ", 20)
	header.write("acsp", 36)
	for (const [i, v] of [2026, 10, 6, 0, 0, 0].entries())
		header.writeUInt16BE(v, 24 + i * 2)
	xyz([0.9642, 1, 0.8249]).copy(header, 68, 8)
	header.writeUInt32BE(tags.length, 128)
	const chunks: Buffer[] = [header]
	for (const [i, [tag, bytes]] of tags.entries()) {
		header.write(tag, 132 + i * 12)
		header.writeUInt32BE(offset, 136 + i * 12)
		header.writeUInt32BE(bytes.length, 140 + i * 12)
		chunks.push(bytes)
		offset += bytes.length
	}
	header.writeUInt32BE(offset, 0)
	return Uint8Array.from(Buffer.concat(chunks))
}
