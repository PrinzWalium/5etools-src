import "../../js/parser.js";
import {deriveArmorClass, deriveCharacterSheet, formatBreakdown, getAbilityScoreParts, getConcentrationSaveDc, getEquippedMagicBonuses, getProfBonus, getTotalLevel, getUnarmedStrike, getWeaponAttack, hasSpellcasting} from "../../js/charactersheet/charactersheet-derive.js";

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

	describe("Weapon attacks", () => {
		it("Should use Strength for a melee weapon (with proficiency)", () => {
			const state = getBaseState({abil_str: 16, level: 5}); // Str +3, PB +3
			const atk = getWeaponAttack(state, {name: "Longsword", type: "M", dmg1: "1d8", dmgType: "S"});
			expect(atk.name).toBe("Longsword");
			expect(atk.atkBonus).toBe(6);
			expect(atk.damage).toMatch(/^1d8\+3 slashing$/i);
		});

		it("Should use Dexterity for ranged and the better of Str/Dex for finesse", () => {
			const state = getBaseState({abil_str: 10, abil_dex: 18});
			expect(getWeaponAttack(state, {name: "Longbow", type: "R", dmg1: "1d8", dmgType: "P"}).damage).toMatch(/^1d8\+4 piercing$/i);
			expect(getWeaponAttack(state, {name: "Dagger", type: "M", properties: ["F"], dmg1: "1d4", dmgType: "P"}).damage).toMatch(/^1d4\+4 piercing$/i);
		});

		it("Should fold in magic attack/damage bonuses", () => {
			const state = getBaseState({abil_str: 16, level: 1}); // Str +3, PB +2
			const atk = getWeaponAttack(state, {name: "+1 Longsword", type: "M", dmg1: "1d8", dmgType: "S", bonusAttack: 1, bonusDamage: 1});
			expect(atk.atkBonus).toBe(6); // 3 + 2 + 1
			expect(atk.damage).toMatch(/^1d8\+4 slashing$/i); // 3 + 1
		});

		it("Should build the Unarmed Strike from Strength", () => {
			const state = getBaseState({abil_str: 14, level: 1}); // Str +2, PB +2
			expect(getUnarmedStrike(state)).toMatchObject({name: "Unarmed Strike", atkBonus: 4, damage: "3 bludgeoning"});
			expect(getUnarmedStrike(state).atkParts.map(p => p.label)).toEqual(["Strength", "Proficiency"]);
		});
	});

	describe("Equipped magic bonuses (saves / spell DC / spell attack)", () => {
		it("Should sum only equipped items", () => {
			const inv = [
				{id: "c", name: "Cloak of Protection", bonusSavingThrow: 1, bonusAc: 1, equipped: true},
				{id: "r", name: "Rod of the Pact Keeper", bonusSpellSaveDc: 1, bonusSpellAttack: 1, equipped: false},
			];
			expect(getEquippedMagicBonuses({inventory: inv})).toEqual({savingThrow: 1, spellSaveDc: 0, spellAttack: 0});
			inv[1].equipped = true;
			expect(getEquippedMagicBonuses({inventory: inv})).toEqual({savingThrow: 1, spellSaveDc: 1, spellAttack: 1});
		});

		it("Should flow into saving throws and spell DC/attack in the full derivation", () => {
			const state = getBaseState({
				abil_cha: 16,
				level: 5,
				save_cha: true,
				spellAbility: "cha", // Cha +3, PB +3
				inventory: [{id: "c", name: "Cloak of Protection", bonusSavingThrow: 1, equipped: true},
					{id: "r", name: "Rod", bonusSpellSaveDc: 1, bonusSpellAttack: 1, equipped: true}],
			});
			const d = deriveCharacterSheet(state);
			expect(d.saves.cha.mod).toBe(7); // 3 + 3 (prof) + 1 (cloak)
			expect(d.saves.str.mod).toBe(1); // 0 + 1 (cloak), no proficiency
			expect(d.spell.dc).toBe(15); // 8 + 3 + 3 + 1
			expect(d.spell.atkMod).toBe(7); // 3 + 3 + 1
		});
	});
});

