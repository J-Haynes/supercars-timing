/** Practice, qualifying and shootouts are ranked by best lap; races by running order. */
export function isRace(sessionType: string): boolean {
  return sessionType.toLowerCase().includes('race')
}

/** Top Ten Shootout (or similar single-car runs), detected from Natsoft's session name/type. */
export function isShootout(sessionName: string, sessionType: string): boolean {
  return /shoot\s*-?out|top\s*(10|ten)/i.test(`${sessionName} ${sessionType}`)
}
