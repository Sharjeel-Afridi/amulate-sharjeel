/**
 * Normalise a Sketchfab car export into the shape `intro.js` expects.
 *
 * The intro scene makes four assumptions the raw download does not satisfy:
 * metres, nose down -Z, origin at the centre of the contact patch, and four
 * independently-rotatable wheel nodes. A Sketchfab GLB is authored to none of
 * them — it arrives at arbitrary scale, facing +Z, off-origin, and with all
 * four wheels merged into single meshes that cannot be spun without
 * cartwheeling the whole set around a shared centre.
 *
 * Rather than paper over that at runtime — 565k vertices is not something to
 * re-partition on the landing gate every session — this bakes the fix into the
 * asset once, offline.
 *
 * Run:
 *   npm i @gltf-transform/core @gltf-transform/functions \
 *         @gltf-transform/extensions draco3dgltf
 *   node scripts/prepare-car-model.mjs <in.glb> <out.glb>
 */

import { NodeIO } from '@gltf-transform/core'
import { KHRDracoMeshCompression } from '@gltf-transform/extensions'
import { dedup, prune, weld, resample } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'

/** Real BMW M4 Competition length, metres. Sets the scale for everything. */
const TARGET_LENGTH = 4.79

/**
 * Wheels live in the corners, so a triangle's centroid sign is enough to say
 * which one it belongs to. Runs after normalisation, so -Z is the nose.
 */
const quadrantOf = (x, z) => (z < 0 ? 'f' : 'r') + (x < 0 ? 'l' : 'r')

const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) {
  console.error('usage: node scripts/prepare-car-model.mjs <in.glb> <out.glb>')
  process.exit(1)
}

const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
})

const doc = await io.read(inPath)
const root = doc.getRoot()
const scene = root.getDefaultScene() ?? root.listScenes()[0]

// ---------------------------------------------------------------------------
// 1. Flatten. Bake every node's world matrix into its vertices so the model is
//    one flat list of meshes in a single coordinate space — the split and the
//    re-origin below both need world coordinates to reason about.
// ---------------------------------------------------------------------------

const mat4 = {
  identity: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(a, b) {
    const o = new Array(16)
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
        o[c * 4 + r] = s
      }
    return o
  },
  point: (m, p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ],
  /** Directions ignore translation — normals and tangents go through this. */
  dir: (m, p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
  ],
}

/** Every mesh in the scene, paired with the world matrix it renders under. */
const flat = []
;(function walk(node, parent) {
  const world = mat4.mul(parent, node.getMatrix())
  const mesh = node.getMesh()
  if (mesh) flat.push({ node, mesh, world })
  for (const child of node.listChildren()) walk(child, world)
})(
  { getMatrix: mat4.identity, getMesh: () => null, listChildren: () => scene.listChildren() },
  mat4.identity(),
)

console.log(`flattened ${flat.length} mesh nodes`)

// ---------------------------------------------------------------------------
// 2. Work out the normalisation matrix from the model's own bounds.
// ---------------------------------------------------------------------------

const bounds = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }
for (const { mesh, world } of flat) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    const [lo, hi] = [pos.getMin([]), pos.getMax([])]
    for (let c = 0; c < 8; c++) {
      const p = mat4.point(world, [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]])
      for (let k = 0; k < 3; k++) {
        bounds.lo[k] = Math.min(bounds.lo[k], p[k])
        bounds.hi[k] = Math.max(bounds.hi[k], p[k])
      }
    }
  }
}

const size = bounds.hi.map((h, k) => h - bounds.lo[k])
const scale = TARGET_LENGTH / size[2]
const centre = bounds.hi.map((h, k) => (h + bounds.lo[k]) / 2)

console.log(
  `source bounds ${size.map((s) => s.toFixed(2)).join(' x ')} -> scale ${scale.toFixed(4)}`,
)

