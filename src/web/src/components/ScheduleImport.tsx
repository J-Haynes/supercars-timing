import { useState } from 'react'

/** Only offered by the portable app; the schedule is shared with the feed and both series' menus. */
export function ScheduleImport() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function importFile(file: File) {
    setMessage('')
    if (file.size > 1_048_576) {
      setMessage('Choose a schedule file smaller than 1 MB. Your current timetable has been kept.')
      return
    }
    setBusy(true)
    try {
      const response = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SupercarsTiming-Local': '1' },
        body: await file.text(),
      })
      if (!response.ok) {
        const result = await response.json().catch(() => null)
        throw new Error(result?.message ?? 'The schedule could not be saved. Your current timetable has been kept.')
      }
      window.location.reload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The schedule could not be imported.')
    } finally { setBusy(false) }
  }

  return <section>
    <h2>Supercars schedule</h2>
    <p className="menu-muted">Import a timetable without replacing the app. Changes apply to event pages and live connections.</p>
    <p className="menu-muted"><a href="https://raw.githubusercontent.com/J-Haynes/supercars-timing/main/src/web/src/schedule/supercars.json" target="_blank" rel="noreferrer">Get the latest schedule</a> and save it as a JSON file.</p>
    <label className="schedule-import">
      {busy ? 'Importing schedule…' : 'Import schedule'}
      <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void importFile(file)
      }} />
    </label>
    {message && <p className="menu-muted" role="alert">{message}</p>}
  </section>
}