describe("Derive: fighting-style effects", () => {
	const withStyle = (name, overrides = {}) => getBaseState({
		classes: [{optionalFeatures: [{name}]}],
		...overrides,
	});

	it("Archery adds +2 to ranged weapon attacks only", () => {
		const bow = {name: "Longbow", type: "R", dmg1: "1d8", dmgType: "P", properties: ["A", "2H"]};
		const sword = {name: "Longsword", type: "M", dmg1: "1d8", dmgType: "S", properties: []};
		const state = withStyle("Archery", {abil_dex: 14, abil_str: 14});
		expect(getWeaponAttack(state, bow).atkBonus).toBe(2 + 2 + 2); // Dex +2, PB +2, Archery +2
		expect(getWeaponAttack(state, sword).atkBonus).toBe(2 + 2); // melee: unaffected
	});

	it("Defense adds +1 AC only while wearing armor", () => {
		const armor = {name: "Chain Shirt", isArmor: true, type: "MA", baseAc: 13, dexterityMax: 2, equipped: true};
		expect(deriveArmorClass(withStyle("Defense", {inventory: [armor]})).ac).toBe(14); // 13 + 1
		expect(deriveArmorClass(withStyle("Defense", {inventory: []})).ac).toBe(10); // unarmored: no bonus
	});

	it("Dueling adds +2 damage to one-handed melee weapons only", () => {
		const sword = {name: "Longsword", type: "M", dmg1: "1d8", dmgType: "S", properties: []};
		const greatsword = {name: "Greatsword", type: "M", dmg1: "2d6", dmgType: "S", properties: ["2H", "H"]};
		const state = withStyle("Dueling", {abil_str: 14});
		expect(getWeaponAttack(state, sword).damage).toBe("1d8+4 slashing"); // Str +2, Dueling +2
		expect(getWeaponAttack(state, greatsword).damage).toBe("2d6+2 slashing"); // two-handed: unaffected
	});

	it("Thrown Weapon Fighting adds +2 damage to thrown weapons", () => {
		const javelin = {name: "Javelin", type: "M", dmg1: "1d6", dmgType: "P", properties: ["T"]};
		const state = withStyle("Thrown Weapon Fighting", {abil_str: 14});
		expect(getWeaponAttack(state, javelin).damage).toBe("1d6+4 piercing"); // Str +2, TWF +2
	});

	it("Styles chosen as 2024 feats apply the same way", () => {
		const bow = {name: "Shortbow", type: "R", dmg1: "1d6", dmgType: "P", properties: ["A", "2H"]};
		const state = getBaseState({abil_dex: 14, featureFeats: [{name: "Archery"}]});
		expect(getWeaponAttack(state, bow).atkBonus).toBe(2 + 2 + 2);
	});

	it("Leaves characters without a style untouched", () => {
		const bow = {name: "Longbow", type: "R", dmg1: "1d8", dmgType: "P", properties: ["A", "2H"]};
		expect(getWeaponAttack(getBaseState({abil_dex: 14}), bow).atkBonus).toBe(2 + 2);
	});
});

