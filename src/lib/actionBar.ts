/**
 * Which buttons the profile's moderation bar draws, and which of them work.
 *
 * ═══ WHY THIS IS A MODULE AND NOT THREE LINES INSIDE `PlayerActions` ═══
 *
 * It was three lines inside `PlayerActions`, and it was correct there. What
 * broke the arrangement is that a SECOND reader appeared: `ProfileView`'s
 * loading skeleton has to draw the right NUMBER of button-shaped rectangles
 * before the component that decides the number has rendered, so it re-spelled
 * the rule — `!banned && online ? 2 : 1` — and carried a comment saying it was
 * "kept in step by hand". Two representations of one fact with nothing
 * asserting they agree is this project's signature bug; the comment naming the
 * hazard is not the same as removing it.
 *
 * Adding Spectate would have made it two representations of TWO facts. So the
 * rule moved here, both readers import it, and the skeleton now counts what the
 * bar is about to draw rather than what somebody remembered it draws.
 *
 * ═══ THERE IS ONLY ONE QUESTION LEFT: IS THERE ANYBODY TO DO THIS TO? ═══
 *
 * Decided by the state of the PLAYER (and, for Spectate, of the admin's own
 * body in the world). When the answer is no the control is ABSENT — hidden, not
 * greyed, the owner's standing rule. An action with no target is not an action
 * being withheld; it is one that does not exist right now, and a dead button
 * with a caption under it is the console explaining an absence nobody asked
 * about. Nothing marks the gap.
 *
 * ═══ THE SECOND QUESTION — MAY THIS ACCOUNT DO IT? — HAS BEEN DELETED ═══
 *
 * It was answered by a scope, and it always had the same answer.
 *
 * Spectate lost its scope first (dba5a6a). The scope was a good idea that could
 * not work: NOTHING IN THIS CONSOLE COULD GRANT ONE. There was no scopes UI, the
 * only route was editing DynamoDB by hand, and the owner does not do that. So
 * the check was a wall with no door — every admin on the server got a
 * permanently greyed button and a sentence telling them to acquire something
 * unacquirable.
 *
 * `canBan` then went the same way, and with it the whole scope system
 * (lib/grants.ts). Anyone who can sign in is a full admin, so every control this
 * file describes is enabled whenever it is drawn, and `enabled` is no longer a
 * field: a boolean that is always true is a field nobody reads and a
 * `disabled={}` branch nothing can reach.
 *
 * A GRANULAR CHECK WITH NO GRANT PATH IS NOT CAUTION, IT IS A BROKEN FEATURE.
 * If levels are ever built, the place to put them back is here — but they go
 * back WITH the door, not before it.
 *
 * ═══ NOTHING HERE WAITS ON DISCORD, AND NOW NOTHING HERE READS DYNAMODB ═══
 *
 * Every input is known on the server as the page is built — `banned` is
 * `bans.isActive` and the two presence booleans come out of the one live
 * snapshot. That is what lets the skeleton draw the final count instead of
 * drawing three and resolving to one when Discord answers, which is the layout
 * jump the skeleton exists to prevent.
 *
 * NO RUNTIME IMPORTS, deliberately — the same property `serverPhase`, `labels`
 * and `incidentChip` keep. `PlayerActions` is a client component, so anything
 * this reached for would be reached for in the browser bundle too.
 */

/**
 * A control: the only question is whether it is drawn.
 *
 * `ActionState { shown, enabled }` USED TO SIT ABOVE THIS, for the controls that
 * also asked a scope. Nothing asks one now, so it is gone rather than kept with
 * `enabled: true` hard-coded. A field that is always the same value is a field
 * nobody reads, and this repository's standing failure is machinery that ships
 * before — or after — anything calls it. A constant `enabled` invites a call
 * site to keep a `disabled={}` branch that can never fire, which is how the
 * greyed Spectate button survived the route change meant to remove it.
 */
export interface ShownOnly {
  shown: boolean
}

export interface ActionBarInputs {
  /**
   * A ban IN FORCE right now — `bans.isActive`, decided on the server.
   *
   * NOT "there is a ban row". A ban that was served or lifted is history, and
   * history must not take the kick button away or turn Ban into Lift ban.
   */
  banned: boolean

