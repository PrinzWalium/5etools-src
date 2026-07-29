# Character Sheet — Maintenance & Upstream Updates

This fork adds a **Character Sheet builder** that the original 5etools does not
have. This page explains, in plain terms, how to keep your fork up to date with
upstream 5etools **without losing the builder** — and what to do in the rare
case of a merge conflict.

You do **not** need to be a programmer to follow this.

---

## The one-command update

```bash
bash scripts/update-from-upstream.sh
```

That script fetches the latest upstream changes, merges them, rebuilds the
generated pages, and runs the Character Sheet's tests. It makes a **safety
backup branch** first, so nothing is ever lost.

**First time only:** tell git where the original 5etools lives (this is the repo
you forked from). Run once:

```bash
git remote add upstream https://github.com/5etools-mirror-3/5etools-src.git
```

(If you forked from a different repo, use that URL instead.)

---

## The automatic update (and the button that must never be pressed)

`.github/workflows/sync-upstream.yml` runs the same update **every night**, and
can also be started by hand from the repo's **Actions** tab. It merges upstream
into `main`, regenerates the pages, and runs the Character Sheet's lint and
tests. If all of that passes it pushes to `main`; if the merge conflicts, or a
check fails, it pushes **nothing** and opens a pull request for you instead.

> **Never use GitHub's "Sync fork → Discard commits" button.**
>
> That button does not merge — it *resets* `main` to upstream and throws every
> commit this fork ever added away, the Character Sheet included. It has already
> done so once. Upstream cannot touch your fork on its own; only that button (or
> a `git push --force` to `main`) can.
>
> Two things make it a non-issue: the nightly sync above removes any reason to
> press it, and **protecting `main`** stops it working even if someone does.
> Turn that on once, in the repo's *Settings → Branches → Add branch ruleset*:
> target `main`, and tick **Block force pushes**.

If `main` is ever wiped again, nothing is lost as long as `beta` still has the
work: merge upstream's `main` into `beta`, then push that merge to `main` (it
fast-forwards, so no force push is needed and upstream's releases stay in the
history).

---

## Why conflicts are rare

A merge conflict can only happen when **both** upstream **and** your fork change
**the same file**. Almost the entire Character Sheet lives in **fork-only files**
that upstream doesn't have, so they can never conflict:

- `charactersheet.html` (generated — see below)
- `js/charactersheet.js` and everything in `js/charactersheet/`
- `css/charactersheet.css`, `scss/charactersheet.scss`
- `node/generate-pages/template/page/template-page-charactersheet.hbs`
- `test/jest/CharacterSheet*.test.js`

That's ~95% of the work, and it is **conflict-proof**.

---

## The only 4 places a conflict can happen

The Character Sheet has to be "registered" into a few shared files so the app
knows the page exists. These are the **only** spots that can ever conflict. If
the update script reports a conflict, it will be in one of these — and the fix
is always the same: **keep both your line(s) and upstream's**.

### 1. `js/navigation.js` — the navbar entry

Your fork adds this one line (puts "Character Sheet" in the Player menu):

```js
this._addElement_li({keyPath: [NavBar._CAT_PLAYER], page: "charactersheet.html", aText: "Character Sheet"});
```

**On conflict:** keep upstream's surrounding menu entries *and* this line.

### 2. `index.html` — the two home-page buttons

Your fork adds two `<a ... href="charactersheet.html" ...>` buttons on the home
page (one narrow-screen, one normal). Each looks like:

```html
<a class="home__btn-page ve-btn ve-btn-default home__btn-player" href="charactersheet.html" title="Build and manage a character with an interactive digital character sheet. Autosaves to your browser.">
```

**On conflict:** keep upstream's home layout *and* your two buttons. If a button
ends up duplicated after resolving, just delete the extra — it's harmless
either way.

### 3. `node/generate-pages/generate-pages-page-generator-config.js` — the page build entry

Your fork adds a page-generator class and registers it. The class:

```js
class _PageGeneratorCharactersheet extends PageGeneratorGeneric {
	_filename = "page/template-page-charactersheet.hbs";
	_page = "charactersheet.html";
	_pageTitle = "Character Sheet";
	_navbarDescription = "Build and manage a character. Autosaves to your browser.";
	_stylesheets = ["charactersheet"];
	_scriptsModules = ["charactersheet.js"];
}
```

…and one line in the list of generators near the bottom of the file:

```js
new _PageGeneratorCharactersheet(),
```

**On conflict:** keep upstream's other generators *and* both of these.

> **Resolving a conflict** just means opening the file, finding the
> `<<<<<<<`, `=======`, `>>>>>>>` markers, and editing so that **both** sides'
> content is present (deleting the marker lines). Then `git add <file>` and
> `git commit`. Re-run the update script afterward to rebuild and test.

---

### 4. `package.json` — two added lines

The fork adds one script and one dev dependency for its browser tests:

```json
"test:e2e": "node test/e2e/run-e2e.mjs",
```
```json
"playwright-core": "^1.61.1",
```

If this ever conflicts, keep **both** sides' lines — upstream's dependency changes and these two.

---

## Testing the Character Sheet

Three layers, cheapest first — all of them run in CI on every push
(`.github/workflows/charactersheet-ci.yml`):

```bash
npm run test:unit -- test/jest/CharacterSheet   # pure rules, ~2s
npm run test:e2e                                 # the real pages in a browser, ~2min
npx eslint js/charactersheet.js js/charbuilder.js js/charactersheet/
```

Prefer a unit test when the logic is pure. `test/e2e/README.md` explains the browser suites and
how to add one.

---

## Important: `charactersheet.html` is a *generated* file

Never hand-edit `charactersheet.html` — the build overwrites it. Its real source
is the template:

```
node/generate-pages/template/page/template-page-charactersheet.hbs
```

To change the page's markup, edit the **template**, then regenerate:

```bash
node node/generate-pages.js
```

The update script does this regeneration for you automatically, which also picks
up any upstream changes to the shared page header/navbar.

---

## If something goes wrong

Every run of the update script prints a **backup branch** name like
`backup/pre-upstream-20260101-120000`. To completely undo an update and return
to exactly where you were:

```bash
git reset --hard backup/pre-upstream-YYYYMMDD-HHMMSS
```

Or, if you're mid-merge and want to bail out:

```bash
git merge --abort
```

---

## Asking Claude for help

If you'd rather not resolve a conflict by hand, you can open a Claude Code
session and say *"pull the latest from upstream into my fork."* The repo's
`CLAUDE.md` tells Claude exactly how this fork is structured and how to resolve
these specific conflict points, so it can do it for you safely.
