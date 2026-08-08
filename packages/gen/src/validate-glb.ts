// Minimal GLB structural validator + triangle-count reporter.
// No external glTF library — just reads the 12-byte GLB header and the JSON
// chunk (glTF accessor "count" fields are cheap and sufficient; we never need
// to decode the actual vertex/index buffers).
//
// Usage: node src/validate-glb.ts <path-to.glb> [more paths...]

import { readFileSync, statSync } from "node:fs";

const GLB_MAGIC = 0x46546c67; // "glTF" little-endian

interface GltfAccessor {
  count: number;
  type: string;
}

interface GltfPrimitive {
  indices?: number;
  mode?: number; // default 4 = TRIANGLES
}

interface GltfMesh {
  primitives: GltfPrimitive[];
}

interface GltfJson {
  asset?: { version?: string };
  scenes?: unknown[];
  nodes?: unknown[];
  meshes?: GltfMesh[];
  accessors?: GltfAccessor[];
}

function validateGlb(path: string): void {
  const size = statSync(path).size;
  const buf = readFileSync(path);

  if (buf.length < 12) {
    console.log(`${path}: FAIL — file smaller than GLB header (12 bytes), size=${size}`);
    return;
  }

  const magic = buf.readUInt32LE(0);
  const version = buf.readUInt32LE(4);
  const totalLength = buf.readUInt32LE(8);

  if (magic !== GLB_MAGIC) {
    console.log(`${path}: FAIL — bad magic 0x${magic.toString(16)} (expected 0x${GLB_MAGIC.toString(16)})`);
    return;
  }
  if (totalLength !== buf.length) {
    console.log(`${path}: WARN — header length ${totalLength} != file size ${buf.length}`);
  }

  // First chunk must be JSON (chunk type 0x4E4F534A = "JSON")
  const chunk0Length = buf.readUInt32LE(12);
  const chunk0Type = buf.readUInt32LE(16);
  if (chunk0Type !== 0x4e4f534a) {
    console.log(`${path}: FAIL — first chunk is not JSON (type=0x${chunk0Type.toString(16)})`);
    return;
  }
  const jsonBytes = buf.subarray(20, 20 + chunk0Length);
  const json: GltfJson = JSON.parse(jsonBytes.toString("utf8"));

  const accessors = json.accessors ?? [];
  const meshes = json.meshes ?? [];
  let triangleCount = 0;
  let primitiveCount = 0;
  for (const mesh of meshes) {
    for (const prim of mesh.primitives) {
      primitiveCount++;
      const mode = prim.mode ?? 4;
      if (mode !== 4) continue; // only TRIANGLES is counted
      if (prim.indices !== undefined) {
        const acc = accessors[prim.indices];
        if (acc) triangleCount += Math.floor(acc.count / 3);
      }
    }
  }

  console.log(
    `${path}: OK  size=${(size / 1024).toFixed(0)}KiB  glTF=${json.asset?.version ?? "?"}  ` +
      `nodes=${json.nodes?.length ?? 0}  meshes=${meshes.length}  primitives=${primitiveCount}  ` +
      `triangles≈${triangleCount}`
  );
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("Usage: node src/validate-glb.ts <path-to.glb> [more paths...]");
  process.exit(1);
}
for (const p of paths) validateGlb(p);
