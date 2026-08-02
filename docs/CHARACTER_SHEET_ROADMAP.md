# Character Sheet — roadmap

What is worth building next, and why. Ordered by value, not by effort. Tick items off as they
land; add new ones at the bottom of their tier.

Done so far: the builder and sheet themselves, the choice engine, the leveling engine, structured
proficiencies, "choose one" species traits, per-character source filtering, stat provenance,
the UI rework, the sidekick builder, print/PDF export, and the test/CI setup below.

---

## Now

- [x] **CI that runs the tests.** `npm test` existed but nothing invoked it; a push ran nothing.
      Now `.github/workflows/charactersheet-ci.yml` lints, unit-tests, checks the generated pages
      match their templates, and runs the browser tests on every push and pull request.
- [x] **Browser tests in the repo.** 136 checks across eight suites in `test/e2e/`, promoted from
      throwaway scripts. They caught real regressions repeatedly while the sheet was being built.
- [x] **Sidekick builder** (`sidekick.html`, in the DM menu). Both published rulesets, read from
      data: the Essentials Kit's three types with their roles (healer/mage, attacker/defender) and
      its fixed level table driving a one-click level-up, and any bestiary stat block plus a TCE
      sidekick class for levels past 6. Traits & Actions is a list of editable rows. Everything
      stays hand-editable, and a sidekick is just a character with `isSidekick: true`, so it reuses
      the whole engine.
- [x] **Print / PDF output.** The *Print* button on every page. Character pages print as a plain
      sheet, sidekicks as a stat-block card. `_bindPrintPrep` works around what browsers refuse
      to print: textarea overflow, closed `<details>`, and panels with nothing in them.

---

## Next — rules gaps a player hits at the table

- [x] **Resistances, immunities and senses are structured.** A *Defenses & Senses* panel on all
      three pages, grouped by kind and attributed to whatever granted each one — species, feat,
      trait pick, equipped item, or added by hand. Read from the data in every case. Gear grants
      only while it is worn (and the chip says so); a trait pick's resistance follows the pick.
      Nothing is copied into the notes box any more.
- [x] **Exhaustion now costs what it should.** −2 per level on every d20 test: ability checks,
      saving throws, skills, initiative, passive Perception and attack rolls, weapon and spell
      alike. Not on a spell save DC, which is set rather than rolled, and not on damage. Each
      affected number's breakdown names exhaustion as the reason, and the counter says what it is
      costing ("−4 to d20 tests, −10 ft. speed").
- [x] **The concentration save is prompted.** Losing hit points while concentrating raises a
      prompt with the DC (10, or half the damage), the spell's name, a Constitution save to roll,
      and *Kept it* / *Lost it* — the latter clearing the spell. Watches the hit-point value rather
      than the Damage button, so typing a lower number counts; healing and switching characters do
      not.
- [x] **Item charges and ammunition.** An item with charges shows what it has left and spends them
      a click at a time; a rest gives back exactly what the item says (`1d6 + 1` at dawn is rolled,
      not assumed), and only on the rest that recharges it. Ammunition has *Fire*, and the
      battlefield search that recovers half of what was spent.
- [x] **Stale "assign manually" notes.** A skipped ability increase is now an outstanding offer
      shown beside the ability scores, with *Assign now* (which walks the original choice) and
      *Dismiss*. Assigning settles it, and an old character's note is migrated into one on load.

## Next — the turn helper

- [x] **"What can I do right now?"** The Actions panel now says what is *possible*, not just what
      exists. A spell with no slot left, an empty wand, an empty quiver and a spent class resource
      are greyed with the reason beside them; a concentration spell warns that it would drop what
      is already running; an incapacitating condition blocks the whole turn, and exhaustion, being
      prone and being grappled are stated once above the list. Equipped items with charges are
      listed as actions in their own right, which they never were. No mainstream sheet gates its
      action list on live resources.

## Later — quality of life

