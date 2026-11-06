import { inPointsSeason } from './championship'

/**
 * Supercars teams' championship and the pit lane order it sets.
 *
 * Teams' standings after the Bathurst 1000 (Round 11), from Supercars' standings page,
 * https://www.supercars.com/standings/2026/supercars/teams (read 23 Oct 2026; the page says "Current standings"
 * without a round). They are the post-Bathurst figures: the 190-point gap between the top two matches Supercars'
 * "How Bathurst blew apart teams' championship" (https://www.supercars.com/news/supercars-news-2026-bathurst-1000-teams-championship-pit-lane-order-gold-coast-500-finals),
 * and Ford Racing's post-Bathurst listing has Grove (Penrite) on 4561. Brad Jones Racing's third car (#96) and the
 * one-car teams score as their own entries; the last four rows are wildcard entries from earlier rounds.
 *
 * Pit lane order: garages go by the teams' championship, the leading team in the two garages nearest pit exit
 * (Supercars, 2023: Red Bull Ampol Racing, the teams' champions, "will occupy the two garages closest to pit exit",
 * listed in garages 1 and 2, https://www.supercars.com/news/2023-supercars-pit-lane-order-set ). Since 2024 the
 * "Live Pit Lane" re-orders it from the team points after each event. Which car of a team takes which garage is the
 * team's choice, so it comes from each round's published order, not from the standings.
 */

export interface TeamStanding {
  /** Entrant (sponsor) name, as Supercars lists it first. */
  name: string
  /** The team running the cars. */
  team: string
  points: number
  /** Car numbers entered under this entry at the current round (none for wildcard entries). */
  cars: string[]
}

/** Teams' championship after the Bathurst 1000, in order (source above). Cars from the Gold Coast pit lane order. */
export const TEAM_STANDINGS_AFTER_BATHURST: TeamStanding[] = [
  { name: 'Penrite Racing', team: 'Grove Racing', points: 4561, cars: ['26', '19'] },
  { name: 'Red Bull Ampol Racing', team: 'Triple Eight Race Engineering', points: 4371, cars: ['888', '88'] },
  { name: 'Monster Castrol Racing', team: 'Tickford Racing', points: 3480, cars: ['6', '55'] },
  { name: 'Mobil 1 Truck Assist & Mobil 1 Optus Racing', team: 'Walkinshaw TWG Racing', points: 3321, cars: ['1', '2'] },
  { name: 'Shell V-Power Racing Team', team: 'Dick Johnson Racing', points: 3282, cars: ['17', '38'] },
  { name: 'DEWALT & Snowy River Racing', team: 'Team 18', points: 2993, cars: ['18', '48'] },
  { name: 'Sherrin Rentals & Bendix Racing', team: 'Matt Stone Racing', points: 2526, cars: ['4', '10'] },
  { name: 'Brad Jones Racing', team: 'Brad Jones Racing', points: 2468, cars: ['8', '14'] },
  { name: 'Blanchard Racing Team', team: 'Blanchard Racing Team', points: 2236, cars: ['3', '7'] },
  { name: 'PremiAir Racing', team: 'PremiAir Racing', points: 2121, cars: ['31', '36'] },
  { name: 'Erebus Motorsport', team: 'Erebus Motorsport', points: 1667, cars: ['99', '9'] },
  { name: 'Brad Jones Racing (96)', team: 'Brad Jones Racing', points: 767, cars: ['96'] },
  { name: 'Objective Racing', team: 'SCT Motorsport', points: 711, cars: ['11'] },
  { name: 'Tickford Autosport', team: 'Tickford Autosport', points: 149, cars: [] },
  { name: 'Matt Stone Racing', team: 'Matt Stone Racing', points: 98, cars: [] },
  { name: 'Team Valvoline GRM', team: 'Garry Rogers Motorsport', points: 67, cars: [] },
  { name: 'Supercheap Auto Racing', team: 'WFL Racing', points: 0, cars: [] },
]

/**
 * Teams' championship after the Gold Coast 500 (Round 12): Supercars' standings page (same URL as above, read 6 Nov
 * 2026, still without a round; no Sandown race had run, and every team's total is up on the post-Bathurst figures).
 * Brad Jones Racing back ahead of Matt Stone Racing, the "one change" to the pit lane V8 Sleuth reports (below). Cars
 * from the Sandown pit lane order. Supercars' page skips 14th; the order here is its own.
 */