describe("Derive: breakdowns (where a number comes from)", () => {
	it("Explains a save: ability, proficiency and magic items", () => {
		const cloak = {name: "Cloak of Protection", equipped: true, bonusSavingThrow: 1};
		const state = getBaseState({level: 5, abil_dex: 16, save_dex: true, inventory: [cloak]});
		const {saves} = deriveCharacterSheet(state);
		expect(saves.dex.mod).toBe(3 + 3 + 1); // Dex +3, PB +3, cloak +1
		expect(saves.dex.parts.map(p => p.label)).toEqual(["Dexterity", "Proficiency", "Magic items"]);
		expect(formatBreakdown(saves.dex.parts, saves.dex.mod)).toBe("Dexterity +3, Proficiency +3, Magic items +1 = +7");
	});

	it("Explains a skill, and distinguishes Expertise", () => {
		const state = getBaseState({level: 1, abil_dex: 14, skill_stealth: 2, skill_acrobatics: 1});
		const {skills} = deriveCharacterSheet(state);
		expect(formatBreakdown(skills.stealth.parts, skills.stealth.mod)).toBe("Dexterity +2, Expertise (2× proficiency) +4 = +6");
		expect(formatBreakdown(skills.acrobatics.parts, skills.acrobatics.mod)).toBe("Dexterity +2, Proficiency +2 = +4");
	});

	it("Keeps a zero ability modifier visible but drops absent contributions", () => {
		const {skills} = deriveCharacterSheet(getBaseState({skill_arcana: 0}));
		// Int +0 is shown (it is a real contribution); there is no proficiency part
		expect(skills.arcana.parts.map(p => p.label)).toEqual(["Intelligence"]);
	});

	it("Explains Armor Class from armor, shield, magic and fighting style", () => {
		const state = getBaseState({
			abil_dex: 14,
			classes: [{optionalFeatures: [{name: "Defense"}]}],
			inventory: [
				{name: "Chain Shirt", isArmor: true, type: "MA", baseAc: 13, dexterityMax: 2, equipped: true},
				{name: "Shield", type: "S", baseAc: 2, equipped: true},
			],
			acMisc: 1,
		});
		const ac = deriveArmorClass(state);
		expect(ac.ac).toBe(13 + 2 + 2 + 1 + 1);
		expect(ac.parts.map(p => p.label))
			.toEqual(["Chain Shirt", "Dexterity (max +2)", "Shield", "Defense (fighting style)", "Misc"]);
	});

	it("Explains initiative and passive Perception", () => {
		const state = getBaseState({abil_dex: 16, initMisc: 2, skill_perception: 1});
		const d = deriveCharacterSheet(state);
		expect(formatBreakdown(d.initiativeParts, d.initiative)).toBe("Dexterity +3, Misc +2 = +5");
		expect(d.passivePerception).toBe(10 + d.skills.perception.mod);
		expect(d.passivePerceptionParts[0]).toMatchObject({label: "Base", value: 10});
	});

	it("Explains spell save DC and spell attack", () => {
		const rod = {name: "Rod of the Pact Keeper +1", equipped: true, bonusSpellSaveDc: 1, bonusSpellAttack: 1};
		const state = getBaseState({level: 5, abil_cha: 18, spellAbility: "cha", inventory: [rod]});
		const {spell} = deriveCharacterSheet(state);
		expect(formatBreakdown(spell.dcParts, spell.dc - 0)).toContain("Base 8");
		expect(spell.dc).toBe(8 + 3 + 4 + 1);
		expect(spell.atkParts.map(p => p.label)).toEqual(["Proficiency", "Charisma", "Magic items"]);
	});

	it("Explains a weapon attack including its fighting style", () => {
		const bow = {name: "Longbow +1", type: "R", dmg1: "1d8", dmgType: "P", properties: ["A", "2H"], bonusAttack: 1, bonusDamage: 1};
		const state = getBaseState({abil_dex: 16, classes: [{optionalFeatures: [{name: "Archery"}]}]});
		const atk = getWeaponAttack(state, bow);
		expect(atk.atkBonus).toBe(3 + 2 + 1 + 2);
		expect(atk.atkParts.map(p => p.label)).toEqual(["Dexterity", "Proficiency", "Magic weapon", "Archery (fighting style)"]);
		expect(atk.damageParts[0]).toMatchObject({label: "1d8", isText: true});
	});

	it("Shows value-type totals unsigned (AC, DC, passive) but bonuses signed", () => {
		const parts = [{label: "Base", value: 10, isRaw: true}, {label: "Dexterity", value: 3}];
		expect(formatBreakdown(parts, 13, {isTotalValue: true})).toBe("Base 10, Dexterity +3 = 13");
		expect(formatBreakdown(parts, 13)).toBe("Base 10, Dexterity +3 = +13");
		expect(formatBreakdown([], null)).toBe("");
		expect(formatBreakdown(null, -2)).toBe("−2");
	});

	it("Explains an ability score from its recorded increases", () => {
		const state = getBaseState({
			abil_str: 17,
			abilityBonusLog: [
				{id: "a", source: "Dragonborn", bonuses: {str: 2}},
				{id: "b", source: "Ability Score Improvement", bonuses: {str: 2, con: 1}},
			],
		});
		const parts = getAbilityScoreParts(state, "str");
		expect(parts).toEqual([
			{label: "Base", value: 13, isRaw: true},
			{label: "Dragonborn", value: 2},
			{label: "Ability Score Improvement", value: 2},
		]);
	});

	it("Falls back to a plain base score with no recorded increases", () => {
		expect(getAbilityScoreParts(getBaseState({abil_str: 15}), "str"))
			.toEqual([{label: "Base", value: 15, isRaw: true}]);
	});
});

describe("Spellcasting presence", () => {
	it("Is false for a character with nothing spell-related", () => {
		expect(hasSpellcasting({spellsKnown: [], inventory: []})).toBe(false);
		expect(hasSpellcasting(null)).toBe(false);
		expect(hasSpellcasting({})).toBe(false);
	});

	it("Is true for a class caster, even before any spell is picked", () => {
		expect(hasSpellcasting({}, {isClassCaster: true})).toBe(true);
	});

	it("Is true once a spell arrives from a species, feat or by hand", () => {
		expect(hasSpellcasting({spellsKnown: [{name: "Fire Bolt"}]})).toBe(true);
		expect(hasSpellcasting({grantedSpellChoices: [{name: "Bless"}]})).toBe(true);
	});

	it("Is true for a spell-carrying magic item", () => {
		expect(hasSpellcasting({inventory: [{name: "Longsword"}]})).toBe(false);
		expect(hasSpellcasting({inventory: [{name: "Wand of Magic Missiles", grantsSpells: true}]})).toBe(true);
	});

	it("Is true once a spellcasting ability is set, or notes are written", () => {
		expect(hasSpellcasting({spellAbility: "int"})).toBe(true);
		expect(hasSpellcasting({spellsText: "  "})).toBe(false);
		expect(hasSpellcasting({spellsText: "Ritual: Find Familiar"})).toBe(true);
	});
});

