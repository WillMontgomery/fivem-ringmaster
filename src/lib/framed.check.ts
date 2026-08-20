/**
 * `isFramedClient` decides whether the first-run preferences prompt is drawn.
 *
 * WHY IT IS GATED RATHER THAN UNIT-TESTED IN PASSING. The failure this guards
 * against is asymmetric and neither direction is visible to whoever changes it:
 * getting it wrong towards `true` means a desktop admin is never asked for a
 * timezone and every timestamp in the console silently stays UTC; getting it
 * wrong towards `false` puts a modal over a moderation console during a live
 * match. Whoever edits `framed.ts` next is looking at a browser, where both
 * mistakes look identical.
 *
 *   npx tsx src/lib/framed.check.ts
 */

import { isFramedClient, type HeaderReader } from './framed'

let failures = 0

function check(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`  ok    ${label}`)
    return
  }
  failures++
  console.error(`  FAIL  ${label} -> ${JSON.stringify(actual)} (wanted ${JSON.stringify(expected)})`)
}

/** A header bag with case-insensitive lookup, as both real callers provide. */
const headers = (h: Record<string, string>): HeaderReader => ({
  get(name) {
    const k = Object.keys(h).find((key) => key.toLowerCase() === name.toLowerCase())
    return k === undefined ? null : h[k]
  },
})

/** A real one, from FiveM's `Chrome/<version> CitizenFX/1.0.0.<build>`. */
const NUI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/103.0.5060.134 Safari/537.36 CitizenFX/1.0.0.7290'

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/127.0.0.0 Safari/537.36'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Version/17.5 Mobile/15E148 Safari/604.1'

console.log('framed — the pause-menu console is recognised')
check(
  'the NUI user agent alone is enough',
  isFramedClient(headers({ 'user-agent': NUI_UA })),
  true,
)
check(
  'Sec-Fetch-Dest: iframe alone is enough',
  isFramedClient(headers({ 'sec-fetch-dest': 'iframe', 'user-agent': CHROME_UA })),
  true,
)
check(
  'and both together, which is the real request',
  isFramedClient(headers({ 'sec-fetch-dest': 'iframe', 'user-agent': NUI_UA })),
  true,
)

console.log('\nframed — a browser is not')
check('desktop Chrome, top level', isFramedClient(headers({ 'user-agent': CHROME_UA, 'sec-fetch-dest': 'document' })), false)
check('mobile Safari, top level', isFramedClient(headers({ 'user-agent': IPHONE_UA, 'sec-fetch-dest': 'document' })), false)

console.log('\nframed — it fails towards showing the prompt')
// EVERY ONE OF THESE MUST BE false. The harmless mistake is asking a browser
// user a question they can answer; the harmful one is never asking at all.
check('no headers object', isFramedClient(null), false)
check('undefined', isFramedClient(undefined), false)
check('an empty bag', isFramedClient(headers({})), false)
check('a user agent that says nothing', isFramedClient(headers({ 'user-agent': '' })), false)
check('a stripped Sec-Fetch-Dest', isFramedClient(headers({ 'sec-fetch-dest': '' , 'user-agent': CHROME_UA })), false)
check('some other fetch destination', isFramedClient(headers({ 'sec-fetch-dest': 'empty', 'user-agent': CHROME_UA })), false)
// `nested-document` is a sub-frame NAVIGATION, not the frame's own document.
// It is deliberately not treated as framing: it arrives on requests a page
// inside the frame makes, and the prompt is decided for the document itself.
check('nested-document is not iframe', isFramedClient(headers({ 'sec-fetch-dest': 'nested-document' })), false)

console.log('\nframed — the parts that must not be brittle')
check(
  'header lookup is case-insensitive',
  isFramedClient(headers({ 'Sec-Fetch-Dest': 'iframe' })),
  true,
)
check(
  'and so is the value',
  isFramedClient(headers({ 'sec-fetch-dest': 'IFRAME' })),
  true,
)
check(
  'a padded value still matches',
  isFramedClient(headers({ 'sec-fetch-dest': ' iframe ' })),
  true,
)
// THE BUILD NUMBER MOVES EVERY RELEASE. Pinning it is how this silently stops
// working on the next client update, months after anybody remembers why.
check(
  'a different CitizenFX build still matches',
  isFramedClient(headers({ 'user-agent': 'Chrome/999.0.0.0 CitizenFX/1.0.0.99999' })),
  true,
)
check(
  'and the token is matched case-insensitively',
  isFramedClient(headers({ 'user-agent': 'Chrome/103 citizenfx/1.0.0.1' })),
  true,
)
// NOT A SUBSTRING FREE-FOR-ALL. `CitizenFX` without the slash is prose -- a
// support page, a referrer, a player's own name in a header somewhere.
check(
  'the bare word without a slash is not the product token',
  isFramedClient(headers({ 'user-agent': 'Mozilla/5.0 CitizenFX' })),
  false,
)

console.log()
if (failures > 0) {
  console.error(`check:framed FAILED with ${failures} problem(s)`)
  process.exit(1)
}
console.log('check:framed — all cases pass')
