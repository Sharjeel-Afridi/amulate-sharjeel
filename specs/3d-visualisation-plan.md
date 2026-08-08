# 3D car visualisation — investigation and plan

Status: **recommendation is "don't do 3D"**. Read §7 first if you only read one section.

---

## 1. What `shliamin/JS-3D-Car` actually is

I pulled the repo metadata, the full file tree with sizes, the README, `index.html`
and `main.js`.

**It is a vendored copy of the official three.js example `webgl_materials_car`,
with arrow-key driving bolted on.** Not a library. Not a package. A GitHub Pages
demo. The evidence is not subtle — `index.html`'s own `<title>` is
`three.js webgl - materials - car`, and the credit line in the page body reads
"three.js car materials demo by Efim Shliamin / Ferrari 458 Italia model by
vicent091036".

| Fact | Value |
| --- | --- |
| Type | Static demo page (`index.html` + `main.js` + `main.css`), no build, no exports, no npm package |
| Engine | three.js, **vendored as `build/three.module.js`**, circa r105 (2019) |
| Models | Ships models — does **not** generate geometry |
| Repo size | ~5.3 MB across 25 files |
| Licence | **None. `license: null` from the GitHub API, `/license` endpoint 404s.** |
| Stars / commits | 15 / 48 |

Size breakdown (the whole reason this matters):

```
1,681,572  models/ferrari.glb          <- ONE car
1,119,957  build/three.module.js       <- pinned 2019 three.js
  954,360  js/libs/draco/gltf/draco_encoder.js
  583,758  js/libs/draco/gltf/draco_decoder.js
  229,813  js/libs/draco/gltf/draco_decoder.wasm
  ~420,000 textures/cube/skyboxsun25deg/*.jpg   (6 faces)
   81,872  build/GLTFLoader.js
    7,606  main.js                     <- the only original code
```

### Four independent reasons it is not usable as-is

1. **No licence.** Absent a licence, default copyright applies: all rights
   reserved. Copying it into our Docker image is not something to hand-wave at a
   hackathon submission. Separately, `models/ferrari.glb` is a **real, trademarked
   Ferrari 458 Italia** sourced from Sketchfab under terms the repo never states.
   Two licence problems stacked on each other.
2. **It is not offline.** `index.html` loads four scripts from `rawgit.com` and
   `cdn.rawgit.com`. **RawGit was shut down in October 2019.** The published demo
   is partially broken today, and it directly violates our hard "no CDN at
   runtime" constraint.
3. **The vendored three.js is dead API.** `main.js` uses `PMREMCubeUVPacker`,
   `PlaneBufferGeometry`, `renderer.gammaOutput`, and `DRACOLoader.setDecoderPath`
   as a static method — every one of those was removed from three.js between r125
   and r144. Current three is r185. You cannot lift this code into a modern build;
   you would rewrite it.
4. **One model, ten categories.** It ships a single sports car. We have 10
   categories and 34 brands. It solves 1/10th of the asset problem, using the one
   asset we are least able to redistribute.

**Verdict: usable as a *reference* for the scene recipe** (env-map + PMREM +
`MeshPhysicalMaterial` car paint + AO-plane contact shadow is a genuinely good
recipe, and modern three.js ships `RoomEnvironment` which makes it three lines).
**Not usable as code, as a dependency, or as an asset.** If we did real-time 3D
we would write it from scratch against three r185 and source models elsewhere.

---

## 2. The measurement that decides this

Before comparing options, look at how large the car art actually renders:

| Consumer | File | Rendered size |
| --- | --- | --- |
| A2UI `CarCard` | `apps/web/src/a2ui/a2ui.css:101-108` | **108 × 72 px** |
| MCP App widgets | `apps/mcp-marketplace/src/theme.ts:109` | **92 × 42 px** |

Both call sites paint the car at roughly the size of two favicons side by side.

