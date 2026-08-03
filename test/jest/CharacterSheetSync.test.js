import {describe, expect, it} from "@jest/globals";
import {
	SYNC_PATH_DEFAULT,
	SYNC_PATH_META,
	SyncConflictError,
	getMissingAdapterMethods,
	getSyncBasePath,
	getSyncCapabilities,
	getSyncClientUrl,
	getSyncEndpoints,
	getSyncStatus,
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

	describe("getSyncCapabilities", () => {
		it("Should assume everything works when an adapter says nothing", () => {
			expect(getSyncCapabilities({})).toEqual({characters: true});
			expect(getSyncCapabilities(null)).toEqual({characters: true});
		});

		it("Should believe an adapter that says character storage is not open yet", () => {
			expect(getSyncCapabilities({getCapabilities: () => ({characters: false})})).toEqual({characters: false});
			expect(getSyncCapabilities({capabilities: {characters: false}})).toEqual({characters: false});
		});

		// A throwing adapter must not take the page down on the way to drawing a badge
		it("Should treat a broken declaration as no declaration", () => {
			expect(getSyncCapabilities({getCapabilities: () => { throw new Error("nope"); }})).toEqual({characters: true});
		});
	});

	describe("getSyncStatus", () => {
		// A static build has no account system, and decorating it with a red badge would report the
		// absence of a feature as a fault
		it("Should be off, and so invisible, when nothing is deployed", () => {
			expect(getSyncStatus({}).kind).toBe("off");
			expect(getSyncStatus({basePath: "/online", isLoaded: false}).kind).toBe("off");
		});

		it("Should report a half-implemented adapter as an error, naming what is missing", () => {
			const status = getSyncStatus({basePath: "/online", isLoaded: true, missingMethods: ["pSave", "pDelete"]});
			expect(status.kind).toBe("error");
			expect(status.tone).toBe("bad");
			expect(status.lines.some(l => /pSave, pDelete/.test(l.value))).toBe(true);
		});

		it("Should carry the failure's own message, so the popover can show it", () => {
			const status = getSyncStatus({basePath: "/online", isLoaded: true, error: new Error("502 Bad Gateway")});
			expect(status.kind).toBe("error");
			expect(status.lines.some(l => l.value === "502 Bad Gateway")).toBe(true);
		});

		it("Should offer a sign-in when connected but signed out", () => {
			const status = getSyncStatus({basePath: "/online", isLoaded: true, user: null});
			expect(status.kind).toBe("signedOut");
			expect(status.canSignIn).toBe(true);
			expect(status.canSignOut).toBe(false);
		});

		it("Should name whoever is signed in, and their role", () => {
			const status = getSyncStatus({basePath: "/online", isLoaded: true, user: {id: "u1", name: "Ada", role: "admin"}});
			expect(status.kind).toBe("signedIn");
			expect(status.tone).toBe("ok");
			expect(status.label).toBe("Online \u2014 Ada");
			expect(status.lines.some(l => l.label === "Role" && l.value === "admin")).toBe(true);
			expect(status.canSignOut).toBe(true);
		});

		// Signed in to a service that does not store characters yet is not "online" in the sense a
		// player would read it, so it must not look like it
		it("Should say plainly when characters are not stored online yet", () => {
			const status = getSyncStatus({basePath: "/online", isLoaded: true, user: {name: "Ada"}, capabilities: {characters: false}});
			expect(status.kind).toBe("signedIn");
			expect(status.tone).toBe("warn");
			expect(status.lines.some(l => l.label === "Characters" && /only copy/.test(l.value))).toBe(true);
		});

		it("Should always say where it looked", () => {
			expect(getSyncStatus({basePath: "/accounts", isLoaded: true, user: null}).lines[0])
				.toEqual({label: "Account system", value: "/accounts"});
		});
	});
});
