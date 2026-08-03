# The account system — features and phasing

Companion to `ACCOUNT_SYSTEM.md`, which is the *contract* between this fork and the account system.
This document is the *plan*: what the account system should do, in what order, and which parts need
work on the 5etools side.

**It belongs in the account system's own repository.** It lives here only until that repository
exists, because it is the thing that repository is built from.

---

## What it is for

One person's tables: several campaigns and one-shots, a handful of players each, and a GM who can
see the party's characters without anyone exporting a file.

That framing decides a lot. It is **not** a public service, so quotas, rate limits and abuse
handling are hygiene rather than day-one features. But it *is* multi-user with real roles, so
campaigns and permissions belong in the schema from the start — retrofitting them is what hurts.

## Non-goals, stated so they stay non-goals

- **The account system never understands D&D.** It stores opaque character envelopes. The moment it
  parses a class, a spell or a level, the two repositories are coupled and upstream merges get risky
  again — which is the whole property we are protecting.
- **It is not a virtual tabletop.** No maps, no dice, no initiative tracker. Those exist in
  5etools already or are somebody else's problem.
- **It is not authoritative during play.** The browser in front of the player is. The server is a
  backup and a transfer medium.

---

## Data model

| Entity | Fields | Notes |
| --- | --- | --- |
| `user` | `id`, `oidc_sub`, `display_name`, `created_at` | Comes from Authentik. **No credentials stored, ever.** |
| `campaign` | `id`, `name`, `created_by`, `is_party_visible`, `created_at` | A one-shot is just a campaign. |
| `membership` | `campaign_id`, `user_id`, `role` (`gm` \| `player`), `joined_at` | A campaign may have more than one GM. |
| `invite` | `code`, `campaign_id`, `role`, `expires_at`, `max_uses`, `uses` | How a player joins. |
| `character` | `id`, `owner_id`, `campaign_id` (nullable), `name`, `envelope`, `sync_version`, `schema_version`, `updated_at`, `deleted_at` | `campaign_id` nullable: a character can exist before it joins a table. |
| `character_version` | `character_id`, `sync_version`, `envelope`, `created_at` | History. Keep the last ~20. |
| `blob` | `hash`, `bytes`, `refcount` | Portraits, content-addressed — see *Payload size*. |

`name` on `character` is denormalised out of the envelope purely so a list can be drawn without the
server parsing anything meaningful. It is a label, not a fact the server reasons about.

### Visibility

- **Owner** — full read/write on their own characters.
- **GM of the character's campaign** — read. *Not* write: a GM editing a player's sheet mid-session
  is a support burden and a trust problem, and nobody has asked for it. Revisit only if asked.
- **Other players in the campaign** — nothing, unless `campaign.is_party_visible` is set, which
  grants members read access to each other's characters. That flag is what makes the party sheet
  possible, and it is per-campaign because some tables will not want it.

The party sheet's columns (senses, languages, resistances, passive Perception) are computed
**client-side** from envelopes the client is allowed to read. The server never learns what a sense
is.

---

## Versioning — three different things

| Kind | Field | Purpose |
| --- | --- | --- |
| **Sync version** | `character.sync_version` | Conflict detection via `If-Match`. Integer, bumped server-side on every accepted write. |
| **Schema version** | inside the envelope (`{version, state}`, currently `2`) | Format skew between clients. |
| **History** | `character_version` rows | Undo and restore. |

Two rules worth writing into the code rather than the docs:

- **Do not overload the envelope's `version`.** It is the schema version and always has been. The
  sync version is a separate field on the row.
- **An older client must refuse to overwrite a newer schema.** If `envelope.version` on the server
  is higher than the client understands, the client must decline the write and say so — not
  round-trip the document and silently drop fields it did not recognise. This is the single most
  likely way to lose data quietly once two clients exist.

History is the sleeper feature. Twenty snapshots per character turns this from a sync tool into a
**safety net**, which `localStorage` has never been: "restore to before tonight's session" is worth
more to most players than cross-device access.

---

## Sync rules

**Local-first, always.** Write `localStorage` first, then queue a push. The UI never blocks on the
network; play survives the wifi dying mid-session.

**Automatic push, manual pull.** Pushing is safe — it is the local browser asserting what it knows.
Pulling overwrites, so it happens only when the player asks, or on the first open of a character on
a device that has no local copy. If auto-pull is added later, gate it on "no unpushed local
changes", so it can only ever run when it is provably safe.

**Conflicts are shown, never resolved silently.** Two devices in one session is expected here, so on
a `409` the player gets a dialog naming both sides — character name, level, hit points, when each
was last changed — and three options:

1. **Keep mine** — push over the server's copy (the old one stays in history).
2. **Take theirs** — replace local.
3. **Keep both** — save mine as a new character.

The third is the safety valve. It means no conflict dialog can ever lose data, however the player
answers it under time pressure at the table.

### Payload size, which is now a real constraint