/**
 * Scale to metres, spin 180° about Y so the nose faces -Z, and drop the origin
 * on the centre of the contact patch. The Y row keeps the wheels on the ground
 * instead of centring vertically.
 *
 * The 180° Y rotation is the pair of -1s: x -> -x, z -> -z.
 */
const NORMALISE = [
  -scale, 0, 0, 0,
  0, scale, 0, 0,
  0, 0, -scale, 0,
  centre[0] * scale, -bounds.lo[1] * scale, centre[2] * scale, 1,
]

// ---------------------------------------------------------------------------
// 3. Bake. Vertices move once, here; every attribute that carries a direction
//    has to move with them or the lighting goes inside out.
// ---------------------------------------------------------------------------

const baked = new Set()
for (const { mesh, world } of flat) {
  const m = mat4.mul(NORMALISE, world)
  for (const prim of mesh.listPrimitives()) {
    for (const [name, fn] of [
      ['POSITION', mat4.point],
      ['NORMAL', mat4.dir],
      ['TANGENT', mat4.dir],
    ]) {
      const attr = prim.getAttribute(name)
      // Accessors are shared between primitives; transforming one twice would
      // apply the matrix twice.
      if (!attr || baked.has(attr)) continue
      baked.add(attr)

      const arr = attr.getArray()
      const stride = attr.getElementSize()
      for (let i = 0; i < arr.length; i += stride) {
        const [x, y, z] = fn(m, [arr[i], arr[i + 1], arr[i + 2]])
        arr[i] = x
        arr[i + 1] = y
        arr[i + 2] = z
      }
      // Renormalise: the bake carries a uniform scale that would otherwise
      // leave every normal `scale` units long.
      if (name === 'NORMAL') {
        for (let i = 0; i < arr.length; i += stride) {
          const len = Math.hypot(arr[i], arr[i + 1], arr[i + 2]) || 1
          arr[i] /= len
          arr[i + 1] /= len
          arr[i + 2] /= len
        }
      }
      attr.setArray(arr)
    }
  }
}

// The mirroring in NORMALISE (two negative axes) preserves handedness, so
// winding order still holds. A single negative axis would need every triangle
// reversed here.

// ---------------------------------------------------------------------------
// 4. Split the merged wheels into four nodes with axle-centred pivots.
// ---------------------------------------------------------------------------

/** Sketchfab groups the wheels under one node; everything else is bodywork. */
const isWheelNode = (entry) => /wheel|rim/i.test(findGroupName(entry.node))

function findGroupName(node) {
  let cur = node
  const names = []
  while (cur) {
    names.push(cur.getName() || '')
    cur = cur.listParents().find((p) => p.propertyType === 'Node')
  }
  return names.join('/')
}

const wheelEntries = flat.filter(isWheelNode)
const bodyEntries = flat.filter((e) => !isWheelNode(e))
console.log(`wheel meshes: ${wheelEntries.length}, body meshes: ${bodyEntries.length}`)

if (wheelEntries.length === 0) throw new Error('no wheel meshes matched — check the node names')

/** Per-corner buckets of freshly-built primitives, before re-origining. */
const corners = { fl: [], fr: [], rl: [], rr: [] }

for (const { mesh } of wheelEntries) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION').getArray()
    const indices = prim.getIndices().getArray()

    const buckets = { fl: [], fr: [], rl: [], rr: [] }
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]]
      const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3
      const cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3
      buckets[quadrantOf(cx, cz)].push(a, b, c)
    }

    for (const [corner, tris] of Object.entries(buckets)) {
      if (!tris.length) continue
      corners[corner].push(rebuild(prim, tris))
    }
  }
}

/**
 * A new primitive holding only `tris`, with vertices compacted to the ones it
 * actually references — otherwise each corner would carry all four wheels'
 * vertex buffers and the split would cost size instead of saving it.
 */
