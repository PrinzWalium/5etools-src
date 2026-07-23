import {CharacterSheetClassData} from "../../js/charactersheet/charactersheet-classdata.js";

describe("CharacterSheetClassData.getFeatureFeatGrants", () => {
	it("Detects a Fighting Style feat grant from feature prose", () => {
		const feature = {entries: [
			"You gain a {@filter Fighting Style feat|feats|category=FS} of your choice.",
			"Whenever you gain a Fighter level, you can replace it with a different {@filter Fighting Style feat|feats|category=FS}.",
		]};
		// Two references, one category → one distinct grant
		expect(CharacterSheetClassData.getFeatureFeatGrants(feature)).toEqual([{category: "FS"}]);
	});

	it("Detects an Epic Boon grant", () => {
		const feature = {entries: ["You gain an {@filter Epic Boon feat|feats|category=EB} of your choice."]};
		expect(CharacterSheetClassData.getFeatureFeatGrants(feature)).toEqual([{category: "EB"}]);
	});

	it("Walks nested entries", () => {
		const feature = {entries: [{type: "entries", entries: ["Pick a {@filter x|feats|category=FS}."]}]};
		expect(CharacterSheetClassData.getFeatureFeatGrants(feature)).toEqual([{category: "FS"}]);
	});

	it("Returns nothing for features that grant no feat", () => {
		expect(CharacterSheetClassData.getFeatureFeatGrants({entries: ["You gain Second Wind."]})).toEqual([]);
		expect(CharacterSheetClassData.getFeatureFeatGrants({})).toEqual([]);
		expect(CharacterSheetClassData.getFeatureFeatGrants(null)).toEqual([]);
	});
});