A character envelope is not small any more: the session journal holds up to 1000 events (~40KB), a
portrait up to 512KB, the rest ~20–50KB. Pushing everything on every hit-point click would be
absurd.

- **Debounce**: push after ~10–30s idle, and on meaningful boundaries — a rest, a level-up, the tab
  being hidden, `pagehide`.
- **Store portraits once.** Content-address them (`blob` above) so a portrait is uploaded once and
  every version of the character references the same bytes. Without this, 20 history snapshots of a
  character with a portrait is 10MB for one character.
- Split the envelope into build data and play state **only if debouncing proves insufficient**. It
  is a real complication; do not pay for it upfront.

### Deletion

Soft-delete with a tombstone and a 30-day trash. "Deleted on my phone" must not mean "gone
everywhere, immediately" — that is how one mis-tap destroys a character.

---

## Phases

Each phase is shippable, and none of them makes the no-account deployment worse.

### Phase 0 — the skeleton and the proof

Repository, container, reverse-proxy route, OIDC against Authentik (confidential client,
Authorization Code + PKCE), a session cookie, and `GET /api/whoami`.

Serves `client.js` implementing only `pWhoAmI` and `getLoginUrl`; the other methods throw.

**Fork-side:** the status bubble. Nothing is written anywhere, so this proves the whole path —
proxy, cookies, OIDC — with no data at risk.

### Phase 1 — characters, by hand

`GET/PUT/DELETE /api/characters[/:id]`, ownership, sync versions, tombstones.
Client gains `pList`, `pLoad`, `pSave`, `pDelete`.

**Fork-side:** an *Online* panel listing server characters, with explicit *Upload* and *Download*;
and the first-sign-in migration prompt — *"You have 3 characters in this browser. Upload them?"* —
without which signing in looks like data loss. Local ids need a stable mapping to server ids, kept
locally.

Useful on its own: cross-device transfer in two clicks.

### Phase 2 — campaigns and the GM

Campaigns, invites, memberships, roles. A character can be assigned to a campaign. A GM can read
the characters in theirs.

**Fork-side:** a campaign selector on the character, and a read-only view for a GM opening someone
else's character.

### Phase 3 — automatic push

The debounced queue, `If-Match`, the conflict dialog with its three options.

**Fork-side:** the queue and the dialog. The bubble gains its *Unsaved (n)* state.

### Phase 4 — history

Snapshot on every accepted write, keep the last 20, `GET /api/characters/:id/versions` and a
restore endpoint.

**Fork-side:** a *History* section — timestamped entries with the journal's own sentence as the
label, since that already describes what happened, and a *Restore* button.

### Phase 5 — the party sheet

`is_party_visible`, a campaign-wide read endpoint, and the page that answers "does anyone here have
darkvision / speak Draconic / resist fire".

**Fork-side:** the party page itself. Everything it needs is already structured.

---

## The status bubble (fork-side spec)

One indicator on all three character pages. Five states, because "online/offline" collapses cases
that need different responses:

| State | Shows | Click |
| --- | --- | --- |
| Not configured | **nothing at all** | — |
| Configured, unreachable | `Offline` (amber) | Error detail + *Retry* |
| Reachable, not signed in | `Sign in` (neutral) | Starts the OIDC flow |
| Signed in, everything pushed | `Online · 2m ago` (green) | Account, character list, *Sign out* |
| Signed in, queued or failed | `Unsaved (3)` (amber) | What is pending, the error, *Retry* |

Two rules that are not negotiable:

- **Nothing configured shows nothing.** On the static Pages build there is no account system to be
  offline *from*; a permanent "Offline" badge there would be alarming and wrong.
- **Never green when the last push failed.** The bubble's only job is to be trustworthy. Green while
  data sits in a queue is worse than no bubble at all.

"Last synced" is in the text deliberately. *Online* is a claim about the network; *2m ago* is a
claim about the player's data, and that is what actually reassures.

---

## Operations

The code is a weekend; this is the part that is not.

- **Backups**: the database, nightly, restore-tested at least once. History does not protect against
  losing the whole store.
- **Uptime is optional by design.** Local-first means the site works with the account system down.
  Keep it that way — never make sync a precondition for anything.
- **Identity is delegated.** Authentik owns passwords, resets and revocation. Sessions here should
  be short-ish and refreshable, so revoking someone in Authentik takes effect.
- **Quota**: a per-user cap on characters and total bytes, with a clear error rather than a silent
  failure. Hygiene, not urgency, at this scale.

---

## Open questions

- **Does a GM ever need to *write* to a player's character?** Assumed no. If it turns out yes, the
  cleanest version is a per-campaign toggle plus an audit note in the journal, not a general
  permission.
- **Should a one-shot expire?** Campaigns accumulate. A dormant campaign could archive itself after
  a year, which mostly matters for keeping the picker short.
- **Where do sidekicks live?** They are characters with `isSidekick: true`, so they sync for free —
  but a GM's sidekicks probably belong to the campaign rather than to a player. Worth deciding in
  phase 2 rather than discovering in phase 5.
