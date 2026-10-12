import { lazy, Suspense, type ComponentProps } from 'react'
import { TrackMap } from './TrackMap'
import { isRace } from '../session'
import { isF1 } from '../series'
import type { Settings } from '../settings'

// three.js is large (~0.5 MB): only fetched when a viewer switches to 3D.
const TrackMap3D = lazy(() => import('./TrackMap3D'))

type View = '2d' | 'static' | 'orbit' | 'follow' | 'free'
const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: '2d', label: '2D', hint: 'Flat map: rotate, zoom and pan' },
  { id: 'static', label: '3D', hint: 'The track in 3D, standing still: drag to turn, scroll or pinch to zoom' },
  { id: 'orbit', label: 'Orbit', hint: 'Turns slowly around the track (drag to turn)' },
  { id: 'follow', label: 'Follow', hint: 'Chase one car' },
  { id: 'free', label: 'Free', hint: 'Fly around: WASD or arrow keys to move, Q/E down and up, Shift for faster, +/− or scroll to zoom, drag to look' },
]

/**
 * The track map in the viewer's chosen view: 2D (TrackMap), or the 3D map (TrackMap3D, the default) standing still,
 * orbiting or following a car. Both place cars with the same code (map/useCarPlacement.ts). Remembered in settings.
 */
export function MapView({ settings, onSettings, ...props }: ComponentProps<typeof TrackMap> & {
  settings: Pick<Settings, 'mapView' | 'camera3d' | 'followCar' | 'flatBuildings' | 'cornerLabels' | 'showBattles' | 'showLandmarks'>
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
  const corners = (
    <button type="button" className={`wide${settings.cornerLabels ? ' active' : ''}`} aria-pressed={settings.cornerLabels}
      onClick={() => onSettings({ cornerLabels: !settings.cornerLabels })} title={settings.cornerLabels ? 'Hide corner names and numbers' : 'Show corner names and numbers'}>Corners</button>
  )
  // Battles button: races only (there are no battles in practice or qualifying).
  const battlesButton = isRace(props.update.timing.session.type) && (
    <button type="button" className={`wide${settings.showBattles ? ' active' : ''}`} aria-pressed={settings.showBattles}
      onClick={() => onSettings({ showBattles: !settings.showBattles })}
      title={isF1 ? 'Highlight cars within a second of the car ahead (OT: in Overtake Mode range)' : 'Highlight cars within a second of the car ahead'}>Battles</button>
  )
  const showBattles = settings.showBattles && isRace(props.update.timing.session.type)
  if (view === '2d') return <TrackMap {...props} extraTools={<>{views}{corners}{battlesButton}</>} showLabels={settings.cornerLabels} showBattles={showBattles} />
  return (
    <Suspense fallback={<div className="track-map"><div className="map-missing">Loading the 3D map…</div></div>}>
      <TrackMap3D track={props.track} update={props.update} live={props.live} hoverId={props.hoverId} highlightIds={props.highlightIds}
        pinned={props.pinned} camera={view} followCar={settings.followCar} views={views}
        cornerLabels={settings.cornerLabels} cornersButton={<>{corners}{battlesButton}</>} showBattles={showBattles}
        flatBuildings={settings.flatBuildings} onFlatBuildings={(flatBuildings) => onSettings({ flatBuildings })}
        showLandmarks={settings.showLandmarks} onShowLandmarks={(showLandmarks) => onSettings({ showLandmarks })}
        onFollowCar={(followCar) => onSettings({ followCar })}
        onHover={props.onHover} onTogglePin={props.onTogglePin} note={props.note} />
    </Suspense>
  )
}
