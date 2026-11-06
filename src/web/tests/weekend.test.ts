import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { formatSessionTime } from '../src/timeZone.ts'
import { coverageLabel, weekendSessions, nextWeekend, type WeekendData, type ChampionshipStandings } from '../src/weekend.ts'
import { finalsQualification, lockedPositions } from '../src/championshipLocks.ts'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import type { RecordedSession } from '../src/types.ts'

test('viewer dates cross midnight and respect half-hour offsets without relabelling the track date', () => {
  process.env.TZ = 'Australia/Brisbane'
  const brazil = new Date('2026-11-06T12:30:00-03:00')
  assert.deepEqual(formatSessionTime(brazil, 'mine', '-03:00'), { day: 'Sat, 7 Nov', time: '01:30' })
  assert.deepEqual(formatSessionTime(brazil, 'track', '-03:00'), { day: 'Fri, 6 Nov', time: '12:30' })
  const adelaide = new Date('2026-11-27T00:15:00+10:30')
  assert.deepEqual(formatSessionTime(adelaide, 'mine', '+10:30'), { day: 'Thu, 26 Nov', time: '23:45' })
})

test('the main timetable remains usable when weekend data is unavailable', () => {
  const sessions = [{ name: 'Race', start: '2026-11-27T00:15', end: '2026-11-27T01:15' }]
  const event = { name: 'Adelaide', venue: '', location: '', startDate: '2026-11-26', endDate: '2026-11-29', utcOffset: '+10:30', sessions }
  const result = weekendSessions(event)
  assert.equal(new Date(result[0].start).toISOString(), '2026-11-26T13:45:00.000Z')
  assert.equal(coverageLabel(result[0].coverage), 'Coverage unconfirmed')
  assert.deepEqual(sessions, [{ name: 'Race', start: '2026-11-27T00:15', end: '2026-11-27T01:15' }])
})

const weekends = JSON.parse(readFileSync(new URL('../src/schedule/weekends.json', import.meta.url), 'utf8')) as WeekendData[]
const sandown = weekends.find(w => w.series === 'v8' && w.startDate === '2026-11-06')!
const event = { name: sandown.eventName, startDate: sandown.startDate, endDate: '2026-11-08', utcOffset: '+11:00', venue: '', location: '',
  sessions: [{ name: 'Practice 1', start: '2026-11-06T16:00', end: '2026-11-06T16:30' }] }

test('waiting event selection uses refreshed final-session changes', () => {
  const delayed = { ...sandown, sessions: sandown.sessions.map(s => s.name === 'Race 34' ? { ...s, end: '2026-11-08T19:00:00+11:00' } : s) }
  const now = Date.parse('2026-11-08T18:00:00+11:00')
  assert.equal(nextWeekend([event], [sandown], now), null)
  assert.equal(nextWeekend([event], [delayed], now)?.session?.name, 'Race 34')
})

test('exact position locks cover both directions, zero points, season end and reachable ties', () => {
  const data = (JSON.parse(readFileSync(new URL('../src/schedule/standings.json', import.meta.url), 'utf8')) as ChampionshipStandings[]).find(s => s.series === 'f1')!
  assert.deepEqual([...lockedPositions(data.drivers, data, false)], ['Andrea Kimi Antonelli'])
  assert.equal(lockedPositions(data.teams, data, true).has('Mercedes'), false)
  const rows = [{ position: 1, name: 'A', points: 101 }, { position: 2, name: 'B', points: 50 }, { position: 3, name: 'C', points: 0 }]
  const small = { ...data, pointsRemaining: { ...data.pointsRemaining!, drivers: 50 } }
  assert.deepEqual([...lockedPositions(rows, small, false)], ['A']) // B/C can tie: position not proven.
  assert.equal(lockedPositions(rows, { ...small, note: 'Source offline' }, false).size, 0)
  assert.equal(lockedPositions(rows, { ...small, pointsRemaining: { ...small.pointsRemaining!, races: 0 } }, false).size, 3)
  assert.equal(lockedPositions([{ position: 1, name: 'Finalist', points: 4150 }, { position: 2, name: 'Other', points: 2000 }],
    { ...small, pointsRemaining: { ...small.pointsRemaining!, driverResetsPending: true } }, false).size, 0)
})