describe("Derive: exhaustion", () => {
	// 2024 rules: each level of exhaustion takes 2 off every d20 test and 5 feet off speed
	const getExhausted = level => deriveCharacterSheet(getBaseState({
		level: 5,
		exhaustion: level,
		abil_str: 16,
		abil_dex: 14,
		abil_con: 14,
		save_con: true,
		skill_athletics: 1,
		skill_perception: 1,
		spellAbility: "int",
	}));

	it("Costs nothing at all while the character is rested", () => {
		const rested = getExhausted(0);
		expect(rested.exhaustion).toEqual({level: 0, penalty: 0, speedPenaltyFt: 0});
		expect(rested.saves.con.mod).toBe(5);
		expect(rested.skills.athletics.mod).toBe(6);
		expect(rested.initiative).toBe(2);
	});

	it("Takes 2 per level off saving throws, skills and ability checks", () => {
		const tired = getExhausted(2);
		expect(tired.exhaustion).toEqual({level: 2, penalty: -4, speedPenaltyFt: 10});
		expect(tired.saves.con.mod).toBe(1); // 5 − 4
		expect(tired.skills.athletics.mod).toBe(2); // 6 − 4
		expect(tired.abilities.str.checkMod).toBe(-1); // +3 − 4
	});

	it("Leaves the ability modifier itself alone, so nothing derived from it double-counts", () => {
		const tired = getExhausted(2);
		expect(tired.abilities.str.mod).toBe(3);
		expect(tired.abilities.str.score).toBe(16);
	});

	it("Takes it off attack rolls, both weapon and unarmed", () => {
		const state = getBaseState({level: 5, abil_str: 16, exhaustion: 1});
		expect(getUnarmedStrike(state).atkBonus).toBe(3 + 3 - 2);
		expect(getWeaponAttack(state, {name: "Longsword", dmg1: "1d8", dmgType: "S"}).atkBonus).toBe(3 + 3 - 2);
		// ... but not off the damage it deals
		expect(getWeaponAttack(state, {name: "Longsword", dmg1: "1d8", dmgType: "S"}).damage).toBe("1d8+3 slashing");
	});

	it("Takes it off spell attacks, but not off the spell save DC", () => {
		const tired = getExhausted(3);
		const rested = getExhausted(0);
		expect(tired.spell.dc).toBe(rested.spell.dc);
		expect(tired.spell.atkMod).toBe(rested.spell.atkMod - 6);
	});

	it("Drags down initiative and passive Perception, which are checks too", () => {
		const tired = getExhausted(1);
		expect(tired.initiative).toBe(0); // dex +2 − 2
		expect(tired.passivePerception).toBe(getExhausted(0).passivePerception - 2);
	});

	it("Says so in the breakdown", () => {
		expect(getExhausted(2).saves.con.parts.some(it => /Exhaustion 2/.test(it.label))).toBe(true);
		expect(getExhausted(0).saves.con.parts.some(it => /Exhaustion/.test(it.label))).toBe(false);
	});

	it("Stops at six, and ignores nonsense", () => {
		expect(getExhausted(9).exhaustion.penalty).toBe(-12);
		expect(deriveCharacterSheet(getBaseState({exhaustion: -3})).exhaustion.level).toBe(0);
		expect(deriveCharacterSheet(getBaseState({exhaustion: null})).exhaustion.level).toBe(0);
	});
});

describe("Derive: the concentration save after damage", () => {
	it("Is DC 10 for anything up to 20 damage", () => {
		expect(getConcentrationSaveDc(1)).toBe(10);
		expect(getConcentrationSaveDc(11)).toBe(10);
		expect(getConcentrationSaveDc(20)).toBe(10);
	});

	it("Is half the damage once that is higher", () => {
		expect(getConcentrationSaveDc(21)).toBe(10);
		expect(getConcentrationSaveDc(22)).toBe(11);
		expect(getConcentrationSaveDc(45)).toBe(22); // rounded down
	});

	it("Tolerates nonsense", () => {
		expect(getConcentrationSaveDc(0)).toBe(10);
		expect(getConcentrationSaveDc(null)).toBe(10);
	});
});