  /**
   * The TARGET is on the server right now.
   *
   * One reading of one fact: `liveView(now).players` holds a row for their
   * license. The profile page derives it once and hands the same boolean to the
   * ONLINE NOW chip and to here, so the chip and the buttons cannot disagree.
   */
  online: boolean

  /**
   * The ACTING ADMIN is on the server right now.
   *
   * THE SAME QUESTION ASKED OF A DIFFERENT LICENSE, from the same array in the
   * same snapshot — not a second notion of presence. It exists because
   * spectating needs somewhere to put a camera: an admin reading the console in
   * a browser at their desk has no body in the world and no screen the game can
   * point anywhere, so the request could only ever be refused.
   */
  adminOnline: boolean
}

export interface ActionBar {
  kick: ShownOnly
  spectate: ShownOnly
  /**
   * How many buttons the bar will contain, Ban-or-Lift included.
   *
   * FOR THE SKELETON, and it is the whole reason `buttons` is a field rather
   * than something each caller counts. `ProfileView` draws this many grey
   * rectangles in a right-aligned flex group while Discord is still thinking;
   * being wrong by one leaves an 88px hole that fills in later.
   */
  buttons: number
}

/**
 * The whole rule, in one place, for one player and one admin.
 *
 * BAN-OR-LIFT IS UNCONDITIONAL and therefore is not in the result: there is
 * always exactly one of those two buttons, whatever the player's state, so
 * there is no decision to hand back. It is counted in `buttons` because the
 * skeleton counts rectangles rather than decisions.
 */
export function actionBar(i: ActionBarInputs): ActionBar {
  /**
   * KICK — two ways there is nobody to kick, and both HIDE.
   *
   * `!banned` — "the kick button should not be displayed on the profile page
   * when a ban is in place" — the owner. A banned player is not somebody you
   * kick, so there is no action being withheld and nothing to explain.
   *
   * `online` — "let's remove the 'kick' button from the profile page if the
   * user is offline" — the owner. It used to draw a dead button over an absent
   * player.
   *
   * A banned player who is somehow still connected is a transient state —
   * `/api/bans` kicks them in the same request — and it resolves towards the
   * button being irrelevant either way.
   *
   * NO SCOPE HALF ANY MORE. This used to carry `enabled: i.canBan` — the API
   * route authorised on `kick` while the button asked for `ban`, a mismatch
   * older than this file that the tooltip admitted to out loud. Both scopes are
   * gone, so the button is live whenever it is drawn and the mismatch cannot be
   * inherited by whatever comes next.
   */
  const kick: ShownOnly = {
    shown: !i.banned && i.online,
  }

  /**
   * SPECTATE — BOTH ENDS MUST BE IN-GAME (#192).
   *
   * "The console offers a Spectate button on a player only when the admin and
   * the target are both in-game. Otherwise the button is hidden, not greyed —
   * the standing rule, and the same treatment the profile page already gives
   * Kick." That is the issue, and this line is the whole of it.
   *
   * THE TWO HALVES FAIL FOR DIFFERENT REASONS AND A HARNESS HAS TO SEPARATE
   * THEM. `online` false means there is nobody to watch. `adminOnline` false
   * means there is nobody to watch THROUGH — the camera is a scripted camera on
   * the admin's own client (br_core/client/bus.lua's, reused), so with the
   * admin at a desk rather than in a match there is no client to run it. Both
   * hide the button, so a mutation dropping either one still looks right on any
   * fixture where both are true; `?mod=admin-offline` in /preview/profile
   * exists to hold exactly one of them false.
   *
   * A BAN DOES NOT HIDE IT, unlike Kick, and that asymmetry is deliberate. The
   * reason `!banned` hides Kick is that a banned player is not somebody you
   * kick — the action is redundant, not forbidden. Watching one who is still
   * connected in the seconds before the ban's own kick lands is not redundant
   * at all; it is the last chance to see what they were doing.
   *
   * NO SCOPE HALF EITHER — see the note at the top of this file. Whoever can
   * open this page can press this button, and `/api/spectate` still writes its
   * audit row before the command leaves.
   */
  const spectate: ShownOnly = {
    shown: i.online && i.adminOnline,
  }

  return {
    kick,
    spectate,
    // Ban-or-lift is always one of them.
    buttons: 1 + (kick.shown ? 1 : 0) + (spectate.shown ? 1 : 0),
  }
}