- [ ] **Print polish.** The print path now works and is tested by hand, but it has no automated
      coverage, and a long character still spills onto a third page. Worth a pass once the layout
      settles: tighter margins, a deliberate page break between play data and reference text.
- [ ] **Accessibility.** Focus rings, labels on icon-only buttons, keyboard access to the feature
      cards. Noticed during the UI rework and deliberately left out of its scope.
- [ ] **Character portrait and appearance fields.**
- [ ] **Sharing a character** with a DM — a link or an export they can open read-only.
- [ ] **Homebrew.** 5etools has a homebrew loader; the builder ignores it entirely, so a
      homebrew class or species cannot be picked.

## Ideas worth building, easiest first

- [x] **Printable spell and action cards.** The *Cards* button on the sheet prints the character's
      known spells and attacks as index-card-sized cards, two across a page: name, level and school,
      casting time, range, components, duration, the spell's own text and its at-higher-levels
      clause — plus *their* save DC or attack bonus rather than a formula to work out. Concentration
      and ritual are flagged. The deck is built only when asked for, since it needs the whole spell
      list loaded, and exists only on paper.
- [ ] **Level-up preview.** Show the diff *before* committing: "+1d8+2 HP · Extra Attack · one new
      spell to pick · 3rd-level slots 0→2 · proficiency bonus unchanged". Every sheet walks you
      through a level-up; none shows the outcome first or lets you back out cleanly. Cheap because
      the level engine already derives everything by level — derive at N and N+1 and diff. The same
      machinery answers "what did I gain at 4th?".
- [x] **Build audit.** A *Build Check* panel on the builder, in two halves: what breaks a rule (a
      fourth attuned item, an unmet multiclass prerequisite read from the class's own
      `multiclassing.requirements`, over-encumbered, class levels that do not add up, hit points
      never set) and what is unclaimed (an ability increase never assigned, an Expertise pick, a
      weapon mastery, a missing class/species/background). It reports and never blocks — a DM
      ruling beats it. The counts come from the same pure functions the class panel uses to *offer*
      those choices, so the audit cannot drift from what the panel asks for.
- [x] **Every number cites its rule.** A breakdown is now a list rather than a line, and beside each
      contribution sits the rule that lets it count — one click away from the book's own paragraph,
      with its source and page. The mapping turned out to need no curated prose at all: the 2024
      rules glossary states Proficiency, Ability Score and Modifier, Armor Class, Passive Perception,
      Initiative and the rest as their own addressable entries, so a "Proficiency +3" part points at
      the actual rule, and gear, fighting styles and the exhaustion condition point at themselves. A
      magic bonus names the item responsible when exactly one is — with two contributing there is no
      single rule to show, and it stays unlinked rather than inventing one. So does a house-ruled
      Misc. A unit test asserts every catalogue entry exists in the shipped data, so a citation
      cannot rot into an empty modal.
- [x] **A session journal the sheet writes itself.** A *Session Journal* panel on the sheet, newest
      session first, each written up as a sentence: "Took 47 damage across three fights, went down
      once, burned six slots, two long rests, gained a level and fired 23 pieces of ammunition and
      recovered 11." Nothing is typed — every hit point, death save, rest, spent slot, class
      resource, condition, charge and arrow is recorded as it happens.
      *Sessions* split on a six-hour silence, or wherever *New session* is pressed, because a player
      who says a session ended knows better than a clock. *Fights* are inferred from bursts of
      damage separated by quiet or by a rest — approximate by design, since the sheet is never told
      initiative was rolled. *Storage* is capped at 1000 events, oldest dropped, so it cannot grow
      forever beside the character. *Recording pauses while loading*, so re-opening the sheet and
      restoring a saved hit-point total does not read as a fight — the same `hpCur` hook the
      concentration prompt uses, so the two can never disagree about what damage is.

## Maybe