export const TEAM_STANDINGS_AFTER_GOLD_COAST: TeamStanding[] = [
  { name: 'Penrite Racing', team: 'Grove Racing', points: 4864, cars: ['19', '26'] },
  { name: 'Red Bull Ampol Racing', team: 'Triple Eight Race Engineering', points: 4762, cars: ['88', '888'] },
  { name: 'Monster Castrol Racing', team: 'Tickford Racing', points: 3750, cars: ['6', '55'] },
  { name: 'Mobil 1 Truck Assist & Mobil 1 Optus Racing', team: 'Walkinshaw TWG Racing', points: 3716, cars: ['1', '2'] },
  { name: 'Shell V-Power Racing Team', team: 'Dick Johnson Racing', points: 3598, cars: ['17', '38'] },
  { name: 'DEWALT & Snowy River Racing', team: 'Team 18', points: 3325, cars: ['18', '48'] },
  { name: 'Brad Jones Racing', team: 'Brad Jones Racing', points: 2805, cars: ['8', '14'] },
  { name: 'Sherrin Rentals & Bendix Racing', team: 'Matt Stone Racing', points: 2676, cars: ['4', '10'] },
  { name: 'Blanchard Racing Team', team: 'Blanchard Racing Team', points: 2436, cars: ['7', '3'] },
  { name: 'PremiAir Racing', team: 'PremiAir Racing', points: 2330, cars: ['31', '36'] },
  { name: 'Erebus Motorsport', team: 'Erebus Motorsport', points: 1771, cars: ['99', '9'] },
  { name: 'Brad Jones Racing (96)', team: 'Brad Jones Racing', points: 834, cars: ['96'] },
  { name: 'Objective Racing', team: 'SCT Motorsport', points: 789, cars: ['11'] },
  { name: 'Tickford Autosport', team: 'Tickford Autosport', points: 149, cars: [] },
  { name: 'Matt Stone Racing', team: 'Matt Stone Racing', points: 98, cars: [] },
  { name: 'Team Valvoline GRM', team: 'Garry Rogers Motorsport', points: 67, cars: [] },
  { name: 'Supercheap Auto Racing', team: 'WFL Racing', points: 0, cars: [] },
]

export interface TeamsRound {
  meeting: RegExp
  /** The event the standings are from ("Bathurst"), for the notes. */
  after: string
  /** Car numbers by garage, garage 1 (nearest pit exit) first. */
  garages: string[]
  /** Teams' standings going into the round. */
  standings: TeamStanding[]
  /** Where the order came from. */
  source: string
}

export const TEAMS_ROUNDS: TeamsRound[] = [
  {
    // Supercars' Gold Coast 500 pit lane order (same article as the standings above). V8 Sleuth's provisional order
    // (16 Oct) has the same teams in the same garages but swaps the cars within Penrite and Blanchard.
    meeting: /gold coast/i,
    after: 'Bathurst',
    garages: ['26', '19', '888', '88', '6', '55', '1', '2', '17', '38', '18', '48', '4', '10', '8', '14', '96', '11', '3', '7', '31', '36', '99', '9'],
    standings: TEAM_STANDINGS_AFTER_BATHURST,
    source: 'https://www.supercars.com/news/supercars-news-2026-bathurst-1000-teams-championship-pit-lane-order-gold-coast-500-finals',
  },
  {
    // V8 Sleuth's provisional Sandown order (3 Nov 2026; no Supercars article found). Within-team order is theirs: the
    // Gold Coast article had two teams swapped against Supercars' own, so check it against the cars in the pit lane.
    meeting: /sandown/i,
    after: 'the Gold Coast',
    garages: ['19', '26', '88', '888', '6', '55', '1', '2', '17', '38', '18', '48', '8', '14', '96', '11', '4', '10', '7', '3', '31', '36', '99', '9'],
    standings: TEAM_STANDINGS_AFTER_GOLD_COAST,
    source: 'https://www.v8sleuth.com.au/pitlane-order-for-supercars-sandown-semi-finals/',
  },
]

/** This season's round for a meeting ("2026 Boost Mobile Gold Coast 500", or the event page's name without a year);
 * never a rebuilt past race ("2025 ..."), whose pit lane order and standings were different. */
export function teamsRoundFor(meeting: string): TeamsRound | undefined {
  return inPointsSeason(meeting) ? TEAMS_ROUNDS.find((r) => r.meeting.test(meeting)) : undefined
}
