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
- [x] **Sidekick builder** (`sidekick.html`). Any bestiary stat block seeds a sheet; one of the
      three TCE sidekick classes drives its features and spell slots; everything stays
      hand-editable, and a "How Sidekicks Level" box carries the 20-level table and the book's
      own rules. A sidekick is just a character with `isSidekick: true`, so it reuses the whole
      engine.
- [x] **Print / PDF output.** The *Print* button on every page. Character pages print as a plain
      sheet, sidekicks as a stat-block card. `_bindPrintPrep` works around what browsers refuse
      to print: textarea overflow, closed `<details>`, and panels with nothing in them.

---

## Next — rules gaps a player hits at the table

- [ ] **Resistances, immunities and senses are free text.** Darkvision, damage resistances and
      condition immunities all land in the notes box. They should be structured and attributed to
      their source, the way proficiencies now are, and rendered as real fields on the sheet.
      *(The Dragonborn work already models the shape: a trait pick carries its resistance.)*
- [ ] **Exhaustion is tracked but does nothing.** The 2024 rule is −2 per level on every d20 test.
      The counter and the derivation engine both exist; they are simply not connected.
- [ ] **No concentration prompt on damage.** When current HP drops while concentrating, offer the
      DC 10 (or half the damage, whichever is higher) Constitution save.
- [ ] **Item charges and ammunition.** Spell-carrying items are now flagged, but nothing tracks a
      wand's charges or a quiver's arrows.
- [ ] **Stale "assign manually" notes.** Skipping an ability-score offer leaves a note in the
      proficiencies box forever, even once the scores are assigned by hand.

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

## Housekeeping

- [x] **Protect `main`.** Branch rulesets are in place for `main` and `beta`, so the
      "Sync fork → Discard commits" button can no longer wipe the fork.
      (It already did once; see `CHARACTER_SHEET_MAINTENANCE.md`.)
- [ ] **Prove the nightly upstream sync.** `.github/workflows/sync-upstream.yml` has never fired.
      Run it once by hand from the Actions tab.
- [ ] **Port the remaining ad-hoc smokes** — magic-item bonuses, multiclass Expertise, origin
      feats, the session/store round-trip — into `test/e2e/` as their coverage is needed.