- [ ] **A party sheet.** One page for the whole party: senses, resistances and immunities,
      languages, tool proficiencies, passive Perception, spells known — the columns that answer
      "does anyone have darkvision / speak Draconic / resist fire", which is the question that
      actually stops play. No other sheet answers it, and everything it needs is structured here.
      *The catch:* characters live in each player's own browser, and live sync would need a server
      or WebRTC signalling — which costs the no-account, static-site property. The workable version
      is snapshots: players send a *Save to File* export (or a link whose payload sits in the URL
      fragment and never reaches a server) once per level-up, and the page flags a stale one
      ("level 4 snapshot, party is level 6"). The columns that matter are build data, so a snapshot
      is nearly as good as live — but it costs every player a send at each level-up, and only the
      DM sees the benefit. Worth doing if that trade stops feeling annoying.

- [ ] **Server-side characters.** The thing that would make the party sheet live, and let a player
      pick up their character on another device. Sketched here so the shape is on record; not
      committed to, because it is the first part of this project that could break for other people.

  **The client barely changes.** Persistence is already behind a seam — `CharacterPageBase` owns
  `_initStore` / `_persistNow` / `_doLoadState`, and the store format is a pure module. Define a
  storage adapter (`list`, `load`, `save`, `delete`) with two implementations, `LocalStorage` and
  `Remote`, and pick one at init. The model, the panels and the derivations never learn about it.
  One new fork-owned module and a few lines in the page base: **no new upstream conflict points**,
  the count stays at four.

  **Local-first, never server-first.** Write to localStorage always, then queue a push. The UI
  never blocks on the network, play survives the wifi dying mid-session, and with no sync URL
  configured the app behaves exactly as it does today.

  **The server is small.** A key-value store of character envelopes with ownership:
  `POST /api/session` (join with a campaign invite code → long-lived token), then
  `GET/PUT/DELETE /api/characters[/:id]`. Concurrency by a per-character version and `If-Match`;
  on a 409 ask "keep mine / take theirs" rather than attempting a merge — characters are
  single-writer in practice. The wire format is the existing save-file envelope, so an export is a
  valid upload and there is no second schema to maintain.

  **Deployment stays boring.** A Cloudflare Worker with D1/KV needs no container and no backups to
  run; the alternative is a small container beside the existing image, which is yours to patch and
  restore. Either way the client reads the sync URL from a runtime `config.js` the image can drop
  in, so the Pages build keeps producing a working, sync-less site. The server lives in `server/`
  with its own `package.json`, so the root dependency tree and CI are untouched.

  **The real cost is not the code** — that is a weekend. It is owning uptime, backups, restores and
  token revocation, for data that today cannot be lost except by the user's own browser.

## Housekeeping

- [x] **Protect `main`.** Branch rulesets are in place for `main` and `beta`, so the
      "Sync fork → Discard commits" button can no longer wipe the fork.
      (It already did once; see `CHARACTER_SHEET_MAINTENANCE.md`.)
- [x] **Prove the nightly upstream sync.** It had fired — three times, all green — and proved
      nothing: upstream had not moved, so every run skipped ten of its twelve steps. Both real
      paths are now exercised by `scripts/rehearse-upstream-sync.sh`, which replays the workflow's
      own steps over a synthetic upstream in a throwaway clone: a clean merge (regenerates 56
      pages, lints, tests, would push) and a conflict in `js/navigation.js` (markers committed,
      nothing built, nothing pushed). Rehearsing the two side by side turned up a real defect —
      a conflicted night finished **green**, because the merge failure was swallowed by the step's
      own `if`, so the one morning needing attention looked like every other. It now ends red.
      The workflow also gained `force` / `dry_run` dispatch inputs, so the merge path can be run
      on demand instead of only on a night upstream happens to move, and it now lints
      `js/sidekick.js` along with the other two entry points.
- [ ] **Port the remaining ad-hoc smokes** — magic-item bonuses, multiclass Expertise, origin
      feats, the session/store round-trip — into `test/e2e/` as their coverage is needed.
