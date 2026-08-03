import {describe, expect, it} from "@jest/globals";
import {
	SYNC_PATH_DEFAULT,
	SYNC_PATH_META,
	SyncConflictError,
	getMissingAdapterMethods,
	getSyncBasePath,
	getSyncClientUrl,
	getSyncEndpoints,
	isAdapterValid,
	isSameOrigin,
	isSyncConflict,
	normaliseSyncPath,
} from "../../js/charactersheet/charactersheet-sync.js";

/** A document stub with (or without) the configuration meta tag. */
const mkDoc = content => ({
	querySelector: sel => sel === `meta[name="${SYNC_PATH_META}"]` && content !== undefined
		? {getAttribute: () => content}
		: null,
});

const mkAdapter = (overrides = {}) => ({
	pWhoAmI: () => null,
	pList: () => [],
	pLoad: () => null,
	pSave: () => null,
	pDelete: () => null,
	...overrides,
});

describe("Character Sheet — the account-system seam", () => {
	describe("normaliseSyncPath", () => {
		it("Should add the leading slash and drop a trailing one", () => {
			expect(normaliseSyncPath("online")).toBe("/online");
			expect(normaliseSyncPath("/online/")).toBe("/online");
			expect(normaliseSyncPath("  /online  ")).toBe("/online");
		});

		it("Should keep a nested path intact", () => {
			expect(normaliseSyncPath("/tools/online")).toBe("/tools/online");
		});

		it("Should allow an absolute URL, for a deployment that is not behind the same proxy", () => {
			expect(normaliseSyncPath("https://accounts.example.com/")).toBe("https://accounts.example.com");
		});

		// A deployment must be able to say "no account system", not just "somewhere else"
		it("Should treat an empty or explicit off value as switched off", () => {
			expect(normaliseSyncPath("")).toBeNull();
			expect(normaliseSyncPath("   ")).toBeNull();
			expect(normaliseSyncPath("off")).toBeNull();
			expect(normaliseSyncPath("none")).toBeNull();
			expect(normaliseSyncPath("/")).toBeNull();
			expect(normaliseSyncPath(null)).toBeNull();
		});
	});

	describe("getSyncBasePath", () => {
		it("Should default to /online when nothing is configured", () => {
			expect(getSyncBasePath({win: {}, doc: mkDoc(undefined)})).toBe("/online");
			expect(SYNC_PATH_DEFAULT).toBe("/online");
		});

		it("Should take the meta tag over the default", () => {
			expect(getSyncBasePath({win: {}, doc: mkDoc("/accounts")})).toBe("/accounts");
		});

		it("Should take the window variable over the meta tag", () => {
			expect(getSyncBasePath({win: {CHARACTER_SYNC_PATH: "/from-config"}, doc: mkDoc("/from-meta")}))
				.toBe("/from-config");
		});

		it("Should let either source switch sync off entirely", () => {
			expect(getSyncBasePath({win: {CHARACTER_SYNC_PATH: ""}, doc: mkDoc("/accounts")})).toBeNull();
			expect(getSyncBasePath({win: {}, doc: mkDoc("")})).toBeNull();
		});
	});

	describe("Derived URLs", () => {
		it("Should put the client script under the configured path", () => {
			expect(getSyncClientUrl("/online")).toBe("/online/client.js");
			expect(getSyncClientUrl("/tools/accounts")).toBe("/tools/accounts/client.js");
		});

		it("Should have no client to load when sync is off", () => {
			expect(getSyncClientUrl(null)).toBeNull();
			expect(getSyncEndpoints(null)).toBeNull();
		});

		it("Should hang every endpoint off the same base", () => {
			const eps = getSyncEndpoints("/online");
			expect(eps.whoami).toBe("/online/api/whoami");
			expect(eps.login).toBe("/online/login");
			expect(eps.characters).toBe("/online/api/characters");
			expect(eps.character("abc")).toBe("/online/api/characters/abc");
		});

		it("Should escape an id rather than paste it into the URL", () => {
			expect(getSyncEndpoints("/online").character("a b/c")).toBe("/online/api/characters/a%20b%2Fc");
		});
	});

	// Same-origin is the whole point: it is what lets the session cookie authenticate each call
	describe("isSameOrigin", () => {
		it("Should be true for a path, false for another origin", () => {
			expect(isSameOrigin("/online")).toBe(true);
			expect(isSameOrigin("https://accounts.example.com")).toBe(false);
			expect(isSameOrigin(null)).toBe(false);
		});
	});

	describe("isAdapterValid", () => {
		it("Should accept an adapter implementing the whole contract", () => {
			expect(isAdapterValid(mkAdapter())).toBe(true);
			expect(getMissingAdapterMethods(mkAdapter())).toEqual([]);
		});

		// Half an adapter would take storage over and then fail partway — worse than none at all
		it("Should refuse one that is missing a method, and say which", () => {
			const partial = mkAdapter();
			delete partial.pSave;
			delete partial.pDelete;
			expect(isAdapterValid(partial)).toBe(false);
			expect(getMissingAdapterMethods(partial)).toEqual(["pSave", "pDelete"]);
		});

		it("Should refuse anything that is not an object of functions", () => {
			expect(isAdapterValid(null)).toBe(false);
			expect(isAdapterValid("yes")).toBe(false);
			expect(isAdapterValid({pWhoAmI: "not a function"})).toBe(false);
			expect(getMissingAdapterMethods(null)).toHaveLength(5);
		});
	});

	describe("SyncConflictError", () => {
		it("Should carry what the server holds, so the user can be asked which to keep", () => {
			const err = new SyncConflictError("changed elsewhere", {serverVersion: 7, serverEnvelope: {name: "Theirs"}});
			expect(isSyncConflict(err)).toBe(true);
			expect(err.serverVersion).toBe(7);
			expect(err.serverEnvelope.name).toBe("Theirs");
		});

		it("Should not mistake an ordinary failure for a conflict", () => {
			expect(isSyncConflict(new Error("network down"))).toBe(false);
			expect(isSyncConflict(null)).toBe(false);
		});
	});
});