function rebuild(prim, tris) {
  const remap = new Map()
  const indices = new Uint32Array(tris.length)
  for (let i = 0; i < tris.length; i++) {
    let next = remap.get(tris[i])
    if (next === undefined) {
      next = remap.size
      remap.set(tris[i], next)
    }
    indices[i] = next
  }

  const out = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode())
  out.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices))

  for (const name of prim.listSemantics()) {
    const attr = prim.getAttribute(name)
    const src = attr.getArray()
    const stride = attr.getElementSize()
    const dst = new src.constructor(remap.size * stride)
    for (const [from, to] of remap)
      for (let k = 0; k < stride; k++) dst[to * stride + k] = src[from * stride + k]

    out.setAttribute(
      name,
      doc
        .createAccessor()
        .setType(attr.getType())
        .setArray(dst)
        .setNormalized(attr.getNormalized()),
    )
  }
  return out
}

/** Assemble each corner as its own mesh, re-origined onto its axle. */
const carRoot = doc.createNode('car')
for (const [corner, prims] of Object.entries(corners)) {
  if (!prims.length) {
    console.warn(`corner ${corner} is empty — the wheel split found nothing there`)
    continue
  }

  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const prim of prims) {
    const arr = prim.getAttribute('POSITION').getArray()
    for (let i = 0; i < arr.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], arr[i + k])
        hi[k] = Math.max(hi[k], arr[i + k])
      }
  }
  // The axle: centre of the wheel's own bounds. Spinning about anything else
  // makes the wheel wobble.
  const pivot = hi.map((h, k) => (h + lo[k]) / 2)

  const mesh = doc.createMesh(`wheel_${corner}_mesh`)
  for (const prim of prims) {
    const arr = prim.getAttribute('POSITION').getArray()
    for (let i = 0; i < arr.length; i += 3)
      for (let k = 0; k < 3; k++) arr[i + k] -= pivot[k]
    prim.getAttribute('POSITION').setArray(arr)
    mesh.addPrimitive(prim)
  }

  carRoot.addChild(doc.createNode(`wheel_${corner}`).setMesh(mesh).setTranslation(pivot))
  const radius = Math.max(hi[1] - lo[1], hi[2] - lo[2]) / 2
  console.log(
    `  wheel_${corner}  pivot ${pivot.map((v) => v.toFixed(3)).join(', ')}  r=${radius.toFixed(3)}m`,
  )
}

// Bodywork keeps its own meshes — `paint()` matches on material name, so the
// node names never need to mean anything.
for (const { node, mesh } of bodyEntries) {
  carRoot.addChild(doc.createNode(node.getName() || mesh.getName() || 'part').setMesh(mesh))
}

// Drop the original hierarchy and hang the rebuilt car off the scene. The old
// nodes still reference the meshes we kept, so detach rather than dispose.
for (const child of scene.listChildren()) child.detach()
scene.addChild(carRoot)
for (const node of root.listNodes()) {
  if (node !== carRoot && !node.listParents().some((p) => p === carRoot || p === scene)) {
    node.dispose()
  }
}

// ---------------------------------------------------------------------------
// 5. Shrink. Welding is the big one here: the export ships ~565k vertices for
//    ~207k triangles, i.e. essentially no vertex sharing at all.
// ---------------------------------------------------------------------------

await doc.transform(
  resample(),
  dedup(),
  weld({ tolerance: 0.0001 }),
  prune({ keepAttributes: false, keepLeaves: false }),
)

doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({
  method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
  quantizationBits: { POSITION: 14, NORMAL: 10, TEX_COORD: 12, GENERIC: 12 },
})

await io.write(outPath, doc)

const { statSync } = await import('node:fs')
const before = statSync(inPath).size
const after = statSync(outPath).size
console.log(
  `\n${(before / 1024 / 1024).toFixed(2)} MB -> ${(after / 1024 / 1024).toFixed(2)} MB ` +
    `(${(after / before * 100).toFixed(1)}%)`,
)
