import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { SceneryArea, SceneryDefinition } from '../tracks/types'
import type { BattleSpan } from '../battles'
import type { CarRow } from '../types'
import type { TrackModel, Vec } from './trackModel'
import type { Placement } from './useCarPlacement'

/**
 * The 3D map's scene, written against three.js directly (no React wrapper library): the track as a ribbon at its
 * real height (track file `elevation`, exaggerated), a curtain down to the ground so the hills read, the pit lane,
 * and a dot for each car placement (like the 2D map). React (TrackMap3D) creates one per track and calls `setCars` every
 * frame with the same placements the 2D map draws; this class renders on its own animation loop.
 *
 * Coordinates: track metres x east / y north become three.js x / -z, and height becomes y (up).
 */

/** Heights are stretched so a hill reads from a distance. Shown in the caption. */
export const HEIGHT_SCALE = 2
const TRACK_WIDTH = 16 // metres; a little wider than the real road so it shows from afar
const PIT_WIDTH = 9
/** Car dots: radius in metres, growing with distance from the camera so they still show in the overview. */
const DOT_MIN = 4
const DOT_MAX = 32
/** Metres of camera distance per metre of dot radius (between the limits). */
const DOT_PER_DISTANCE = 100
/** A colour token from styles.css (each series has its own), so the 3D scene matches the panel it sits in. */
function cssColour(name: string, fallback: number) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#[0-9a-f]{6}$/i.test(value) ? parseInt(value.slice(1), 16) : fallback
}
const BG = cssColour('--panel', 0x12161b)
const MAKER_COLOURS: Record<string, number> = { ford: 0x2f6fdf, chevrolet: 0xf28c1b, toyota: 0xe5172f }
// Track colours: a light surface with near-white edges, like painted track lines, so the circuit stands out from the
// darker slate buildings (they were the same mid grey, and the track vanished among the Las Vegas casinos).
const TRACK = 0x5f6b78
const EDGE = 0xdde3e9
/** The faint copy of the track drawn over everything, so it shows through buildings. */
const XRAY_OPACITY = 0.3
/** Battles: a glowing band over the track under the cars (a colour no team or flag uses). */
const BATTLE = 0x2fd3ff
const BATTLE_WIDTH = 46
/** Pit rejoin ghost (pit/): violet, a colour no team, flag or battle uses. */
const GHOST = 0xb98cff
/** Scenery colours: muted, so the track and the cars stay the brightest things on screen. */
const SCENERY = { park: 0x1d3325, wood: 0x1b3524, beach: 0x6e6248, water: 0x17324d, building: 0x272e37, footprint: 0x313943,
  grandstand: 0x55677a, tree: 0x34613b, ground: 0x252e29 }
const YELLOW = 0xffd23f

export type CameraMode = 'static' | 'orbit' | 'follow' | 'free'

