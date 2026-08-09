/**
 * Landing intro — a parked Ferrari you launch by holding ↑.
 *
 * Adapted from the JS-3D-Car sample, which pins three r107 — hence the vendored
 * copy in `scene/vendor/` rather than a dependency. Plain JS on purpose: it is
 * the only consumer of that build, and typing a decade-old API against it would
 * cost more than it catches. `intro.d.ts` types the one function that escapes.
 *
 * Deliberately not a driving game — there is no steering, no reverse and no
 * brake. The only input is throttle, and crossing LAUNCH_SPEED is the single
 * event this module reports: the site fades in over the top and unmounts it.
 */

import * as THREE from './vendor/three.module.js'
import { GLTFLoader } from './vendor/GLTFLoader.js'
import { DRACOLoader } from './vendor/DRACOLoader.js'
import { PMREMGenerator } from './vendor/PMREMGenerator.js'
import { PMREMCubeUVPacker } from './vendor/PMREMCubeUVPacker.js'

/**
 * The model, sky and Draco decoder stay in `public/` — they are fetched at
 * runtime by URL (the decoder via a script tag), not imported, so they must
 * keep a stable path the bundler does not rename.
 */
const BASE = `${import.meta.env.BASE_URL}intro/`

const ACCENT = 0xc8ff3d

const MAX_SPEED = 62 // m/s
const ACCELERATION = 13 // m/s²
const DECELERATION = 16 // m/s² — throttle released before launch
const LAUNCH_SPEED = 7 // m/s — "the car is moving", hand over to the site

const IDLE_ORBIT_RADIUS = 9 // the car is 4.5 m long — closer than this crops it
const IDLE_ORBIT_SPEED = 0.11 // rad/s
const IDLE_START_ANGLE = 2.3 // rad — opens on a three-quarter front view
const IDLE_HEIGHT = 2.0
const CHASE_BACK = 6.8 // metres behind the car
const CHASE_HEIGHT = 1.55
const BASE_FOV = 50
const LAUNCH_FOV = 82 // widened after launch for the pull-away

const TAU = Math.PI * 2

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const smoothstep = (t) => t * t * (3 - 2 * t)

