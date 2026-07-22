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

## 5etools class data structure (read this before adding class mechanics)

Almost every class/subclass mechanic the builder needs is **structured data**,
not prose — mining it is how you integrate features correctly. Files:

- `data/class/class-<name>.json` — arrays `class[]`, `subclass[]`,
  `classFeature[]`, `subclassFeature[]`. The `DataLoader` class loader
  **dereferences** the feature refs, so a loaded `cls.classFeatures` is a
  **by-level array of resolved feature objects** (index 0 = level 1). Read via
  `CharacterSheetClassData`, never re-parse refs yourself.
- `data/class/fluff-class-<name>.json` — prose only (`classFluff`, `subclassFluff`).

Key fields (all read by `charactersheet-levelengine.js` unless noted):

- **`classFeatures` refs** are strings `"Name|Class|ClassSource|Level"` (source
  blank ⇒ PHB). A feature that unlocks the subclass is `{classFeature, gainSubclassFeature: true}`.
  2014 subclasses bundle their level features as **nested `refSubclassFeature`
  entries inside one level feature** (e.g. Rakish Audacity lives *inside* the
  level‑3 "Swashbuckler" feature) — collect names recursively
  (`CharacterSheetClassData.pGetCharacterFeatureNames`).
- **`classTableGroups`** = the class table. `colLabels` + `rows` hold per-level
  resource values — **Rages, Rage Damage, Weapon Mastery (count), Sneak Attack,
  Martial Arts die, Ki/Focus/Sorcery Points, Channel Divinity, Wild Shape,
  Bardic Die, Invocations, Favored Enemy**. Cells are strings, numbers, or
  `{type:"dice"|"bonus"|"bonusSpeed"}` (`getClassResources`/`getWeaponMasteryCount`).
  A group with `rowsSpellProgression` is the spell-slot table instead.
- **Spellcasting**: `casterProgression` (`full`/`1/2`/`1/3`/`artificer`/`pact`),
  `cantripProgression`, `spellsKnownProgression`, `preparedSpells` (formula),
  `spellcastingAbility`.
- **`additionalSpells`** — auto-granted domain/patron/circle spells. Array of
  groups with buckets `prepared`/`known`/`expanded`/`innate`, each keyed by
  **class level** → list of uids (`"cure wounds|phb"`) or dynamic
  `{choose}`/`{all}` filters. `getGrantedSpellUids` reads the plain-uid ones.
- **`optionalfeatureProgression`** — counts of Invocations / Fighting Styles /
  Maneuvers etc. by level (`getOptionalFeatureCounts`).
- **`startingProficiencies`** (skills/tools/languages, some as `{choose}`),
  **`startingEquipment`** (`defaultData` A/B groups), **`multiclassing`**.
- Feature *effects* that are only prose (a subclass adding an ability mod to
  Initiative, etc.) can't be read structurally — those use a **small curated map**
  (`charactersheet-features.js`, `charactersheet-actions.js`). Prefer structured
  reads; fall back to curated only for unambiguous prose cases.

Some counts are inconsistent between books (e.g. Weapon Mastery is a table
column for Fighter/Barbarian but prose "two kinds" for Rogue/Ranger/Paladin) —
read the column when present, curated fallback otherwise.

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
