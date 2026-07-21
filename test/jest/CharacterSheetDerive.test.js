import "../../js/parser.js";
import {deriveArmorClass, deriveCharacterSheet, getProfBonus, getTotalLevel} from "../../js/charactersheet/charactersheet-derive.js";

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

	describe("Armor Class", () => {
		it("Should default to 10 + Dex unarmored", () => {
			const state = getBaseState({abil_dex: 16});
			expect(deriveArmorClass(state).ac).toBe(13);
		});

		it("Should use light armor (base + full Dex) only when equipped", () => {
			const armor = {id: "a", type: "LA", isArmor: true, baseAc: 11, equipped: false};
			const state = getBaseState({abil_dex: 18, inventory: [armor]});
			expect(deriveArmorClass(state).ac).toBe(14); // unequipped → unarmored 10+4
			armor.equipped = true;
			expect(deriveArmorClass(state).ac).toBe(15); // 11 + 4
		});

		it("Should cap Dex on medium armor and ignore it on heavy", () => {
			const med = {id: "m", type: "MA", isArmor: true, baseAc: 15, equipped: true};
			expect(deriveArmorClass(getBaseState({abil_dex: 18, inventory: [med]})).ac).toBe(17); // 15 + min(4,2)
			const heavy = {id: "h", type: "HA", isArmor: true, baseAc: 16, equipped: true};
			expect(deriveArmorClass(getBaseState({abil_dex: 18, inventory: [heavy]})).ac).toBe(16); // no Dex
		});

		it("Should add shields, magic armor bonuses, and worn magic AC", () => {
			const inv = [
				{id: "a", type: "HA", isArmor: true, baseAc: 16, bonusAc: 1, equipped: true},
				{id: "s", type: "S", baseAc: 2, bonusAc: 1, equipped: true},
				{id: "r", type: "RG", bonusAc: 1, equipped: true}, // ring of protection
			];
			expect(deriveArmorClass(getBaseState({inventory: inv})).ac).toBe(21); // 16+1 +3 +1
		});

		it("Should apply Barbarian/Monk unarmored formulas, and honour manual mode", () => {
			const s = getBaseState({abil_dex: 14, abil_con: 16, abil_wis: 12});
			expect(deriveArmorClass({...s, acMode: "barbarian"}).ac).toBe(15); // 10 +2 +3
			expect(deriveArmorClass({...s, acMode: "monk"}).ac).toBe(13); // 10 +2 +1
			expect(deriveArmorClass({...s, acMode: "manual", ac: 20}).ac).toBe(20);
		});
	});
});
