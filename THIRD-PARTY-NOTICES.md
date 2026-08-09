# Third-party notices

Assets and vendored code redistributed in this repository, with the terms they
come under. Anything added to `apps/web/public/` or `scene/vendor/` belongs here.

---

## BMW M4 Competition M Package (3D model)

`apps/web/public/intro/models/bmw.glb`

| | |
| --- | --- |
| Title | BMW M4 Competition M Package |
| Author | 𝙎𝙍𝙏 𝙋𝙚𝙧𝙛𝙤𝙢𝙖𝙣𝙘𝙚™ (https://sketchfab.com/TheRealSRT) |
| Source | https://sketchfab.com/3d-models/bmw-m4-competition-m-package-5c0a2dafb1ad408d9fc9eeef9aee531b |
| Licence | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |

CC BY 4.0 requires attribution wherever the work is shown, so the credit is
rendered in the landing intro itself (`.intro__credit` in `Intro.tsx`) as well as
recorded here. **Do not remove that credit line without replacing the model.**

The shipped file is a modified version of the download: rescaled to metres,
rotated nose-down -Z, re-origined on the contact patch, its merged wheel meshes
split into four independently-rotatable nodes, and Draco-compressed
(21.7 MB → 3.5 MB). CC BY 4.0 permits modification and this note is the record
of it. The transform is reproducible via `scripts/prepare-car-model.mjs`.

Separately from the licence: *BMW*, *M4* and the BMW roundel are trademarks of
Bayerische Motoren Werke AG, which the CC BY licence on this model does not
grant any rights to. The model is used here as demo dressing for a hackathon
project with no affiliation to or endorsement by BMW. A commercial launch should
replace it with a generic vehicle or a properly licensed one.

---

## three.js (vendored)

`apps/web/src/intro/scene/vendor/`

three.js r107, © 2010–2019 three.js authors, [MIT](https://opensource.org/licenses/MIT).
Vendored rather than depended on because the intro is its only consumer and the
scene uses APIs (`PMREMCubeUVPacker`, `renderer.gammaOutput`) removed after r125.

## Draco decoder

`apps/web/public/intro/draco/`

Google Draco, © Google LLC,
[Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0). Fetched at runtime by
`DRACOLoader` to decode the compressed model geometry.

## Skybox

`apps/web/public/intro/textures/cube/skyboxsun25deg/`

From the three.js examples asset set, distributed under three.js's MIT licence.
