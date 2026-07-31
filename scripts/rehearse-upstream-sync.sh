#!/usr/bin/env bash
#
# rehearse-upstream-sync.sh
# -------------------------
# Prove that .github/workflows/sync-upstream.yml actually works, without waiting
# for upstream to move.
#
# The scheduled sync is nearly always a no-op: when upstream has not changed it
# skips ten of its twelve steps and reports success. That green tick says only
# "there was nothing to do" — it never demonstrates that the merge, the page
# regeneration, the lint and the tests behave. Nor can a run in the Actions tab
# ever exercise the conflict path on purpose.
#
# This rehearses both, against a synthetic upstream branched from the real one:
#
#   bash scripts/rehearse-upstream-sync.sh clean
#       upstream changes a shared head partial (which every generated page
#       includes) and bumps the version. Expected: merge, regenerate, lint and
#       test all succeed, and the push would go to `main`.
#
#   bash scripts/rehearse-upstream-sync.sh conflict
#       upstream edits js/navigation.js immediately beside the three lines the
#       fork adds there. Expected: the merge conflicts, the markers are
#       committed, nothing is built or pushed, and a pull request is opened.
#
# Everything happens in a throwaway clone under a temporary directory; the
# working repository is never touched and nothing is pushed anywhere.

set -uo pipefail

MODE="${1:-clean}"
case "$MODE" in
	clean|conflict) ;;
	*) echo "usage: $0 [clean|conflict]" >&2; exit 2 ;;
esac

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[33m! %s\033[0m\n' "$1"; }
err()  { printf '\033[31m✗ %s\033[0m\n' "$1"; }
fail() { err "failed at: $1"; exit 1; }

SRC="$(git rev-parse --show-toplevel)" || exit 1
UPSTREAM_REPO=https://github.com/5etools-mirror-3/5etools-src.git
UPSTREAM_BRANCH=main
TARGET_BRANCH=main

WORK="$(mktemp -d -t sync-rehearsal-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

bold "Rehearsing the '$MODE' path of the upstream sync"

# --- a real upstream commit to branch the simulation from --------------------
git -C "$SRC" remote get-url upstream >/dev/null 2>&1 \
	|| git -C "$SRC" remote add upstream "$UPSTREAM_REPO"
git -C "$SRC" fetch -q upstream "$UPSTREAM_BRANCH" || fail "fetching upstream"
UPSTREAM_SHA="$(git -C "$SRC" rev-parse "upstream/$UPSTREAM_BRANCH")"
ok "upstream/$UPSTREAM_BRANCH is at $UPSTREAM_SHA"

# --- a throwaway clone, with the server's branch rather than the local one ----
git clone -q --no-hardlinks "$SRC" "$WORK/repo" || fail "cloning"
cd "$WORK/repo" || exit 1
# `npm ci` is proven on every push by charactersheet-ci.yml; borrow the tree.
[ -d "$SRC/node_modules" ] && ln -s "$SRC/node_modules" node_modules

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git fetch -q "$SRC" "+refs/remotes/origin/$TARGET_BRANCH:refs/heads/target" || fail "fetching $TARGET_BRANCH"
git checkout -q -B "$TARGET_BRANCH" target
BASE="$(git rev-parse HEAD)"
ok "$TARGET_BRANCH is at $BASE"

# --- the synthetic upstream commit -------------------------------------------
git checkout -q -b upstream-sim "$UPSTREAM_SHA"
if [ "$MODE" = clean ]; then
	node -e '
		const fs = require("fs");
		const p = "node/generate-pages/template/head/template-head.hbs";
		const s = fs.readFileSync(p, "utf8");
		if (!s.includes("<meta charset=\"utf-8\">")) throw new Error("anchor not found in " + p);
		fs.writeFileSync(p, s.replace("<meta charset=\"utf-8\">", "<meta charset=\"utf-8\">\n<meta name=\"sync-rehearsal\" content=\"upstream-was-here\">"));
		const j = JSON.parse(fs.readFileSync("package.json", "utf8"));
		j.version = "99.0.0";
		fs.writeFileSync("package.json", `${JSON.stringify(j, null, "\t")}\n`);
	' || fail "building the simulated upstream commit"
	git commit -qam "Simulated upstream release: shared head partial + version bump"
else
	node -e '
		const fs = require("fs");
		const p = "js/navigation.js";
		const s = fs.readFileSync(p, "utf8");
		if (!s.includes("aText: \"Stat Generator\"")) throw new Error("anchor not found in " + p);
		fs.writeFileSync(p, s.replace("aText: \"Stat Generator\"", "aText: \"Ability Score Generator\""));
	' || fail "building the simulated upstream commit"
	git commit -qam "Simulated upstream change beside the fork's own navbar lines"
fi
git checkout -q "$TARGET_BRANCH"
ok "simulated an upstream that is one commit ahead"

# --- from here: the workflow's own steps -------------------------------------
UP=upstream-sim

bold "step: Check whether there is anything to merge"
if git merge-base --is-ancestor "$UP" HEAD; then
	fail "the rehearsal produced nothing to merge"
fi
ok "has-changes=true"

bold "step: Merge upstream"
if git merge --no-edit "$UP"; then
	CLEAN=true
	ok "merged cleanly"
else
	CLEAN=false
	warn "conflicts in: $(git diff --name-only --diff-filter=U | tr '\n' ' ')"
	git add -A
	git commit -qm "chore: merge upstream (CONFLICTS — resolve before merging)" --no-verify
fi

if [ "$CLEAN" = true ]; then
	[ "$MODE" = clean ] || fail "the conflict rehearsal merged cleanly — the anchor no longer collides"

	bold "step: Regenerate pages"
	node node/generate-pages.js >/dev/null || fail "generate-pages"
	if [ -n "$(git status --porcelain)" ]; then
		ok "the regeneration picked up upstream's partial: $(git status --porcelain | wc -l) files"
		git add -A
		git commit -qm "chore: regenerate pages after upstream merge"
	else
		fail "the regeneration changed nothing — upstream's partial never reached the pages"
	fi

	bold "step: Verify the Character Sheet still works"
	npx eslint js/charactersheet.js js/charbuilder.js js/sidekick.js js/charactersheet/ || fail "eslint"
	ok "eslint"
	mkdir -p test/temp
	node --localstorage-file test/temp/localstorage.tmp --experimental-vm-modules \
		node_modules/jest/bin/jest.js test/jest/CharacterSheet 2>&1 | tail -5 || fail "jest"

	bold "step: Push the merge"
	git push --dry-run "$SRC" "HEAD:refs/heads/sync-rehearsal" >/dev/null 2>&1 || fail "push"
	ok "the push would move $TARGET_BRANCH by $(git rev-list --count "$BASE"..HEAD) commits"
else
	[ "$MODE" = conflict ] || fail "the clean rehearsal conflicted"

	bold "step: Open a pull request for manual resolution"
	git --no-pager grep -q '^<<<<<<<' HEAD -- js/navigation.js \
		&& ok "conflict markers are committed, so the pull request shows them" \
		|| fail "the conflict markers were not committed"
	[ -z "$(git status --porcelain)" ] || fail "the tree was left dirty"
	ok "nothing was built and nothing would be pushed to $TARGET_BRANCH"
fi

bold "The '$MODE' path behaves as documented."
