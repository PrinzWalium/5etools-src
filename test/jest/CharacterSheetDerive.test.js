import "../../js/parser.js";
import {deriveCharacterSheet, getProfBonus, getTotalLevel} from "../../js/charactersheet/charactersheet-derive.js";

const getBaseState = (overrides = {}) => ({
	level: 1,
	initMisc: 0,
	classes: [],
	abil_str: 10,
	abil_dex: 10,
	abil_con: 10,
	abil_int: 10,
	abil_wis: 10,
	abil_cha: 10,
	spellAbility: "",
	...overrides,
});

describe("Character sheet derivation", () => {
	it("Should derive a level 5 fighter (PHB values)", () => {
		const state = getBaseState({
			level: 5,
			abil_str: 16,
			abil_dex: 14,
			abil_con: 15,
			save_str: true,
			save_con: true,
			skill_athletics: 1,
			skill_perception: 1,
		});
		const derived = deriveCharacterSheet(state);

		expect(derived.totalLevel).toBe(5);
		expect(derived.pb).toBe(3);
		expect(derived.abilities.str.mod).toBe(3);
		expect(derived.saves.str.mod).toBe(6);
		expect(derived.saves.con.mod).toBe(5);
		expect(derived.saves.dex.mod).toBe(2); // not proficient
		expect(derived.skills.athletics.mod).toBe(6);
		expect(derived.passivePerception).toBe(13); // 10 + wis 0 + pb 3, perception proficient
		expect(derived.initiative).toBe(2);
		expect(derived.spell).toBeNull();
	});

	it("Should derive a level 11 cleric's spellcasting stats", () => {
		const state = getBaseState({
			level: 11,
			abil_wis: 18,
			spellAbility: "wis",
		});
		const derived = deriveCharacterSheet(state);

		expect(derived.pb).toBe(4);
		expect(derived.spell.dc).toBe(16); // 8 + 4 + 4
		expect(derived.spell.atkMod).toBe(8);
	});

	it("Should sum structured class levels over the manual level field", () => {
		const state = getBaseState({
			level: 1,
			classes: [
				{id: "a", name: "Fighter", source: "PHB", level: 3},
				{id: "b", name: "Wizard", source: "PHB", level: 2},
			],
		});
		expect(getTotalLevel(state)).toBe(5);
		expect(getProfBonus(state)).toBe(3);
	});

	it("Should apply expertise as double proficiency", () => {
		const state = getBaseState({
			level: 9,
			abil_dex: 16,
			skill_stealth: 2,
		});
		const derived = deriveCharacterSheet(state);
		expect(derived.pb).toBe(4);
		expect(derived.skills.stealth.mod).toBe(11); // 3 + 2×4
	});

	it("Should treat blank abilities as 10 and clamp level to 1-20", () => {
		const stateBlank = getBaseState({abil_str: null, level: null});
		const derivedBlank = deriveCharacterSheet(stateBlank);
		expect(derivedBlank.abilities.str.mod).toBe(0);
		expect(derivedBlank.totalLevel).toBe(1);

		const stateHigh = getBaseState({level: 25});
		expect(getTotalLevel(stateHigh)).toBe(20);
		expect(getProfBonus(stateHigh)).toBe(6);

		const stateMulti = getBaseState({classes: [{id: "a", name: "Fighter", source: "PHB", level: 22}]});
		expect(getTotalLevel(stateMulti)).toBe(20);
	});

	it("Should include miscellaneous initiative bonuses", () => {
		const state = getBaseState({abil_dex: 14, initMisc: 5});
		expect(deriveCharacterSheet(state).initiative).toBe(7);
	});
});