Real-time PBR rendering into a 108 × 72 box means shipping ~600 KB of engine plus
a megabyte of geometry to produce detail the user physically cannot resolve.
Reflections, normal maps, and depth are invisible at that scale. The thing that is
visible at that scale is **silhouette, colour, and contrast** — which is exactly
what an SVG is good at.

This is the single most important finding in this document. The current art does
not look bad because it is 2D. It looks bad because it is **97 px wide, flat, has
no gradients, has no curves, and picks its colour from `hash % 360`**.

---

## 3. Implementation options, ranked

### Option 0 — Make the 2D art genuinely good *(recommended)*

Not a 3D option. Included because it is the correct answer, and because the brief
asked me to assess whether the real problem is 3D-vs-2D or just bad 2D. It is the
latter.

Six specific defects in `packages/catalog/src/art.ts`, each cheap to fix:

1. **Everything is straight lines.** Every profile is built from `L` segments
   (`bodyPath()`, lines 75–122). Cars are curves. Swapping the roofline, bonnet
   and boot to `C`/`Q` beziers is the single largest realism gain available and
   costs about 30 lines. This is why they read as "clip art".
2. **One flat fill per body.** `fill="hsl(h 48% 47%)"` — no gradient. A vertical
   linear gradient (light at the shoulder, dark at the rocker) plus one specular
   sweep across the door is what actually makes a shape read as three-dimensional
   at thumbnail size. This is the "3D-ness" people perceive; it is not raytracing.
3. **The contact shadow is a flat 22%-opacity ellipse** (line 172). A radial
   gradient that fades at the edges instead of a hard ellipse costs one `<defs>`
   block.
4. **`brandHue()` returns `hash % 360`.** Across 34 brands that lands several on
   muddy olive and khaki. Replace with an index into ~12 curated automotive
   colours (pearl white, silver, graphite, midnight blue, racing red, British
   racing green, …). Instantly reads as designed rather than random.
5. **No detail marks at all.** No wheel arch, no door shut line, no headlight, no
   tail light, no mirror, no window divider, no alloy spokes. Six primitives,
   ~45 minutes, and the silhouette stops being a silhouette.
6. **The image box is too small.** 108 × 72 is undersized for a card that carries
   a title, subtitle, tags, a score bar, a price badge and a rationale line.
   Two CSS lines.

Per-category flourishes (roof rails on SUV/estate, a ducktail on sports, bed
rails on pickup, a sliding-door rail on MPV) make the ten categories visually
distinct at a glance, which is a genuine product improvement — right now
`crossover` and `suv` differ by 3 px of roof height.

**Files touched:** `packages/catalog/src/art.ts` (all of the above),
`apps/web/src/a2ui/a2ui.css:101` (bigger box),
`apps/mcp-marketplace/src/theme.ts:109` (bigger box). That is it.

**Cost:** 0 KB bundle, 0 new dependencies, 0 licence questions, 0 offline risk,
works unchanged inside the sandboxed iframes, Docker image does not grow by a
byte. `npm run verify -w @car/catalog` still gates it.

**Time: 2–3.5 h**, and it is *interruptible* — you can stop after the beziers and
the gradient (90 min) and already have a visibly better product.

---

### Option A — Pre-baked renders from CC0 models *(best option if you insist on 3D)*

Render 3D **at build time**, ship **images** at runtime. All the 3D look, none of
the runtime cost.

**Assets.** 10 distinct models — one per category, not one per listing. Source
from CC0 kits, not from JS-3D-Car:

- **Kenney Car Kit** — ~45 vehicles, ships glTF/GLB, **CC0**, generic shapes with
  no manufacturer badges (so no trademark exposure either).
- **Quaternius Ultimate Vehicles Pack** — CC0, same deal.

Realistically 7–8 of our 10 categories map cleanly (hatchback, sedan, suv,
crossover, coupe, pickup, mpv, sports). `estate` and `convertible` will need a
near-match or a small mesh edit. Both kits are stylised low-poly, not photoreal —
which is fine and arguably better for a product UI.

