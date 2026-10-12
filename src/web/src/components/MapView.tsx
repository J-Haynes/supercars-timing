import { lazy, Suspense, type ComponentProps } from 'react'
import { TrackMap } from './TrackMap'
import type { Settings } from '../settings'

// three.js is large (~0.5 MB): only fetched when a viewer switches to 3D.
const TrackMap3D = lazy(() => import('./TrackMap3D'))

type View = '2d' | 'static' | 'orbit' | 'follow'
const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: '2d', label: '2D', hint: 'Flat map: rotate, zoom and pan' },
  { id: 'static', label: '3D', hint: 'The track in 3D, standing still: drag to turn, scroll or pinch to zoom' },
  { id: 'orbit', label: 'Orbit', hint: 'Turns slowly around the track (drag to turn)' },
  { id: 'follow', label: 'Follow', hint: 'Chase one car' },
]

/**
 * The track map in the viewer's chosen view: 2D (TrackMap), or the 3D map (TrackMap3D, the default) standing still,
 * orbiting or following a car. Both place cars with the same code (map/useCarPlacement.ts). Remembered in settings.
 */
export function MapView({ settings, onSettings, ...props }: ComponentProps<typeof TrackMap> & {
  settings: Pick<Settings, 'mapView' | 'camera3d' | 'followCar' | 'flatBuildings'>
  onSettings: (change: Partial<Settings>) => void
}) {
  const view: View = settings.mapView === '2d' ? '2d' : settings.camera3d
  const pick = (v: View) => onSettings(v === '2d' ? { mapView: '2d' } : { mapView: '3d', camera3d: v })
  const views = (
    <div className="segmented small map-views" role="radiogroup" aria-label="Map view">
      {VIEWS.map((v) => (
        <button key={v.id} type="button" role="radio" aria-checked={view === v.id} className={view === v.id ? 'active' : ''}
          title={v.hint} onClick={() => pick(v.id)}>{v.label}</button>
      ))}
    </div>
  )
  if (view === '2d') return <TrackMap {...props} extraTools={views} />
  return (
    <Suspense fallback={<div className="track-map"><div className="map-missing">Loading the 3D map…</div></div>}>
      <TrackMap3D track={props.track} update={props.update} live={props.live} hoverId={props.hoverId} highlightIds={props.highlightIds}
        pinned={props.pinned} camera={view} followCar={settings.followCar} views={views}
        flatBuildings={settings.flatBuildings} onFlatBuildings={(flatBuildings) => onSettings({ flatBuildings })}
        onFollowCar={(followCar) => onSettings({ followCar })}
        onHover={props.onHover} onTogglePin={props.onTogglePin} note={props.note} />
    </Suspense>
  )
}