export class TrackScene {
  readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 5, 40000)
  private readonly controls: OrbitControls
  private readonly overlay: HTMLDivElement
  private readonly cars = new Map<string, { group: THREE.Group; body: THREE.MeshBasicMaterial; rim: THREE.Mesh; tag: HTMLSpanElement; seen: boolean; hovered: boolean }>()
  /** Rim for the hovered car: white, like the 2D map. */
  private readonly hoverRimMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
  /** Rim for the car with the pit rejoin estimate on: the ghost's violet, a little wider. */
  private readonly ghostRimMaterial = new THREE.MeshBasicMaterial({ color: GHOST, depthTest: false })
  private readonly carGroup = new THREE.Group()
  private readonly dotGeometry = new THREE.SphereGeometry(1, 20, 14)
  /** Drawn inside out, slightly bigger than the dot: a dark outline from any angle. */
  private readonly rimMaterial = new THREE.MeshBasicMaterial({ color: 0x0b0d10, side: THREE.BackSide, depthTest: false })
  private readonly edges: THREE.LineBasicMaterial
  private readonly edgesXray = new THREE.LineBasicMaterial({ color: EDGE, transparent: true, opacity: XRAY_OPACITY, depthTest: false, depthWrite: false })
  private readonly labels: { el: HTMLSpanElement; at: THREE.Vector3; corner?: boolean; landmark?: boolean }[] = []
  private showCorners = true
  private readonly battleGroup = new THREE.Group()
  private readonly battleMaterial = new THREE.MeshBasicMaterial({ color: BATTLE, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
  private battleSpans: BattleSpan[] = []
  private readonly battleLabels: HTMLSpanElement[] = []
  private readonly overtakeTags: HTMLSpanElement[] = []
  private readonly resize: ResizeObserver
  private readonly raycaster = new THREE.Raycaster()
  private readonly centre: Vec
  private readonly radius: number
  private frame = 0
  private grid: THREE.GridHelper | null = null
  private scenery: THREE.Group | null = null
  private sceneryDef: SceneryDefinition | null = null
  private buildings: THREE.Mesh[] = []
  /** The ground's height grid (hilly tracks), from the scenery. */
  private terrain: SceneryDefinition['terrain'] = null
  private curtainMesh: THREE.Mesh | null = null
  private groundPlane: THREE.Mesh | null = null
  /** Landmark and corner labels that came with the scenery (removed when it changes). */
  private sceneryLabels: { el: HTMLSpanElement; at: THREE.Vector3; corner?: boolean; landmark?: boolean }[] = []
  private showLandmarks = true
  /** Pit rejoin ghost: a band over the likely stretch, a dashed ring at the most likely spot, and a label. */
  private readonly ghostMaterial = new THREE.MeshBasicMaterial({ color: GHOST, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
  private ghostBand: THREE.Mesh | null = null
  private readonly ghostRing = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.2, 8, 40), new THREE.MeshBasicMaterial({ color: GHOST, depthTest: false }))
  private readonly ghostLabel: HTMLSpanElement
  private flatBuildings = false
  private last = performance.now()
  private mode: CameraMode = 'static'
  private followId: string | null = null
  /** Eased direction of the chase camera (flat, unit length). */
  private heading: THREE.Vector3 | null = null
  private tagged = new Set<string>()
  /** Keys held down in Free mode (KeyboardEvent.code). */
  private readonly keys = new Set<string>()
  hover: (id: string | null) => void = () => {}
  togglePin: (carNumber: string) => void = () => {}

  constructor(private readonly host: HTMLElement, private readonly model: TrackModel) {
    const def = model.def
    const xs = def.path.map((p) => p[0])
    const ys = def.path.map((p) => p[1])
    this.centre = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
    this.radius = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2

    // Throws when WebGL isn't available; TrackMap3D shows a message instead.
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    host.appendChild(this.renderer.domElement)
    this.overlay = document.createElement('div')
    this.overlay.className = 'm3d-overlay'
    host.appendChild(this.overlay)

    this.scene.background = new THREE.Color(BG)
    this.scene.fog = new THREE.Fog(BG, this.radius * 4, this.radius * 10)
    this.scene.add(new THREE.HemisphereLight(0xdde6f0, 0x1a2027, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(-1, 2, 1)
    this.scene.add(sun)

    this.scene.add(this.ground())
    const ribbon = this.ribbon()
    this.scene.add(ribbon)
    // X-ray: the same ribbon drawn last, faintly, ignoring depth, so where buildings hide the track it still shows.
    const xray = new THREE.Mesh(ribbon.geometry, new THREE.MeshBasicMaterial({ color: EDGE, transparent: true, opacity: XRAY_OPACITY * 0.5, depthTest: false, depthWrite: false, side: THREE.DoubleSide }))
    xray.renderOrder = 8
    this.scene.add(xray)
    if (def.elevation?.length) {
      this.curtainMesh = this.curtain()
      this.scene.add(this.curtainMesh)
    }
    this.edges = new THREE.LineBasicMaterial({ color: EDGE })
    for (const side of [1, -1]) {
      const geometry = this.edgeGeometry(side)
      this.scene.add(new THREE.LineLoop(geometry, this.edges))
      const ghost = new THREE.LineLoop(geometry, this.edgesXray)
      ghost.renderOrder = 8
      this.scene.add(ghost)
    }
    if (def.pitLane.length > 1) this.scene.add(this.pitLane())
    this.scene.add(this.controlLine())
    this.battleGroup.renderOrder = 9
    this.scene.add(this.battleGroup)
    this.scene.add(this.carGroup)
    this.ghostRing.renderOrder = 12
    this.ghostRing.visible = false
    this.scene.add(this.ghostRing)
    this.ghostLabel = document.createElement('span')
    this.ghostLabel.className = 'm3d-label m3d-ghost'
    this.ghostLabel.style.display = 'none'
    this.overlay.appendChild(this.ghostLabel)
    for (const l of def.labels.filter((l) => !/line$|^pit straight$/i.test(l.name))) {
      const el = document.createElement('span')
      // Corner numbers (T1, T12...) as small pills so they read over the bright track; names as plain text.
      el.className = /^T\d/.test(l.name) ? 'm3d-label m3d-corner' : 'm3d-label'
      el.textContent = l.name
      this.overlay.appendChild(el)
      this.labels.push({ el, at: this.beside(l.distance), corner: true })
    }

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.autoRotate = false // turned on for Orbit (setCamera)
    this.controls.autoRotateSpeed = 0.35 // about one turn every three minutes
    this.controls.maxPolarAngle = Math.PI * 0.47 // stay above the ground
    this.controls.minDistance = 150
    this.controls.maxDistance = this.radius * 8

    const canvas = this.renderer.domElement
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('dblclick', this.onDoubleClick)
    // Free mode keys: the canvas takes focus when clicked, so WASD only moves the map while it's the map you're using.
    canvas.tabIndex = 0
    canvas.addEventListener('pointerdown', this.onFocus)
    canvas.addEventListener('keydown', this.onKeyDown)
    canvas.addEventListener('keyup', this.onKeyUp)
    canvas.addEventListener('blur', this.onBlur)
    // Headless checks (CLAUDE.md "Verifying changes"): with ?debug3d in the URL, scripts can move the camera.
    if (new URLSearchParams(window.location.search).has('debug3d')) (window as unknown as { scene3d: TrackScene }).scene3d = this
    this.resize = new ResizeObserver(() => this.fit())
    this.resize.observe(host)
    this.fit()
    this.resetOrbit()
    this.frame = requestAnimationFrame(this.tick)
  }

  /** Debug (?debug3d): look at track point (x, y) from `distance` m away, `elevation` degrees up, from `bearing`° (0 = south). */
  debugView(x: number, y: number, distance: number, elevation = 35, bearing = 0) {
    const target = this.toWorld({ x, y }, this.groundAt(x, y))
    const e = (elevation * Math.PI) / 180, b = (bearing * Math.PI) / 180
    this.controls.target.copy(target)
    this.camera.position.copy(target).add(new THREE.Vector3(Math.sin(b) * Math.cos(e), Math.sin(e), Math.cos(b) * Math.cos(e)).multiplyScalar(distance))
    this.controls.update()
  }

  setCamera(mode: CameraMode, followId: string | null) {
    // Back from Follow: the overview again. Between 3D and Orbit the view stays where it is.
    if (mode !== 'follow' && this.mode === 'follow') this.resetOrbit()
    if (mode === 'follow' && (this.mode !== 'follow' || followId !== this.followId)) this.heading = null
    this.mode = mode
    this.followId = followId
    this.controls.enabled = mode !== 'follow'
    this.controls.autoRotate = mode === 'orbit'
    if (mode === 'free') this.renderer.domElement.focus({ preventScroll: true })
    else this.keys.clear()
  }

  /**
   * Battles this frame (battles.ts): a band over each stretch of track, drawn over buildings like the cars, with a
   * label at the front car and, in F1, an "OT" tag on each car in Overtake Mode range. Empty to clear.
   */
  setBattles(spans: BattleSpan[]) {
    for (const m of this.battleGroup.children) (m as THREE.Mesh).geometry.dispose()
    this.battleGroup.clear()
    for (const sp of spans) {
      const mesh = new THREE.Mesh(this.band(sp.from, sp.to), this.battleMaterial)
      mesh.renderOrder = 9
      this.battleGroup.add(mesh)
    }
    this.battleSpans = spans
  }

  /** A flat band along the track from `from` to `to` metres (to may pass the lap length), `width` wide. */
  private band(from: number, to: number, width = BATTLE_WIDTH) {
    const positions: number[] = []
    const index: number[] = []
    const steps = Math.max(2, Math.ceil((to - from) / 5))
    for (let k = 0; k <= steps; k++) {
      const d = from + ((to - from) * k) / steps
      const p = this.model.pointAt(d)
      const n = this.model.normalAt(d)
      for (const side of [1, -1]) {
        const q = this.toWorld({ x: p.x + n.x * side * width / 2, y: p.y + n.y * side * width / 2 }, this.heightAt(d) + 1)
        positions.push(q.x, q.y, q.z)
      }
      if (k < steps) index.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 2, k * 2 + 1, k * 2 + 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setIndex(index)
    return g
  }

  /** The n-th element of a pool of overlay spans, created on demand; the rest are hidden by the caller. */
  private pooled(pool: HTMLSpanElement[], n: number, className: string) {
    while (pool.length <= n) {
      const el = document.createElement('span')
      el.className = className
      this.overlay.appendChild(el)
      pool.push(el)
    }
    return pool[n]
  }

  /** Corner names and numbers on or off (the Corners button); the pit lane and landmarks stay. */
  setCornerLabels(show: boolean) {
    this.showCorners = show
  }

  /** Landmark names (attractions, stadiums, tall buildings) on or off (the Landmarks button). */
  setLandmarks(show: boolean) {
    this.showLandmarks = show
  }

  /**
   * The pit rejoin ghost this frame (pit/usePitGhost.ts, ghostOnTrack): `from`..`to` metres is the likely stretch,
   * `mid` the most likely spot. Null hides it.
   */
  setPitGhost(ghost: { from: number; to: number; mid: number; label: string } | null) {
    if (this.ghostBand) {
      this.scene.remove(this.ghostBand)
      this.ghostBand.geometry.dispose()
      this.ghostBand = null
    }
    this.ghostRing.visible = !!ghost
    if (!ghost) { this.ghostLabel.style.display = 'none'; return }
    this.ghostBand = new THREE.Mesh(this.band(ghost.from, ghost.to, 30), this.ghostMaterial)
    this.ghostBand.renderOrder = 9
    this.scene.add(this.ghostBand)
    this.ghostRing.position.copy(this.at(ghost.mid, 3))
    this.ghostLabel.textContent = ghost.label
  }

  setCaution(caution: boolean) {
    this.edges.color.setHex(caution ? YELLOW : EDGE)
    this.edgesXray.color.setHex(caution ? YELLOW : EDGE)
  }

  /**
   * Buildings, water, beaches and parks around the track (tracks/scenery/<CODE>.json). Flat tracks: the flat layers
   * don't write depth and are drawn in a fixed order (parks, woods, beach, water, markings), so the thin gaps between
   * them never flicker; the track and buildings still draw over them. Hilly tracks with a `terrain` grid (Bathurst):
   * the ground is a mesh at its real height (exaggerated like the track) with those layers painted onto it, and
   * buildings and trees stand on it. The grid is hidden: the scenery gives the sense of scale.
   */
  setScenery(scenery: SceneryDefinition | null) {
    if (this.scenery) {
      this.buildings = []
      this.scene.remove(this.scenery)
      disposeTree(this.scenery)
      this.scenery = null
    }
    for (const l of this.sceneryLabels) l.el.remove()
    this.sceneryLabels = []
    this.terrain = scenery?.terrain ?? null
    this.sceneryDef = scenery
    if (this.grid) this.grid.visible = !scenery
    if (this.curtainMesh) this.curtainMesh.visible = !this.terrain
    if (this.groundPlane) this.groundPlane.position.y = this.terrain ? Math.min(...this.terrain.h) * HEIGHT_SCALE - 2 : -0.5
    if (!scenery) return
    // Landmarks just above their roofs; corners (when the track file has none of its own) like the track's labels.
    const label = (text: string, className: string, at: THREE.Vector3, corner = false, landmark = false) => {
      const el = document.createElement('span')
      el.className = className
      el.textContent = text
      this.overlay.appendChild(el)
      this.sceneryLabels.push({ el, at, corner, landmark })
    }
    for (const l of scenery.landmarks ?? []) {
      label(`◆ ${l.name}`, 'm3d-label m3d-landmark', this.toWorld({ x: l.at[0], y: l.at[1] }, this.groundAt(l.at[0], l.at[1]) + (l.h || 20) + 15), false, true)
    }
    if (this.model.def.labels.length === 0) for (const c of scenery.corners ?? []) label(c.name, 'm3d-label m3d-corner', this.beside(c.distance), true)
    const group = new THREE.Group()
    if (this.terrain) group.add(this.terrainMesh(scenery, this.terrain))
    else {
      const layers: [SceneryArea[], number, number][] = [[scenery.parks, SCENERY.park, 1], [scenery.woods ?? [], SCENERY.wood, 2],
        [scenery.beach, SCENERY.beach, 3], [scenery.water, SCENERY.water, 4]]
      for (const m of scenery.markings ?? []) layers.push([[m], new THREE.Color(m.colour).getHex(), 5])
      for (const [areas, colour, order] of layers) {
        const shapes = areas.filter((a) => a.outer.length > 2).map((a) => {
          const shape = new THREE.Shape(a.outer.map(([x, y]) => this.flat(x, y)))
          for (const h of a.holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => this.flat(x, y))))
          return shape
        })
        if (!shapes.length) continue
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shapes), new THREE.MeshBasicMaterial({ color: colour, depthWrite: false }))
        mesh.rotation.x = -Math.PI / 2
        mesh.position.y = -0.4 + order * 0.05
        mesh.renderOrder = order
        group.add(mesh)
      }
    }
    if (scenery.trees?.length) group.add(this.treeMesh(scenery.trees))
    this.scenery = group
    this.scene.add(group)
    this.setFlatBuildings(this.flatBuildings)
  }

  /**
   * Buildings as flat grey footprints (just above the ground) or as blocks at their height. Flat ones are a lighter
   * grey, as they're seen from above. Grandstands are a lighter slate than other buildings, so they stand out.
   */
  setFlatBuildings(flat: boolean) {
    this.flatBuildings = flat
    if (!this.scenery || !this.sceneryDef) return
    for (const mesh of this.buildings) {
      this.scenery.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    this.buildings = []
    const all = this.sceneryDef.buildings.filter((b) => b.ring.length > 2)
    for (const [list, colour] of [[all.filter((b) => b.kind !== 'grandstand'), SCENERY.building], [all.filter((b) => b.kind === 'grandstand'), SCENERY.grandstand]] as const) {
      // One extruded prism each, merged into a single mesh (2,000 separate meshes would be slow).
      const prisms = list.map((b) => {
        const ring = b.ring.map(([x, y]) => this.flat(x, y))
        // On a hill, a building stands on the lowest ground under it (the rest of it is cut into the slope); a flat
        // footprint lies on the highest, so the slope doesn't cover it.
        const grounds = this.terrain ? b.ring.map(([x, y]) => this.groundAt(x, y)) : [0]
        const base = flat ? Math.max(...grounds) : Math.min(...grounds)
        if (b.shape === 'sphere' && !flat) return sphereBuilding(ring, b.h)
        const height = flat ? 0.05 : b.h - b.min
        const g = new THREE.ExtrudeGeometry(new THREE.Shape(ring), { depth: height, bevelEnabled: false })
        g.rotateX(-Math.PI / 2)
        g.translate(0, base + (flat ? 0.3 : b.min), 0)
        return g.index ? g.toNonIndexed() : g
      })
      if (!prisms.length) continue
      const merged = mergeGeometries(prisms)
      prisms.forEach((g) => g.dispose())
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: flat ? SCENERY.footprint : colour, roughness: 0.95 }))
      this.buildings.push(mesh)
      this.scenery.add(mesh)
    }
  }

  /** Ground height (scaled, m) at a point in track metres: the terrain grid where there is one, else 0. */
  private groundAt(x: number, y: number): number {
    const t = this.terrain
    if (!t) return 0
    const fx = Math.min(Math.max((x - t.origin[0]) / t.spacing, 0), t.cols - 1.001)
    const fy = Math.min(Math.max((y - t.origin[1]) / t.spacing, 0), t.rows - 1.001)
    const c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r
    const h = (rr: number, cc: number) => t.h[rr * t.cols + cc]
    const v = (h(r, c) * (1 - tx) + h(r, c + 1) * tx) * (1 - ty) + (h(r + 1, c) * (1 - tx) + h(r + 1, c + 1) * tx) * ty
    return v * HEIGHT_SCALE
  }

  /**
   * The ground as a mesh at its height, with parks, woods, sand, water and markings (the Mount Panorama sign) painted
   * onto a canvas texture over it, so they follow the hill exactly.
   */
  private terrainMesh(scenery: SceneryDefinition, t: NonNullable<SceneryDefinition['terrain']>) {
    const positions: number[] = []
    const uvs: number[] = []
    const index: number[] = []
    for (let r = 0; r < t.rows; r++) {
      for (let c = 0; c < t.cols; c++) {
        const p = this.toWorld({ x: t.origin[0] + c * t.spacing, y: t.origin[1] + r * t.spacing }, t.h[r * t.cols + c] * HEIGHT_SCALE - 0.3)
        positions.push(p.x, p.y, p.z)
        uvs.push(c / (t.cols - 1), r / (t.rows - 1))
        if (r < t.rows - 1 && c < t.cols - 1) {
          const a = r * t.cols + c
          index.push(a, a + 1, a + t.cols, a + 1, a + t.cols + 1, a + t.cols)
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    g.setIndex(index)
    g.computeVertexNormals()
    // The texture: about 1.5 m a pixel, so the sign's 20-30 m letters read.
    const spanX = (t.cols - 1) * t.spacing, spanY = (t.rows - 1) * t.spacing
    const scale = 2048 / Math.max(spanX, spanY)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(spanX * scale)
    canvas.height = Math.round(spanY * scale)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = css(SCENERY.ground)
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const paint = (areas: SceneryArea[], colour: string) => {
      ctx.fillStyle = colour
      for (const a of areas) {
        const path = new Path2D()
        for (const ring of [a.outer, ...a.holes]) {
          ring.forEach(([x, y], i) => {
            const px = (x - t.origin[0]) * scale, py = canvas.height - (y - t.origin[1]) * scale
            if (i) path.lineTo(px, py); else path.moveTo(px, py)
          })
          path.closePath()
        }
        ctx.fill(path, 'evenodd')
      }
    }
    paint(scenery.parks, css(SCENERY.park))
    paint(scenery.woods ?? [], css(SCENERY.wood))
    paint(scenery.beach, css(SCENERY.beach))
    paint(scenery.water, css(SCENERY.water))
    for (const m of scenery.markings ?? []) paint([m], m.colour)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }))
  }

  /** Trees as small cones (one instanced mesh), standing on the ground; heights from the scenery file (real metres). */
  private treeMesh(trees: [number, number, number][]) {
    const cone = new THREE.ConeGeometry(1, 1, 7)
    cone.translate(0, 0.5, 0) // base at 0
    const mesh = new THREE.InstancedMesh(cone, new THREE.MeshStandardMaterial({ color: SCENERY.tree, roughness: 1, flatShading: true }), trees.length)
    const m = new THREE.Matrix4()
    trees.forEach(([x, y, h], i) => {
      const p = this.toWorld({ x, y }, this.groundAt(x, y) - 0.5)
      m.makeScale(h * 0.32, h, h * 0.32).setPosition(p)
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
    return mesh
  }

  /** Moves every car to this frame's placement; cars that aren't placed are hidden. */
  setCars(placements: Placement[], tagged: Set<string>, ghostId: string | null = null, hoverIds: Set<string> = new Set()) {
    this.tagged = tagged
    for (const c of this.cars.values()) c.seen = false
    for (const pl of placements) {
      const c = this.car(pl.car)
      c.seen = true
      // Hovered: a white rim and a bigger dot (see tick); the pit rejoin car: a wider violet rim. Hover wins.
      const ghosted = pl.car.id === ghostId
      const hovered = hoverIds.has(pl.car.id)
      const rim = hovered ? this.hoverRimMaterial : ghosted ? this.ghostRimMaterial : this.rimMaterial
      if (c.rim.material !== rim) {
        c.rim.material = rim
        c.rim.scale.setScalar(hovered ? 1.3 : ghosted ? 1.45 : 1.18)
      }
      c.hovered = hovered
      c.tag.classList.toggle('ghosted', ghosted)
      c.tag.classList.toggle('hovered', hovered)
      c.group.visible = true
      if (c.body.transparent !== pl.dim) {
        c.body.transparent = pl.dim
        c.body.opacity = pl.dim ? 0.45 : 1
        c.body.needsUpdate = true
      }
      if (pl.kind === 'track') {
        // Beside the centreline on the starting grid (two-wide), else on it.
        const lateral = pl.lateral ?? 0
        c.group.position.copy(this.toWorld(this.model.pointBeside(pl.distance, lateral), this.heightAt(pl.distance) + 1.5))
        c.group.lookAt(this.toWorld(this.model.pointBeside(pl.distance + 6, lateral), this.heightAt(pl.distance + 6) + 1.5))
      } else {
        // Pit lane: at the height of the nearest bit of track, facing along the pit straight.
        const d = this.model.wrap(nearestDistance(this.model, pl.point))
        c.group.position.copy(this.toWorld(pl.point, this.heightAt(d) + 1.5))
        c.group.lookAt(this.toWorld(this.model.pointAt(d + 50), this.heightAt(d) + 1.5))
      }
    }
    for (const c of this.cars.values()) if (!c.seen) { c.group.visible = false; c.tag.style.display = 'none' }
  }

  dispose() {
    cancelAnimationFrame(this.frame)
    this.resize.disconnect()
    this.controls.dispose()
    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointermove', this.onPointerMove)
    canvas.removeEventListener('pointerleave', this.onPointerLeave)
    canvas.removeEventListener('dblclick', this.onDoubleClick)
    canvas.removeEventListener('pointerdown', this.onFocus)
    canvas.removeEventListener('keydown', this.onKeyDown)
    canvas.removeEventListener('keyup', this.onKeyUp)
    canvas.removeEventListener('blur', this.onBlur)
    disposeTree(this.scene)
    this.renderer.dispose()
    canvas.remove()
    this.overlay.remove()
  }

  // --- Animation loop -------------------------------------------------------------------------------------------

  private tick = () => {
    this.frame = requestAnimationFrame(this.tick)
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    if (this.mode === 'follow') this.updateChase(dt)
    else {
      if (this.mode === 'free') this.fly(dt)
      this.controls.update(dt)
    }
    if (this.ghostRing.visible) {
      // Sized like a car dot, and turned to face the camera so it always reads as a ring.
      this.ghostRing.scale.setScalar(Math.min(DOT_MAX, Math.max(DOT_MIN, this.ghostRing.position.distanceTo(this.camera.position) / DOT_PER_DISTANCE)))
      this.ghostRing.quaternion.copy(this.camera.quaternion)
    }
    for (const c of this.cars.values()) {
      if (c.group.visible) c.group.scale.setScalar(Math.min(DOT_MAX, Math.max(DOT_MIN, c.group.position.distanceTo(this.camera.position) / DOT_PER_DISTANCE)) * (c.hovered ? 1.3 : 1))
    }
    this.renderer.render(this.scene, this.camera)
    this.placeOverlay()
  }

  /**
   * Chase camera: behind and above the followed car. The camera stays locked to the car's position (at 10x replay
   * speed an eased position trailed it by hundreds of metres); only its heading is eased, so the view swings round
   * corners smoothly instead of snapping at each step of the path.
   */
  private updateChase(dt: number) {
    const car = this.followId ? this.cars.get(this.followId) : undefined
    if (!car?.group.visible) return
    const pos = car.group.position
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(car.group.quaternion)
    forward.y = 0
    forward.normalize()
    if (!this.heading) this.heading = forward.clone()
    this.heading.lerp(forward, 1 - Math.exp(-dt / 0.6)).normalize()
    this.camera.position.copy(pos).addScaledVector(this.heading, -170).add(new THREE.Vector3(0, 75, 0))
    this.camera.lookAt(pos.clone().addScaledVector(this.heading, 90))
  }

  /**
   * Free mode: WASD / arrows move across the map relative to the view, Q/E down and up, +/- zoom, Shift for 3x speed.
   * The camera and the point it looks at move together, so mouse drag (look around) and scroll (zoom) keep working.
   * Speed scales with the distance to that point: slow close up, quick across the whole circuit.
   */
  private fly(dt: number) {
    if (this.keys.size === 0) return
    const k = (...codes: string[]) => codes.some((c) => this.keys.has(c))
    const target = this.controls.target
    const offset = this.camera.position.clone().sub(target)
    const forward = offset.clone().negate().setY(0)
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1)
    forward.normalize()
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0))
    const speed = Math.max(30, offset.length() * 0.25) * (k('ShiftLeft', 'ShiftRight') ? 3 : 1) * dt
    const move = new THREE.Vector3()
    if (k('KeyW', 'ArrowUp')) move.add(forward)
    if (k('KeyS', 'ArrowDown')) move.sub(forward)
    if (k('KeyD', 'ArrowRight')) move.add(right)
    if (k('KeyA', 'ArrowLeft')) move.sub(right)
    if (k('KeyE')) move.y += 1
    if (k('KeyQ')) move.y -= 1
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed)
      // Keep the camera above the ground.
      if (this.camera.position.y + move.y < 10) move.y = Math.max(move.y, 10 - this.camera.position.y)
      this.camera.position.add(move)
      target.add(move)
    }
    // Zoom: move the camera towards or away from the point it looks at (within the scroll-zoom limits).
    const zoom = k('Equal', 'NumpadAdd') ? 1 : k('Minus', 'NumpadSubtract') ? -1 : 0
    if (zoom) {
      const distance = THREE.MathUtils.clamp(offset.length() * Math.exp(-zoom * 1.5 * dt), this.controls.minDistance, this.controls.maxDistance)
      this.camera.position.copy(target).add(offset.setLength(distance))
    }
  }

  private onFocus = () => this.renderer.domElement.focus({ preventScroll: true })
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.mode !== 'free' || e.ctrlKey || e.metaKey || e.altKey) return
    const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'ShiftLeft', 'ShiftRight', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']
    if (!codes.includes(e.code)) return
    e.preventDefault() // arrows and space would scroll the page
    this.keys.add(e.code)
  }
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code) }
  private onBlur = () => this.keys.clear()

  /** Corner names and car number tags follow their 3D points on screen. */
  private placeOverlay() {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    const v = new THREE.Vector3()
    const place = (el: HTMLElement, at: THREE.Vector3) => {
      v.copy(at).project(this.camera)
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1
      el.style.display = visible ? '' : 'none'
      if (visible) el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`
    }
    // Labels skip any spot a label before them has taken: the pit lane and corners first (in lap order), then landmarks
    // (best first). Estimated boxes of ~6 px a letter by 14 px, so no layout reads every frame. In a tight run of
    // corners some numbers hide, and come back when zoomed in.
    const taken: { x: number; y: number; w: number }[] = []
    // Battle labels first: during a race they matter more than corner names.
    this.battleSpans.forEach((sp, i) => {
      const el = this.pooled(this.battleLabels, i, 'm3d-label m3d-battle')
      el.textContent = sp.label
      // Out to the side, so it covers neither the battling cars nor the band.
      place(el, this.beside(sp.front, 90))
      if (el.style.display !== 'none') taken.push({ ...screenOf(el), w: sp.label.length * 6 + 12 })
    })
    for (let i = this.battleSpans.length; i < this.battleLabels.length; i++) this.battleLabels[i].style.display = 'none'
    if (this.ghostRing.visible) {
      place(this.ghostLabel, this.ghostRing.position.clone().add(new THREE.Vector3(0, this.ghostRing.scale.y * 2 + 6, 0)))
      if (this.ghostLabel.style.display !== 'none') taken.push({ ...screenOf(this.ghostLabel), w: (this.ghostLabel.textContent?.length ?? 0) * 6 + 12 })
    }
    // F1: "OT" beside each car in Overtake Mode range.
    const overtake = this.battleSpans.flatMap((sp) => sp.overtakeIds)
    overtake.forEach((id, i) => {
      const el = this.pooled(this.overtakeTags, i, 'm3d-ot')
      el.textContent = 'OT'
      el.title = 'Within 1 s of the car ahead: in Overtake Mode range (F1 decides it at a detection point)'
      const car = this.cars.get(id)
      if (!car?.group.visible) { el.style.display = 'none'; return }
      place(el, car.group.position.clone().add(new THREE.Vector3(0, car.group.scale.y * 2.4 + 4, 0)))
    })
    for (let i = overtake.length; i < this.overtakeTags.length; i++) this.overtakeTags[i].style.display = 'none'
    for (const l of [...this.labels, ...this.sceneryLabels]) {
      if ((l.corner && !this.showCorners) || (l.landmark && !this.showLandmarks)) { l.el.style.display = 'none'; continue }
      place(l.el, l.at)
      if (l.el.style.display === 'none') continue
      const box = { ...screenOf(l.el), w: l.el.textContent!.length * 6 + 8 }
      if (taken.some((t) => Math.abs(t.x - box.x) < (t.w + box.w) / 2 && Math.abs(t.y - box.y) < 15)) l.el.style.display = 'none'
      else taken.push(box)
    }
    for (const [id, c] of this.cars) {
      if (!c.group.visible || !this.tagged.has(id)) { c.tag.style.display = 'none'; continue }
      place(c.tag, c.group.position.clone().add(new THREE.Vector3(0, c.group.scale.y * 2.4 + 4, 0)))
    }
  }

  // --- Pointer: hover and double-click to pin, like the 2D map ---------------------------------------------------

  private carAt(e: PointerEvent | MouseEvent): string | null {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera)
    const hit = this.raycaster.intersectObjects(this.carGroup.children.filter((g) => g.visible), true)[0]
    let o: THREE.Object3D | null = hit?.object ?? null
    while (o && !o.userData.carId) o = o.parent
    return (o?.userData.carId as string | undefined) ?? null
  }

  private onPointerMove = (e: PointerEvent) => { if (e.pointerType === 'mouse') this.hover(this.carAt(e)) }
  private onPointerLeave = () => this.hover(null)
  private onDoubleClick = (e: MouseEvent) => {
    const id = this.carAt(e)
    const number = id ? (this.carGroup.children.find((g) => g.userData.carId === id)?.userData.carNumber as string) : null
    if (number) this.togglePin(number)
  }

  // --- Building the scene --------------------------------------------------------------------------------------

  private fit() {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /** Overview: far enough back that the whole track fits the panel, whatever its shape, looking down at ~40°. */
  private resetOrbit() {
    const vfov = (this.camera.fov * Math.PI) / 180
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect)
    const distance = (this.radius * 0.95) / Math.sin(Math.min(vfov, hfov) / 2)
    const top = Math.max(0, ...(this.model.def.elevation ?? [0])) * HEIGHT_SCALE
    this.controls.target.set(0, top / 3, 0)
    this.camera.position.set(0, top / 3, 0).add(new THREE.Vector3(0.45, 0.65, 0.6).normalize().multiplyScalar(distance))
    this.controls.update()
  }

  /** Height (m, already scaled) of the track at distance d. 0 without elevation data. */
  private heightAt(d: number): number {
    const e = this.model.def.elevation
    if (!e?.length) return 0
    const f = this.model.wrap(d) / this.model.def.step
    const i = Math.floor(f) % e.length
    const j = (i + 1) % e.length
    return (e[i] + (f - Math.floor(f)) * (e[j] - e[i])) * HEIGHT_SCALE
  }

  /** Where a corner label goes: `offset` m beside the track on its outside (away from the circuit's middle), 10 m up. */
  private beside(d: number, offset = 35) {
    const p = this.model.pointAt(d)
    const n = this.model.normalAt(d)
    const outward = (p.x - this.centre.x) * n.x + (p.y - this.centre.y) * n.y > 0 ? 1 : -1
    return this.toWorld({ x: p.x + n.x * offset * outward, y: p.y + n.y * offset * outward }, this.heightAt(d) + 10)
  }

  /** Track metres to a 2D shape point that becomes the world's x / -z after rotating the shape flat (rotateX -90°). */
  private flat(x: number, y: number) {
    return new THREE.Vector2(x - this.centre.x, y - this.centre.y)
  }

  private toWorld(p: Vec, height: number) {
    return new THREE.Vector3(p.x - this.centre.x, height, -(p.y - this.centre.y))
  }

  /** World position on the centreline at distance d, `lift` metres above the track. */
  private at(d: number, lift = 0) {
    return this.toWorld(this.model.pointAt(d), this.heightAt(d) + lift)
  }

  /** Samples along the lap with the left (+1) or right (-1) edge offset. */
  private edgePoint(k: number, side: number, lift = 0.4) {
    const d = k * this.model.def.step
    const p = this.model.pointAt(d)
    const n = this.model.normalAt(d)
    return this.toWorld({ x: p.x + n.x * side * TRACK_WIDTH / 2, y: p.y + n.y * side * TRACK_WIDTH / 2 }, this.heightAt(d) + lift)
  }

  private edgeGeometry(side: number) {
    return new THREE.BufferGeometry().setFromPoints(this.model.def.path.map((_, k) => this.edgePoint(k, side, 0.6)))
  }

  private ribbon() {
    const n = this.model.def.path.length
    const positions: number[] = []
    const index: number[] = []
    for (let k = 0; k < n; k++) {
      for (const side of [1, -1]) { const p = this.edgePoint(k, side); positions.push(p.x, p.y, p.z) }
      const a = k * 2
      const b = ((k + 1) % n) * 2
      index.push(a, a + 1, b, b, a + 1, b + 1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setIndex(index)
    g.computeVertexNormals()
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: TRACK, roughness: 0.9, side: THREE.DoubleSide }))
  }

  /** A see-through wall from the track down to the ground: shows how high each part of the lap is. */
  private curtain() {
    const n = this.model.def.path.length
    const positions: number[] = []
    const colours: number[] = []
    const index: number[] = []
    const top = new THREE.Color(0x3a4653)
    const bottom = new THREE.Color(BG)
    for (let k = 0; k < n; k++) {
      const p = this.at(k * this.model.def.step)
      positions.push(p.x, p.y, p.z, p.x, 0, p.z)
      colours.push(top.r, top.g, top.b, bottom.r, bottom.g, bottom.b)
      const a = k * 2
      const b = ((k + 1) % n) * 2
      index.push(a, a + 1, b, b, a + 1, b + 1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
    g.setIndex(index)
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }))
  }

  private ground() {
    const size = this.radius * 8
    const group = new THREE.Group()
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color: 0x151a20 }))
    plane.rotation.x = -Math.PI / 2
    plane.position.y = -0.5
    group.add(plane)
    this.groundPlane = plane
    // 200 m grid: gives a sense of scale and depth.
    const grid = new THREE.GridHelper(size, Math.round(size / 200), 0x222a33, 0x1c232b)
    grid.position.y = -0.3
    group.add(grid)
    this.grid = grid
    return group
  }

  /** The pit lane: a narrower road beside the track, edged like it, with a "Pit lane" label at its middle. */
  private pitLane() {
    const pit = this.model.def.pitLane
    const at = (i: number) => {
      const [x, y] = pit[Math.max(0, Math.min(pit.length - 1, i))]
      return { x, y }
    }
    const height = (p: Vec) => this.heightAt(nearestDistance(this.model, p)) + 0.3
    const positions: number[] = []
    const index: number[] = []
    const edges: [THREE.Vector3[], THREE.Vector3[]] = [[], []]
    pit.forEach((_, i) => {
      // Direction from the neighbouring points; the edges sit half the pit lane's width either side.
      const a = at(i - 1), b = at(i + 1), p = at(i)
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
      ;[1, -1].forEach((side, k) => {
        const q = this.toWorld({ x: p.x + n.x * side * PIT_WIDTH / 2, y: p.y + n.y * side * PIT_WIDTH / 2 }, height(p))
        positions.push(q.x, q.y, q.z)
        edges[k].push(q.clone().setY(q.y + 0.2))
      })
      if (i < pit.length - 1) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setIndex(index)
    g.computeVertexNormals()
    const group = new THREE.Group()
    group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x252c34, roughness: 0.9, side: THREE.DoubleSide })))
    for (const e of edges) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(e), new THREE.LineBasicMaterial({ color: 0x4a5461 })))
    // Label halfway along the pit lane by distance (OSM points are unevenly spaced: bends have many, straights few).
    const cum = [0]
    for (let i = 1; i < pit.length; i++) cum.push(cum[i - 1] + Math.hypot(pit[i][0] - pit[i - 1][0], pit[i][1] - pit[i - 1][1]))
    const half = cum[cum.length - 1] / 2
    const k = Math.max(1, cum.findIndex((c) => c >= half))
    const f = (half - cum[k - 1]) / (cum[k] - cum[k - 1] || 1)
    const mid = { x: pit[k - 1][0] + f * (pit[k][0] - pit[k - 1][0]), y: pit[k - 1][1] + f * (pit[k][1] - pit[k - 1][1]) }
    const el = document.createElement('span')
    el.className = 'm3d-label m3d-pit'
    el.textContent = 'Pit lane'
    this.overlay.appendChild(el)
    this.labels.push({ el, at: this.toWorld(mid, height(mid) + 20) })
    return group
  }

  private controlLine() {
    const a = this.edgePoint(0, 1, 0.8)
    const b = this.edgePoint(0, -1, 0.8)
    const mid = a.clone().add(b).multiplyScalar(0.5)
    const bar = new THREE.Mesh(new THREE.BoxGeometry(a.distanceTo(b), 1, 3), new THREE.MeshBasicMaterial({ color: 0xffffff }))
    bar.position.copy(mid)
    bar.lookAt(this.at(5, 0.8)) // the box's x (its length) now runs across the track
    return bar
  }

  /**
   * A car: a flat-coloured dot with a dark rim, like the 2D map. Unit radius, resting on the track (the group is
   * scaled to the dot size each frame). The group still turns to face along the track: the Follow camera reads the
   * car's direction from it.
   */
  private car(row: CarRow) {
    const existing = this.cars.get(row.id)
    if (existing) return existing
    const colour = row.teamColour ? parseInt(row.teamColour, 16) : MAKER_COLOURS[row.manufacturer.toLowerCase()] ?? 0x5a6573
    // Dots are drawn over everything (depthTest off, last): a car behind a tower is still where you can see it.
    const body = new THREE.MeshBasicMaterial({ color: colour, depthTest: false })
    const group = new THREE.Group()
    const dot = new THREE.Mesh(this.dotGeometry, body)
    dot.position.y = 1
    const rim = new THREE.Mesh(this.dotGeometry, this.rimMaterial)
    rim.position.y = 1
    rim.scale.setScalar(1.18)
    rim.renderOrder = 10
    dot.renderOrder = 11
    group.add(rim, dot)
    group.userData = { carId: row.id, carNumber: row.carNumber }
    this.carGroup.add(group)
    const tag = document.createElement('span')
    tag.className = 'm3d-tag'
    tag.textContent = row.carNumber
    tag.style.borderColor = `#${colour.toString(16).padStart(6, '0')}`
    this.overlay.appendChild(tag)
    const entry = { group, body, rim, tag, seen: true, hovered: false }
    this.cars.set(row.id, entry)
    return entry
  }
}