**Baking.** A one-off Node script (three.js + `RoomEnvironment` + an orthographic
or long-lens 3/4 camera) or a Blender CLI render. Output: category × colour grid.
120 WebP at 320 × 216 with alpha ≈ 5–8 KB each ≈ **600 KB–1 MB of static files**,
of which only the ~8 on screen are ever fetched. Commit the output; the baker is
a dev tool that never runs in CI or in the container.

**Files touched:**
- NEW `tools/bake-car-art/` — the offline render script. Never runs at runtime.
- NEW `apps/web/public/art/{category}-{colour}.webp` — committed output.
- `packages/catalog/src/art.ts` — add `carArtUrl(brand, category)`. **Keep
  `carArt()` and `carArtDataUri()` intact** as the fallback and for the iframes.
- `apps/api/src/surfaces.ts:102` — `carArtDataUri(...)` → `carArtUrl(...)`.
  The A2UI `CarCard.imageUrl` prop is a `DynamicString`, so this is a *one-value*
  change. **No A2UI schema change, no renderer change.** That is the whole reason
  this option is cheap.
- `apps/web/src/a2ui/a2ui.css:101` — bigger box (mandatory; a baked render at
  108 × 72 is a waste).
- MCP widgets: keep the SVG, **or** inline the same baked PNG as a data URI at
  `booking-form.ts:61` / `checkout.ts:52`. A few KB, stays offline.

**Docker/offline:** trivial. Ordinary static files copied into the image. No
runtime fetch, no WebGL, no engine.

**Grid performance:** solved by construction. Eight `<img>` tags. Zero WebGL
contexts. Add `loading="lazy"` and you are done.

**Time: 4–7 h honest**, and the variance is bad. The engineering is 2 h; the other
2–5 h is asset wrangling — finding, importing, orienting, framing, and
colour-tinting 10 vehicles you did not author, then discovering the wheels are a
separate mesh with a different pivot. Setting up a headless Blender/three render
pipeline at hour 6 of 18 is exactly where this quietly becomes 9 hours.

---

### Option C — Real-time three.js in the card grid *(do not do this now)*

For completeness, and because the multi-context problem has a real answer.

**The performance mechanism** (this part is genuinely solvable): do **not** create
one canvas per card. Create **one** `WebGLRenderer` for the whole page and use the
scissor-viewport technique from the three.js `webgl_multiple_elements` example:

```
// illustrative only
renderer.setScissorTest(true)
for (const slot of visibleSlots) {
  const r = slot.el.getBoundingClientRect()
  renderer.setViewport(r.left, bottom, r.width, r.height)
  renderer.setScissor (r.left, bottom, r.width, r.height)
  camera.lookAt(slot.car); renderer.render(scene, camera)
}
```

One context, N viewports. Layer with: a fixed-position `pointer-events: none`
canvas behind the card text; `IntersectionObserver` to skip off-screen slots;
render-on-demand (`requestAnimationFrame` only while something moves — idle at
0 fps otherwise); `setPixelRatio(min(dpr, 1.5))`; shared geometry with per-card
material clones only for body colour. That holds 8 cards at 60 fps comfortably.

**But the cost is not the renderer, it is the contract.** `CarCardApi` takes
`imageUrl: DynamicString` — a *URL string*, produced server-side in
`surfaces.ts`. Real-time 3D needs the card to own a positioned DOM slot and a
model key. So you change:

- `apps/web/src/a2ui/catalog.tsx` — `CarCardApi` schema and the `CarCard`
  implementation (placeholder div + stage registration instead of `<img>`)
- `apps/api/src/surfaces.ts` — emit `category` + colour instead of `imageUrl`
- `packages/shared` — if the new prop enters the shared contract
- NEW `apps/web/src/three/CarStage.tsx` — shared renderer, slot registry, RAF loop
- NEW `apps/web/public/models/*.glb`
- `apps/web/src/App.tsx`, `styles.css` — overlay canvas vs. the scrolling stage
  panel's `overflow` clipping and `border-radius` (an overlay canvas does not
  clip to rounded corners; expect fighting)
