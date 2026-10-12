import { lazy, Suspense, type ComponentProps } from 'react'
import { TrackMap } from './TrackMap'
import type { Settings } from '../settings'

// three.js is large (~0.5 MB): only fetched when a viewer switches to 3D.
const TrackMap3D = lazy(() => import('./TrackMap3D'))

/**
 * The track map in the viewer's chosen mode: the flat map (TrackMap) or the 3D map (TrackMap3D). Both place cars
 * with the same code (map/useCarPlacement.ts). The choice and the 3D camera are remembered in settings.
 */
export function MapView({ settings, onSettings, ...props }: ComponentProps<typeof TrackMap> & {
  settings: Pick<Settings, 'mapMode' | 'mapCamera' | 'followCar'>
  onSettings: (change: Partial<Settings>) => void
}) {
  const is3d = settings.mapMode === '3d'
  const modeSwitch = (
    <button type="button" className="wide" onClick={() => onSettings({ mapMode: is3d ? '2d' : '3d' })}
      title={is3d ? 'Back to the flat map' : '3D map with the hills (drag to turn)'}>{is3d ? '2D' : '3D'}</button>
  )
  if (!is3d) return <TrackMap {...props} extraTools={modeSwitch} />
  return (
    <Suspense fallback={<div className="track-map"><div className="map-missing">Loading the 3D map…</div></div>}>
      <TrackMap3D track={props.track} update={props.update} live={props.live} hoverId={props.hoverId} highlightIds={props.highlightIds}
        pinned={props.pinned} camera={settings.mapCamera} followCar={settings.followCar} modeSwitch={modeSwitch}
        onCamera={(mapCamera, followCar) => onSettings({ mapCamera, followCar })}
        onHover={props.onHover} onTogglePin={props.onTogglePin} />
    </Suspense>
  )
}
