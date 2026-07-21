import "../../js/parser.js";
import "../../js/utils.js";
import {CHAR_STORE_VERSION, getCharacterLabel, getMigratedStore, getNewStore} from "../../js/charactersheet/charactersheet-charstore.js";

describe("Multi-character store migration", () => {
	it("Should pass a current store through unchanged", () => {
		const store = {storeVersion: CHAR_STORE_VERSION, currentId: "x", characters: {x: {version: 2, state: {name: "A"}}}};
		expect(getMigratedStore(store)).toBe(store);
	});

	it("Should wrap a v2 single-character envelope into a one-character store", () => {
		const envelope = {version: 2, state: {name: "Solo"}};
		const store = getMigratedStore(envelope);
		expect(store.storeVersion).toBe(CHAR_STORE_VERSION);
		expect(Object.keys(store.characters)).toHaveLength(1);
		expect(store.characters[store.currentId]).toBe(envelope);
	});

	it("Should wrap a legacy v1 field map into a one-character store", () => {
		const legacy = {fields: {"cs-name": "Old-Timer"}, skills: {}, saves: {}};
		const store = getMigratedStore(legacy);
		expect(store.characters[store.currentId]).toBe(legacy);
	});

	it("Should reject unrecognisable data", () => {
		expect(getMigratedStore(null)).toBeNull();
		expect(getMigratedStore("junk")).toBeNull();
		expect(getMigratedStore({foo: 1})).toBeNull();
	});

	it("Should create fresh stores with a single empty character", () => {
		const store = getNewStore();
		expect(store.characters[store.currentId]).toBeNull();
	});

	it("Should label characters from either envelope shape", () => {
		expect(getCharacterLabel({version: 2, state: {name: "Wiz Ard"}})).toBe("Wiz Ard");
		expect(getCharacterLabel({fields: {"cs-name": "Legacy Larry"}})).toBe("Legacy Larry");
		expect(getCharacterLabel(null)).toBe("Unnamed Character");
		expect(getCharacterLabel({version: 2, state: {name: "  "}})).toBe("Unnamed Character");
	});
});
