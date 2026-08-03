# The account system — what this repo provides, and what it expects

The account system is **a separate project**: <https://github.com/PrinzWalium/5etools-online>. This repository holds only the seam it plugs into
(`js/charactersheet/charactersheet-sync.js` plus a loader in `charactersheet-pagebase.js`), so that
the fork stays easy to update from upstream and every later sync feature ships from the other
repository instead of this one.

This document is the contract. It is written for whoever builds that other project.

---

## The shape of the deployment

One subdomain, a reverse proxy in front, two things behind it:

```
https://tools.example.com/            → the 5etools fork (static, this repo's Docker image)
https://tools.example.com/online/*    → the account system (its own container)
```

Same origin is the whole point:

- the browser's own session cookie authenticates every API call, so the client never holds a
  credential and there is nothing in `localStorage` to leak;
- there is no CORS to configure and no per-deployment client config to ship.

An absolute URL on another origin is *accepted* by the path config, but the session cookie will
likely not be sent — the page warns and carries on rather than pretending it works.

## Where it is mounted

The path is configuration, not a constant. Resolved most specific first:

1. `window.CHARACTER_SYNC_PATH` — for a `config.js` an image can drop in
2. `<meta name="character-sync-path" content="/online">` — easy for a reverse proxy to inject
3. `/online` — the default

Setting either source to `""`, `"off"` or `"none"` switches sync off entirely.

## What the pages do

During `pInit`, before the page builds, `_pLoadSyncAdapter` loads `<base>/client.js` and looks for
`window.CharacterSyncAdapter`.

**Every failure is silent and inert.** No account system deployed, a 404, a script that throws —
each leaves the pages exactly as they are without one. That is a supported deployment, not a
degraded one: the GitHub Pages build is static, with no proxy in front. Only one case is reported,
because it is a mistake rather than a choice: an adapter that exists but does not implement the
whole contract, which is refused with the missing method names rather than allowed to take storage
over and then fail partway.

## The adapter

`<base>/client.js` must define:

```js
window.CharacterSyncAdapter = {
	// → {id, name} | null   (null means "not signed in")
	async pWhoAmI () {},

	// → [{id, name, version, updatedAt}]
	async pList () {},

	// → {envelope, version}
	async pLoad (id) {},

	// → {version}; throw SyncConflictError when the server holds a newer version
	async pSave (id, envelope, {version}) {},

	async pDelete (id) {},

	// where to send someone to sign in — the OIDC dance is entirely the account app's business
	getLoginUrl () {},
};
```

`envelope` is **the existing save-file envelope**, unchanged. A *Save to File* export is therefore a
valid upload, and there is no second schema to keep in step with this one.

The five `p*` methods are required; an adapter missing any of them is refused.

## Endpoints the client script is expected to use

Given a base of `/online`, `getSyncEndpoints` documents the shape:

| Purpose | Path |
| --- | --- |
| Who is signed in | `/online/api/whoami` |
| Begin sign-in | `/online/login` |
| Sign out | `/online/logout` |
| List / create characters | `/online/api/characters` |
| One character | `/online/api/characters/:id` |

These are a convention for the other project, not something this repo calls directly — the adapter
is free to do otherwise as long as it satisfies the contract above.

## Authentication

**OIDC against an existing Authentik instance.** The account app is a confidential OIDC client and
owns the whole flow; this fork never sees a token, an identity, or a password. It only ever learns
whether `pWhoAmI()` answers.

That is deliberate: it means nothing in this repository — and nothing in the account app either —
has to store password hashes, or own resets and revocation.

## Rules for the other project to honour

- **Local-first, never server-first.** Write `localStorage` always, then queue a push. The UI must
  never block on the network: play has to survive the wifi dying mid-session.
- **Single-writer conflicts.** Concurrency by a per-character version and `If-Match`. On a clash,
  throw `SyncConflictError` carrying the server's version and envelope so the user can be asked
  *keep mine / take theirs*. Do not attempt a merge — characters are single-writer in practice.
- **Own the character, not the rules.** The account app stores envelopes. It should never need to
  understand a class, a spell or a level.

## Testing it from this side

- `test/jest/CharacterSheetSync.test.js` — the path resolution, the contract check, the conflict
  error.
- `test/e2e/sync.e2e.mjs` — the no-account-system state: nothing picked up, nothing logged, and a
  character still edited and persisted locally across a reload.

When there is an account app to test against, point a dev proxy at it and add a suite beside those.
