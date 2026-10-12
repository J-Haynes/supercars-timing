import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TimingUpdate } from '../types'
import type { TrackDefinition } from '../tracks/types'
import { useScenery } from '../tracks'
import { TrackModel } from '../map/trackModel'
import { useCarPlacement } from '../map/useCarPlacement'
import { HEIGHT_SCALE, TrackScene, type CameraMode } from '../map/scene3d'
import { ElevationStrip, type StripCar } from './ElevationStrip'
import { battles, battleSpans } from '../battles'

/**
 * The 3D map: the same car placements as the 2D map (useCarPlacement), drawn by map/scene3d.ts. Loaded lazily by
 * MapView, so three.js is only downloaded by viewers who switch to 3D.
 *
 * Cameras: Orbit turns slowly around the track (drag to turn, scroll or pinch to zoom); Follow chases one car
 * (the leader unless the viewer picks another).
 */
export default function TrackMap3D({ track, update, live, hoverId, highlightIds = [], pinned, camera, followCar, views, cornerLabels, cornersButton, showBattles, flatBuildings, onFlatBuildings, onFollowCar, onHover, onTogglePin, note }: {
  track: TrackDefinition
  update: TimingUpdate
  live?: TimingUpdate | null
  hoverId: string | null
  highlightIds?: string[]
  pinned: string[]
  camera: CameraMode
  /** Car number to follow; null = the leader. */
  followCar: string | null
  /** The view switch (MapView: 2D, 3D, Orbit, Follow), shown first in the toolbar. */
  views: ReactNode
  /** Corner names and numbers shown; and the button that switches them (MapView). */
  cornerLabels: boolean
  cornersButton: ReactNode
  /** Highlight battles (races, the Battles button). */
  showBattles: boolean
  /** Buildings as flat footprints (tracks with scenery). */
  flatBuildings: boolean
  onFlatBuildings: (flat: boolean) => void
  onFollowCar: (carNumber: string | null) => void
  onHover: (id: string | null) => void
  onTogglePin: (carNumber: string) => void
  /** Replaces the "learning timing points" overlay, e.g. on an upcoming event's page. */
  note?: string
}) {
  const { placements, sync, awaitingCalibration, flagNow, model } = useCarPlacement(track, update, live)
  // Battles from the timing (when it changes); placed on the track every frame below, so the bands follow the cars.
  const battleList = useMemo(() => (showBattles ? battles(update.timing) : []), [showBattles, update.timing])
  const cars = update.timing.cars
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<TrackScene | null>(null)
  const [failed, setFailed] = useState(false)
  const geometry = useMemo(() => new TrackModel(track), [track])

  useEffect(() => {
    if (!host.current) return
    try {
      scene.current = new TrackScene(host.current, geometry)
    } catch (e) {
      console.error('3D map unavailable', e)
      setFailed(true)
      return
    }
    return () => { scene.current?.dispose(); scene.current = null }
  }, [geometry])

  // Buildings, water and beaches, for tracks that have them (TrackBuilder --scenery).
  const scenery = useScenery(track.code)
  useEffect(() => { scene.current?.setScenery(scenery) }, [scenery, geometry])
  useEffect(() => { scene.current?.setFlatBuildings(flatBuildings) }, [flatBuildings, scenery, geometry])
  useEffect(() => { scene.current?.setCornerLabels(cornerLabels) }, [cornerLabels, geometry])

  const leader = cars.find((c) => c.position === 1)
  const followed = (followCar && cars.find((c) => c.carNumber === followCar)) || leader
  useEffect(() => { scene.current?.setCamera(camera, followed?.id ?? null) }, [camera, followed?.id])

  // Number tags: the leader, the followed car, pinned, hovered and highlighted cars.
  const tagged = new Set([leader?.id, followed?.id, hoverId, ...highlightIds, ...cars.filter((c) => pinned.includes(c.carNumber)).map((c) => c.id)]
    .filter((id): id is string => !!id))
  // Every frame (the session clock re-renders this component): move the cars.
  useEffect(() => {
    const s = scene.current
    if (!s) return
    s.hover = onHover
    s.togglePin = onTogglePin
    s.setCaution(flagNow === 'caution')
    s.setCars(placements, tagged)
    const distanceOf = new Map(placements.flatMap((p) => (p.kind === 'track' ? [[p.car.id, p.distance] as const] : [])))
    s.setBattles(battleSpans(battleList, distanceOf, model.length))
  })

  const stripCars: StripCar[] = placements.flatMap((pl) => (pl.kind === 'track' ? [{ car: pl.car, distance: pl.distance, dim: pl.dim }] : []))
  const byPosition = [...cars].filter((c) => !c.retired).sort((a, b) => (a.position || 99) - (b.position || 99))

  return (
    <div className={`track-map map3d${!awaitingCalibration && !sync.synced ? ' syncing' : ''}`}>
      <div className="map-tools" role="toolbar" aria-label="Map view">
        {views}
        {camera === 'follow' && (
          <select value={followCar ?? ''} onChange={(e) => onFollowCar(e.target.value || null)} aria-label="Car to follow">
            <option value="">Leader</option>
            {byPosition.map((c) => <option key={c.id} value={c.carNumber}>P{c.position} #{c.carNumber} {c.driver}</option>)}
          </select>
        )}
        {(track.labels.length > 0 || (scenery?.corners?.length ?? 0) > 0) && cornersButton}
        {scenery && scenery.buildings.length > 0 && (
          <button type="button" className={`wide${flatBuildings ? '' : ' active'}`} aria-pressed={!flatBuildings}
            onClick={() => onFlatBuildings(!flatBuildings)} title={flatBuildings ? 'Show buildings at their height' : 'Flatten buildings to their footprints'}>Buildings</button>
        )}
      </div>
      <div ref={host} className="m3d-host">
        {failed && <div className="map-overlay">The 3D map needs WebGL, which this browser has turned off. Switch back to 2D.</div>}
      </div>
      {track.elevation && track.elevation.length > 0 && (
        <ElevationStrip track={track} elevation={track.elevation} cars={stripCars} caution={flagNow === 'caution'}
          hoverId={hoverId} pinned={pinned} onHover={onHover} />
      )}
      {!awaitingCalibration && !sync.synced && (
        <div className="map-sync" role="status">
          <span className="map-sync-dot" aria-hidden />
          Syncing car positions · {sync.updated}/{sync.total} cars
        </div>
      )}
      {awaitingCalibration && (
        <div className={`map-overlay${note ? ' map-note' : ''}`}>{note ?? 'Learning where the timing points are from live pace. Cars appear after a lap or two.'}</div>
      )}
      <div className="map-caption">
        {track.name} · 3D · positions estimated between timing points
        {track.elevation?.length ? ` · heights ×${HEIGHT_SCALE}` : ' · no height data for this track'}
        {camera === 'free' ? ' · click the map, then WASD or arrows to move, Q/E down/up, Shift faster, +/− or scroll to zoom, drag to look'
          : camera !== 'follow' ? ' · drag to turn, scroll or pinch to zoom' : ` · following ${followed ? `#${followed.carNumber} ${followed.driver}` : 'the leader'}`}
        {' · '}double-click a car to pin it · {track.source.attribution}{scenery ? ` · ${scenery.attribution}` : ''}
      </div>
    </div>
  )
}