/** Signed shortest angular distance, so the camera never takes the long way. */
function shortestArc(from, to) {
  let d = (to - from) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return d
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container   element the canvas is appended to
 * @param {() => void}  [opts.onReady]   car loaded and first frame drawn
 * @param {() => void}  [opts.onLaunch]  speed crossed LAUNCH_SPEED, once
 * @param {(e: unknown) => void} [opts.onError]
 * @returns {{ setThrottle(on: boolean): void, dispose(): void }}
 */
export function createIntro({ container, onReady, onLaunch, onError }) {
  const clock = new THREE.Clock()

  let disposed = false
  let carModel = null
  let envMap = null
  let ready = false
  let launched = false

  let throttle = false
  let speed = 0
  let elapsed = 0
  let sinceLaunch = 0
  let wheelRadius = 0.35
  const wheels = []

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0xd7cbb1, 1, 90)

  const camera = new THREE.PerspectiveCamera(BASE_FOV, aspect(), 0.1, 220)
  // Start on the orbit rather than lerping in from somewhere else — the first
  // visible frame should already be the composed shot.
  camera.position.set(
    Math.sin(IDLE_START_ANGLE) * IDLE_ORBIT_RADIUS * framingScale(),
    IDLE_HEIGHT,
    Math.cos(IDLE_START_ANGLE) * IDLE_ORBIT_RADIUS * framingScale(),
  )

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.gammaOutput = true
  renderer.gammaFactor = 2.2
  renderer.toneMappingExposure = 0.92
  // Capped: a 5K display would otherwise render ~4x the pixels for a shot that
  // is on screen for a few seconds.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight)
  container.appendChild(renderer.domElement)

  const grid = new THREE.GridHelper(400, 40, 0x000000, 0x000000)
  grid.material.opacity = 0.2
  grid.material.depthWrite = false
  grid.material.transparent = true
  scene.add(grid)

  const cameraTarget = new THREE.Vector3()
  const lookTarget = new THREE.Vector3()

  function aspect() {
    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight
    return w / h
  }

  /**
   * A portrait viewport crops horizontally at a fixed distance, so the camera
   * backs off until the whole car fits. Read every frame rather than cached —
   * it has to survive a rotation mid-shot.
   */
  function framingScale() {
    const a = aspect()
    return a >= 1.5 ? 1 : clamp(1.5 / a, 1, 1.75)
  }

  function onWindowResize() {
    if (disposed) return
    camera.aspect = aspect()
    camera.updateProjectionMatrix()
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight)
  }
  window.addEventListener('resize', onWindowResize, false)

  // The sky doubles as the only light source — the car is lit entirely by the
  // prefiltered environment map, so nothing renders until this resolves.
  const cubeUrls = ['px.jpg', 'nx.jpg', 'py.jpg', 'ny.jpg', 'pz.jpg', 'nz.jpg']
  new THREE.CubeTextureLoader().setPath(`${BASE}textures/cube/skyboxsun25deg/`).load(
    cubeUrls,
    (texture) => {
      if (disposed) return
      scene.background = texture

      const pmremGenerator = new PMREMGenerator(texture)
      pmremGenerator.update(renderer)
      const packer = new PMREMCubeUVPacker(pmremGenerator.cubeLods)
      packer.update(renderer)
      envMap = packer.CubeUVRenderTarget.texture
      pmremGenerator.dispose()
      packer.dispose()

      loadCar()
    },
    undefined,
    (err) => onError?.(err),
  )

  function loadCar() {
    DRACOLoader.setDecoderPath(`${BASE}draco/`)
    const loader = new GLTFLoader()
    loader.setDRACOLoader(new DRACOLoader())

    loader.load(
      `${BASE}models/ferrari.glb`,
      (gltf) => {
        if (disposed) return

        carModel = gltf.scene.children[0]
        carModel.traverse((child) => {
          if (child.isMesh && child.material) child.material.envMap = envMap
        })

        paint(carModel)
        setupWheels(carModel)
        addContactShadow(carModel)

        scene.add(carModel)
        ready = true
        onReady?.()
      },
      undefined,
      (err) => onError?.(err),
    )
  }

  /** Showroom palette, tied to the app's own accent so the handover reads. */
  function paint(model) {
    const body = new THREE.MeshStandardMaterial({ color: 0x0d0f12, envMap, metalness: 0.92, roughness: 0.22 })
    const rim = new THREE.MeshStandardMaterial({ color: 0x555555, envMap, envMapIntensity: 2, metalness: 1, roughness: 0.2 })
    const glass = new THREE.MeshStandardMaterial({
      color: 0x05070a,
      envMap,
      metalness: 1,
      roughness: 0,
      opacity: 0.28,
      transparent: true,
      premultipliedAlpha: true,
    })
    // Seen head-on while parked and dead-centre once the chase camera swings
    // behind — the one place the brand colour belongs in the scene.
    const tail = new THREE.MeshStandardMaterial({
      color: ACCENT,
      emissive: ACCENT,
      emissiveIntensity: 0.85,
      envMap,
      metalness: 0.4,
      roughness: 0.35,
    })

    const assign = (name, material) => {
      const part = model.getObjectByName(name)
      if (part) part.material = material
    }

    assign('body', body)
    assign('blue', body)
    for (const name of ['rim_fl', 'rim_fr', 'rim_rl', 'rim_rr', 'trim']) assign(name, rim)
    assign('glass', glass)
    for (const name of ['lights_red', 'leds']) assign(name, tail)
  }

  function setupWheels(model) {
    for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
      const wheel = model.getObjectByName(name)
      if (wheel) wheels.push(wheel)
    }
    if (wheels.length) {
      const size = new THREE.Vector3()
      new THREE.Box3().setFromObject(wheels[0]).getSize(size)
      wheelRadius = Math.max(size.x, size.y, size.z) / 2 || 0.35
    }
  }

  function addContactShadow(model) {
    const map = new THREE.TextureLoader().load(`${BASE}models/ferrari_ao.png`)
    const shadow = new THREE.Mesh(
      new THREE.PlaneBufferGeometry(0.655 * 4, 1.3 * 4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map, opacity: 0.8, transparent: true, depthWrite: false }),
    )
    shadow.renderOrder = 2
    model.add(shadow)
  }

  function update(delta) {
    elapsed += delta
    if (!carModel) return

    // Past the launch the throttle is no longer the user's — holding a key
    // through a transition they have already triggered would be busywork.
    const accelerating = throttle || launched
    if (accelerating) speed = clamp(speed + delta * ACCELERATION, 0, MAX_SPEED)
    else speed = clamp(speed - delta * DECELERATION, 0, MAX_SPEED)

    const travelled = speed * delta
    carModel.position.z -= travelled
    for (const wheel of wheels) wheel.rotation.x -= travelled / wheelRadius

    // Keep the grid under the car so the road never runs out.
    grid.position.z = Math.round(carModel.position.z / 10) * 10

    if (!launched && speed >= LAUNCH_SPEED) {
      launched = true
      onLaunch?.()
    }
    if (launched) sinceLaunch += delta

    updateCamera(delta)
  }

  function updateCamera(delta) {
    const car = carModel.position
    const blend = smoothstep(clamp(speed / LAUNCH_SPEED, 0, 1))

    // Slow arc while parked, tightening onto the car's tail as it pulls away.
    // The blend runs on the camera's *angle and radius*, not on two world
    // positions — lerping between a front three-quarter and a chase shot draws
    // a chord straight through the car.
    const idleAngle = IDLE_START_ANGLE + elapsed * IDLE_ORBIT_SPEED
    const angle = idleAngle + shortestArc(idleAngle, 0) * blend
    const scale = framingScale()
    const radius = (IDLE_ORBIT_RADIUS + (CHASE_BACK - IDLE_ORBIT_RADIUS) * blend) * scale
    const height =
      IDLE_HEIGHT + Math.sin(elapsed * 0.5) * 0.07 * (1 - blend) + (CHASE_HEIGHT - IDLE_HEIGHT) * blend

    cameraTarget.set(car.x + Math.sin(angle) * radius, height, car.z + Math.cos(angle) * radius)

    // Light damping only — the target already moves on a smooth arc, so this is
    // there to take the edge off, not to do the travelling.
    camera.position.lerp(cameraTarget, clamp(delta * 10, 0, 1))

    lookTarget.set(car.x, car.y + 0.55, car.z - blend * 3)
    camera.lookAt(lookTarget)

    const fov = BASE_FOV + (LAUNCH_FOV - BASE_FOV) * smoothstep(clamp(sinceLaunch / 1.1, 0, 1))
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  }

  let firstFrame = true
  renderer.setAnimationLoop(() => {
    if (disposed) return
    // getDelta() also covers the tab being backgrounded mid-intro, where a
    // multi-second delta would teleport the car out of the scene.
    update(Math.min(clock.getDelta(), 0.05))
    renderer.render(scene, camera)
    if (firstFrame) firstFrame = false
  })

  return {
    setThrottle(on) {
      // Ignore input until the car exists, so an early keypress cannot bank
      // speed against a scene that has not loaded.
      throttle = ready && !!on
    },

    dispose() {
      if (disposed) return
      disposed = true
      window.removeEventListener('resize', onWindowResize, false)
      renderer.setAnimationLoop(null)

      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) {
          if (!material) continue
          if (material.map) material.map.dispose()
          material.dispose()
        }
      })
      if (scene.background && scene.background.dispose) scene.background.dispose()

      renderer.dispose()
      // A WebGL context is not garbage collected promptly, and browsers cap how
      // many can exist at once — the app behind this intro still wants one.
      renderer.forceContextLoss?.()
      renderer.domElement.remove()
    },
  }
}