- `apps/web/package.json`, `vite.config.ts`

That is **schema churn in the exact subsystem the hackathon is about**. CLAUDE.md
states the A2UI/MCP-Apps split is "the core design idea, not an implementation
detail". Destabilising `CarCard` 18 hours out to improve a thumbnail is a bad
trade.

**Offline landmine:** three.js's `DRACOLoader` defaults its decoder path to
`https://www.gstatic.com/draco/...`. If you use Draco and forget
`setDecoderPath()`, **the container breaks the moment it is demoed offline** and
the failure mode is a silent blank card. Copy `node_modules/three/examples/jsm/libs/draco/`
into `public/` and point at it — or skip Draco entirely, which for low-poly models
is the right call anyway (the 230 KB wasm decoder costs more than it saves).

**Bundle cost, realistic:**

| Item | Minified | Gzipped |
| --- | --- | --- |
| `three` r185 core, tree-shaken | ~600–650 KB | ~155–175 KB |
| `GLTFLoader` + `OrbitControls` + `RoomEnvironment` | ~60–90 KB | ~20 KB |
| `@react-three/fiber` (if used) | ~150 KB | ~50 KB |
| 10 low-poly GLB models | — | ~0.5–1 MB (assets) |
| **Total added** | **~900 KB – 1.3 MB** | **~250–350 KB over the wire + ~1 MB assets** |

Today `apps/web` ships **zero** graphics code. This roughly triples the JS bundle.

**Time: 10–14 h.** More than half the remaining budget, for a 108 × 72 thumbnail.

---

### Option B — CSS 3D transforms

3–4 h, no dependencies, but stacked `rotate3d` divs look like a 2005 CSS
demoscene entry. **Strictly worse output than Option 0 for comparable effort.**
Listed only to be dismissed.

---

## 4. Sandboxed iframes (MCP Apps) — assessment

`apps/web/src/mcp/McpAppFrame.tsx:249` sets `sandbox="allow-scripts"` with **no**
`allow-same-origin`, and assigns HTML via `srcdoc` (line 218).

WebGL itself is **not** blocked by the sandbox. The blockers are these:

1. **Opaque origin.** Without `allow-same-origin` the guest document has a null
   origin. Any `fetch()`/XHR for a `.glb` goes out with `Origin: null` and needs
   `Access-Control-Allow-Origin: *` to succeed, and relative URLs have no reliable
   base to resolve against in a `srcdoc` document.
2. **So everything must be inlined into the `srcdoc` string** — three.js (~600 KB)
   *plus* the model base64'd (+33%). That is a ~1 MB HTML string generated
   **per widget instance** by `bookingFormHtml()`, pushed across the MCP wire as a
   `ui://` resource, and assigned to `iframe.srcdoc`. For a booking form.
3. **It renders at 92 × 42 px** (`theme.ts:109`).

**Verdict: no 3D in the MCP App widgets, under any option.** Keep the inline SVG
there. If Option A ships, inline the same baked PNG as a data URI — a few KB, and
it keeps the widgets visually consistent with the cards. The `carArt()` export
must therefore survive whatever else changes.

---

## 5. Asset count — how this scales

We have **10 categories** and **34 unique brands** (counted from
`packages/catalog/src/models.ts`; the file is `Record<Category, Record<Brand, Model>>`
with 10 brands per category, 34 distinct across all).

Brand does **not** need a distinct model. Today brand only drives *colour*
(`brandHue()`), and that is the correct design — a Kia Sportage and a Hyundai
Tucson are the same silhouette in any honest side profile.

So the real asset count is:

- **10 models** (one per category) — the floor, whatever the approach.
- Colour applied at render time (Option 0: SVG fill; Option A: bake
  10 categories × ~12 curated colours = **120 images**; Option C: material clone).

