import {getFeatureInitiativeBonus} from "../../js/charactersheet/charactersheet-features.js";

describe("Feature effects: initiative", () => {
	const ctx = {abilities: {cha: 3, dex: 2}, pb: 3};

	it("Should add an ability modifier for Rakish Audacity", () => {
		expect(getFeatureInitiativeBonus(["Rakish Audacity"], ctx)).toBe(3); // Cha +3
	});

	it("Should add half proficiency for Jack of All Trades", () => {
		expect(getFeatureInitiativeBonus(["Jack of All Trades"], ctx)).toBe(1); // floor(3/2)
	});

	it("Should stack multiple effects and ignore unknown/duplicate features", () => {
		expect(getFeatureInitiativeBonus(["Rakish Audacity", "Jack of All Trades", "Sneak Attack", "Rakish Audacity"], ctx)).toBe(4);
	});

	it("Should return 0 with no relevant features", () => {
		expect(getFeatureInitiativeBonus(["Sneak Attack"], ctx)).toBe(0);
		expect(getFeatureInitiativeBonus([], ctx)).toBe(0);
		expect(getFeatureInitiativeBonus(null, ctx)).toBe(0);
	});
});
