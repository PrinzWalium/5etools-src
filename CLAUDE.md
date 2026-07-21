# CLAUDE.md — project orientation for AI sessions

This repository is a **fork of 5etools-src**. Its distinguishing customization
is a **Character Sheet builder** (a full, data-driven D&D character
builder/sheet) that upstream 5etools does **not** have.

When helping with this repo, prioritize keeping that builder working and keeping
the fork easy to update from upstream.

## Character Sheet: file map

**Fork-owned (upstream has no version → these never conflict on an upstream merge):**
- `charactersheet.html` — **generated**, do not hand-edit (see below)
- `js/charactersheet.js` — page entry point
- `js/charactersheet/*.js` — the builder modules (model, derive, classdata,
  levelengine, choices, abilityscores, equipment, wizard, and the panel
  renderers, charstore)
- `css/charactersheet.css`, `scss/charactersheet.scss`
- `node/generate-pages/template/page/template-page-charactersheet.hbs`
- `test/jest/CharacterSheet*.test.js`

**Shared upstream files the fork edits (the ONLY upstream-merge conflict points):**
1. `js/navigation.js` — one `_addElement_li({... page: "charactersheet.html" ...})` line
2. `index.html` — two `<a href="charactersheet.html">` home-page buttons
3. `node/generate-pages/generate-pages-page-generator-config.js` — a
   `_PageGeneratorCharactersheet` class + one `new _PageGeneratorCharactersheet(),`
   registration line

Exact snippets and resolution steps: `docs/CHARACTER_SHEET_MAINTENANCE.md`.

## Critical gotcha: charactersheet.html is generated

`charactersheet.html` is built from
`node/generate-pages/template/page/template-page-charactersheet.hbs` by
`node node/generate-pages.js` (run in the Docker/Pages builds). **Editing
`charactersheet.html` directly is silently overwritten by the build.** To change
the page markup, edit the **template** and regenerate. After editing the
template, run `node node/generate-pages.js` and commit both.

## Architecture notes

- The builder is model-driven: `CharacterModel` (a 5etools `BaseComponent`
  subclass in `charactersheet-model.js`) is the single source of truth. UI
  mutates the model; the model's hooks re-render. Rendering is one-directional.
- Game rules are read from the real data (classes, races, feats, spells, items),
  not hardcoded — except the PHB multiclass spell-slot table, which is a fixed
  core rule in `charactersheet-levelengine.js`.
- The pure rules modules (`derive`, `levelengine`, `choices`, `abilityscores`,
  `equipment`, `charstore`) are unit-tested; keep them DOM-free and tested.

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
