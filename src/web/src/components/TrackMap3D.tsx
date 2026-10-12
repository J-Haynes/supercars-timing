import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TimingUpdate } from '../types'
import type { TrackDefinition } from '../tracks/types'
import { useScenery } from '../tracks'
import { TrackModel } from '../map/trackModel'
import { useCarPlacement } from '../map/useCarPlacement'
import { HEIGHT_SCALE, TrackScene, type CameraMode } from '../map/scene3d'
import { ElevationStrip, type StripCar } from './ElevationStrip'

/**
 * The 3D map: the same car placements as the 2D map (useCarPlacement), drawn by map/scene3d.ts. Loaded lazily by
 * MapView, so three.js is only downloaded by viewers who switch to 3D.
 *
 * Cameras: Orbit turns slowly around the track (drag to turn, scroll or pinch to zoom); Follow chases one car
 * (the leader unless the viewer picks another).
 */
export default function TrackMap3D({ track, update, live, hoverId, highlightIds = [], pinned, camera, followCar, modeSwitch, onCamera, onHover, onTogglePin, note }: {
  track: TrackDefinition
  update: TimingUpdate
  live?: TimingUpdate | null
  hoverId: string | null
  highlightIds?: string[]
  pinned: string[]
  camera: CameraMode
  /** Car number to follow; null = the leader. */
  followCar: string | null
  /** The 2D/3D switch (MapView), shown first in the toolbar. */
  modeSwitch: ReactNode
  onCamera: (camera: CameraMode, followCar: string | null) => void
  onHover: (id: string | null) => void
  onTogglePin: (carNumber: string) => void
  /** Replaces the "learning timing points" overlay, e.g. on an upcoming event's page. */
  note?: string
}) {
  const { placements, sync, awaitingCalibration, flagNow } = useCarPlacement(track, update, live)
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
  })

  const stripCars: StripCar[] = placements.flatMap((pl) => (pl.kind === 'track' ? [{ car: pl.car, distance: pl.distance, dim: pl.dim }] : []))
  const byPosition = [...cars].filter((c) => !c.retired).sort((a, b) => (a.position || 99) - (b.position || 99))

  return (
    <div className={`track-map map3d${!awaitingCalibration && !sync.synced ? ' syncing' : ''}`}>
      <div className="map-tools" role="toolbar" aria-label="Map view">
        {modeSwitch}
        <button type="button" className={`wide${camera === 'orbit' ? ' active' : ''}`} aria-pressed={camera === 'orbit'}
          onClick={() => onCamera('orbit', followCar)} title="Turn slowly around the track. Drag to turn, scroll or pinch to zoom.">Orbit</button>
        <button type="button" className={`wide${camera === 'follow' ? ' active' : ''}`} aria-pressed={camera === 'follow'}
          onClick={() => onCamera('follow', followCar)} title="Chase one car">Follow</button>
        {camera === 'follow' && (
          <select value={followCar ?? ''} onChange={(e) => onCamera('follow', e.target.value || null)} aria-label="Car to follow">
            <option value="">Leader</option>
            {byPosition.map((c) => <option key={c.id} value={c.carNumber}>P{c.position} #{c.carNumber} {c.driver}</option>)}
          </select>
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
        {camera === 'orbit' ? ' · drag to turn, scroll or pinch to zoom' : ` · following ${followed ? `#${followed.carNumber} ${followed.driver}` : 'the leader'}`}
        {' · '}double-click a car to pin it · {track.source.attribution}{scenery ? ` · ${scenery.attribution}` : ''}
      </div>
    </div>
  )
}
