# CLAUDE.md — project orientation for AI sessions

This repository is a **fork of 5etools-src**. Its distinguishing customization
is a **Character Sheet builder** (a full, data-driven D&D character
builder/sheet) that upstream 5etools does **not** have.

When helping with this repo, prioritize keeping that builder working and keeping
the fork easy to update from upstream.

## Character Sheet: file map

The feature is **two pages** that share one character store: a play-focused
**sheet** (`charactersheet.html`) and a build-focused **builder**
(`charbuilder.html`). Both subclass `CharacterPageBase`
(`charactersheet-pagebase.js`), which owns the model, the multi-character
store/switcher, autosave, file save/load, the null-safe input binding, and the
shared build helpers (data pickers, wizard). Each page's controller keeps only
its own DOM assembly + rendering.

**Fork-owned (upstream has no version → these never conflict on an upstream merge):**
- `charactersheet.html`, `charbuilder.html` — **generated**, do not hand-edit (see below)
- `js/charactersheet.js`, `js/charbuilder.js` — the two page entry points
- `js/charactersheet/*.js` — the shared modules: pure rules (`derive`,
  `levelengine`, `choices`, `abilityscores`, `equipment`, `actions`, `charstore`,
  `consts`), data access (`classdata`), the model (`model`), the page base
  (`pagebase`), and the panel renderers (`classpanel`, `inventorypanel`,
  `spellspanel`, `actionspanel`, `wizard`)
- `css/charactersheet.css`, `scss/charactersheet.scss` (shared by both pages)
- `node/generate-pages/template/page/template-page-charactersheet.hbs`,
  `.../template-page-charbuilder.hbs`
- `test/jest/CharacterSheet*.test.js`

**Shared upstream files the fork edits (the ONLY upstream-merge conflict points):**
1. `js/navigation.js` — two `_addElement_li({... page: "char....html" ...})` lines
2. `index.html` — two `<a href="charactersheet.html">` home-page buttons
3. `node/generate-pages/generate-pages-page-generator-config.js` — the
   `_PageGeneratorCharactersheet` / `_PageGeneratorCharbuilder` classes + their two
   `new _PageGenerator...(),` registration lines

Exact snippets and resolution steps: `docs/CHARACTER_SHEET_MAINTENANCE.md`.

## Critical gotcha: the page HTML is generated

`charactersheet.html` and `charbuilder.html` are built from their
`node/generate-pages/template/page/template-page-*.hbs` templates by
`node node/generate-pages.js` (run in the Docker/Pages builds). **Editing the
generated `.html` directly is silently overwritten by the build.** To change
the page markup, edit the **template** and regenerate. After editing a
template, run `node node/generate-pages.js` and commit both.

## Architecture notes

- The builder is model-driven: `CharacterModel` (a 5etools `BaseComponent`
  subclass in `charactersheet-model.js`) is the single source of truth. UI
  mutates the model; the model's hooks re-render. Rendering is one-directional.
- Game rules are read from the real data (classes, races, feats, spells, items),
  not hardcoded — except the PHB multiclass spell-slot table, which is a fixed
  core rule in `charactersheet-levelengine.js`.
- The pure rules modules (`derive`, `levelengine`, `choices`, `abilityscores`,
  `equipment`, `actions`, `charstore`) are unit-tested; keep them DOM-free and tested.

## What the feature covers (so you don't rebuild it)

- **Builder** (`charbuilder.html`): guided wizard; species/background/class pickers;
  ability scores; the class/leveling panel (subclass, ASI/feat with prerequisite
  warnings, optional features, **Expertise** chooser, features timeline); the
  class-filtered **spell manager** (learnable-only, known vs prepared counts,
  ritual flags); real inventory with equip/attune; HP-on-level-up policy.
  Feat skill/Expertise **choices are resolved interactively**.
- **Sheet** (`charactersheet.html`): the play view — abilities/saves/skills,
  **computed Armor Class** (armor/shield/unarmored modes + magic bonuses),
  attacks with a **Wield** button and an automatic **Unarmed Strike**, an
  **Actions** panel (action/bonus/reaction economy), spell slots, death saves,
  **rests** (short/long), and a **conditions & concentration** tracker.
- Equipped magic items feed derivations globally: AC, saving throws, spell save
  DC and spell attack, and weapon attack/damage (`derive.js`).
- Both pages share one character store, so a character built in the builder is
  immediately playable on the sheet.

## Updating from upstream

Preferred: `bash scripts/update-from-upstream.sh` (fetches, merges, regenerates
pages, runs Character Sheet lint + tests, makes a safety backup branch). If a
conflict occurs it will be in one of the 3 shared files above — resolve by
keeping BOTH the fork's registration line(s) and upstream's changes, per
`docs/CHARACTER_SHEET_MAINTENANCE.md`.

## Verifying Character Sheet changes

- Lint: `npx eslint js/charactersheet.js js/charactersheet/`
- Unit tests: the repo's `test:unit` script, e.g.
  `node --localstorage-file test/temp/localstorage.tmp --experimental-vm-modules node_modules/jest/bin/jest.js test/jest/CharacterSheet`
- Manual: `npm run serve:dev` then open `http://localhost:5050/charactersheet.html`
  (regenerate first if you changed the template).
- `npm install` may need `--engine-strict=false` if the local Node is older than
  the repo's `engines` requirement.