/**
 * A spherical building (Las Vegas's Sphere): a sphere as wide as its footprint, its top at `height`, the rest sunk
 * into the ground like the real one (157 m across, 112 m tall). Non-indexed to merge with the extruded buildings.
 */
function sphereBuilding(ring: THREE.Vector2[], height: number): THREE.BufferGeometry {
  const cx = ring.reduce((a, p) => a + p.x, 0) / ring.length
  const cy = ring.reduce((a, p) => a + p.y, 0) / ring.length
  const radius = ring.reduce((a, p) => a + Math.hypot(p.x - cx, p.y - cy), 0) / ring.length
  const g = new THREE.SphereGeometry(radius, 48, 32).toNonIndexed()
  // Shape coordinates (x, y) become world (x, -z), as for the extruded buildings after their rotateX.
  g.translate(cx, height - radius, -cy)
  return g
}

/** A three.js colour number as a CSS colour, for the canvas. */
function css(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`
}

/** A label's screen position, from the transform placeOverlay gave it. */
function screenOf(el: HTMLElement): { x: number; y: number } {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform)
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: -1e9, y: -1e9 }
}

/** Frees the GPU memory of every mesh and line under `root`. */
function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      o.geometry.dispose()
      const m = o.material as THREE.Material | THREE.Material[]
      for (const mat of Array.isArray(m) ? m : [m]) mat.dispose()
    }
  })
}

/** Distance along the lap of the centreline sample closest to p (to the nearest step). */
function nearestDistance(model: TrackModel, p: Vec): number {
  const path = model.def.path
  let best = 0
  let bestD = Infinity
  for (let k = 0; k < path.length; k++) {
    const d = (path[k][0] - p.x) ** 2 + (path[k][1] - p.y) ** 2
    if (d < bestD) { bestD = d; best = k }
  }
  return best * model.def.step
}
