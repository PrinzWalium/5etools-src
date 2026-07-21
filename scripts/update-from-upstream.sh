#!/usr/bin/env bash
#
# update-from-upstream.sh
# -----------------------
# Safely pull the latest changes from the original 5etools ("upstream") into
# this fork, keeping the Character Sheet builder intact.
#
# This fork adds a Character Sheet builder that upstream does not have. Almost
# all of that code lives in fork-only files that CANNOT conflict. Only a few
# small "registration" lines in shared files can ever conflict — see
# docs/CHARACTER_SHEET_MAINTENANCE.md for the exact list and how to fix them.
#
# Usage:
#   bash scripts/update-from-upstream.sh
#
# It never force-pushes and never throws away your work: it makes a backup
# branch first, and if anything goes wrong you can always return to it.

set -uo pipefail

# --- pretty output helpers ---------------------------------------------------
bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[33m! %s\033[0m\n' "$1"; }
err()  { printf '\033[31m✗ %s\033[0m\n' "$1"; }
step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

UPSTREAM_SUGGESTION="https://github.com/5etools-mirror-3/5etools-src.git"
DEFAULT_BRANCH="main"

cd "$(git rev-parse --show-toplevel)" || { err "Not inside a git repository."; exit 1; }

# --- 1. Make sure an 'upstream' remote is configured -------------------------
step "Checking for the 'upstream' remote"
if ! git remote get-url upstream >/dev/null 2>&1; then
	warn "No 'upstream' remote is set up yet."
	echo "  'upstream' is the ORIGINAL 5etools repo you forked from."
	echo "  Add it once with (replace the URL if you forked from somewhere else):"
	echo ""
	echo "      git remote add upstream $UPSTREAM_SUGGESTION"
	echo ""
	echo "  Then run this script again."
	exit 1
fi
ok "upstream = $(git remote get-url upstream)"

# --- 2. Refuse to run with uncommitted changes -------------------------------
step "Checking your working tree is clean"
if [ -n "$(git status --porcelain)" ]; then
	err "You have uncommitted changes. Commit or stash them first, then re-run."
	git status --short
	exit 1
fi
ok "Working tree is clean."

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# --- 3. Make a backup branch you can always return to ------------------------
BACKUP="backup/pre-upstream-$(date +%Y%m%d-%H%M%S)"
step "Creating a safety backup branch: $BACKUP"
git branch "$BACKUP"
ok "If anything looks wrong later, run:  git reset --hard $BACKUP"

# --- 4. Fetch upstream -------------------------------------------------------
step "Fetching the latest from upstream"
if ! git fetch upstream; then
	err "Could not reach upstream. Check your internet connection and the remote URL."
	exit 1
fi
ok "Fetched upstream."

# --- 5. Merge ----------------------------------------------------------------
step "Merging upstream/$DEFAULT_BRANCH into $CURRENT_BRANCH"
if git merge --no-edit "upstream/$DEFAULT_BRANCH"; then
	ok "Merged with no conflicts."
	CONFLICTS=""
else
	CONFLICTS="$(git diff --name-only --diff-filter=U)"
	warn "There were merge conflicts in these files:"
	echo "$CONFLICTS" | sed 's/^/    /'
	echo ""
	echo "  This fork only ever conflicts in a few small 'registration' spots."
	echo "  Open docs/CHARACTER_SHEET_MAINTENANCE.md — it lists the exact lines"
	echo "  the Character Sheet adds to each file, so you can keep BOTH your"
	echo "  lines and upstream's, then run:"
	echo ""
	echo "      git add <fixed file>        # once each conflict is resolved"
	echo "      git commit                   # finish the merge"
	echo "      bash scripts/update-from-upstream.sh   # re-run to regenerate + test"
	echo ""
	echo "  To abandon this update entirely and go back:"
	echo "      git merge --abort"
	exit 2
fi

# --- 6. Regenerate the generated pages (incl. charactersheet.html) -----------
# charactersheet.html is BUILT from a template; upstream changes to shared
# partials (header/navbar/etc.) only take effect after regenerating.
step "Regenerating generated HTML pages"
if node node/generate-pages.js >/dev/null 2>&1; then
	ok "Pages regenerated."
	if [ -n "$(git status --porcelain)" ]; then
		git add -A
		git commit --no-edit -m "chore: regenerate pages after upstream merge" >/dev/null
		ok "Committed regenerated pages."
	fi
else
	warn "Page generation reported a problem — run 'node node/generate-pages.js' manually to see it."
fi

# --- 7. Sanity-check the Character Sheet -------------------------------------
step "Running Character Sheet checks (lint + unit tests)"
LINT_OK=1; TEST_OK=1
npx eslint js/charactersheet.js js/charactersheet/ >/dev/null 2>&1 || LINT_OK=0
node --localstorage-file test/temp/localstorage.tmp --experimental-vm-modules \
	node_modules/jest/bin/jest.js test/jest/CharacterSheet >/dev/null 2>&1 || TEST_OK=0

[ "$LINT_OK" = 1 ] && ok "Lint passed." || err "Lint FAILED — run: npx eslint js/charactersheet.js js/charactersheet/"
[ "$TEST_OK" = 1 ] && ok "Character Sheet tests passed." || err "Tests FAILED — run the jest command in package.json (test:unit)."

# --- 8. Done -----------------------------------------------------------------
step "Update complete"
if [ "$LINT_OK" = 1 ] && [ "$TEST_OK" = 1 ]; then
	ok "You're up to date with upstream and the Character Sheet still works."
	echo "  Push when ready:   git push origin $CURRENT_BRANCH"
	echo "  Safety backup at:  $BACKUP  (delete later with: git branch -D $BACKUP)"
else
	warn "Update merged, but a check failed above. Review it before pushing."
	echo "  Undo everything with:  git reset --hard $BACKUP"
fi
