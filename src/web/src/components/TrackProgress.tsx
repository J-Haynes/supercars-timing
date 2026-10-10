import type { TimingPoint } from '../types'

/**
 * Lap progress from the last timing point passed: M (control line) then each TP in order.
 * A stand-in for the interpolated track map.
 */
export function TrackProgress({ lastPoint, points }: { lastPoint: string; points: TimingPoint[] }) {
  const ids = ['M', ...points.map((p) => p.id)]
  const index = ids.indexOf(lastPoint)
  const names = ['Line', ...points.map((p) => p.name)]
  return (
    <div className="progress" title={index >= 0 ? `Last point: ${names[index]}` : 'No timing point yet'}>
      {ids.map((id, i) => (
        <span key={id} className={i === index ? 'seg current' : i < index ? 'seg passed' : 'seg'} />
      ))}
    </div>
  )
}
