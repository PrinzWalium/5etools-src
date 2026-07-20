import "../../js/parser.js";
import {
	CHOICE_TYPE_LANGUAGE,
	CHOICE_TYPE_SKILL,
	CHOICE_TYPE_TOOL,
	getPendingChoices,
	getProfListDisplay,
} from "../../js/charactersheet/charactersheet-choices.js";
import {
	POINT_BUY_BUDGET,
	STANDARD_ARRAY,
	getPointBuyCost,
	getPointBuyTotalCost,
	isValidStandardArrayAssignment,
} from "../../js/charactersheet/charactersheet-abilityscores.js";

describe("Choice queue extraction", () => {
	it("Should extract a class skill choice (Fighter-style)", () => {
		const cls = {
			name: "Fighter",
			startingProficiencies: {
				skills: [{choose: {from: ["acrobatics", "animal handling", "athletics", "history", "insight", "intimidation", "perception", "survival"], count: 2}}],
			},
		};
		const choices = getPendingChoices({cls});
		expect(choices).toHaveLength(1);
		expect(choices[0].type).toBe(CHOICE_TYPE_SKILL);
		expect(choices[0].count).toBe(2);
		expect(choices[0].from).toContain("Animal Handling");
		expect(choices[0].sourceName).toBe("Class: Fighter");
	});

	it("Should extract race any-skill and standard-language choices (Half-Elf-style)", () => {
		const race = {
			name: "Half-Elf",
			skillProficiencies: [{any: 2}],
			languageProficiencies: [{common: true, elvish: true, anyStandard: 1}],
		};
		const choices = getPendingChoices({race});
		const skillChoice = choices.find(it => it.type === CHOICE_TYPE_SKILL);
		const langChoice = choices.find(it => it.type === CHOICE_TYPE_LANGUAGE);

		expect(skillChoice.count).toBe(2);
		expect(skillChoice.from).toHaveLength(18);
		expect(langChoice.count).toBe(1);
		expect(langChoice.from).toContain("Dwarvish");
		// Fixed languages are not part of the choice
		expect(langChoice.from.length).toBe(Parser.LANGUAGES_STANDARD.length);
	});

	it("Should extract background tool choices (Soldier-style gaming set)", () => {
		const background = {
			name: "Soldier",
			skillProficiencies: [{athletics: true, intimidation: true}],
			toolProficiencies: [{anyGamingSet: 1, "vehicles (land)": true}],
		};
		const choices = getPendingChoices({background});
		expect(choices).toHaveLength(1);
		expect(choices[0].type).toBe(CHOICE_TYPE_TOOL);
		expect(choices[0].from).toContain("Dice set");
	});

	it("Should order choices species → class → background", () => {
		const choices = getPendingChoices({
			race: {name: "Half-Elf", skillProficiencies: [{any: 2}]},
			cls: {name: "Fighter", startingProficiencies: {skills: [{choose: {from: ["athletics"], count: 1}}]}},
			background: {name: "Sage", languageProficiencies: [{anyStandard: 2}]},
		});
		expect(choices.map(it => it.sourceName)).toEqual(["Species: Half-Elf", "Class: Fighter", "Background: Sage"]);
	});

	it("Should render fixed proficiency displays, with and without choice text", () => {
		const groups = [{anyGamingSet: 1, "vehicles (land)": true}];
		expect(getProfListDisplay(groups)).toBe("1 of your choice, Vehicles (Land)");
		expect(getProfListDisplay(groups, {isFixedOnly: true})).toBe("Vehicles (Land)");
	});
});

describe("Ability score methods", () => {
	it("Should cost point-buy scores per the PHB table", () => {
		expect(getPointBuyCost(8)).toBe(0);
		expect(getPointBuyCost(13)).toBe(5);
		expect(getPointBuyCost(14)).toBe(7);
		expect(getPointBuyCost(15)).toBe(9);
		expect(getPointBuyCost(16)).toBeNull();
		expect(getPointBuyCost(7)).toBeNull();
	});

	it("Should total a classic 27-point spread", () => {
		// 15/15/15/8/8/8 = 9+9+9 = 27; the classic 15/14/13/12/10/8 spread also totals exactly 27
		expect(getPointBuyTotalCost({str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8})).toBe(POINT_BUY_BUDGET);
		expect(getPointBuyTotalCost({str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8})).toBe(POINT_BUY_BUDGET);
		expect(getPointBuyTotalCost({str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8})).toBeNull();
	});

	it("Should validate standard array assignments", () => {
		expect(isValidStandardArrayAssignment({str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8})).toBe(true);
		expect(isValidStandardArrayAssignment({str: 8, dex: 10, con: 12, int: 13, wis: 14, cha: 15})).toBe(true);
		expect(isValidStandardArrayAssignment({str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8})).toBe(false);
		expect(isValidStandardArrayAssignment({str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: null})).toBe(false);
		expect(STANDARD_ARRAY).toHaveLength(6);
	});
});