test('Finals projections distinguish completed wins from leading and reserve win-to-advance seats', () => {
  const rows = ['A','B','C','D','E','F','G'].map((car, i) => ({ car, banked: 4150 - i * 20, total: 4300 - i * 20, wins: 0, leading: i === 6 }))
  const projected = finalsQualification(rows, 4, 2, 150)
  assert.ok(projected.through.has('G'))
  assert.equal(projected.secured.has('G'), false)
  assert.equal(projected.through.has('D'), false)
  const won = finalsQualification(rows.map(r => ({ ...r, leading: false, wins: r.car === 'G' ? 1 : 0 })), 4, 1, 150)
  assert.equal(won.secured.get('G'), 'win')
  const safe = finalsQualification(rows.map((r, i) => ({ ...r, banked: i === 0 ? 4700 : 4000, leading: false })), 4, 1, 150)
  assert.equal(safe.secured.get('A'), 'points')
  const onlyOnePlace = finalsQualification(rows.map((r, i) => ({ ...r, banked: i === 0 ? 4700 : 4000, leading: false })), 1, 1, 150)
  assert.equal(onlyOnePlace.secured.has('A'), false) // Another driver can win the one remaining race.
})

test('Finals standings keep driver identities and replay session boundaries', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { FINALS_ROUNDS, roundStandings, priorFinalsSessions } = await server.ssrLoadModule('/src/finals.ts') as typeof import('../src/finals.ts')
    const round = FINALS_ROUNDS.find(r => r.firstRace === 33)!
    const result = roundStandings(round, [])!
    assert.equal(result.rows.length, 33)
    assert.equal(result.rows.filter(r => r.finalist).length, 7)
    assert.equal(new Set(result.rows.map(r => r.driver)).size, 33)
    assert.equal(result.rows.find(r => r.carNumber === '26')?.rank, 8)
    for (const car of ['888', '6']) assert.equal(result.rows.filter(r => r.carNumber === car).length, 1)
    const final = roundStandings(round, [['19', '88', '17', '1', '888', '6', '18']],
      ['18', '6', '888', '1', '17', '88', '19'], true)!
    assert.equal(final.secured.get('18'), 'win')
    assert.equal(final.rows.find(r => r.carNumber === '1')?.out, true)
    assert.equal(final.secured.has('1'), false)
    assert.ok(final.rows.filter(r => final.secured.has(r.carNumber!)).every(r => !r.out))

    // Official awards can be published without the latest classification. Equal totals at the cut stay unknown.
    const latest = ['48', '8', '2', '7', '55', '31', '10', '14', '36', '38', '3', '18', '96', '6', '11', '777', '9', '17', '99', '4']
    const prior = { points: Object.fromEntries(latest.map((car, i) => [car, round.points[i]])),
      winners: ['48'], completed: 1, complete: true }
    for (const orders of [[], [['6', '18']]]) {
      const unknown = roundStandings(round, orders, undefined, false, prior)!
      assert.deepEqual([...unknown.uncertain].sort(), ['18', '6'])
      assert.equal(unknown.secured.has('6'), false)
      assert.equal(unknown.secured.has('18'), false)
    }
    const classified = roundStandings(round, [], undefined, false, { ...prior, lastRaceOrder: latest })!
    assert.equal(classified.uncertain.size, 0)
    assert.equal(classified.rows.find(r => r.carNumber === '18')?.out, false)
    assert.equal(classified.rows.find(r => r.carNumber === '6')?.out, true)

    const session = (id: string, meeting: string, name: string, start: string) =>
      ({ id, meeting, name, start, type: name.includes('Race') ? 'Race' : 'Practice' }) as RecordedSession
    const gold = '2026 Boost Mobile Gold Coast 500'
    const practice = '2026 Repco Supercars Championship - Practice 1'
    const catalogue = [session('sandown', '2026 Penrite Oil Sandown 500', practice, '2026-11-06T04:00:00Z'),
      session('race32', gold, '2026 Repco Supercars Championship - Race 32', '2026-10-25T04:00:00Z'),
      session('practice-part2', gold, practice, '2026-10-23T04:20:00Z'),
      session('practice-part1', gold, practice, '2026-10-23T04:00:00Z')]
    const goldRound = FINALS_ROUNDS[0]
    assert.deepEqual(priorFinalsSessions(catalogue, goldRound, { meeting: gold, name: practice }), [])
    assert.deepEqual(priorFinalsSessions(catalogue, goldRound, { meeting: gold, name: 'unrecorded practice' }), [])
    const race33 = session('race33', '2026 Penrite Oil Sandown 500', '2026 Repco Supercars Championship - Race 33', '2026-11-07T04:00:00Z')
    const race34 = session('race34', race33.meeting, '2026 Repco Supercars Championship - Race 34', '2026-11-08T04:00:00Z')
    assert.deepEqual(priorFinalsSessions([...catalogue, race34, race33], round, race34).map(s => s.id), ['race33'])
  } finally {
    await server.close()
  }
})
