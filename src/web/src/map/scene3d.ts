import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { SceneryArea, SceneryDefinition } from '../tracks/types'
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
const BG = 0x12161b // --panel
const MAKER_COLOURS: Record<string, number> = { ford: 0x2f6fdf, chevrolet: 0xf28c1b, toyota: 0xe5172f }
const EDGE = 0x5d6976
/** Scenery colours: muted, so the track and the cars stay the brightest things on screen. */
const SCENERY = { park: 0x1d3325, beach: 0x6e6248, water: 0x17324d, building: 0x3a4450, footprint: 0x4a5461 }
const YELLOW = 0xffd23f

export type CameraMode = 'static' | 'orbit' | 'follow'

export class TrackScene {
  readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 5, 40000)
  private readonly controls: OrbitControls
  private readonly overlay: HTMLDivElement
  private readonly cars = new Map<string, { group: THREE.Group; body: THREE.MeshBasicMaterial; tag: HTMLSpanElement; seen: boolean }>()
  private readonly carGroup = new THREE.Group()
  private readonly dotGeometry = new THREE.SphereGeometry(1, 20, 14)
  /** Drawn inside out, slightly bigger than the dot: a dark outline from any angle. */
  private readonly rimMaterial = new THREE.MeshBasicMaterial({ color: 0x0b0d10, side: THREE.BackSide })
  private readonly edges: THREE.LineBasicMaterial
  private readonly labels: { el: HTMLSpanElement; at: THREE.Vector3 }[] = []
  private readonly resize: ResizeObserver
  private readonly raycaster = new THREE.Raycaster()
  private readonly centre: Vec
  private readonly radius: number
  private frame = 0
  private grid: THREE.GridHelper | null = null
  private scenery: THREE.Group | null = null
  private buildings: THREE.Mesh | null = null
  private flatBuildings = false
  private last = performance.now()
  private mode: CameraMode = 'static'
  private followId: string | null = null
  /** Eased direction of the chase camera (flat, unit length). */
  private heading: THREE.Vector3 | null = null
  private tagged = new Set<string>()
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
    this.scene.add(this.ribbon())
    if (def.elevation?.length) this.scene.add(this.curtain())
    this.edges = new THREE.LineBasicMaterial({ color: EDGE })
    for (const side of [1, -1]) this.scene.add(new THREE.LineLoop(this.edgeGeometry(side), this.edges))
    if (def.pitLane.length > 1) this.scene.add(this.pitLane())
    this.scene.add(this.controlLine())
    this.scene.add(this.carGroup)
    for (const l of def.labels.filter((l) => !/line$|^pit straight$/i.test(l.name))) {
      const el = document.createElement('span')
      el.className = 'm3d-label'
      el.textContent = l.name
      this.overlay.appendChild(el)
      this.labels.push({ el, at: this.at(l.distance, 25) })
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
    this.resize = new ResizeObserver(() => this.fit())
    this.resize.observe(host)
    this.fit()
    this.resetOrbit()
    this.frame = requestAnimationFrame(this.tick)
  }

  setCamera(mode: CameraMode, followId: string | null) {
    // Back from Follow: the overview again. Between 3D and Orbit the view stays where it is.
    if (mode !== 'follow' && this.mode === 'follow') this.resetOrbit()
    if (mode === 'follow' && (this.mode !== 'follow' || followId !== this.followId)) this.heading = null
    this.mode = mode
    this.followId = followId
    this.controls.enabled = mode !== 'follow'
    this.controls.autoRotate = mode === 'orbit'
  }

  setCaution(caution: boolean) {
    this.edges.color.setHex(caution ? YELLOW : EDGE)
  }

  /**
   * Buildings, water, beaches and parks around the track (tracks/scenery/<CODE>.json). The flat layers don't write
   * depth and are drawn in a fixed order (parks, beach, water), so the thin gaps between them never flicker; the
   * track and buildings still draw over them. The grid is hidden: the scenery gives the sense of scale.
   */
  setScenery(scenery: SceneryDefinition | null) {
    if (this.scenery) {
      this.buildings = null
      this.scene.remove(this.scenery)
      disposeTree(this.scenery)
      this.scenery = null
    }
    if (this.grid) this.grid.visible = !scenery
    if (!scenery) return
    const group = new THREE.Group()
    const layers: [SceneryArea[], number, number][] = [[scenery.parks, SCENERY.park, 1], [scenery.beach, SCENERY.beach, 2], [scenery.water, SCENERY.water, 3]]
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
    // Buildings: one extruded prism each, merged into a single mesh (2,000 separate meshes would be slow).
    const prisms = scenery.buildings.filter((b) => b.ring.length > 2).map((b) => {
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(b.ring.map(([x, y]) => this.flat(x, y))), { depth: b.h - b.min, bevelEnabled: false })
      g.rotateX(-Math.PI / 2)
      g.translate(0, b.min, 0)
      return g
    })
    if (prisms.length) {
      const merged = mergeGeometries(prisms)
      prisms.forEach((g) => g.dispose())
      if (merged) {
        this.buildings = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: SCENERY.building, roughness: 0.95 }))
        group.add(this.buildings)
        this.setFlatBuildings(this.flatBuildings)
      }
    }
    this.scenery = group
    this.scene.add(group)
  }

  /**
   * Buildings as flat grey footprints (squashed to a few cm, just above the ground layers and under the track) or as
   * blocks at their height. Flat ones are a lighter grey, as they're seen from above.
   */
  setFlatBuildings(flat: boolean) {
    this.flatBuildings = flat
    if (!this.buildings) return
    this.buildings.scale.y = flat ? 0.0005 : 1 // a 130 m tower becomes 6.5 cm
    this.buildings.position.y = flat ? -0.1 : 0
    ;(this.buildings.material as THREE.MeshStandardMaterial).color.setHex(flat ? SCENERY.footprint : SCENERY.building)
  }

  /** Moves every car to this frame's placement; cars that aren't placed are hidden. */
  setCars(placements: Placement[], tagged: Set<string>) {
    this.tagged = tagged
    for (const c of this.cars.values()) c.seen = false
    for (const pl of placements) {
      const c = this.car(pl.car)
      c.seen = true
      c.group.visible = true
      if (c.body.transparent !== pl.dim) {
        c.body.transparent = pl.dim
        c.body.opacity = pl.dim ? 0.45 : 1
        c.body.needsUpdate = true
      }
      if (pl.kind === 'track') {
        c.group.position.copy(this.at(pl.distance, 1.5))
        c.group.lookAt(this.at(pl.distance + 6, 1.5))
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
    else this.controls.update(dt)
    for (const c of this.cars.values()) {
      if (c.group.visible) c.group.scale.setScalar(Math.min(DOT_MAX, Math.max(DOT_MIN, c.group.position.distanceTo(this.camera.position) / DOT_PER_DISTANCE)))
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
    for (const l of this.labels) place(l.el, l.at)
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
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2b333c, roughness: 0.9, side: THREE.DoubleSide }))
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
    const body = new THREE.MeshBasicMaterial({ color: colour })
    const group = new THREE.Group()
    const dot = new THREE.Mesh(this.dotGeometry, body)
    dot.position.y = 1
    const rim = new THREE.Mesh(this.dotGeometry, this.rimMaterial)
    rim.position.y = 1
    rim.scale.setScalar(1.18)
    group.add(rim, dot)
    group.userData = { carId: row.id, carNumber: row.carNumber }
    this.carGroup.add(group)
    const tag = document.createElement('span')
    tag.className = 'm3d-tag'
    tag.textContent = row.carNumber
    tag.style.borderColor = `#${colour.toString(16).padStart(6, '0')}`
    this.overlay.appendChild(tag)
    const entry = { group, body, tag, seen: true }
    this.cars.set(row.id, entry)
    return entry
  }
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
