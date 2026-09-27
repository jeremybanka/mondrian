// SPDX-License-Identifier: MPL-2.0
// Generation only: node generate-prc.ts <pinned-asymptote-checkout> [zlib-include] [zlib-lib]
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const revision = "e2a77cadae8c479f4b753a6a86571b0882971cf8"
const [checkout, zlibInclude, zlibLibrary] = process.argv.slice(2)
if (!checkout) throw new Error("Supply an Asymptote checkout at " + revision)
const root = resolve(checkout)
assert.equal(
	execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim(),
	revision,
)
assert.equal(
	execFileSync("git", ["diff", "HEAD", "--", "prc"], {
		cwd: root,
		encoding: "utf8",
	}),
	"",
)
const temporary = mkdtempSync(join(tmpdir(), "mondrian-original-prc-"))
const compiler = process.env.PRC_CXX ?? "g++"
const includes = [
	"-I" + join(root, "prc/include"),
	"-I" + join(root, "prc/include/prc"),
	...(zlibInclude ? ["-I" + zlibInclude] : []),
]
const libraries = zlibLibrary
	? ["-L" + zlibLibrary, "-Wl,-rpath," + zlibLibrary]
	: []
const driver = `
#include "prc/oPRCFile.h"
#include <ctime>
// Pin the writer's UUID clock; all geometry and materials below are original.
extern "C" time_t __wrap_time(time_t *out) { const time_t t=1788220800; if(out) *out=t; return t; }
int main(int argc, char **argv) {
  if(argc!=2) return 2;
  prc::oPRCFile file(argv[1]);
  prc::PRCmaterial material;
  material.diffuse=prc::RGBAColour(0.15,0.65,0.45,1);
  material.ambient=prc::RGBAColour(0.05,0.1,0.05,1);
  material.specular=prc::RGBAColour(0.2,0.2,0.2,1);
  material.emissive=prc::RGBAColour(0,0,0,1);
  const double vertices[][3]={{0,0,0},{2,0,0},{0,3,0},{0.4,0.6,4}};
  const uint32_t triangles[][3]={{0,2,1},{0,1,3},{1,2,3},{2,0,3}};
  file.begingroup("Moss tetrahedron");
  file.addTriangles(4,vertices,4,triangles,material,0,(const double (*)[3])nullptr,nullptr,0,nullptr,nullptr,0,nullptr,nullptr,0,nullptr,nullptr,0);
  file.endgroup();
  return file.finish()?0:1;
}
`
try {
	const source = join(temporary, "original-model.cc")
	writeFileSync(source, driver)
	const writer = join(temporary, "write-prc")
	execFileSync(
		compiler,
		[
			"-O2",
			"-std=c++17",
			...includes,
			source,
			...["oPRCFile.cc", "PRCbitStream.cc", "PRCdouble.cc", "writePRC.cc"].map(
				(file) => join(root, "prc", file),
			),
			...libraries,
			"-Wl,--wrap=time",
			"-lz",
			"-o",
			writer,
		],
		{ stdio: "inherit" },
	)
	const reader = join(temporary, "describe-prc")
	execFileSync(
		compiler,
		[
			"-O2",
			"-std=c++17",
			...includes,
			...[
				"PRCTools/bitData.cc",
				"PRCTools/inflation.cc",
				"PRCdouble.cc",
				"PRCTools/iPRCFile.cc",
				"PRCTools/describePRC.cc",
				"PRCTools/describeMain.cc",
			].map((file) => join(root, "prc", file)),
			...libraries,
			"-lz",
			"-o",
			reader,
		],
		{ stdio: "inherit" },
	)
	const output = join(temporary, "moss-tetrahedron.prc")
	execFileSync(writer, [output])
	const first = readFileSync(output)
	execFileSync(writer, [output])
	assert.deepEqual(readFileSync(output), first)
	const description = execFileSync(reader, [output], { encoding: "utf8" })
	assert.match(description, /Name "Moss tetrahedron"/)
	assert.match(description, /number_of_tessellations 1/)
	const coordinates = /number_of_coordinates 12\s+([\d.\s]+)has_faces/.exec(
		description,
	)
	assert.ok(coordinates)
	assert.deepEqual(
		coordinates[1]!.trim().split(/\s+/).map(Number),
		[0, 0, 0, 2, 0, 0, 0, 3, 0, 0.4, 0.6, 4],
	)
	const indices =
		/number_of_triangulated_indices 12\s+([\d\s]+)number_of_face_tessellation/.exec(
			description,
		)
	assert.ok(indices)
	assert.deepEqual(
		indices[1]!.trim().split(/\s+/).map(Number),
		[0, 6, 3, 0, 3, 9, 3, 6, 9, 6, 0, 9],
	)
	assert.match(description, /size_of_sizes_triangulated 1\s+4/)
	assert.match(description, /--Model File--/)
	const sha256 = createHash("sha256").update(first).digest("hex")
	writeFileSync(new URL("./moss-tetrahedron.prc", import.meta.url), first)
	console.log(
		JSON.stringify(
			{ source: revision, bytes: first.length, sha256, vertices: 4, faces: 4 },
			null,
			2,
		),
	)
} finally {
	rmSync(temporary, { recursive: true, force: true })
}