A plan needing one hand-made model per *listing* would be 400 models. Nobody is
proposing that. But note that even 10 is 10 models we do not have and cannot take
from JS-3D-Car, which ships exactly one, of a trademarked car, with no licence.

---

## 6. Time budget reality check

`specs/tasks.md` is somewhat stale, but the outstanding work is not in doubt:

- Phase 2 — MCP Apps host bridge, Express API + SSE, AgentDriver, **the
  walking-skeleton gate**
- Phase 7 — **Dockerfiles + `docker compose up` (there is no Dockerfile in the
  repo at all — I checked)**, README run instructions, full end-to-end rehearsal
- Phase 8 — deck, video demo

Docker + docs + rehearsal + video alone is 4–6 h and none of it is optional for a
submission. Agent integration is the product.

| Option | Hours | Bundle | Licence risk | Touches A2UI schema |
| --- | --- | --- | --- | --- |
| **0 — better 2D** | **2–3.5** | 0 KB | none | no |
| A — pre-baked sprites | 4–7 (high variance) | 0 KB JS, ~1 MB assets | CC0, clean | no |
| B — CSS 3D | 3–4 | 0 KB | none | no |
| C — real-time three.js | 10–14 | +250–350 KB gz | CC0, clean | **yes** |
| JS-3D-Car as-is | n/a | n/a | **unlicensed, trademarked, CDN-dependent** | — |

---

## 7. Recommendation

**Do Option 0. Do not do 3D.**

Spend 2–3.5 hours making the SVGs genuinely good — beziers instead of straight
lines, gradient body fill, soft radial contact shadow, a curated 12-colour brand
palette instead of `hash % 360`, wheel arches and door lines and lights, a
per-category flourish, and a bigger image box. One file plus two CSS lines. Then
go build the agent integration, the Dockerfile, and the video.

The reasoning, plainly:

- **The art renders at 108 × 72 and 92 × 42.** At that size no amount of 3D is
  perceptible. The perceived "3D-ness" comes from gradients and contact shadows,
  which SVG does for free.
- **The current art is not bad because it is 2D.** It is bad because it is flat,
  polygonal, tiny, and randomly coloured. Every one of those has a cheap fix.
- **JS-3D-Car cannot be used.** No licence, a trademarked Ferrari, dead RawGit
  CDN links, a six-year-old three.js against removed APIs, and one model for ten
  categories. Even as inspiration it only offers a scene recipe that modern
  three.js reduces to `new RoomEnvironment()`.
- **Real-time 3D would touch `CarCardApi`**, the one schema the project's own
  CLAUDE.md calls the core design idea. Judges will care about the A2UI/MCP-Apps
  split working; a third rendering system that is not part of the story adds
  surface area for bugs and none for the pitch.
- **There is no Dockerfile yet.** Adding a WebGL asset pipeline before the
  container exists is the wrong order.

### What would change my mind

- **A single hero car, not a grid.** If the demo video's money shot is one large
  selected-car detail panel (~600 × 400), that is a completely different problem:
  one WebGL context, one CC0 model, a slow auto-rotate, no multi-context issue,
  and — crucially — **no `CarCard` schema change**, because it is a new panel, not
  the card. That is ~2–3 h and it is the *only* 3D I would consider. Park it as a
  stretch goal for after Docker and the video are done, and only then.
- **If ~40 h remained instead of ~18.** Option A becomes clearly worthwhile.
- **If judging explicitly rewarded graphics ambition** over agent architecture.
  For an agent hackathon it almost certainly does not.

### If you overrule me and want 3D anyway

Do **Option A**, not Option C, and time-box the asset hunt to 90 minutes. If you
do not have 10 usable CC0 models oriented and framed by then, abandon and fall
back to Option 0 — `carArt()` will still be sitting there working, which is the
main reason Option A keeps it rather than replacing it.
