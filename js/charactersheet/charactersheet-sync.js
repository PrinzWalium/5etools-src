/**
 * The seam an account system plugs into — and nothing more.
 *
 * The account system itself (OIDC login against Authentik, sessions, character storage) lives in a
 * **separate repository**, deployed behind the same subdomain on its own path by a reverse proxy.
 * This fork holds only the contract and the wiring, so that:
 *
 *  - the four shared upstream files stay four — nothing here touches them;
 *  - every later sync feature ships from the other repo, with no change to 5etools-src at all;
 *  - with no account system deployed, the pages behave exactly as they always have. That is not a
 *    fallback but a supported deployment: the GitHub Pages build is static, with no proxy in front.
 *
 * ## How it connects
 *
 * The account app serves a small client script at `<base>/client.js`. That script defines
 * `window.CharacterSyncAdapter`. The pages load it during `pInit`; if it is missing, or 404s, or
 * defines nothing valid, sync simply never turns on.
 *
 * Because everything is same-origin, the browser's own session cookie authenticates each call:
 * the client never sees or stores a credential, and there is no CORS to configure.
 *
 * ## The adapter contract
 *
 * ```js
 * window.CharacterSyncAdapter = {
 *   pWhoAmI (),                          // → {id, name} | null   (null = not signed in)
 *   pList   (),                          // → [{id, name, version, updatedAt}]
 *   pLoad   (id),                        // → {envelope, version}
 *   pSave   (id, envelope, {version}),   // → {version}            (throws SyncConflictError on 409)
 *   pDelete (id),                        // → void
 *   getLoginUrl (),                      // → string, where to send someone to sign in
 * }
 * ```
 *
 * `envelope` is the existing save-file envelope, unchanged — an export is therefore a valid upload,
 * and there is no second schema to keep in step.
 *
 * This module is DOM-free apart from reading the configured path off the document, and is tested.
 */

/** Where the account system is mounted, unless the deployment says otherwise. */
export const SYNC_PATH_DEFAULT = "/online";

/** The meta tag a deployment (or the reverse proxy, or the image) can set to move it. */
export const SYNC_PATH_META = "character-sync-path";

/** Set this to an empty string to switch sync off outright, whatever else is configured. */
const _isDisabled = value => value === "" || value === "off" || value === "none";

/**
 * Normalise a configured path: leading slash, no trailing one, so joining is unambiguous.
 * @return {string|null} null when sync is switched off.
 */
export function normaliseSyncPath (raw) {
	if (raw == null) return null;
	const str = String(raw).trim();
	if (_isDisabled(str)) return null;

	// An absolute URL is allowed, but loses the same-origin cookie — the caller is told, not stopped
	if (/^https?:\/\//i.test(str)) return str.replace(/\/+$/, "");

	const withLead = str.startsWith("/") ? str : `/${str}`;
	const trimmed = withLead.replace(/\/+$/, "");
	return trimmed || null;
}

/** Whether a base path will carry the session cookie — i.e. whether it is same-origin. */
export function isSameOrigin (basePath) {
	return !!basePath && !/^https?:\/\//i.test(basePath);
}

/**
 * Where the account system is mounted, most specific source first:
 *   1. `window.CHARACTER_SYNC_PATH`  — set by a `config.js` the image can drop in
 *   2. `<meta name="character-sync-path" content="…">` — set in the page or by the proxy
 *   3. `/online`
 */
export function getSyncBasePath ({win = typeof window !== "undefined" ? window : null, doc = typeof document !== "undefined" ? document : null} = {}) {
	if (win && Object.prototype.hasOwnProperty.call(win, "CHARACTER_SYNC_PATH")) {
		return normaliseSyncPath(win.CHARACTER_SYNC_PATH);
	}
	const meta = doc?.querySelector?.(`meta[name="${SYNC_PATH_META}"]`);
	if (meta) return normaliseSyncPath(meta.getAttribute("content"));
	return normaliseSyncPath(SYNC_PATH_DEFAULT);
}

/** The script the account app serves, which defines the adapter. */
export function getSyncClientUrl (basePath) {
	return basePath ? `${basePath}/client.js` : null;
}

/** The endpoints the adapter is expected to talk to, for documentation and for the other repo. */
export function getSyncEndpoints (basePath) {
	if (!basePath) return null;
	return {
		whoami: `${basePath}/api/whoami`,
		login: `${basePath}/login`,
		logout: `${basePath}/logout`,
		characters: `${basePath}/api/characters`,
		character: id => `${basePath}/api/characters/${encodeURIComponent(id)}`,
	};
}

const _ADAPTER_METHODS = ["pWhoAmI", "pList", "pLoad", "pSave", "pDelete"];

/**
 * Whether what turned up is usable. A half-implemented adapter is worse than none: it would take
 * the storage path over and then fail partway, so anything incomplete is refused outright.
 */
export function isAdapterValid (adapter) {
	if (!adapter || typeof adapter !== "object") return false;
	return _ADAPTER_METHODS.every(fn => typeof adapter[fn] === "function");
}

/** Which methods an otherwise plausible adapter is missing, so the reason can be reported. */
export function getMissingAdapterMethods (adapter) {
	if (!adapter || typeof adapter !== "object") return [..._ADAPTER_METHODS];
	return _ADAPTER_METHODS.filter(fn => typeof adapter[fn] !== "function");
}

/**
 * Raised by an adapter when the server holds a newer version than the one being written. Characters
 * are single-writer in practice, so the answer is to ask which to keep rather than to merge.
 */
export class SyncConflictError extends Error {
	constructor (message, {serverVersion = null, serverEnvelope = null} = {}) {
		super(message || "This character was changed elsewhere.");
		this.name = "SyncConflictError";
		this.serverVersion = serverVersion;
		this.serverEnvelope = serverEnvelope;
	}
}

export const isSyncConflict = err => err?.name === "SyncConflictError";
